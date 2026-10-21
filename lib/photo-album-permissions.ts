import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { PHOTO_ALBUM_UPDATED_EVENT, loadPhotoAlbumState, renameUploadAlbum } from "./photo-album-storage";

const KEY = "ai_phone_album_permissions_v1";
registerKvMigration(KEY);
export const GENERATED_ALBUM_PERMISSION = "::float-generated-album::";
export type AlbumPermission = { characterIds: string[]; revision: string; availableAt: number };
export function getAlbumPermission(name?: string): AlbumPermission {
  try {
    const entry = JSON.parse(kvGet(KEY) || "{}")[name || GENERATED_ALBUM_PERMISSION];
    if (entry && Array.isArray(entry.characterIds) && typeof entry.revision === "string" && Number.isFinite(entry.availableAt)) {
      return { characterIds: [...new Set(entry.characterIds.filter((id: unknown): id is string => typeof id === "string" && !!id))] as string[], revision: entry.revision, availableAt: entry.availableAt };
    }
  } catch { /* Older albums are private by default. */ }
  return { characterIds: [], revision: "private", availableAt: 0 };
}
export function setAlbumPermission(name: string, characterIds: string[]): void {
  if (!name.trim()) return;
  let all: Record<string, AlbumPermission>;
  try { all = JSON.parse(kvGet(KEY) || "{}"); } catch { all = {}; }
  const ids = [...new Set(characterIds)];
  const previous = getAlbumPermission(name);
  if (previous.characterIds.length === ids.length && ids.every(id => previous.characterIds.includes(id))) return;
  const entry = { characterIds: ids, revision: `${Date.now()}-${Math.random()}`, availableAt: Date.now() + 60_000 };
  kvSet(KEY, JSON.stringify({ ...all, [name]: entry }));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PHOTO_ALBUM_UPDATED_EVENT));
}

export function updateUploadAlbum(previous: string, name: string, characterIds: string[]): string {
  const next = name.trim();
  if (next === GENERATED_ALBUM_PERMISSION) throw new Error("请使用其他专辑名字。");
  if (!next || next.length > 60) throw new Error("请输入 1–60 字的专辑名字。");
  if (next !== previous) {
    if (loadPhotoAlbumState().nativeAssets.some(a => a.uploadAlbum === next)) throw new Error("这个专辑名字已经存在。");
    let all: Record<string, AlbumPermission>;
    try { all = JSON.parse(kvGet(KEY) || "{}"); } catch { all = {}; }
    // Preserve the permission revision on a pure rename: existing reviews stay valid.
    kvSet(KEY, JSON.stringify({ ...all, [next]: getAlbumPermission(previous) }));
    renameUploadAlbum(previous, next);
    delete all[previous];
    kvSet(KEY, JSON.stringify({ ...all, [next]: getAlbumPermission(next) }));
  }
  setAlbumPermission(next, characterIds);
  return next;
}
