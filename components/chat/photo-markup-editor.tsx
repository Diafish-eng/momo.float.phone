"use client";

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Check, Pencil, Smile, Eraser } from "lucide-react";
import type { ChatPhotoAnnotation } from "@/lib/chat-storage";

export function PhotoMarkupEditor({ imageUrl, fallbackText, initial, onSave, onClose, renderLayer }: {
    imageUrl?: string; fallbackText?: string; initial?: ChatPhotoAnnotation[];
    onSave: (annotations: ChatPhotoAnnotation[]) => void; onClose: () => void;
    renderLayer: (annotations: ChatPhotoAnnotation[], selectedId: string | null) => ReactNode;
}) {
    const [marks, setMarks] = useState<ChatPhotoAnnotation[]>(() => structuredClone(initial || []));
    const marksRef = useRef(marks);
    const history = useRef<ChatPhotoAnnotation[][]>([]);
    const [tool, setTool] = useState<"draw" | "emoji">("draw");
    const [color, setColor] = useState("#ff3b30");
    const [width, setWidth] = useState(.014);
    const [selected, setSelected] = useState<string | null>(null);
    const [typing, setTyping] = useState(false);
    const [draft, setDraft] = useState("");
    const stage = useRef<HTMLDivElement>(null);
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const gesture = useRef<{ id: string; centerX: number; centerY: number; distance: number; angle: number; mark: ChatPhotoAnnotation } | null>(null);
    const stroke = useRef<string | null>(null);
    const switchStart = useRef<number | null>(null);
    const publish = (next: ChatPhotoAnnotation[]) => { marksRef.current = next; setMarks(next); };
    const checkpoint = () => { history.current.push(structuredClone(marksRef.current)); };
    const patchMark = (id: string, patch: Partial<ChatPhotoAnnotation>) => publish(marksRef.current.map(mark => mark.id === id ? { ...mark, ...patch } : mark));
    const metrics = () => {
        const [a, b] = [...pointers.current.values()];
        if (!a) return null;
        return { centerX: b ? (a.x + b.x) / 2 : a.x, centerY: b ? (a.y + b.y) / 2 : a.y,
            distance: b ? Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) : 0,
            angle: b ? Math.atan2(b.y - a.y, b.x - a.x) : 0 };
    };
    const rebase = (id: string) => {
        const mark = marksRef.current.find(mark => mark.id === id);
        const geometry = metrics();
        gesture.current = mark && geometry ? { id, ...geometry, mark: { ...mark } } : null;
    };
    const finishInput = () => {
        const emoji = draft.trim();
        if (emoji) {
            checkpoint();
            const id = `emoji_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            publish([...marksRef.current, { id, kind: "emoji", color: "#ffffff", emoji, x: .5, y: .5,
                scale: 1.25, rotation: 0, description: `${emoji}贴图`, createdAt: new Date().toISOString() }]);
            setSelected(id);
        }
        setTyping(false); setDraft("");
    };
    const changeTool = (next: "draw" | "emoji") => {
        pointers.current.clear(); gesture.current = null; stroke.current = null;
        setTool(next);
        if (next === "emoji") { setTyping(true); setDraft(""); }
        else { setTyping(false); setSelected(null); }
    };
    return createPortal(<section className="photo-edit-page" role="dialog" aria-modal="true" aria-label="标记照片"
        onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        <header className="photo-edit-header">
            <button className="photo-glass-button" aria-label="放弃修改并返回" onClick={onClose}><ChevronLeft /></button>
            <button className="photo-glass-button" aria-label="确认保存" onClick={() => {
                if (typing) finishInput();
                onSave(marksRef.current);
            }}><Check /></button>
        </header>
        <div className="photo-edit-workspace" onClick={() => { if (typing) finishInput(); }}>
            <div className="photo-edit-stage" ref={stage}>
                {imageUrl ? <img src={imageUrl} alt="正在标记的照片" draggable={false} /> : <div className="photo-edit-text">{fallbackText || "文字图片"}</div>}
                {renderLayer(marks, selected)}
                <div className="photo-edit-touch"
                    onPointerDown={event => {
                        if (typing || !stage.current || !event.isPrimary && tool === "draw") return;
                        if (pointers.current.size >= 2) return;
                        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
                        const rect = stage.current.getBoundingClientRect();
                        const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
                        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                        if (tool === "draw") {
                            checkpoint(); const id = `stroke_${Date.now()}`; stroke.current = id;
                            publish([...marksRef.current, { id, kind: "stroke", color, width, points: [x, y, x + .0001, y] }]);
                        } else if (pointers.current.size === 1) {
                            const hit = [...marksRef.current].reverse().find(mark => mark.kind === "emoji" &&
                                Math.hypot((x - (mark.x ?? .5)) * rect.width, (y - (mark.y ?? .5)) * rect.height) <= Math.max(22, .085 * (mark.scale || 1) * Math.max(rect.width, rect.height)));
                            setSelected(hit?.id || null);
                            if (hit) { checkpoint(); rebase(hit.id); }
                            else gesture.current = null;
                        } else if (gesture.current) rebase(gesture.current.id);
                    }}
                    onPointerMove={event => {
                        if (!pointers.current.has(event.pointerId) || !stage.current) return;
                        event.preventDefault();
                        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                        const rect = stage.current.getBoundingClientRect();
                        if (tool === "draw" && stroke.current) {
                            const mark = marksRef.current.find(mark => mark.id === stroke.current);
                            if (mark) patchMark(mark.id, { points: [...(mark.points || []), Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))] });
                        } else if (gesture.current) {
                            const g = gesture.current, m = metrics(); if (!m) return;
                            let delta = m.angle - g.angle;
                            delta = Math.atan2(Math.sin(delta), Math.cos(delta));
                            patchMark(g.id, { x: Math.max(0, Math.min(1, (g.mark.x ?? .5) + (m.centerX - g.centerX) / rect.width)),
                                y: Math.max(0, Math.min(1, (g.mark.y ?? .5) + (m.centerY - g.centerY) / rect.height)),
                                scale: Math.max(.3, Math.min(6, (g.mark.scale || 1) * (g.distance && m.distance ? m.distance / g.distance : 1))),
                                rotation: (g.mark.rotation || 0) + (g.distance && m.distance ? delta * 180 / Math.PI : 0) });
                        }
                    }}
                    onPointerUp={event => {
                        pointers.current.delete(event.pointerId); stroke.current = null;
                        if (gesture.current) rebase(gesture.current.id);
                    }}
                    onPointerCancel={() => { pointers.current.clear(); gesture.current = null; stroke.current = null; }}
                />
            </div>
        </div>
        {typing && <div className="photo-emoji-input-overlay" onClick={finishInput}>
            <input autoFocus value={draft} aria-label="输入 Emoji" placeholder="☺" className="photo-emoji-native-input"
                onClick={event => event.stopPropagation()} onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) finishInput(); }} />
        </div>}
        <footer className="photo-edit-footer">
            {tool === "draw" && <div className="photo-pen-options">
                {["#ff3b30", "#ffcc00", "#34c759", "#007aff", "#ffffff", "#191919"].map(value => <button key={value} className="photo-color-dot" style={{ background: value }} aria-label={`画笔颜色 ${value}`} aria-pressed={color === value} onClick={() => setColor(value)} />)}
                <span className="photo-tool-separator" />
                {[.006, .014, .028].map((value, index) => <button key={value} className="photo-pen-width" aria-label={["细", "粗", "特粗"][index]} aria-pressed={width === value} onClick={() => setWidth(value)}><i style={{ width: 5 + index * 4, height: 5 + index * 4 }} /></button>)}
                <button className="photo-undo" aria-label="撤回上一笔" onClick={() => { const previous = history.current.pop(); if (previous) publish(previous); }}><Eraser size={20} /></button>
            </div>}
            <div className="photo-tool-capsule" onPointerDown={event => { switchStart.current = event.clientX; }}
                onPointerUp={event => { if (switchStart.current !== null && Math.abs(event.clientX - switchStart.current) > 28) changeTool(event.clientX < switchStart.current ? "emoji" : "draw"); switchStart.current = null; }}>
                <button aria-pressed={tool === "draw"} onClick={() => changeTool("draw")}><Pencil size={19} />画笔</button>
                <button aria-pressed={tool === "emoji"} onClick={() => changeTool("emoji")}><Smile size={19} />Emoji</button>
            </div>
        </footer>
    </section>, document.body);
}
