"use client";

import { memo, useEffect, useState } from "react";

/**
 * 聊天头像图片。
 *
 * 头像原图往往是一张很大的 data: 图片。每条新消息都会新建一个 <img>，浏览器要把大图重新解码一遍，
 * 解码完成前那几帧头像位置是空的（露出白底），看起来就是「发消息时头像闪一下」。
 * 这里把头像预先缩成一张 132px 的小图并缓存起来：小图解码几乎不花时间，新气泡出来时头像同一帧就在。
 */

const THUMB_SIZE = 132;
const thumbCache = new Map<string, string>();
const thumbPending = new Map<string, Promise<string>>();

function canThumb(src: string): boolean {
  // 只处理本地图片（data:/blob:）；远程图片画到 canvas 会跨域污染，直接用原图
  return (src.startsWith("data:") || src.startsWith("blob:")) && src.length > 20000;
}

function makeThumb(src: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          if (!w || !h) { resolve(src); return; }
          const side = Math.min(w, h);
          const canvas = document.createElement("canvas");
          canvas.width = THUMB_SIZE;
          canvas.height = THUMB_SIZE;
          const ctx = canvas.getContext("2d");
          if (!ctx) { resolve(src); return; }
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, THUMB_SIZE, THUMB_SIZE);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    } catch {
      resolve(src);
    }
  });
}

function ensureThumb(src: string): Promise<string> {
  const cached = thumbCache.get(src);
  if (cached) return Promise.resolve(cached);
  let task = thumbPending.get(src);
  if (!task) {
    task = makeThumb(src).then((thumb) => {
      thumbCache.set(src, thumb);
      thumbPending.delete(src);
      // 只留最近用到的几十张，头像换了以后旧的不会一直占内存
      if (thumbCache.size > 60) {
        const first = thumbCache.keys().next().value;
        if (first !== undefined) thumbCache.delete(first);
      }
      return thumb;
    });
    thumbPending.set(src, task);
  }
  return task;
}

export const ChatAvatarImg = memo(function ChatAvatarImg({ src, alt = "", className }: { src: string; alt?: string; className?: string }) {
  const [shown, setShown] = useState(() => thumbCache.get(src) ?? src);

  useEffect(() => {
    if (!canThumb(src)) { setShown(src); return; }
    const cached = thumbCache.get(src);
    if (cached) { setShown(cached); return; }
    let alive = true;
    setShown(src);
    void ensureThumb(src).then((thumb) => { if (alive) setShown(thumb); });
    return () => { alive = false; };
  }, [src]);

  return <img src={shown} alt={alt} decoding="sync" className={className} />;
});
