// 照片涂鸦的描述与合成（移植自 float-Yyk 的共享相册，AGPL-3.0；只保留相册用到的部分）
import type { ChatPhotoAnnotation } from "./chat-storage";

const COLOR_NAMES: Record<string, string> = {
    "#ff3b30": "红色",
    "#ffcc00": "黄色",
    "#34c759": "绿色",
    "#007aff": "蓝色",
    "#ffffff": "白色",
};

function annotationCenter(annotation: ChatPhotoAnnotation): [number, number] {
    if (annotation.kind === "text" || annotation.kind === "rough_shape" || annotation.kind === "emoji") return [annotation.x ?? .5, annotation.y ?? .5];
    const points = annotation.points || [];
    if (points.length < 2) return [.5, .5];
    let x = 0;
    let y = 0;
    let count = 0;
    for (let index = 0; index + 1 < points.length; index += 2) {
        x += points[index];
        y += points[index + 1];
        count += 1;
    }
    return count ? [x / count, y / count] : [.5, .5];
}

type PhotoMarkShape = NonNullable<ChatPhotoAnnotation["shape"]>;

const SHAPE_DESCRIPTIONS: Record<PhotoMarkShape, string> = {
    heart: "手绘爱心",
    star: "手绘星星",
    circle: "手绘圈线",
    arrow: "手绘箭头",
    box: "手绘方框",
    underline: "手绘下划线",
};

export function describePhotoRegion(x: number, y: number): string {
    const horizontal = x < .34 ? "左" : x > .66 ? "右" : "中";
    const vertical = y < .34 ? "上" : y > .66 ? "下" : "部";
    if (horizontal === "中" && vertical === "部") return "中央";
    return `${horizontal}${vertical === "部" ? "部" : vertical}`;
}

export function describePhotoAnnotations(annotations: ChatPhotoAnnotation[]): string {
    if (!annotations.length) return "没有标记";
    return annotations.map(annotation => {
        const [x, y] = annotationCenter(annotation);
        const color = COLOR_NAMES[annotation.color.toLowerCase()] || annotation.color || "彩色";
        const region = describePhotoRegion(x, y);
        const actor = annotation.actorName ? `${annotation.actorName}在` : "";
        if (annotation.kind === "emoji") {
            const rotation = annotation.rotation ? `、旋转${Math.round(annotation.rotation)}度` : "";
            return `${actor}${region}贴了${annotation.emoji || "一个 emoji"}（${annotation.scale || 1}倍${rotation}），用来“${annotation.description || "二创照片"}”`;
        }
        if (annotation.kind === "rough_shape") {
            return `${actor}${region}画了${color}${annotation.doodlePath ? "自由曲线" : SHAPE_DESCRIPTIONS[annotation.shape || "circle"]}${annotation.fill && annotation.fill !== "none" ? `，填色${annotation.fill}` : ""}${annotation.description ? `，用来“${annotation.description}”` : ""}`;
        }
        if (annotation.kind === "text") {
            return `${actor}${region}用${color}手写“${annotation.text || annotation.description || "标记"}”`;
        }
        const points = Math.floor((annotation.points?.length || 0) / 2);
        const meaning = annotation.description?.trim() ? `，表示“${annotation.description.trim()}”` : "";
        return `${actor}${region}留下一笔${color}手绘线条（${points}个轨迹点）${meaning}`;
    }).join("；");
}

