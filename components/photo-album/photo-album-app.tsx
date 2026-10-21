"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderHeart,
  Heart,
  Images,
  Pencil,
  SlidersHorizontal,
  Trash2,
  Send,
  Plus,
  Info,
  MoreHorizontal,
  Share,
  ArrowUp,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { AlbumImageLab, AlbumForwardDialog, AlbumUpload, AlbumPermissionDialog, PhotoDefinitionDialog } from "./photo-album-lab";
import { GENERATED_ALBUM_PERMISSION } from "@/lib/photo-album-permissions";
import { getPhotoDefinition, savePhotoDefinition } from "@/lib/photo-album-core";
import { editAlbumThought, rerollAlbumThought, notifyAlbumAnnotationChange, isAlbumAutoReviewEnabled, setAlbumAutoReviewEnabled, type AlbumComment } from "@/lib/photo-album-discussion";

import { PhotoMarkupEditor } from "@/components/chat/photo-markup-editor";
import { ALBUM_DISCUSSION_UPDATED, addUserAlbumComment, getAlbumDiscussion, queueAlbumReview, saveAlbumDiscussion, unreadAlbumReplies, markAlbumRepliesRead } from "@/lib/photo-album-discussion";
import { loadCharacters } from "@/lib/character-storage";
import { PhotoAlbumAnnotationLayer } from "@/components/photo-album/photo-album-annotation-layer";
import { hydrateChatStorage } from "@/lib/chat-storage";
import { hydrateKvDb } from "@/lib/kv-db";
import {
  getPhotoAlbumSourceUpdatedEvents,
  PHOTO_ALBUM_UPDATED_EVENT,
  collectPhotoAlbumAssets,
  removePhotoAlbumAssets,
  resolvePhotoAlbumMedia,
  restoreChatPhotosToAlbum,
  savePhotoAlbumAnnotations,
  setPhotoAlbumFavorite,
  setPhotoAlbumFavorites,
  type PhotoAlbumAsset,
  type PhotoAlbumConversation,
} from "@/lib/photo-album-storage";

type PhotoAlbumAppProps = { onClose: () => void };
type FilterKind = "all" | "photo" | "text_photo";
type CategoryKind = "private" | "group" | "favorite";
type Route =
  | { kind: "library" }
  | { kind: "collections" }
  | { kind: "category"; category: CategoryKind }
  | { kind: "album"; conversationId: string }
  | { kind: "detail"; assetId: string; photoIds?: string[] }
  | { kind: "lab" }
  | { kind: "upload" }
  | { kind: "native"; name?: string };

type ConversationAlbum = PhotoAlbumConversation & { assets: PhotoAlbumAsset[] };

const FILTER_LABELS: Record<FilterKind, string> = {
  all: "全部",
  photo: "照片",
  text_photo: "文字图",
};

function applyFilter(assets: PhotoAlbumAsset[], filter: FilterKind): PhotoAlbumAsset[] {
  return filter === "all" ? assets : assets.filter((asset) => asset.mediaKind === filter);
}

function formatPhotoDate(value: string): { date: string; time: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "未知日期", time: "" };
  return {
    date: new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date),
    time: new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date),
  };
}

