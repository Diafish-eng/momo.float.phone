"use client";

import { useEffect } from "react";

/**
 * 全局手势（独立文件，挂在 layout 里，不改各页面组件）：
 *
 * 1. 右滑返回：在任意带「返回」键的 PageShell 页面里，手指从左往右滑，页面跟手移动；
 *    松手时滑过约 1/3 宽度或甩得够快就返回（等同点一次返回键），否则弹回原位。
 *    返回键照常可用，两者并存。导入的第三方应用跑在 iframe 里，事件传不出来，天然不受影响。
 *
 * 2. 左滑引用：在聊天室里把某条消息从右往左拖，右侧露出引用图标，拖过阈值松手即引用
 *    （派发 chat-swipe-quote 事件，由聊天室接住）。长按菜单里的「引用」照常可用。
 */

const BACK_COMMIT_RATIO = 0.35;      // 滑过页面宽度的这个比例就返回
const BACK_FLING_VELOCITY = 0.45;    // px/ms，甩得够快也返回
const QUOTE_TRIGGER = 56;            // 左滑超过这个距离松手触发引用
const QUOTE_MAX = 92;                // 消息最多被拖出的距离
const DECIDE_SLOP = 10;              // 移动超过这个距离才判断方向

const REPLY_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';

function isHorizontallyScrollable(from: Element | null, stopAt: Element | null): boolean {
  let node: Element | null = from;
  while (node && node !== stopAt && node !== document.body) {
    if (node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 4) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    node = node.parentElement;
  }
  return false;
}