export async function compositePhotoAnnotations(imageUrl: string, annotations: ChatPhotoAnnotation[]): Promise<string | null> {
    if (!annotations.length || typeof document === "undefined") return null;
    try {
        // 画图库只在真的要合成涂鸦时才加载，不进 Float 的启动代码
        const { default: rough } = await import("roughjs/bin/rough");
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.crossOrigin = "anonymous";
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("image load failed"));
            element.src = imageUrl;
        });
        const scale = Math.min(1, 1600 / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
        const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
        const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return null;
        context.drawImage(image, 0, 0, width, height);
        const roughCanvas = rough.canvas(canvas);
        for (const annotation of annotations) {
            context.save();
            context.globalAlpha = annotation.opacity ?? 1;
            context.strokeStyle = annotation.color || "#ff3b30";
            context.fillStyle = annotation.color || "#ff3b30";
            context.lineWidth = Math.max(2, (annotation.width || .012) * Math.max(width, height));
            context.lineCap = "round";
            context.lineJoin = "round";
            if (annotation.kind === "emoji" && annotation.emoji) {
                const fontSize = width * .12 * (annotation.scale || 1);
                context.font = `${fontSize}px Apple Color Emoji, Segoe UI Emoji, sans-serif`;
                context.textAlign = "center";
                context.textBaseline = "middle";
                context.translate((annotation.x ?? .5) * width, (annotation.y ?? .5) * height);
                context.rotate(((annotation.rotation || 0) * Math.PI) / 180);
                context.fillText(annotation.emoji, 0, 0);
            } else if (annotation.kind === "rough_shape" && annotation.doodlePath) {
                context.translate((annotation.x ?? .5) * width, (annotation.y ?? .5) * height);
                context.rotate((annotation.rotation || 0) * Math.PI / 180);
                context.translate(-(annotation.x ?? .5) * width, -(annotation.y ?? .5) * height);
                context.scale(width / 100, height / 100);
                roughCanvas.path(annotation.doodlePath, { stroke: annotation.color, fill: annotation.fill || "none", fillStyle: "solid", strokeWidth: (annotation.width || .01) * 100, seed: annotation.seed || 1, roughness: (annotation.roughness || 1.8) / 10 });
            } else if (annotation.kind === "rough_shape" && annotation.shape) {
                const cx = (annotation.x ?? .5) * width;
                const cy = (annotation.y ?? .5) * height;
                const size = (annotation.size || .25) * Math.min(width, height);
                const options = { stroke: annotation.color, fill: annotation.fill || "none", fillStyle: "solid", strokeWidth: Math.max(2, (annotation.width || .01) * Math.max(width, height)), roughness: annotation.roughness || 1.8, bowing: annotation.bowing || 1.25, seed: annotation.seed || 1 };
                if (annotation.shape === "circle") roughCanvas.ellipse(cx, cy, size, size * .78, options);
                else if (annotation.shape === "box") roughCanvas.rectangle(cx - size / 2, cy - size * .38, size, size * .76, options);
                else if (annotation.shape === "underline") roughCanvas.line(cx - size / 2, cy, cx + size / 2, cy, options);
                else if (annotation.shape === "arrow") {
                    roughCanvas.line(cx - size / 2, cy + size * .25, cx + size / 2, cy - size * .25, options);
                    roughCanvas.line(cx + size / 2, cy - size * .25, cx + size * .18, cy - size * .28, options);
                    roughCanvas.line(cx + size / 2, cy - size * .25, cx + size * .34, cy + size * .05, options);
                } else if (annotation.shape === "heart") {
                    roughCanvas.path(`M ${cx} ${cy + size * .42} C ${cx - size * .58} ${cy + size * .06}, ${cx - size * .48} ${cy - size * .44}, ${cx} ${cy - size * .12} C ${cx + size * .48} ${cy - size * .44}, ${cx + size * .58} ${cy + size * .06}, ${cx} ${cy + size * .42}`, options);
                } else {
                    const star = Array.from({ length: 10 }, (_, index) => {
                        const radius = index % 2 ? size * .22 : size * .5;
                        const angle = -Math.PI / 2 + index * Math.PI / 5;
                        return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as [number, number];
                    });
                    roughCanvas.polygon(star, options);
                }
            } else if (annotation.kind === "stroke" && (annotation.points?.length || 0) >= 4) {
                const points = annotation.points!;
                context.beginPath();
                context.moveTo(points[0] * width, points[1] * height);
                for (let index = 2; index + 1 < points.length; index += 2) context.lineTo(points[index] * width, points[index + 1] * height);
                context.stroke();
                if (annotation.renderStyle === "handdrawn") {
                    context.globalAlpha = .28;
                    context.lineWidth *= .58;
                    context.translate(width * .0022, height * .0014);
                    context.stroke();
                }
            } else if (annotation.kind === "text" && annotation.text) {
                context.font = `700 ${Math.max(22, Math.round(width * .065))}px "Segoe Print", "Bradley Hand", cursive`;
                context.shadowColor = "rgba(0,0,0,.35)";
                context.shadowBlur = 3;
                context.fillText(annotation.text, (annotation.x ?? .12) * width, (annotation.y ?? .18) * height);
            }
            context.restore();
        }
        return canvas.toDataURL("image/jpeg", .9);
    } catch {
        return null;
    }
}
