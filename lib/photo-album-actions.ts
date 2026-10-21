import { collectPhotoAlbumAssets, resolvePhotoAlbumMedia, type PhotoAlbumAsset } from "./photo-album-storage";
import { albumParticipants, getAlbumDiscussion, saveAlbumDiscussion } from "./photo-album-discussion";
import { claimPhotoAction, releasePhotoAction, recordPhotoAction, getPhotoSeen, photoSeenBy, contentVersionOf, variantVersionOf, photoIdOf } from "./photo-album-core";
import { getAlbumPermission } from "./photo-album-permissions";
import { loadChatSessions, pushChatMessage } from "./chat-storage";
import { loadCharacters, saveCharacters } from "./character-storage";
import { storeMediaBlob, deleteMediaRef } from "./media-cache-storage";
import { kvGet, kvSet } from "./kv-db";

// 角色用相册照片换头像前，先把旧头像留一份（每个角色保留最近 3 个），需要时可以找回
const AVATAR_BACKUP_KEY = "ai_phone_album_avatar_backup_v1";
function backupPreviousAvatar(characterId: string, avatar: string | null | undefined): void {
  if (!avatar) return;
  try {
    const all = JSON.parse(kvGet(AVATAR_BACKUP_KEY) || "{}") as Record<string, Array<{ avatar: string; savedAt: string }>>;
    const list = (all[characterId] || []).filter(item => item.avatar !== avatar);
    all[characterId] = [{ avatar, savedAt: new Date().toISOString() }, ...list].slice(0, 3);
    kvSet(AVATAR_BACKUP_KEY, JSON.stringify(all));
  } catch { /* 备份失败不影响换头像以外的任何东西 */ }
}

export type AlbumActionKind = "forward" | "avatar" | "comment";
const inFlight = new Set<string>();

/** No arbitrary destinations: actions go only to this character's existing private chat. */
export async function executeAlbumAction(characterId: string, assetId: string, kind: AlbumActionKind, text: string, expectedVariant?: string, signal?: AbortSignal): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(`float-album-action:${characterId}`, { ifAvailable: true }, lock => lock ? runAlbumAction(characterId, assetId, kind, text, expectedVariant, signal) : false);
  return runAlbumAction(characterId, assetId, kind, text, expectedVariant, signal);
}

