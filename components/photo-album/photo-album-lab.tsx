"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ImagePlus, Sparkles, X } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import { getAlbumPermission, setAlbumPermission, updateUploadAlbum, GENERATED_ALBUM_PERMISSION } from "@/lib/photo-album-permissions";
import { GroupAvatar } from "@/components/chat/group-avatar";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { collectPhotoAlbumAssets, type PhotoAlbumAsset } from "@/lib/photo-album-storage";
import { albumForwardSessions, forwardAlbumPhoto, generateAlbumPhotos, saveAlbumDraft, type AlbumDraft } from "@/lib/photo-album-lab";
import { imageBlobToDataUrl } from "@/lib/image-grid-split";
import type { ImageGridCount } from "@/lib/image-grid-split";
import { getPhotoDefinition, type PhotoDefinitionInput } from "@/lib/photo-album-core";

export function PhotoDefinitionDialog({ asset, onSave, onClose }: { asset?: PhotoAlbumAsset; onSave: (input: PhotoDefinitionInput) => Promise<void> | void; onClose: () => void }) {
  const initial = asset ? getPhotoDefinition(asset) : undefined;
  const [text, setText] = useState(initial?.text || "");
  const [confirmed, setConfirmed] = useState(initial?.confirmed || false);
  const [ids, setIds] = useState(initial?.characterIds || []);
  const [date, setDate] = useState(initial?.occurredOn || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  return <div className="photo-album-dialog-scrim"><form className="photo-album-dialog photo-album-definition-dialog" role="dialog" aria-modal="true" aria-label="照片背景" onSubmit={async e => { e.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); try { await onSave({ text, confirmed, characterIds: ids, occurredOn: date || undefined }); onClose(); } catch (err) { setError(err instanceof Error ? err.message : "保存失败"); } finally { lock.current = false; setBusy(false); } }}>
    <h2>{asset ? "照片背景" : "保存照片"}</h2><fieldset disabled={busy}><label>照片背景 · 选填<textarea aria-label="照片背景描述" value={text} onChange={e => setText(e.target.value)} maxLength={2000} placeholder="这张照片背后发生了什么？" /></label><label>发生日期 · 选填<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><label className="photo-album-definition-toggle"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />作为共同经历记住</label>{confirmed ? <><span>相关角色</span><CharacterPicker value={ids} onChange={setIds} disabled={busy} /></> : null}</fieldset><p role="status">{error}</p><div className="photo-album-form-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" disabled={busy || (confirmed && (!text.trim() || !ids.length))}>{busy ? "保存中…" : "保存"}</button></div>
  </form></div>;
}

function CharacterPicker({ value, onChange, disabled, limit }: { value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; limit?: number }) {
  const characters = loadCharacters();
  return <div className="photo-album-character-picker">{characters.map(c => {
    const selected = value.includes(c.id);
    return <button type="button" key={c.id} aria-label={c.name} aria-pressed={selected} disabled={disabled || (!selected && !!limit && value.length >= limit)} onClick={() => onChange(selected ? value.filter(id => id !== c.id) : [...value, c.id])}>
      <span className="photo-album-character-portrait">{c.avatar ? <img src={c.avatar} alt="" /> : <span>{c.name.slice(0,1)}</span>}{selected ? <i><Check size={11} /></i> : null}</span><span>{c.name}</span>
    </button>;
  })}{!characters.length ? <p>暂无角色</p> : null}</div>;
}

function AlbumAudience({ shared, setShared, ids, setIds, disabled }: { shared: boolean; setShared: (v: boolean) => void; ids: string[]; setIds: (v: string[]) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled}><legend>专辑权限</legend><div className="photo-album-audience-toggle"><button type="button" aria-pressed={!shared} onClick={() => setShared(false)}>私人</button><button type="button" aria-pressed={shared} onClick={() => setShared(true)}>可给谁看</button></div>{shared ? <CharacterPicker value={ids} onChange={setIds} disabled={disabled} /> : null}</fieldset>;
}

