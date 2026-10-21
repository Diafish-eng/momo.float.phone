import { generateImageFromConfiguredApi } from "./image-generation-service";
import { loadImageGenerationSettings } from "./settings-storage";
import { buildMultiImageSheetPrompt, createPhotoGroupPlan, resolveMultiImageGenerationSize, MULTI_IMAGE_TARGET_CELL_ASPECT_RATIO } from "./image-delivery-protocol";
import { splitImageGrid, type ImageGridCount } from "./image-grid-split";
import { deleteMediaRef, storeMediaBlob } from "./media-cache-storage";
import { collectPhotoAlbumAssets, upsertAlbumNativeAsset, photoAlbumSourceId, resolvePhotoAlbumMedia, type PhotoAlbumAsset } from "./photo-album-storage";
import { savePhotoDefinition, photoIdOf, contentVersionOf, variantVersionOf, type PhotoDefinitionInput } from "./photo-album-core";
import { loadChatMessages, loadChatSessions, pushChatMessage, CHAT_REQUEST_REPLY_EVENT } from "./chat-storage";
import { getChatImageFromIndexedDB } from "./chat-asset-storage";
import { loadCharacters } from "./character-storage";
import { GENERATED_ALBUM_PERMISSION } from "./photo-album-permissions";

let generating = false;
export type AlbumDraft = { id: string; blob: Blob; label: string };
export async function generateAlbumPhotos(description: string, count: 1 | ImageGridCount, characterId?: string | string[], referenceImageDataUrl?: string): Promise<AlbumDraft[]> {
  if (generating) throw new Error("上一组照片仍在生成，请稍候。");
  generating = true;
  try { return await generateDrafts(description, count, characterId, referenceImageDataUrl); }
  finally { generating = false; }
}
async function generateDrafts(description: string, count: 1 | ImageGridCount, characterId?: string | string[], referenceImageDataUrl?: string): Promise<AlbumDraft[]> {
  const settings = loadImageGenerationSettings();
  if (![1,2,4,6,9].includes(count) || !description.trim()) throw new Error("请填写画面描述并选择照片数量。");
  const characterIds = [...new Set(Array.isArray(characterId) ? characterId : characterId ? [characterId] : [])];
  if (characterIds.length > 3) throw new Error("最多选择三个角色参考。");
  // Float 的生图接口一次只带一张参考图（原版能同时带用户参考 + 最多三个角色参考）：
  // 有用户上传的参考就用它；否则用第一个所选角色在生图设置里的参考图（含选脸和固定外观描述）。
  // 其余角色只在提示词里点名。
  const characters = characterIds.map(id => loadCharacters().find(c => c.id === id));
  const mapping: string[] = [];
  let referenceCharacterId: string | undefined;
  if (referenceImageDataUrl) {
    mapping.push("参考图为用户上传参考，发生冲突时优先遵循用户参考和用户画面描述。");
  } else if (characterIds.length) {
    const first = characterIds[0];
    const reference = settings.characterReferences[first];
    if (!reference?.assetId || reference.enabled === false || !(await getChatImageFromIndexedDB(reference.assetId))) {
      throw new Error(`请先在生图设置中为「${characters[0]?.name || "所选角色"}」添加有效参考图。`);
    }
    referenceCharacterId = first;
    mapping.push(`参考图对应角色「${characters[0]?.name || first}」，仅用来识别该角色，不强制复制服装、姿势或表情。`);
  }
  const named = characters.slice(referenceCharacterId ? 1 : 0).map(c => c?.name).filter(Boolean);
  if (named.length) mapping.push(`画面中还有：${named.join("、")}。`);
  const sheet = count === 1 ? null : buildMultiImageSheetPrompt(createPhotoGroupPlan(count, description));
  // 多图一次生成整张拼版再切开：拼版尺寸要写进当前启用的 OpenAI 预设（Float 的模型/尺寸在预设里）
  const activePreset = settings.openaiPresets?.find(p => p.id === settings.activeOpenAiPresetId) || settings.openaiPresets?.[0];
  const sheetSize = sheet ? resolveMultiImageGenerationSize(sheet.canvasGuidance, { model: activePreset?.model || settings.model, configuredSize: activePreset?.size || settings.size }).size : undefined;
  const effectiveSettings = {
    ...settings,
    extraPrompt: "",
    ...(sheetSize ? { size: sheetSize } : {}),
    // 相册生图不叠加全局附加提示词（和原版一致）；预设里的同名字段会覆盖外层，所以预设里也清掉
    ...(settings.openaiPresets?.length ? { openaiPresets: settings.openaiPresets.map(p => p.id === activePreset?.id ? { ...p, extraPrompt: "", ...(sheetSize ? { size: sheetSize } : {}) } : p) } : {}),
  };
  const result = await generateImageFromConfiguredApi({ description: [sheet?.prompt || description, ...mapping].join("\n"),
    characterId: referenceCharacterId, useReferenceImage: Boolean(referenceCharacterId),
    referenceImageDataUrl, persistResult: false, settings: effectiveSettings });
  if (!result) throw new Error("请先在设置中启用并填写生图 API。");
  const pieces = sheet ? await splitImageGrid(result.blob, sheet.layout, { outputAspectRatio: MULTI_IMAGE_TARGET_CELL_ASPECT_RATIO }) : [result.blob];
  return pieces.map((blob, index) => ({ id: `lab-${Date.now()}-${Math.random().toString(36).slice(2)}-${index}`, blob, label: count === 1 ? description : `${description} · 第 ${index + 1} 张` }));
}

