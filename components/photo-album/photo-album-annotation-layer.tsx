"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import rough from "roughjs/bin/rough";

import type { ChatPhotoAnnotation } from "@/lib/chat-storage";

function RoughPhotoShape({ annotation }: { annotation: ChatPhotoAnnotation }) {
  const paths = useMemo(() => {
    if (!annotation.shape && !annotation.doodlePath) return [];
    const generator = rough.generator();
    const cx = (annotation.x ?? 0.5) * 1000;
    const cy = (annotation.y ?? 0.5) * 1000;
    const size = (annotation.size || 0.25) * 1000;
    const options = {
      stroke: annotation.color,
      strokeWidth: (annotation.width || 0.01) * 1000,
      roughness: annotation.roughness || 1.8,
      bowing: annotation.bowing || 1.25,
      seed: annotation.seed || 1,
      fill: annotation.fill || "none",
      fillStyle: "solid" as const,
    };
    if (annotation.doodlePath) {
      return generator.toPaths(generator.path(annotation.doodlePath, {
        ...options,
        strokeWidth: options.strokeWidth / 10,
        roughness: options.roughness / 10,
      }));
    }
    let drawable;
    if (annotation.shape === "circle") drawable = generator.ellipse(cx, cy, size, size * 0.78, options);
    else if (annotation.shape === "box") drawable = generator.rectangle(cx - size / 2, cy - size * 0.38, size, size * 0.76, options);
    else if (annotation.shape === "underline") drawable = generator.line(cx - size / 2, cy, cx + size / 2, cy, options);
    else if (annotation.shape === "arrow") drawable = generator.path(`M ${cx - size / 2} ${cy + size * 0.25} L ${cx + size / 2} ${cy - size * 0.25} M ${cx + size / 2} ${cy - size * 0.25} L ${cx + size * 0.18} ${cy - size * 0.28} M ${cx + size / 2} ${cy - size * 0.25} L ${cx + size * 0.34} ${cy + size * 0.05}`, options);
    else if (annotation.shape === "heart") drawable = generator.path(`M ${cx} ${cy + size * 0.42} C ${cx - size * 0.58} ${cy + size * 0.06}, ${cx - size * 0.48} ${cy - size * 0.44}, ${cx} ${cy - size * 0.12} C ${cx + size * 0.48} ${cy - size * 0.44}, ${cx + size * 0.58} ${cy + size * 0.06}, ${cx} ${cy + size * 0.42}`, options);
    else drawable = generator.polygon(Array.from({ length: 10 }, (_, index) => {
      const radius = index % 2 ? size * 0.22 : size * 0.5;
      const angle = -Math.PI / 2 + index * Math.PI / 5;
      return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as [number, number];
    }), options);
    return generator.toPaths(drawable);
  }, [annotation]);
  const cx = (annotation.x ?? 0.5) * 1000;
  const cy = (annotation.y ?? 0.5) * 1000;
  return (
    <g opacity={annotation.opacity ?? 1} transform={`rotate(${annotation.rotation || 0} ${cx} ${cy})${annotation.doodlePath ? " scale(10)" : ""}`}>
      {paths.map((path, index) => <path key={index} d={path.d} fill={path.fill || "none"} stroke={path.stroke} strokeWidth={path.strokeWidth} />)}
    </g>
  );
}

export function PhotoAlbumAnnotationLayer({ annotations, selectedId }: {
  annotations?: ChatPhotoAnnotation[];
  selectedId?: string | null;
}) {
  const layerRef = useRef<SVGSVGElement>(null);
  const [emojiAspect, setEmojiAspect] = useState(1);
  const hasMarks = Boolean(annotations?.length);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setEmojiAspect(width / height);
    });
    observer.observe(layer);
    return () => observer.disconnect();
  }, [hasMarks]);

  if (!annotations?.length) return null;
  return (
    <svg ref={layerRef} className="photo-album-annotation-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
      {annotations.map((annotation) => annotation.kind === "rough_shape" ? (
        <RoughPhotoShape key={annotation.id} annotation={annotation} />
      ) : annotation.kind === "emoji" && annotation.emoji ? (
        <g key={annotation.id} transform={`translate(${(annotation.x ?? 0.5) * 1000} ${(annotation.y ?? 0.5) * 1000}) scale(1 ${emojiAspect}) rotate(${annotation.rotation || 0})`}>
          {selectedId === annotation.id ? <circle cx={0} cy={0} r={76 * (annotation.scale || 1)} fill="none" stroke="rgba(255,255,255,.92)" strokeWidth="5" strokeDasharray="14 10" /> : null}
          <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={120 * (annotation.scale || 1)} fontFamily="Apple Color Emoji, Segoe UI Emoji, sans-serif">{annotation.emoji}</text>
        </g>
      ) : annotation.kind === "stroke" && annotation.points?.length ? (
        <g key={annotation.id}>
          <polyline
            points={Array.from({ length: Math.floor(annotation.points.length / 2) }, (_, index) => `${annotation.points![index * 2] * 1000},${annotation.points![index * 2 + 1] * 1000}`).join(" ")}
            fill="none"
            stroke={annotation.color}
            strokeWidth={(annotation.width || 0.012) * 1000}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {annotation.renderStyle === "handdrawn" ? <polyline
            points={Array.from({ length: Math.floor(annotation.points.length / 2) }, (_, index) => `${annotation.points![index * 2] * 1000},${annotation.points![index * 2 + 1] * 1000}`).join(" ")}
            fill="none"
            stroke={annotation.color}
            strokeWidth={(annotation.width || 0.012) * 580}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity=".28"
            transform="translate(2.2 1.4)"
          /> : null}
        </g>
      ) : annotation.kind === "text" && annotation.text ? (
        <text key={annotation.id} x={(annotation.x ?? 0.5) * 1000} y={(annotation.y ?? 0.5) * 1000} fill={annotation.color} fontSize="64" fontWeight="700" fontFamily="Segoe Print, Bradley Hand, Comic Sans MS, cursive" fontStyle="italic" paintOrder="stroke" stroke="rgba(0,0,0,.38)" strokeWidth="8" transform={`rotate(-3 ${(annotation.x ?? 0.5) * 1000} ${(annotation.y ?? 0.5) * 1000})`}>{annotation.text}</text>
      ) : null)}
    </svg>
  );
}