async function runAlbumAction(characterId: string, assetId: string, kind: AlbumActionKind, text: string, expectedVariant?: string, signal?: AbortSignal): Promise<boolean> {
  if (inFlight.has(characterId) || !["forward", "avatar", "comment"].includes(kind)) return false;
  inFlight.add(characterId);
  let claimed = false, copied: string | undefined, delivered = false;
  let asset: PhotoAlbumAsset | undefined;
  try {
    asset = collectPhotoAlbumAssets().find(a => a.id === assetId);
    if (!asset || (expectedVariant && variantVersionOf(asset) !== expectedVariant)) return false;
    if (kind !== "comment" && asset.source.kind !== "album") return false;
    const character = loadCharacters().find(c => c.id === characterId);
    const session = loadChatSessions().find(s => !s.isGroup && s.contactId === characterId);
    if (!character || (kind !== "comment" && !session)) return false;
    const seen = getPhotoSeen(asset, characterId);
    if (!seen || seen.variantVersion !== variantVersionOf(asset) || !albumParticipants(asset).includes(characterId)) return false;
    if (kind === "avatar" && !seen.visual) return false;
    // Prevent a batch of fresh photos from producing a burst of chat/avatar actions.
    if (kind !== "comment" && photoSeenBy(characterId).some(s => s.actionNotes?.some(n => Date.now() - Date.parse(n.at) < 60_000))) return false;
    const revision = getAlbumPermission(asset.uploadAlbum).revision;
    const valid = () => {
      const live = collectPhotoAlbumAssets().find(a => a.id === assetId);
      return !signal?.aborted && live && variantVersionOf(live) === variantVersionOf(asset!) && albumParticipants(live).includes(characterId)
        && (live.source.kind !== "album" || getAlbumPermission(live.uploadAlbum).revision === revision)
        && (kind === "comment" || loadChatSessions().some(s => s.id === session!.id && !s.isGroup && s.contactId === characterId));
    };
    const caption = text.trim().slice(0,500);
    let avatar: string | undefined;
    if (kind !== "comment" && asset.mediaKind === "photo") {
      const media = await resolvePhotoAlbumMedia(asset.mediaRef);
      if (!media) return false;
      try {
        if (kind === "avatar") {
          const marks = [...asset.baseAnnotations, ...asset.albumAnnotations];
          const { compositePhotoAnnotations } = await import("./chat-photo-markup");
          const composite = marks.length ? await compositePhotoAnnotations(media.url, marks) : media.url;
          if (!composite) return false; // Never silently use the unmarked original.
          const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => resolve(img); img.onerror = reject; img.src = composite;
          });
          const canvas = document.createElement("canvas");
          const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const ctx = canvas.getContext("2d"); if (!ctx) return false;
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height); avatar = canvas.toDataURL("image/jpeg", .85);
        } else {
          const response = await fetch(media.url, { signal }); if (!response.ok) return false;
          const blob = await response.blob(); if (!valid()) return false;
          copied = await storeMediaBlob(blob, blob.type || "image/jpeg", "image");
        }
      } finally { if (media.revoke) URL.revokeObjectURL(media.url); }
    } else if (kind === "avatar") return false;
    if (!valid() || !claimPhotoAction(asset, characterId, kind)) return false;
    claimed = true;
    if (kind === "forward") {
      pushChatMessage({ sessionId: session!.id, role: "assistant", senderCharacterId: characterId, senderName: character.name,
        content: caption, mediaType: "image", mediaUrl: copied, status: "sent",
        mediaData: { label: asset.label, photoKind: asset.mediaKind, photoAnnotations: [...asset.baseAnnotations, ...asset.albumAnnotations], albumPhotoId: photoIdOf(asset), albumContentVersion: contentVersionOf(asset), albumVariantVersion: variantVersionOf(asset) } });
      delivered = true;
    } else if (kind === "avatar") {
      if (!setAvatarFromSharedAlbum(session!.id, characterId, avatar!)) return false;
      delivered = true;
    } else {
      if (!caption) return false;
      const thread = getAlbumDiscussion(asset);
      saveAlbumDiscussion({ ...thread, comments: [...thread.comments, { id: `album-action-${Date.now()}-${Math.random()}`, authorId: characterId, authorName: character.name, text: caption, kind: "comment", createdAt: new Date().toISOString() }] });
      delivered = true;
    }
    recordPhotoAction(asset, characterId, `${kind === "forward" ? "已向用户转发照片" : kind === "avatar" ? "已设为自己的私聊头像" : "已在相册评论"}（版本 ${variantVersionOf(asset)}）：${caption}`);
    return true;
  } finally {
    if (!delivered && claimed && asset) releasePhotoAction(asset, characterId, kind);
    if (!delivered && copied) await deleteMediaRef(copied).catch(() => undefined);
    inFlight.delete(characterId);
  }
}

/**
 * 角色把相册照片设为自己的头像。Float 的头像是角色级的（各聊天共用），
 * 做法和聊天里「接受头像推荐」一致：改角色头像，并在私聊里留一条系统提示。
 */
function setAvatarFromSharedAlbum(sessionId: string, characterId: string, avatar: string): boolean {
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(avatar)) return false;
  const characters = loadCharacters();
  const index = characters.findIndex(c => c.id === characterId);
  if (index < 0) return false;
  backupPreviousAvatar(characterId, characters[index].avatar);
  characters[index] = { ...characters[index], avatar, updatedAt: new Date().toISOString() };
  saveCharacters(characters);
  pushChatMessage({ sessionId, role: "system", content: `${characters[index].name} 更换了头像`, status: "sent" });
  return true;
}