export function AlbumPermissionDialog({ name, onClose, onRenamed }: { name: string; onClose: () => void; onRenamed: (name: string) => void }) {
  const [ids, setIds] = useState(() => getAlbumPermission(name).characterIds);
  const [shared, setShared] = useState(() => !!ids.length);
  const generated = name === GENERATED_ALBUM_PERMISSION;
  const [title, setTitle] = useState(generated ? "生图专辑" : name);
  const [error, setError] = useState("");
  return <div className="photo-album-dialog-scrim"><div className="photo-album-dialog photo-album-permission-dialog" role="dialog" aria-modal="true" aria-label="专辑权限"><h2>{generated ? "生图专辑权限" : "编辑专辑"}</h2>{!generated && <input className="photo-album-rename" aria-label="专辑名字" value={title} maxLength={60} onChange={e => setTitle(e.target.value)} />}<AlbumAudience shared={shared} setShared={setShared} ids={ids} setIds={setIds} /><p role="status">{error}</p><div className="photo-album-form-actions"><button type="button" onClick={onClose}>取消</button><button type="button" disabled={!title.trim() || (shared && !ids.length)} onClick={() => { try { if (generated) setAlbumPermission(name, shared ? ids : []); else onRenamed(updateUploadAlbum(name, title, shared ? ids : [])); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } }}>保存</button></div></div></div>;
}