function PhotoAlbumMedia({ asset, className = "", eager = false }: { asset: PhotoAlbumAsset; className?: string; eager?: boolean }) {
  const [url, setUrl] = useState("");
  const [ratio, setRatio] = useState(.84);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let revokeUrl = "";
    setUrl("");
    setFailed(false);
    if (asset.mediaKind === "text_photo") return;
    resolvePhotoAlbumMedia(asset.mediaRef).then((resolved) => {
      if (cancelled) { if (resolved?.revoke) URL.revokeObjectURL(resolved.url); return; }
      if (!resolved) {
        setFailed(true);
        return;
      }
      setUrl(resolved.url);
      if (resolved.revoke) revokeUrl = resolved.url;
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [asset.id, asset.mediaKind, asset.mediaRef]);

  const annotations = [...asset.baseAnnotations, ...asset.albumAnnotations];
  if (asset.mediaKind === "photo" && failed) {
    return (
      <div className={`photo-album-media photo-album-media-fallback ${className}`} aria-label="照片暂时无法读取">
        <Images aria-hidden="true" />
        <span>照片暂时无法读取</span>
      </div>
    );
  }
  if (asset.mediaKind === "text_photo" || !url) {
    return (
      <div className={`photo-album-media photo-album-text-photo ${className}`} data-loading={asset.mediaKind === "photo" && !url ? "" : undefined}>
        <span>{asset.mediaKind === "photo" && !url ? "" : asset.label}</span>
        <PhotoAlbumAnnotationLayer annotations={annotations} />
      </div>
    );
  }
  return (
    <div className={`photo-album-media ${className}`} style={{ "--pa-photo-ratio": ratio } as React.CSSProperties}>
      <img src={url} alt={asset.label} draggable={false} loading={eager ? "eager" : "lazy"} onLoad={e => { const img = e.currentTarget; if (img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight); }} onError={() => setFailed(true)} />
      <PhotoAlbumAnnotationLayer annotations={annotations} />
    </div>
  );
}

function PhotoAlbumMarkupEditor({ asset, onClose, onSave }: {
  asset: PhotoAlbumAsset;
  onClose: () => void;
  onSave: (annotations: PhotoAlbumAsset["albumAnnotations"]) => void;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let revokeUrl = "";
    setUrl("");
    setFailed(false);
    if (asset.mediaKind === "text_photo") return;
    resolvePhotoAlbumMedia(asset.mediaRef).then((resolved) => {
      if (cancelled) return;
      if (!resolved) {
        setFailed(true);
        return;
      }
      setUrl(resolved.url);
      if (resolved.revoke) revokeUrl = resolved.url;
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [asset.id, asset.mediaKind, asset.mediaRef]);

  if (asset.mediaKind === "photo" && failed) {
    return (
      <div className="photo-album-editor-error" role="alert">
        <button type="button" className="photo-album-glass-button" onClick={onClose} aria-label="返回"><ChevronLeft /></button>
        <Images aria-hidden="true" />
        <strong>照片暂时无法读取</strong>
      </div>
    );
  }
  if (asset.mediaKind === "photo" && !url) return <div className="photo-album-editor-loading" aria-label="正在准备照片" />;
  return (
    <PhotoMarkupEditor
      imageUrl={url || undefined}
      fallbackText={asset.label}
      initial={asset.albumAnnotations}
      onClose={onClose}
      onSave={onSave}
      renderLayer={(annotations, selectedId) => <><PhotoAlbumAnnotationLayer annotations={asset.baseAnnotations} /><PhotoAlbumAnnotationLayer annotations={annotations} selectedId={selectedId} /></>}
    />
  );
}

function AlbumAvatar({ conversation, size = "small" }: { conversation: PhotoAlbumConversation; size?: "small" | "large" }) {
  if (conversation.avatar) {
    return <span className={`photo-album-avatar photo-album-avatar--${size}`}><img src={conversation.avatar} alt="" /></span>;
  }
  if (conversation.kind === "group" && conversation.memberAvatars.length) {
    return (
      <span className={`photo-album-avatar photo-album-avatar--${size} photo-album-group-avatar`}>
        {Array.from({ length: 4 }, (_, index) => <span key={index}>{conversation.memberAvatars[index] ? <img src={conversation.memberAvatars[index]} alt="" /> : null}</span>)}
      </span>
    );
  }
  return <span className={`photo-album-avatar photo-album-avatar--${size} photo-album-avatar-fallback`}>{conversation.title.slice(0, 1)}</span>;
}

function FilterMenu({ value, onChange, onClose }: { value: FilterKind; onChange: (value: FilterKind) => void; onClose: () => void }) {
  const [autoReview, setAutoReview] = useState(isAlbumAutoReviewEnabled);
  return (
    <>
      <button type="button" className="photo-album-popover-scrim" aria-label="关闭筛选" onClick={onClose} />
      <div className="photo-album-filter-menu" role="menu" aria-label="筛选图片">
        {(Object.keys(FILTER_LABELS) as FilterKind[]).map((key) => (
          <button key={key} type="button" role="menuitemradio" aria-checked={value === key} onClick={() => { onChange(key); onClose(); }}>
            <span>{FILTER_LABELS[key]}</span>
            {value === key ? <Check size={17} strokeWidth={2.4} /> : <span />}
          </button>
        ))}
        <div className="photo-album-filter-divider" role="separator" />
        <button type="button" role="menuitemcheckbox" aria-checked={autoReview} className="photo-album-filter-toggle"
          onClick={() => { const next = !autoReview; setAutoReview(next); setAlbumAutoReviewEnabled(next); }}>
          <span>角色自动看照片<small>{autoReview ? "自动写心语、自己来逛专辑" : "已关闭省 token，你评论时仍会回"}</small></span>
          {autoReview ? <Check size={17} strokeWidth={2.4} /> : <span />}
        </button>
      </div>
    </>
  );
}

function EmptyPhotos({ label }: { label: string }) {
  return <div className="photo-album-empty"><Images size={34} strokeWidth={1.25} /><strong>{label}</strong></div>;
}

function PhotoGrid({
  assets,
  columns,
  selecting,
  selected,
  onSelect,
  onOpen,
  onColumnsChange,
}: {
  assets: PhotoAlbumAsset[];
  columns: 1 | 3 | 5;
  selecting: boolean;
  selected: Set<string>;
  onSelect: (assetId: string) => void;
  onOpen: (assetId: string) => void;
  onColumnsChange: (columns: 1 | 3 | 5) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const frames = useRef(new Map<Element, DOMRect>());
  const lastSwitch = useRef(0);
  const pinching = useRef(false);
  const changeColumns = (next: 1 | 3 | 5) => {
    if (next === columns || performance.now() - lastSwitch.current < 280) return;
    lastSwitch.current = performance.now();
    frames.current = new Map(Array.from(gridRef.current?.children || []).map(el => [el, el.getBoundingClientRect()]));
    onColumnsChange(next);
  };
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || !frames.current.size) return;
    const scroll = grid.parentElement!;
    const viewport = scroll.getBoundingClientRect();
    const scale = grid.getBoundingClientRect().width / grid.offsetWidth || 1;
    const anchor = [...frames.current].find(([, box]) => box.bottom > viewport.top && box.top < viewport.bottom);
    if (anchor) scroll.scrollTop += (anchor[0].getBoundingClientRect().top - anchor[1].top) / scale;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const nextFrames = [...frames.current].map(([el, before]) => ({ el, before, after: el.getBoundingClientRect() }));
      nextFrames.forEach(({ el, before, after }) => {
        el.getAnimations().forEach(a => a.cancel());
        if ((before.bottom < viewport.top || before.top > viewport.bottom) && (after.bottom < viewport.top || after.top > viewport.bottom)) return;
        el.animate([
          { transform: `translate(${(before.left-after.left)/scale}px, ${(before.top-after.top)/scale}px) scale(${before.width/after.width}, ${before.height/after.height})`, transformOrigin: "0 0" },
          { transform: "none", transformOrigin: "0 0" },
        ], { duration: 260, easing: "cubic-bezier(.22,.68,0,1)" });
      });
    }
    frames.current.clear();
  }, [columns]);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<number | null>(null);
  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
  };
  const updatePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const nextDistance = distance();
    if (!nextDistance) return;
    if (pinchStart.current === null) { pinchStart.current = nextDistance; return; }
    const ratio = nextDistance / pinchStart.current;
    if (ratio >= 1.18) {
      changeColumns(columns === 5 ? 3 : 1);
      pinchStart.current = nextDistance;
    } else if (ratio <= 0.84) {
      changeColumns(columns === 1 ? 3 : 5);
      pinchStart.current = nextDistance;
    }
  };
  const releasePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  };

  if (!assets.length) return <EmptyPhotos label="没有符合条件的照片" />;
  return (
    <div
      className="photo-album-grid"
      ref={gridRef}
      data-columns={columns}
      onClickCapture={e => { if (pinching.current) { e.preventDefault(); e.stopPropagation(); pinching.current = false; } }}
      style={{ "--photo-album-columns": columns } as React.CSSProperties}
      onPointerDown={(event) => {
        if (pointers.current.size === 0) pinching.current = false;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size === 2) {
          pinching.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          pinchStart.current = distance();
        }
      }}
      onPointerMove={updatePointer}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
      onWheel={(event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        if (event.deltaY < 0) changeColumns(columns === 5 ? 3 : 1);
        else changeColumns(columns === 1 ? 3 : 5);
      }}
    >
      {assets.map((asset, index) => {
        const active = selected.has(asset.id);
        return (
          <button
            key={asset.id}
            type="button"
            className="photo-album-grid-item"
            aria-label={selecting ? `${active ? "取消选择" : "选择"}${asset.label}` : `查看${asset.label}`}
            aria-pressed={selecting ? active : undefined}
            onClick={() => selecting ? onSelect(asset.id) : onOpen(asset.id)}
          >
            <PhotoAlbumMedia asset={asset} eager={index < columns * 3} />
            {unreadAlbumReplies(asset) > 0 ? <span className="photo-album-unread" aria-label={`${unreadAlbumReplies(asset)} 条未读回复`}>{unreadAlbumReplies(asset)}</span> : null}
            {selecting ? <span className="photo-album-selection-mark" data-selected={active ? "" : undefined}>{active ? <Check size={14} strokeWidth={3} /> : null}</span> : null}
            {asset.favorite && !selecting ? <Heart className="photo-album-grid-heart" size={13} fill="currentColor" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function CollectionPreview({ assets }: { assets: PhotoAlbumAsset[] }) {
  return (
    <span className="photo-album-collection-preview" aria-hidden="true">
      {assets.slice(0, 4).map((asset) => <PhotoAlbumMedia key={asset.id} asset={asset} />)}
      {Array.from({ length: Math.max(0, 4 - Math.min(assets.length, 4)) }, (_, index) => <span key={`empty-${index}`} className="photo-album-preview-empty" />)}
    </span>
  );
}

function AlbumNameButton({ children, className, onClick, onHold, label }: { children: React.ReactNode; className: string; onClick: () => void; onHold?: () => void; label?: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => cancel, []);
  return <button type="button" className={className} aria-label={label} onClick={() => { if (!held.current) onClick(); held.current = false; }}
    onPointerDown={e => { cancel(); held.current = false; start.current = { x: e.clientX, y: e.clientY }; if (onHold && e.isPrimary) timer.current = setTimeout(() => { held.current = true; onHold(); }, 500); }}
    onPointerMove={e => { if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel(); }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
    onContextMenu={e => { if (onHold) { e.preventDefault(); cancel(); held.current = true; onHold(); } }} onKeyDown={e => { if (onHold && (e.key === "F2" || (e.shiftKey && e.key === "F10"))) { e.preventDefault(); onHold(); } }}>{children}</button>;
}

function CollectionsHome({ privateAssets, groupAssets, favoriteAssets, onOpen, nativeAssets, onNative, onEditNative }: {
  privateAssets: PhotoAlbumAsset[];
  groupAssets: PhotoAlbumAsset[];
  favoriteAssets: PhotoAlbumAsset[];
  onOpen: (category: CategoryKind) => void;
  nativeAssets: PhotoAlbumAsset[];
  onNative: (name?: string) => void;
  onEditNative: (name: string) => void;
}) {
  const sections: Array<{ category: CategoryKind; title: string; assets: PhotoAlbumAsset[] }> = [
    { category: "private", title: "私聊", assets: privateAssets },
    { category: "group", title: "群聊", assets: groupAssets },
    { category: "favorite", title: "收藏", assets: favoriteAssets },
  ];
  return (
    <main className="photo-album-collections-scroll">
      {sections.map((section) => (
        <div key={section.category}>
        {section.category === "favorite" ? [undefined, ...new Set(nativeAssets.flatMap(a => a.uploadAlbum ? [a.uploadAlbum] : []))].map(name => {
          const photos = nativeAssets.filter(a => a.uploadAlbum === name);
          return <section className="photo-album-collection-section" key={name || "generated"}><AlbumNameButton className="photo-album-section-heading" onClick={() => onNative(name)} onHold={name ? () => onEditNative(name) : undefined}><strong>{name || "生图专辑"}</strong><ChevronRight size={23} /></AlbumNameButton>{photos.length ? <button type="button" className="photo-album-featured-collection" onClick={() => onNative(name)}><CollectionPreview assets={photos} /><span className="photo-album-featured-meta"><small>{photos.length} 张</small></span></button> : <div className="photo-album-collection-empty">暂无内容</div>}</section>;
        }) : null}
        <section key={section.category} className="photo-album-collection-section">
          <button type="button" className="photo-album-section-heading" onClick={() => onOpen(section.category)}>
            <strong>{section.title}</strong><ChevronRight size={23} />
          </button>
          {section.assets.length ? (
            <button type="button" className="photo-album-featured-collection" aria-label={`${section.title}，${section.assets.length} 张`} onClick={() => onOpen(section.category)}>
              <CollectionPreview assets={section.assets} />
              <span className="photo-album-featured-meta"><small>{section.assets.length} 张</small></span>
            </button>
          ) : <div className="photo-album-collection-empty">暂无内容</div>}
        </section>
        </div>
      ))}
    </main>
  );
}

function AlbumCards({ albums, onOpen }: { albums: ConversationAlbum[]; onOpen: (conversationId: string) => void }) {
  if (!albums.length) return <EmptyPhotos label="还没有相册" />;
  return (
    <main className="photo-album-cards-grid">
      {albums.map((album) => (
        <button key={album.id} type="button" className="photo-album-card" onClick={() => onOpen(album.id)}>
          <span className="photo-album-card-cover"><PhotoAlbumMedia asset={album.assets[0]} /></span>
          <span className="photo-album-card-caption"><AlbumAvatar conversation={album} /><span><strong>{album.title}</strong><small>{album.assets.length} 张</small></span></span>
        </button>
      ))}
    </main>
  );
}

function ConfirmRemoveDialog({ assets, onCancel, onConfirm }: { assets: PhotoAlbumAsset[]; onCancel: () => void; onConfirm: () => void }) {
  const chatCount = assets.filter((asset) => asset.source.kind === "chat").length;
  const nativeCount = assets.length - chatCount;
  const title = nativeCount > 0 ? `删除 ${assets.length} 张照片？` : `从图库移除 ${assets.length} 张照片？`;
  const body = nativeCount > 0 && chatCount > 0
    ? `聊天来源的 ${chatCount} 张只会从图库隐藏；直接保存到相册的 ${nativeCount} 张会被永久删除。`
    : nativeCount > 0
      ? "这些直接保存到相册的照片会被永久删除；已经转发到聊天的副本不受影响。"
      : "聊天中的原图仍会保留。";
  return (
    <div className="photo-album-dialog-scrim" role="presentation" onClick={onCancel}>
      <div className="photo-album-dialog" role="alertdialog" aria-modal="true" aria-labelledby="photo-album-remove-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="photo-album-remove-title">{title}</h2>
        <p>{body}</p>
        <div><button type="button" onClick={onCancel}>取消</button><button type="button" className="photo-album-danger" onClick={onConfirm}>{nativeCount > 0 ? "删除" : "移除"}</button></div>
      </div>
    </div>
  );
}

export function PhotoAlbumApp({ onClose }: PhotoAlbumAppProps) {
  const [ready, setReady] = useState(false);
  const [assets, setAssets] = useState<PhotoAlbumAsset[]>([]);
  const [routes, setRoutes] = useState<Route[]>([{ kind: "library" }]);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [columns, setColumns] = useState<1 | 3 | 5>(3);
  const pageRef = useRef<HTMLDivElement>(null);
  const pageAnimation = useRef<Animation | null>(null);
  const tabSequence = useRef(0);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removeIds, setRemoveIds] = useState<string[] | null>(null);
  const [editingAsset, setEditingAsset] = useState<PhotoAlbumAsset | null>(null);
  const [forwardAsset, setForwardAsset] = useState<PhotoAlbumAsset | null>(null);
  const [permissionAlbum, setPermissionAlbum] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [undoIds, setUndoIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<number | null>(null);
  const current = routes[routes.length - 1];

  const refresh = useCallback(() => setAssets(collectPhotoAlbumAssets()), []);
  useEffect(() => {
    let cancelled = false;
    Promise.all([hydrateKvDb(), hydrateChatStorage()]).then(() => {
      if (cancelled) return;
      setAssets(collectPhotoAlbumAssets());
      setReady(true);
    });
    const onUpdate = () => { if (!cancelled) setAssets(collectPhotoAlbumAssets()); };
    window.addEventListener(PHOTO_ALBUM_UPDATED_EVENT, onUpdate);
    window.addEventListener(ALBUM_DISCUSSION_UPDATED, onUpdate);
    getPhotoAlbumSourceUpdatedEvents().forEach((eventName) => window.addEventListener(eventName, onUpdate));
    window.addEventListener("focus", onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener(PHOTO_ALBUM_UPDATED_EVENT, onUpdate);
      window.removeEventListener(ALBUM_DISCUSSION_UPDATED, onUpdate);
      getPhotoAlbumSourceUpdatedEvents().forEach((eventName) => window.removeEventListener(eventName, onUpdate));
      window.removeEventListener("focus", onUpdate);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelecting(false);
    setSelected(new Set());
    setFilterOpen(false);
  }, [current.kind, current.kind === "category" ? current.category : "", current.kind === "album" ? current.conversationId : ""]);

  const albums = useMemo(() => {
    const grouped = new Map<string, ConversationAlbum>();
    for (const asset of assets) {
      if (!asset.conversation) continue;
      const existing = grouped.get(asset.conversation.id);
      if (existing) existing.assets.push(asset);
      else grouped.set(asset.conversation.id, { ...asset.conversation, assets: [asset] });
    }
    return [...grouped.values()].sort((a, b) => Date.parse(b.assets[0].createdAt) - Date.parse(a.assets[0].createdAt));
  }, [assets]);
  const privateAssets = useMemo(() => assets.filter((asset) => asset.conversation?.kind === "private"), [assets]);
  const groupAssets = useMemo(() => assets.filter((asset) => asset.conversation?.kind === "group"), [assets]);
  const favoriteAssets = useMemo(() => assets.filter((asset) => asset.favorite), [assets]);

  const activeAlbum = current.kind === "album" ? albums.find((album) => album.id === current.conversationId) : undefined;
  const activeDetail = current.kind === "detail" ? assets.find((asset) => asset.id === current.assetId) : undefined;
  const galleryAssets = current.kind === "library"
    ? assets
    : current.kind === "native" ? assets.filter(a => a.source.kind === "album" && a.uploadAlbum === current.name)
    : current.kind === "album"
      ? activeAlbum?.assets || []
      : current.kind === "category" && current.category === "favorite"
        ? favoriteAssets
        : [];
  const visibleGalleryAssets = applyFilter(galleryAssets, filter);
  const detailPhotos = current.kind === "detail" ? (current.photoIds || [current.assetId]).flatMap(id => { const photo = assets.find(a => a.id === id); return photo ? [photo] : []; }) : [];
  const openPhoto = (assetId: string) => pushRoute({ kind: "detail", assetId, photoIds: visibleGalleryAssets.map(a => a.id) });
  const selectedAssets = assets.filter((asset) => selected.has(asset.id));

  const pushRoute = (route: Route) => {
    tabSequence.current++;
    pageAnimation.current?.cancel();
    setRoutes((previous) => [...previous, route]);
  };
  const popRoute = () => setRoutes((previous) => previous.length > 1 ? previous.slice(0, -1) : previous);
  const setTopLevel = (kind: "library" | "collections") => { pageAnimation.current?.cancel(); setRoutes([{ kind }]); };
  const toggleSelected = (assetId: string) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(assetId)) next.delete(assetId); else next.add(assetId);
    return next;
  });
  const flashNotice = (message: string, undo: string[] = []) => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice(message);
    setUndoIds(undo);
    noticeTimer.current = window.setTimeout(() => { setNotice(""); setUndoIds([]); }, 4200);
  };
  const confirmRemove = async () => {
    const targets = assets.filter((asset) => removeIds?.includes(asset.id));
    setRemoveIds(null);
    if (!targets.length) return;
    const result = await removePhotoAlbumAssets(targets);
    refresh();
    setSelected(new Set());
    setSelecting(false);
    if (current.kind === "detail") popRoute();
    if (result.deletedNativeIds.length) flashNotice(`已删除 ${targets.length} 张照片`);
    else flashNotice(`已从图库移除 ${targets.length} 张照片`, result.hiddenChatIds);
  };
  const toggleFavoriteForSelection = () => {
    if (!selectedAssets.length) return;
    const nextFavorite = !selectedAssets.every((asset) => asset.favorite);
    setPhotoAlbumFavorites(selectedAssets.map((asset) => asset.id), nextFavorite);
    refresh();
    flashNotice(nextFavorite ? "已加入收藏" : "已取消收藏");
  };

  const categoryTitle = current.kind === "category"
    ? current.category === "private" ? "私聊" : current.category === "group" ? "群聊" : "收藏"
    : "";
  const standardTitle = current.kind === "native" ? current.name || "生图专辑" : current.kind === "album" ? activeAlbum?.title || "相册" : categoryTitle;
  const showGalleryHeader = current.kind === "native" || current.kind === "library" || current.kind === "album" || (current.kind === "category" && current.category === "favorite");
  const showBottomTabs = !["detail", "lab", "upload"].includes(current.kind);

  if (!ready) return <section className="photo-album-app"><div className="photo-album-loading" aria-label="正在打开相册" /></section>;

  return (
    <section className="photo-album-app" data-view={current.kind}>
      <div className="photo-album-page-content" ref={pageRef}>
      {showGalleryHeader ? (
        <header className={`photo-album-header ${current.kind === "library" ? "photo-album-header--library" : "photo-album-header--floating"}`}>
          <div className="photo-album-header-actions">
            {selecting ? (
              <button type="button" className="photo-album-text-action" onClick={() => { setSelecting(false); setSelected(new Set()); }}>取消</button>
            ) : current.kind === "library" ? (
              <button type="button" className="photo-album-glass-button" onClick={onClose} aria-label="返回桌面"><ChevronLeft /></button>
            ) : (
              <AlbumNameButton className="photo-album-back-capsule photo-album-text-action" label="返回" onClick={popRoute} onHold={current.kind === "native" && current.name ? () => setPermissionAlbum(current.name!) : undefined}><ChevronLeft size={20} /><span title={standardTitle}>{Array.from(standardTitle).slice(0,8).join("")}{Array.from(standardTitle).length > 8 ? "…" : ""}</span></AlbumNameButton>
            )}
            <div className="photo-album-header-right">
              {current.kind === "native" && !selecting ? <button type="button" className="photo-album-glass-button" aria-label="专辑权限" onClick={() => setPermissionAlbum(current.name || GENERATED_ALBUM_PERMISSION)}><Share size={18} /></button> : null}
              {!selecting ? <button type="button" className="photo-album-glass-button" aria-label="筛选" aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)}><SlidersHorizontal size={20} /></button> : null}
              <button type="button" className="photo-album-text-action photo-album-select-action" onClick={() => { setSelecting((value) => !value); setSelected(new Set()); }}>{selecting ? "完成" : "选择"}</button>
            </div>
          </div>
          {current.kind === "library" ? (
            <div className="photo-album-library-title"><h1>{selecting ? `已选择 ${selected.size} 项` : "图库"}</h1><p>{assets.length} 个项目</p></div>
          ) : selecting ? <h1 className="photo-album-centered-title">已选择 {selected.size} 项</h1> : null}
          {filterOpen ? <FilterMenu value={filter} onChange={setFilter} onClose={() => setFilterOpen(false)} /> : null}
        </header>
      ) : current.kind === "collections" ? (
        <div className="photo-album-page-titlebar"><h1>精选集</h1></div>
      ) : current.kind === "category" ? (
        <div className="photo-album-page-titlebar photo-album-page-titlebar--center"><button type="button" className="photo-album-glass-button" onClick={popRoute} aria-label="返回精选集"><ChevronLeft /></button><h1>{categoryTitle}</h1></div>
      ) : null}

      {current.kind === "library" ? (
        <main className="photo-album-gallery-scroll photo-album-gallery-scroll--library">
          <PhotoGrid assets={visibleGalleryAssets} columns={columns} selecting={selecting} selected={selected} onSelect={toggleSelected} onOpen={openPhoto} onColumnsChange={setColumns} />
        </main>
      ) : current.kind === "collections" ? (
        <CollectionsHome privateAssets={privateAssets} groupAssets={groupAssets} favoriteAssets={favoriteAssets} onOpen={(category) => pushRoute({ kind: "category", category })} nativeAssets={assets.filter(a => a.source.kind === "album")} onNative={name => pushRoute({ kind: "native", name })} onEditNative={setPermissionAlbum} />
      ) : current.kind === "category" && current.category !== "favorite" ? (
        <AlbumCards albums={albums.filter((album) => album.kind === current.category)} onOpen={(conversationId) => pushRoute({ kind: "album", conversationId })} />
      ) : current.kind === "category" && current.category === "favorite" ? (
        <main className="photo-album-gallery-scroll photo-album-gallery-scroll--subpage">
          <PhotoGrid assets={visibleGalleryAssets} columns={columns} selecting={selecting} selected={selected} onSelect={toggleSelected} onOpen={openPhoto} onColumnsChange={setColumns} />
        </main>
      ) : current.kind === "album" || current.kind === "native" ? (
        <main className="photo-album-gallery-scroll photo-album-gallery-scroll--subpage">
          <PhotoGrid assets={visibleGalleryAssets} columns={columns} selecting={selecting} selected={selected} onSelect={toggleSelected} onOpen={openPhoto} onColumnsChange={setColumns} />
        </main>
      ) : current.kind === "detail" && activeDetail ? (
        <PhotoDetail
          asset={activeDetail}
          photos={detailPhotos}
          onNavigate={assetId => setRoutes(previous => previous.map((r, i) => i === previous.length - 1 && r.kind === "detail" ? { ...r, assetId } : r))}
          onBack={popRoute}
          onFavorite={() => { setPhotoAlbumFavorite(activeDetail.id, !activeDetail.favorite); refresh(); }}
          onEdit={() => setEditingAsset(activeDetail)}
          onRemove={() => setRemoveIds([activeDetail.id])}
          onForward={() => setForwardAsset(activeDetail)}
        />
      ) : current.kind === "lab" ? <AlbumImageLab onBack={popRoute} /> : current.kind === "upload" ? <AlbumUpload onBack={popRoute} /> : current.kind === "detail" ? <EmptyPhotos label="这张照片已不在相册中" /> : null}
      </div>

      {selecting && showGalleryHeader ? (
        <div className="photo-album-selection-toolbar">
          <button type="button" onClick={toggleFavoriteForSelection} disabled={!selected.size} aria-label="收藏所选照片"><Heart fill={selectedAssets.length && selectedAssets.every((asset) => asset.favorite) ? "currentColor" : "none"} /></button>
          <span>{selected.size ? `${selected.size} 项` : "选择照片"}</span>
          <button type="button" onClick={() => setRemoveIds([...selected])} disabled={!selected.size} aria-label="从图库移除所选照片"><Trash2 /></button>
        </div>
      ) : null}

      {showBottomTabs && !selecting ? (
        <>
        <nav className="photo-album-tabbar" aria-label="相册导航">
          <button type="button" aria-current={current.kind === "library" ? "page" : undefined} onClick={() => setTopLevel("library")}><Images /><span>图库</span></button>
          <button type="button" aria-current={current.kind !== "library" ? "page" : undefined} onClick={() => setTopLevel("collections")}><FolderHeart /><span>精选集</span></button>
        </nav>
        <button type="button" className="photo-album-add photo-album-glass-button" aria-label="添加照片" aria-expanded={addOpen} onClick={() => setAddOpen(v => !v)}><Plus /></button>
        {addOpen ? <div className="photo-album-add-menu"><button type="button" onClick={() => { setAddOpen(false); pushRoute({ kind: "lab" }); }}>生图</button><button type="button" onClick={() => { setAddOpen(false); pushRoute({ kind: "upload" }); }}>上传</button></div> : null}
        </>
      ) : null}

      {editingAsset ? (
        <PhotoAlbumMarkupEditor
          asset={editingAsset}
          onClose={() => setEditingAsset(null)}
          onSave={(annotations) => {
            savePhotoAlbumAnnotations(editingAsset.id, annotations);
            if (JSON.stringify(annotations) !== JSON.stringify(editingAsset.albumAnnotations)) notifyAlbumAnnotationChange({ ...editingAsset, albumAnnotations: annotations });
            setEditingAsset(null);
            refresh();
          }}
        />
      ) : null}

      {removeIds ? <ConfirmRemoveDialog assets={assets.filter((asset) => removeIds.includes(asset.id))} onCancel={() => setRemoveIds(null)} onConfirm={() => void confirmRemove()} /> : null}
      {forwardAsset ? <AlbumForwardDialog asset={forwardAsset} onClose={() => setForwardAsset(null)} /> : null}
      {permissionAlbum ? <AlbumPermissionDialog name={permissionAlbum} onClose={() => setPermissionAlbum(null)} onRenamed={name => setRoutes(previous => previous.map(route => route.kind === "native" && route.name === permissionAlbum ? { ...route, name } : route))} /> : null}
      {notice ? <div className="photo-album-toast" role="status"><span>{notice}</span>{undoIds.length ? <button type="button" onClick={() => { restoreChatPhotosToAlbum(undoIds); refresh(); setNotice(""); setUndoIds([]); }}>撤销</button> : null}</div> : null}
    </section>
  );
}

function PhotoDetail({ asset, photos, onNavigate, onBack, onFavorite, onEdit, onRemove, onForward }: {
  asset: PhotoAlbumAsset;
  photos: PhotoAlbumAsset[];
  onNavigate: (id: string) => void;
  onBack: () => void;
  onFavorite: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onForward: () => void;
}) {
  const { date, time } = formatPhotoDate(asset.createdAt);
  const [thread, setThread] = useState(() => getAlbumDiscussion(asset));
  const [draft, setDraft] = useState("");
  const [editingThought, setEditingThought] = useState<AlbumComment | null>(null);
  const [thoughtText, setThoughtText] = useState("");
  const [compact, setCompact] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const slideAnimation = useRef<Animation | null>(null);
  const dragX = useRef(0);
  const swipe = useRef<{ x: number; y: number; time: number } | null>(null);
  const filmRef = useRef<HTMLDivElement>(null);
  const filmGesture = useRef<{ pointer: number; x: number; lastX: number; scroll: number; active: boolean; dragging: boolean; time: number; velocity: number } | null>(null);
  const filmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filmFrame = useRef(0);
  const suppressFilmClick = useRef(false);
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const stopFilm = () => {
    if (filmTimer.current) clearTimeout(filmTimer.current);
    cancelAnimationFrame(filmFrame.current);
    filmGesture.current = null;
    filmRef.current?.removeAttribute("data-scrubbing");
  };
  useEffect(() => stopFilm, []);
  const scrubFilm = (lastTime = performance.now()) => {
    const node = filmRef.current, gesture = filmGesture.current;
    if (!node || !gesture?.active) return;
    const bounds = node.getBoundingClientRect();
    const edge = 30;
    const now = performance.now(), dt = Math.min(32, now - lastTime);
    const speed = gesture.lastX < bounds.left + edge ? -Math.min(1, (bounds.left + edge - gesture.lastX) / edge) : gesture.lastX > bounds.right - edge ? Math.min(1, (gesture.lastX - bounds.right + edge) / edge) : 0;
    node.scrollLeft += speed * dt * .45;
    const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>("button[data-photo-id]"));
    const nearest = buttons.reduce<HTMLButtonElement | null>((best, button) => {
      const center = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
      return !best || Math.abs(center(button) - gesture.lastX) < Math.abs(center(best) - gesture.lastX) ? button : best;
    }, null);
    if (nearest && nearest.getAttribute("aria-current") !== "true") navigateRef.current(nearest.dataset.photoId!);
    filmFrame.current = requestAnimationFrame(() => scrubFilm(now));
  };
  const coastFilm = (velocity: number, lastTime = performance.now()) => {
    const node = filmRef.current;
    if (!node || Math.abs(velocity) < .02) return;
    const now = performance.now(), dt = Math.min(32, now - lastTime), before = node.scrollLeft;
    node.scrollLeft += velocity * dt;
    if (Math.abs(node.scrollLeft - before) < .1 && dt > 0) return;
    filmFrame.current = requestAnimationFrame(() => coastFilm(velocity * Math.exp(-dt / 180), now));
  };
  const index = photos.findIndex(p => p.id === asset.id);
  const move = (step: number) => { const next = photos[index + step]; if (next) onNavigate(next.id); };
  useLayoutEffect(() => {
    slideAnimation.current?.cancel(); slideAnimation.current = null;
    if (trackRef.current) trackRef.current.style.transform = "translateX(0px)";
    dragX.current = 0; swipe.current = null;
    setDraft(""); setEditingThought(null); setCompact(false); setInfoOpen(false); setDefinitionOpen(false);
    setThread(getAlbumDiscussion(asset));
  }, [asset.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { slideAnimation.current?.cancel(); }, []);
  const finishSwipe = (step: number) => {
    const track = trackRef.current;
    if (!track) return;
    const next = photos[index + step];
    const target = step && next ? -step * track.clientWidth : 0;
    const animation = track.animate([{ transform: `translateX(${dragX.current}px)` }, { transform: `translateX(${target}px)` }], { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220, easing: "cubic-bezier(.23,1,.32,1)", fill: "forwards" });
    slideAnimation.current = animation;
    void animation.finished.then(() => {
      if (step && next) flushSync(() => onNavigate(next.id));
      else { track.style.transform = "translateX(0px)"; dragX.current = 0; }
      animation.cancel(); slideAnimation.current = null;
    }).catch(() => undefined);
  };
  useEffect(() => { if (!filmGesture.current) filmRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "center" }); }, [asset.id]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchY = useRef<number | null>(null);
  useEffect(() => {
    const update = () => {
      if (infoOpen && document.visibilityState === "visible") markAlbumRepliesRead(asset);
      setThread(getAlbumDiscussion(asset));
    };
    window.addEventListener(ALBUM_DISCUSSION_UPDATED, update);
    document.addEventListener("visibilitychange", update);
    queueAlbumReview(asset);
    update();
    return () => {
      window.removeEventListener(ALBUM_DISCUSSION_UPDATED, update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [asset.id, asset.mediaRef, asset.label, infoOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const characters = loadCharacters();
  const thoughts = thread.comments.filter(c => c.kind === "thought");
  const comments = thread.comments.filter(c => c.kind === "comment");
  const submitComment = () => {
    if (!draft.trim()) return;
    addUserAlbumComment(asset, draft);
    setDraft("");
    setCompact(true);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
  };
  const gesture = (delta: number) => {
    if (delta > 8) setCompact(true);
    else if (delta < -8 && (scrollRef.current?.scrollTop || 0) <= 0) setCompact(false);
  };
  return (
    <main className="photo-album-detail photo-album-detail--immersive" data-info={infoOpen ? "" : undefined} data-compact={compact ? "" : undefined}>
      <div className="photo-album-detail-actions">
        <button type="button" className="photo-album-glass-button" onClick={onBack} aria-label="返回"><ChevronLeft /></button>
        <time className="photo-album-date-pill" dateTime={asset.createdAt}><strong>{date}</strong><small>{time}</small></time>
        <span className="photo-album-glass-button" aria-hidden="true"><MoreHorizontal /></span>
      </div>
      <section className="photo-album-detail-stage" tabIndex={0} aria-label="照片，左右滑动切换"
        onKeyDown={e => { if (e.key === "ArrowLeft") move(-1); if (e.key === "ArrowRight") move(1); }}
        onPointerDown={e => { if (!e.isPrimary || slideAnimation.current) return; swipe.current = { x: e.clientX, y: e.clientY, time: performance.now() }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (!swipe.current || !trackRef.current) return; const dx = e.clientX - swipe.current.x; if (Math.abs(dx) < Math.abs(e.clientY - swipe.current.y)) return; const available = photos[index + (dx < 0 ? 1 : -1)]; dragX.current = Math.max(-trackRef.current.clientWidth, Math.min(trackRef.current.clientWidth, dx * (available ? 1 : .22))); trackRef.current.style.transform = `translateX(${dragX.current}px)`; }}
        onPointerCancel={() => { swipe.current = null; finishSwipe(0); }}
        onPointerUp={e => { if (!swipe.current) return; const dx = e.clientX - swipe.current.x; const dy = e.clientY - swipe.current.y; const velocity = Math.abs(dx) / Math.max(1, performance.now() - swipe.current.time); const shouldMove = Math.abs(dx) > Math.abs(dy) * 1.2 && (Math.abs(dx) > 55 || (Math.abs(dx) > 15 && velocity > .4)); swipe.current = null; finishSwipe(shouldMove ? (dx < 0 ? 1 : -1) : 0); }}>
        <div className="photo-album-swipe-track" ref={trackRef}>{[-1,0,1].map(step => { const photo = photos[index + step]; return photo ? <div key={photo.id} className="photo-album-swipe-image" aria-hidden={step !== 0} style={{ left: `${step * 100}%` }}><PhotoAlbumMedia asset={photo} eager /></div> : null; })}</div>
      </section>
      {infoOpen ? <section className="photo-album-discussion" aria-label="照片讨论">
        <div className="photo-album-discussion-scroll" ref={scrollRef} tabIndex={0}
          onWheel={e => gesture(e.deltaY)}
          onTouchStart={e => { touchY.current = e.touches[0]?.clientY ?? null; }}
          onTouchMove={e => { const y = e.touches[0]?.clientY; if (y !== undefined && touchY.current !== null) { gesture(touchY.current - y); touchY.current = y; } }}
          onKeyDown={e => { if (e.key === "ArrowDown" || e.key === "PageDown") setCompact(true); if (e.key === "Home") setCompact(false); }}>
        <time className="photo-album-detail-date" dateTime={asset.createdAt}>{date} · {time}</time>
        {asset.source.kind === "album" ? <div className="photo-album-definition-summary"><button type="button" onClick={() => setDefinitionOpen(true)}>{getPhotoDefinition(asset)?.text ? "编辑照片背景" : "添加照片背景"}</button><p>{getPhotoDefinition(asset)?.text}</p>{getPhotoDefinition(asset)?.confirmed ? <small>已确认为相关角色的共同经历</small> : null}</div> : null}
        {asset.source.kind === "chat" && !thoughts.length && thread.dueAt > 0 && !thread.error ? <p className="photo-album-discussion-status" role="status">正在准备角色心语…</p> : null}
        {thoughts.map(comment => {
          const character = characters.find(c => c.id === comment.authorId);
          return <article className="photo-album-comment photo-album-comment--thought" key={comment.id}>
            <span className="photo-album-avatar photo-album-avatar--small">{character?.avatar ? <img src={character.avatar} alt="" /> : comment.authorName.slice(0, 1)}</span>
            <div><strong>{comment.authorName}</strong><p>{comment.text}</p><div className="photo-album-thought-actions"><button type="button" onClick={() => { setEditingThought(comment); setThoughtText(comment.text); }}>编辑</button><button type="button" disabled={!!thread.thoughtRequests?.[comment.authorId]} onClick={() => rerollAlbumThought(asset, comment.authorId)}>{thread.thoughtRequests?.[comment.authorId] ? "重写中…" : "重写"}</button></div></div>
          </article>;
        })}
        {comments.map(comment => <article className="photo-album-comment" key={comment.id}>
          <div><strong>{comment.authorName}</strong><p>{comment.text}</p></div>
        </article>)}
        {thread.error ? <p className="photo-album-discussion-status" role="status">{thread.error} <button type="button" onClick={() => saveAlbumDiscussion({ ...getAlbumDiscussion(asset), error: undefined, dueAt: Date.now() + 1000 })}>重试</button></p> : null}
        </div>
        <form className="photo-album-comment-form" onSubmit={e => { e.preventDefault(); submitComment(); }}>
          <input aria-label="添加评论" placeholder="添加评论…" maxLength={2000} value={draft} onChange={e => setDraft(e.target.value)} onFocus={() => setCompact(true)} />
          <button type="submit" aria-label="发送评论" disabled={!draft.trim()}><ArrowUp size={17} /></button>
        </form>
      </section> : <div className="photo-album-filmstrip" ref={filmRef} aria-label="照片缩略图"
        onContextMenu={e => e.preventDefault()}
        onDragStart={e => e.preventDefault()}
        onPointerDown={e => { if (!e.isPrimary || e.button !== 0) return; e.stopPropagation(); stopFilm(); suppressFilmClick.current = false; filmGesture.current = { pointer: e.pointerId, x: e.clientX, lastX: e.clientX, scroll: e.currentTarget.scrollLeft, active: false, dragging: false, time: performance.now(), velocity: 0 }; e.currentTarget.setPointerCapture(e.pointerId); filmTimer.current = setTimeout(() => { if (filmGesture.current && !filmGesture.current.dragging) { filmGesture.current.active = true; suppressFilmClick.current = true; filmRef.current?.setAttribute("data-scrubbing", ""); scrubFilm(); } }, 280); }}
        onPointerMove={e => { const g = filmGesture.current; if (!g || g.pointer !== e.pointerId) return; e.stopPropagation(); const now = performance.now(); if (!g.active && (g.dragging || Math.abs(e.clientX - g.x) > 6)) { g.dragging = true; if (filmTimer.current) clearTimeout(filmTimer.current); suppressFilmClick.current = true; e.currentTarget.scrollLeft = g.scroll - (e.clientX - g.x); g.velocity = Math.max(-2, Math.min(2, (g.lastX - e.clientX) / Math.max(1, now - g.time))); } g.lastX = e.clientX; g.time = now; }}
        onPointerUp={e => { const g = filmGesture.current; if (!g || g.pointer !== e.pointerId) return; e.stopPropagation(); if (!suppressFilmClick.current) { const button = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLButtonElement>("button[data-photo-id]"); if (button && e.currentTarget.contains(button)) navigateRef.current(button.dataset.photoId!); } const velocity = g.dragging && performance.now() - g.time < 80 ? g.velocity : 0; stopFilm(); if (velocity && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) filmFrame.current = requestAnimationFrame(() => coastFilm(velocity)); }} onPointerCancel={stopFilm} onLostPointerCapture={() => { if (filmGesture.current) stopFilm(); }}
        >{photos.map((photo, i) => <button type="button" key={photo.id} data-photo-id={photo.id} aria-label={`查看第 ${i+1} 张：${photo.label}`} aria-current={photo.id === asset.id ? "true" : undefined} onClick={e => { if (e.detail === 0) onNavigate(photo.id); }}><PhotoAlbumMedia asset={photo} /></button>)}</div>}
      <footer className="photo-album-viewer-toolbar">
        <button type="button" className="photo-album-glass-button" onClick={onForward} aria-label="转发"><Share /></button>
        <div className="photo-album-viewer-tools">
          <button type="button" onClick={onFavorite} aria-label={asset.favorite ? "取消收藏" : "收藏"} aria-pressed={asset.favorite}><Heart fill={asset.favorite ? "currentColor" : "none"} /></button>
          <button type="button" onClick={() => setInfoOpen(v => !v)} aria-label="照片信息与评论" aria-expanded={infoOpen}><Info />{unreadAlbumReplies(asset) > 0 ? <span className="photo-album-info-dot" /> : null}</button>
          <button type="button" onClick={onEdit} aria-label="涂鸦"><SlidersHorizontal /></button>
        </div>
        <button type="button" className="photo-album-glass-button" onClick={onRemove} aria-label={asset.source.kind === "chat" ? "从图库移除" : "删除照片"}><Trash2 /></button>
      </footer>
      {editingThought ? <div className="photo-album-dialog-scrim"><form className="photo-album-dialog" role="dialog" aria-label="编辑心语" onSubmit={e => { e.preventDefault(); editAlbumThought(asset, editingThought.id, thoughtText); setEditingThought(null); }}><h2>编辑心语</h2><textarea aria-label="心语内容" maxLength={500} value={thoughtText} onChange={e => setThoughtText(e.target.value)} /><div><button type="button" onClick={() => setEditingThought(null)}>取消</button><button type="submit" disabled={!thoughtText.trim()}>保存</button></div></form></div> : null}
      {definitionOpen ? <PhotoDefinitionDialog asset={asset} onClose={() => setDefinitionOpen(false)} onSave={input => { savePhotoDefinition(asset, input); }} /> : null}
    </main>
  );
}
