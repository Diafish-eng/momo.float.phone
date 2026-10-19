"use client";

// 表情包搜索联想：输入时按名称模糊匹配本地表情包，横向列表浮在输入框正上方，
// 点击直接发送（复用 onSendSticker 的 sticker 消息通道），发送后由父组件清空输入。
// 数据源 = 内置表情包（sticker-data，emoji 兜底）+ 当前会话角色绑定的自定义贴纸包（IndexedDB 解析出 url）。

import { useEffect, useMemo, useRef, useState } from "react";
import { STICKER_PACKS } from "@/lib/sticker-data";
import { loadStickerPacksForCharacters } from "@/lib/custom-sticker-storage";
import { getThemeAssetMap } from "@/lib/theme-storage";

export type StickerSearchItem = {
  key: string;
  name: string;
  /** 自定义贴纸解析出的图片地址（dataUrl / externalUrl） */
  url?: string;
  /** 内置表情的 emoji 兜底显示 */
  emoji?: string;
  /** 自定义贴纸存在本地库里的图片 id；只在要显示时才去读图 */
  assetId?: string;
};

/** 已读过的贴纸图片（assetId → url），整个页面共用，同一张图只读一次 */
const stickerUrlCache = new Map<string, string>();

type StickerSearchSuggestProps = {
  /** 当前输入框的原始文本 */
  query: string;
  /** 会话相关的角色 id（单聊=[contactId]，群聊=participantIds） */
  characterIds: string[];
  /** 发送：与 ChatTextInputBar 的 onSendSticker 一致（name, url?） */
  onSend: (name: string, url?: string) => void;
  /** 关闭联想（发送后 / ESC / 失焦由父组件控制，这里只负责发送后收起） */
  onClose: () => void;
};

const DEBOUNCE_MS = 300;
const MAX_RESULTS = 12;

export function StickerSearchSuggest({ query, characterIds, onSend, onClose }: StickerSearchSuggestProps) {
  // ── 防抖：输入停止 300ms 后再匹配 ──
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // ── 自定义贴纸：只取名字（很轻）；图片等匹配出来要显示时再读 ──
  // 以前这里一挂载就把所有贴纸图片逐张从 IndexedDB 读出来，而联想在输入框清空时会卸载、
  // 打下一条消息的第一个字时重新挂载，于是每条消息开头都要全量读一遍图，打字会卡
  const [customItems, setCustomItems] = useState<StickerSearchItem[]>([]);
  useEffect(() => {
    const packs = loadStickerPacksForCharacters(characterIds).filter((pack) => pack.stickers.length > 0);
    const items: StickerSearchItem[] = [];
    for (const pack of packs) {
      for (const sticker of pack.stickers) {
        const assetId = sticker.externalUrl ? undefined : sticker.assetId || undefined;
        items.push({
          key: `custom:${pack.id}:${sticker.id}`,
          name: sticker.name,
          url: sticker.externalUrl || (assetId ? stickerUrlCache.get(assetId) : undefined),
          assetId,
        });
      }
    }
    setCustomItems(items);
  }, [characterIds]);

  // ── 内置表情包（emoji 兜底） ──
  const builtinItems = useMemo<StickerSearchItem[]>(
    () =>
      STICKER_PACKS.flatMap((pack) =>
        pack.stickers.map((sticker) => ({ key: `builtin:${sticker.name}`, name: sticker.name, emoji: sticker.emoji })),
      ),
    [],
  );

  // ── 模糊匹配 + 排序（前缀优先，再包含；同名去重，自定义优先） ──
  const results = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    if (!q) return [];
    const rank = (name: string): number => {
      const n = name.toLowerCase();
      if (n === q) return 0;
      if (n.startsWith(q)) return 1;
      if (n.includes(q)) return 2;
      return -1;
    };
    const scored = [...customItems, ...builtinItems]
      .map((item) => ({ item, rank: rank(item.name) }))
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.item.name.length - b.item.name.length);
    const seen = new Set<string>();
    const out: StickerSearchItem[] = [];
    for (const { item } of scored) {
      if (seen.has(item.name)) continue;
      seen.add(item.name);
      out.push(item);
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }, [debouncedQuery, builtinItems, customItems]);

  // ── 只给要显示的这几张读图（最多 MAX_RESULTS 张），读过的进缓存 ──
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});
  const pendingIdsRef = useRef(new Set<string>());
  useEffect(() => {
    const missing = results
      .map((item) => item.assetId)
      .filter((id): id is string => !!id && !stickerUrlCache.has(id) && !pendingIdsRef.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => pendingIdsRef.current.add(id));
    let cancelled = false;
    void getThemeAssetMap(missing).then((map) => {
      for (const [id, url] of Object.entries(map)) if (url) stickerUrlCache.set(id, url);
      missing.forEach((id) => pendingIdsRef.current.delete(id));
      if (!cancelled) setResolvedUrls((prev) => ({ ...prev, ...map }));
    }).catch(() => { missing.forEach((id) => pendingIdsRef.current.delete(id)); });
    return () => { cancelled = true; };
  }, [results]);
  const urlOf = (item: StickerSearchItem): string | undefined =>
    item.url || (item.assetId ? stickerUrlCache.get(item.assetId) || resolvedUrls[item.assetId] : undefined);

  if (!debouncedQuery || results.length === 0) return null;

  return (
    <div
      className="sticker-search-suggest"
      style={{ position: "absolute", left: 0, right: 0, bottom: "100%", zIndex: 60, marginBottom: 6 }}
      // 阻止 mousedown 默认行为：点击列表项时不触发 textarea 失焦，避免列表在 click 前被 blur 关掉
      onMouseDown={(event) => event.preventDefault()}
    >
      <div
        className="flex items-stretch gap-2 overflow-x-auto px-3 py-2.5 rounded-2xl hide-scrollbar"
        style={{
          background: "color-mix(in srgb, var(--c-card) 96%, transparent)",
          border: "1px solid var(--c-card-border)",
          boxShadow: "0 8px 28px rgba(0,0,0,0.12)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          maxWidth: "100%",
        }}
      >
        {results.map((item) => { const url = urlOf(item); return (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              onSend(item.name, url);
              onClose();
            }}
            className="shrink-0 flex flex-col items-center gap-1 px-2.5 py-2 rounded-xl bg-transparent border-none cursor-pointer transition-transform active:scale-95"
            style={{ minWidth: 64 }}
            title={item.name}
          >
            <span className="w-14 h-14 flex items-center justify-center overflow-hidden">
              {url ? (
                <img src={url} alt={item.name} className="w-14 h-14 object-contain" draggable={false} />
              ) : item.emoji ? (
                <span className="text-[32px] leading-none">{item.emoji}</span>
              ) : (
                <span className="ts-11 text-[var(--c-text)] w-full text-center truncate">{item.name}</span>
              )}
            </span>
            <span className="ts-11 text-[var(--c-text)] opacity-75 max-w-[64px] truncate leading-tight">{item.name}</span>
          </button>
        ); })}
      </div>
    </div>
  );
}