export function AlbumImageLab({ onBack }: { onBack: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState<1 | ImageGridCount>(1);
  const [characterIds, setCharacterIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Array<AlbumDraft & { url: string }>>([]);
  const [reference, setReference] = useState("");
  const [savingDraft, setSavingDraft] = useState<AlbumDraft | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const referenceInput = useRef<HTMLInputElement>(null);
  const generate = async () => {
    if (lock.current || !prompt.trim()) return;
    lock.current = true; setBusy(true); setStatus("正在生成…");
    try {
      const result = await generateAlbumPhotos(prompt.trim(), count, characterIds, reference || undefined);
      const previews = await Promise.all(result.map(async d => ({ ...d, url: await imageBlobToDataUrl(d.blob) })));
      if (mounted.current) { setDrafts(previous => [...previews, ...previous]); setStatus("生成完成，选择喜欢的照片保存。"); }
    } catch (error) { if (mounted.current) setStatus(error instanceof Error ? error.message : "生成失败，请重试"); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const save = async (draft: AlbumDraft, definition: PhotoDefinitionInput) => {
    if (lock.current || ids.includes(draft.id)) return;
    lock.current = true; setBusy(true);
    try { await saveAlbumDraft(draft, undefined, definition); setIds(previous => [...previous, draft.id]); setStatus("已保存到生图专辑和图库。"); }
    finally { lock.current = false; setBusy(false); }
  };
  return <main className="photo-album-lab">
    <button type="button" className="photo-album-glass-button" onClick={() => { if (!drafts.some(d => !ids.includes(d.id)) || window.confirm("未保存的预览会被丢弃，返回相册？")) onBack(); }} disabled={busy} aria-label="返回相册"><ChevronLeft /></button>
    <div className="photo-album-form-heading"><h1>生图实验室</h1><p>把想象留在相册里。</p></div>
    <fieldset disabled={busy}><legend>角色参考 <small>{characterIds.length}/3</small></legend><CharacterPicker value={characterIds} onChange={setCharacterIds} disabled={busy} limit={3} /></fieldset>
    <fieldset disabled={busy}><legend>用户参考</legend><input ref={referenceInput} aria-label="上传用户参考" type="file" accept="image/*" hidden disabled={busy} onChange={async e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) { lock.current = true; setBusy(true); try { const image = await createImageBitmap(file); image.close(); setReference(await imageBlobToDataUrl(file)); } catch { setStatus("参考图读取失败，请选择有效的图片。"); } finally { lock.current = false; setBusy(false); } } }} />
    {reference ? <div className="photo-album-reference"><img src={reference} alt="本次用户参考图" /><button type="button" aria-label="移除参考" disabled={busy} onClick={() => setReference("")}><X size={16} /></button></div> : <button type="button" className="photo-album-file-button" onClick={() => referenceInput.current?.click()}><ImagePlus size={16} />上传图片</button>}</fieldset>
    <label>画面描述<textarea required value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="描绘你想留下的画面…" maxLength={6000} disabled={busy} /></label>
    <fieldset disabled={busy}><legend>照片数量</legend><div className="photo-album-lab-count">{([1,2,4,6,9] as const).map(n => <button type="button" key={n} aria-pressed={count === n} onClick={() => setCount(n)}>{n} 张</button>)}</div></fieldset>
    <button type="button" className="photo-album-lab-generate" disabled={busy || !prompt.trim()} onClick={() => void generate()}><Sparkles size={16} />{busy ? "处理中…" : "生成预览"}</button>
    <p role="status">{status}</p>
    {drafts.length ? <h2>本次预览</h2> : null}
    {drafts.map(d => <div className="photo-album-lab-result" key={d.id}><img src={d.url} alt={d.label} /><button type="button" disabled={busy || ids.includes(d.id)} onClick={() => setSavingDraft(d)}>{ids.includes(d.id) ? "已保存" : "保存这张"}</button></div>)}
    {savingDraft ? <PhotoDefinitionDialog onClose={() => setSavingDraft(null)} onSave={input => save(savingDraft, input)} /> : null}
  </main>;
}

export function AlbumUpload({ onBack }: { onBack: () => void }) {
  const existing = [...new Set(collectPhotoAlbumAssets().flatMap(a => a.uploadAlbum ? [a.uploadAlbum] : []))];
  const [album, setAlbum] = useState("");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [shared, setShared] = useState(false);
  const [audience, setAudience] = useState<string[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { const urls = files.map(file => URL.createObjectURL(file)); setPreviews(urls); return () => urls.forEach(url => URL.revokeObjectURL(url)); }, [files]);
  const lock = useRef(false);
  const upload = async () => {
    const title = (album || name).trim();
    if (lock.current || !title || !files.length || (shared && !audience.length)) return;
    lock.current = true; setBusy(true);
    let saved = 0;
    try {
      if (!album && existing.includes(title)) throw new Error("专辑名字已存在，请选择已有专辑。");
      setAlbumPermission(title, shared ? audience : []);
      for (const file of files) {
        const bitmap = await createImageBitmap(file); bitmap.close();
        await saveAlbumDraft({ id: `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`, blob: file, label: file.name }, title);
        saved++;
      }
      setStatus(`已保存 ${saved} 张到「${title}」`);
    } catch (error) { setStatus(`已保存 ${saved} 张。${error instanceof Error ? error.message : "其余照片未能保存，请重试。"}`); }
    finally { setFiles(previous => previous.slice(saved)); setBusy(false); lock.current = false; }
  };
  return <main className="photo-album-lab"><button type="button" className="photo-album-glass-button" aria-label="返回相册" disabled={busy} onClick={onBack}><ChevronLeft /></button><div className="photo-album-form-heading"><h1>上传照片</h1></div>
    <label>上传到<select disabled={busy} value={album} onChange={e => { const name = e.target.value; setAlbum(name); const ids = getAlbumPermission(name).characterIds; setAudience(ids); setShared(!!ids.length); }}><option value="">创建新专辑</option>{existing.map(n => <option key={n} value={n}>{n}</option>)}</select></label>
    {!album ? <label>专辑名字<input maxLength={60} value={name} onChange={e => setName(e.target.value)} disabled={busy} placeholder="例如：灵感收藏" /></label> : null}
    <fieldset disabled={busy}><legend>选择照片</legend><input ref={fileInput} aria-label="选择照片" type="file" accept="image/*" multiple hidden disabled={busy} onChange={e => { setFiles(Array.from(e.target.files || [])); e.target.value = ""; }} /><button type="button" className="photo-album-file-button" onClick={() => fileInput.current?.click()}><ImagePlus size={16} />选择文件</button></fieldset>
    {previews.length ? <div className="photo-album-upload-previews">{previews.map((url, i) => <img key={url} src={url} alt={files[i]?.name || "待保存照片"} />)}</div> : null}
    <AlbumAudience shared={shared} setShared={setShared} ids={audience} setIds={setAudience} disabled={busy} />
    {files.length ? <button className="photo-album-lab-generate" type="button" disabled={busy || !(album || name).trim() || (shared && !audience.length)} onClick={() => void upload()}>{busy ? "保存中…" : `保存到专辑 · ${files.length}`}</button> : null}<p role="status">{status}</p></main>;
}

export function AlbumForwardDialog({ asset, onClose }: { asset: PhotoAlbumAsset; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const characters = loadCharacters();
  const sessions = albumForwardSessions(asset).map(session => ({ session, character: characters.find(c => c.id === session.contactId), name: session.isGroup ? session.groupName || "群聊" : session.alias || characters.find(c => c.id === session.contactId)?.name || "聊天" })).filter(item => item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a,b) => b.session.updatedAt.localeCompare(a.session.updatedAt));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const lock = useRef(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  const send = async () => {
    if (lock.current || !selected.length) return;
    lock.current = true; setBusy(true);
    const succeeded: string[] = [];
    const failed: string[] = [];
    for (const id of selected) {
      try { await forwardAlbumPhoto(asset, id); succeeded.push(id); }
      catch { failed.push(id); }
    }
    setSent(previous => [...previous, ...succeeded]); setSelected(failed);
    setStatus(failed.length ? `已发送 ${succeeded.length} 个聊天，${failed.length} 个未成功，可重试。` : `已发送到 ${succeeded.length} 个聊天`);
    lock.current = false; setBusy(false);
  };
  return <div className="photo-album-dialog-scrim"><div className="photo-album-dialog photo-album-forward-dialog" role="dialog" aria-modal="true" aria-label="转发照片"><h2>转发给</h2><input className="photo-album-forward-search" type="search" aria-label="搜索聊天" placeholder="搜索聊天" value={search} onChange={e => setSearch(e.target.value)} /><div className="photo-album-forward-list">{sessions.map(({session,character,name}) => {
    const avatar = character?.avatar;
    const user = session.isGroup ? resolveUserIdentity(session.contactId, "chat") : null;
    return <button type="button" key={session.id} aria-label={name} aria-pressed={selected.includes(session.id)} disabled={busy || sent.includes(session.id)} onClick={() => setSelected(previous => previous.includes(session.id) ? previous.filter(id => id !== session.id) : [...previous, session.id])}>
      <span className="photo-album-forward-avatar">{session.isGroup ? <GroupAvatar members={[...(!session.isSpectator && user ? [{ avatar: user.avatarUrl }] : []), ...(session.participantIds || []).map(id => ({ avatar: characters.find(c => c.id === id)?.avatar }))]} /> : avatar ? <img src={avatar} alt="" /> : name.slice(0,1)}</span>
      <span className="photo-album-forward-name">{name}</span><span className="photo-album-forward-check">{sent.includes(session.id) ? <small>已发送</small> : selected.includes(session.id) ? <Check size={18} /> : null}</span>
    </button>;
  })}</div><p role="status">{status || (!sessions.length ? "没有可转发的聊天" : "")}</p><div className="photo-album-forward-actions"><button type="button" onClick={onClose} disabled={busy}>关闭</button><button type="button" onClick={() => void send()} disabled={busy || !selected.length}>{busy ? "发送中…" : `发送${selected.length ? ` (${selected.length})` : ""}`}</button></div></div></div>;
}