export function GestureController() {
  useEffect(() => {
    type Mode = "none" | "pending" | "back" | "quote";
    let mode: Mode = "none";
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;

    // 右滑返回
    let pageEl: HTMLElement | null = null;
    let backBtn: HTMLElement | null = null;
    let pageWidth = 0;
    let backX = 0;
    // 聊天室右滑：下面露出会话列表（跟微信一样两层一起动），不是白底
    let appEl: HTMLElement | null = null;
    let underEl: HTMLElement | null = null;
    let navEl: HTMLElement | null = null;
    let dimEl: HTMLElement | null = null;

    // 左滑引用
    let rowEl: HTMLElement | null = null;
    let iconEl: HTMLElement | null = null;
    let quoteX = 0;
    let quoteArmed = false;

    const reset = () => {
      mode = "none";
      pageEl = null;
      backBtn = null;
      appEl = null;
      underEl = null;
      navEl = null;
      dimEl = null;
      rowEl = null;
      iconEl = null;
    };

    const onStart = (event: TouchEvent) => {
      reset();
      if (event.touches.length !== 1) return;
      const target = event.target as Element | null;
      if (!target || !(target instanceof Element)) return;
      // 滑块、弹窗、下拉菜单、长按菜单里不接管
      if (target.closest('input[type="range"], .modal-overlay, .g-dropdown, .ctx-menu, [data-no-swipe]')) return;

      const touch = event.touches[0];
      startX = lastX = touch.clientX;
      startY = touch.clientY;
      lastT = event.timeStamp;
      velocity = 0;

      // —— 右滑返回的候选页面 ——
      const shell = target.closest<HTMLElement>(".page-shell");
      if (shell) {
        const btn = shell.querySelector<HTMLElement>(':scope > .page-header .page-back-btn[aria-label="返回"]');
        if (btn && !isHorizontallyScrollable(target, shell)) {
          backBtn = btn;
          // 聊天 App 的四个 tab 根页面：返回 = 退出整个 App，所以整块一起动
          pageEl = shell.closest(".chat-main-content") ? (shell.closest<HTMLElement>(".chat-app") ?? shell) : shell;
          // 聊天室本身：整层（.chat-room-layer）一起滑走，露出底下的会话列表
          const layer = shell.classList.contains("chat-room-wrapper") ? shell.closest<HTMLElement>(".chat-room-layer") : null;
          const app = layer?.closest<HTMLElement>(".chat-app") ?? null;
          if (layer && app) {
            pageEl = layer;
            appEl = app;
            underEl = app.querySelector<HTMLElement>(":scope > .chat-main-content");
            navEl = app.querySelector<HTMLElement>(":scope > .chat-tab-bar");
          }
        }
      }

      // —— 左滑引用的候选消息 ——
      const row = target.closest<HTMLElement>('.chat-room-wrapper:not(.mascot-chat-session) .chat-msg-wrapper[id^="message-"]');
      if (row && !row.hasAttribute("data-multi-select")) {
        const role = row.getAttribute("data-role");
        if (role === "user" || role === "assistant") rowEl = row;
      }

      if (pageEl || rowEl) mode = "pending";
    };

    // 底下那层的视差：从左边 -28% 的位置跟着滑回原位，同时暗罩渐渐变透明
    const layoutUnder = (progress: number) => {
      const shift = -(1 - progress) * 0.28 * pageWidth;
      if (underEl) underEl.style.transform = `translate3d(${shift}px,0,0)`;
      if (navEl) navEl.style.transform = `translate3d(${shift}px,0,0)`;
      if (dimEl) dimEl.style.opacity = String(0.22 * (1 - progress));
    };

    const beginBack = () => {
      if (!pageEl) return;
      pageWidth = pageEl.offsetWidth || window.innerWidth;
      pageEl.style.transition = "none";
      pageEl.style.willChange = "transform";
      if (appEl && underEl) {
        appEl.setAttribute("data-swipe-back", "");
        pageEl.style.boxShadow = "-6px 0 24px rgba(0, 0, 0, 0.16)";
        if (navEl) navEl.style.display = "";
        const dim = document.createElement("div");
        dim.className = "chat-swipe-back-dim";
        appEl.appendChild(dim);
        dimEl = dim;
        for (const el of [underEl, navEl]) {
          if (!el) continue;
          el.style.transition = "none";
          el.style.willChange = "transform";
        }
        layoutUnder(0);
      }
      backX = 0;
      mode = "back";
    };

    const beginQuote = () => {
      if (!rowEl) return;
      rowEl.style.transition = "none";
      rowEl.style.willChange = "transform";
      if (getComputedStyle(rowEl).position === "static") rowEl.style.position = "relative";
      const icon = document.createElement("span");
      icon.className = "chat-swipe-quote-icon";
      icon.innerHTML = REPLY_ICON;
      rowEl.appendChild(icon);
      iconEl = icon;
      quoteX = 0;
      quoteArmed = false;
      mode = "quote";
    };

    const onMove = (event: TouchEvent) => {
      if (mode === "none") return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (mode === "pending") {
        if (Math.abs(dx) < DECIDE_SLOP && Math.abs(dy) < DECIDE_SLOP) return;
        if (Math.abs(dy) > Math.abs(dx)) { reset(); return; }   // 竖向滚动，不接管
        if (dx > 0 && pageEl) beginBack();
        else if (dx < 0 && rowEl) beginQuote();
        else { reset(); return; }
      }

      const dt = event.timeStamp - lastT;
      if (dt > 0) velocity = 0.7 * ((touch.clientX - lastX) / dt) + 0.3 * velocity;
      lastX = touch.clientX;
      lastT = event.timeStamp;

      if (mode === "back" && pageEl) {
        if (event.cancelable) event.preventDefault();
        backX = Math.max(0, dx - DECIDE_SLOP);
        pageEl.style.transform = `translate3d(${backX}px,0,0)`;
        if (underEl) layoutUnder(Math.min(1, backX / pageWidth));
      } else if (mode === "quote" && rowEl) {
        if (event.cancelable) event.preventDefault();
        const pulled = Math.max(0, -dx - DECIDE_SLOP);
        // 越往后拖阻力越大
        quoteX = pulled <= QUOTE_TRIGGER ? pulled : QUOTE_TRIGGER + (pulled - QUOTE_TRIGGER) * 0.35;
        quoteX = Math.min(QUOTE_MAX, quoteX);
        rowEl.style.transform = `translate3d(${-quoteX}px,0,0)`;
        const armed = quoteX >= QUOTE_TRIGGER;
        if (iconEl) {
          const progress = Math.min(1, quoteX / QUOTE_TRIGGER);
          iconEl.style.opacity = String(progress);
          iconEl.style.transform = `translateY(-50%) scale(${0.6 + 0.4 * progress})`;
          iconEl.toggleAttribute("data-armed", armed);
        }
        if (armed && !quoteArmed) {
          try { navigator.vibrate?.(8); } catch { /* 不支持震动就算了 */ }
        }
        quoteArmed = armed;
      }
    };

    const onEnd = () => {
      if (mode === "back" && pageEl && backBtn) {
        const el = pageEl;
        const btn = backBtn;
        const commit = backX > pageWidth * BACK_COMMIT_RATIO || (velocity > BACK_FLING_VELOCITY && backX > 24);
        el.style.transition = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
        el.style.transform = commit ? `translate3d(${pageWidth}px,0,0)` : "translate3d(0,0,0)";
        const app = appEl;
        const under = underEl;
        const nav = navEl;
        const dim = dimEl;
        if (under) {
          const ease = "220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
          for (const layer of [under, nav]) {
            if (layer) layer.style.transition = `transform ${ease}`;
          }
          if (dim) dim.style.transition = `opacity ${ease}`;
          layoutUnder(commit ? 1 : 0);
        }
        window.setTimeout(() => {
          if (commit) btn.click();
          // 等返回逻辑把页面换掉后再清样式，避免闪一下原页面
          window.setTimeout(() => {
            el.style.transition = "";
            el.style.transform = "";
            el.style.willChange = "";
            el.style.boxShadow = "";
            for (const layer of [under, nav]) {
              if (!layer) continue;
              layer.style.transition = "";
              layer.style.transform = "";
              layer.style.willChange = "";
            }
            // 没返回成功：聊天室还开着，底部栏恢复隐藏
            if (nav && !commit) nav.style.display = "none";
            dim?.remove();
            app?.removeAttribute("data-swipe-back");
          }, commit ? 80 : 0);
        }, 230);
      } else if (mode === "quote" && rowEl) {
        const el = rowEl;
        const icon = iconEl;
        const armed = quoteArmed;
        el.style.transition = "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)";
        el.style.transform = "translate3d(0,0,0)";
        if (icon) icon.style.opacity = "0";
        if (armed) {
          const messageId = el.id.replace(/^message-/, "");
          window.dispatchEvent(new CustomEvent("chat-swipe-quote", { detail: { messageId } }));
        }
        window.setTimeout(() => {
          el.style.transition = "";
          el.style.transform = "";
          el.style.willChange = "";
          icon?.remove();
        }, 210);
      }
      reset();
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return null;
}