export async function saveAlbumDraft(draft: AlbumDraft, uploadAlbum?: string, definition?: PhotoDefinitionInput): Promise<string> {
  if (uploadAlbum === GENERATED_ALBUM_PERMISSION) throw new Error("请使用其他专辑名字。");
  if (definition?.confirmed && (!definition.text.trim() || !definition.characterIds.length)) throw new Error("请填写背景并选择角色。");
  const id = photoAlbumSourceId({ kind: "album", assetVersionId: draft.id });
  const existing = collectPhotoAlbumAssets().find(a => a.id === id);
  if (existing) { if (definition) savePhotoDefinition(existing, definition); return id; }
  const mediaRef = await storeMediaBlob(draft.blob, draft.blob.type || "image/jpeg", "image");
  try {
    upsertAlbumNativeAsset({ assetVersionId: draft.id, mediaRef, label: draft.label, photoKind: "photo", createdAt: new Date().toISOString(), uploadAlbum });
  } catch (error) { await deleteMediaRef(mediaRef); throw error; }
  const asset = collectPhotoAlbumAssets().find(a => a.id === id);
  if (asset && definition) savePhotoDefinition(asset, definition);
  return id;
}

export function albumForwardSessions(asset: PhotoAlbumAsset) {
  const source = asset.source;
  const sessions = loadChatSessions();
  const origin = source.kind === "chat" ? sessions.find(s => s.id === source.sessionId) : undefined;
  const sourceCharacterId = origin?.isGroup && source.kind === "chat"
    ? loadChatMessages(source.sessionId).find(m => m.id === source.messageId)?.senderCharacterId
    : origin?.contactId;
  return sessions.filter(s => s.id !== origin?.id && !(sourceCharacterId && !s.isGroup && sourceCharacterId === s.contactId));
}
export async function forwardAlbumPhoto(asset: PhotoAlbumAsset, sessionId: string): Promise<void> {
  const session = albumForwardSessions(asset).find(s => s.id === sessionId);
  if (!session) throw new Error("只能转发到已有聊天，且不能转回来源会话。");
  let mediaUrl: string | undefined;
  if (asset.mediaKind === "photo") {
    const media = await resolvePhotoAlbumMedia(asset.mediaRef);
    if (!media) throw new Error("照片暂时无法读取");
    try {
      const response = await fetch(media.url);
      if (!response.ok) throw new Error("照片读取失败");
      const blob = await response.blob();
      mediaUrl = await storeMediaBlob(blob, blob.type || "image/jpeg", "image");
    } finally { if (media.revoke) URL.revokeObjectURL(media.url); }
  }
  const current = collectPhotoAlbumAssets().find(a => a.id === asset.id);
  if (!current || variantVersionOf(current) !== variantVersionOf(asset) || !albumForwardSessions(current).some(s => s.id === sessionId)) {
    if (mediaUrl) await deleteMediaRef(mediaUrl).catch(() => undefined);
    throw new Error("照片或目标聊天已发生变化，请重新选择。");
  }
  pushChatMessage({ sessionId: session.id, role: "user", content: "", mediaType: "image", mediaUrl,
    mediaData: { label: asset.label, photoKind: asset.mediaKind, photoAnnotations: [...asset.baseAnnotations, ...asset.albumAnnotations], albumPhotoId: photoIdOf(asset), albumContentVersion: contentVersionOf(asset), albumVariantVersion: variantVersionOf(asset) } });
  window.dispatchEvent(new CustomEvent(CHAT_REQUEST_REPLY_EVENT, { detail: { sessionId: session.id } }));
}
