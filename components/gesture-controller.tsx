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
    const prevPages = new WeakMap<HTMLElement, HTMLElement[]>();

    // —— 页面栈 ——
    // 很多二级页面并不换外壳，只换外壳里的内容（设置 → 预设 就是这样），所以不能靠「谁被移除了」来判断。
    // 做法：每次点击前先给当前页拍一份快照；点击后如果页面顶栏变了，说明发生了跳转，
    // 把快照记为新页面的「上一页」。回退时按顶栏文字在栈里找到自己，弹掉后面的。
    type StackEntry = { key: string; under: HTMLElement | null; scroll: number };
    let stack: StackEntry[] = [];
    type PendingNav = { fromKey: string | null; home: boolean; clone: HTMLElement | null; scroll: number; done: boolean };
    const homeRects = new WeakMap<HTMLElement, { l: number; t: number; w: number; h: number }>();
    const SNAPSHOT_MAX_NODES = 2500;

    const STD_BACK = ':scope > .page-header .page-back-btn[aria-label="返回"]';
    const APP_BOX = ".phone-app-pane, .mini-app-window";

    // 不是所有内置应用都用标准页面外壳。这里按「左上角的返回键」来认：
    // 带 返回 字样的按钮、类名带 back 的按钮、或者里面是 ‹ / ← 图标的按钮，且真的显示在最上层。
    const findBackButton = (root: HTMLElement): HTMLElement | null => {
      try {
        const box = root.getBoundingClientRect();
        if (box.width === 0) return null;
        const found = root.querySelectorAll<HTMLElement>(
          '[aria-label^="返回"], .page-back-btn, button[class*="back"], svg.lucide-chevron-left, svg.lucide-arrow-left',
        );
        for (let i = found.length - 1; i >= 0; i--) {
          const raw = found[i];
          const el = raw.tagName.toLowerCase() === "svg" ? raw.closest<HTMLElement>('button, [role="button"], a') : raw;
          if (!el || el.offsetParent === null) continue;
          if ((el as HTMLButtonElement).disabled) continue;
          const label = el.getAttribute("aria-label") || "";
          if (label.includes("下拉") || el.closest(".swipe-back-under")) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.left - box.left > 110 || r.top - box.top > 170) continue;
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (hit && (hit === el || el.contains(hit))) return el;
        }
        // 兜底：有些应用的返回键既没文字也没标记（比如音乐），就取最左上角那个只有图标的按钮
        const buttons = root.querySelectorAll<HTMLElement>('button, [role="button"]');
        for (let i = 0; i < buttons.length && i < 80; i++) {
          const el = buttons[i];
          if (el.offsetParent === null || (el as HTMLButtonElement).disabled) continue;
          if ((el.textContent || "").trim() !== "" || !el.querySelector("svg")) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.left - box.left > 64 || r.top - box.top > 130) continue;
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (hit && (hit === el || el.contains(hit))) return el;
        }
      } catch { /* ignore */ }
      return null;
    };

    // 一页的「身份」：顶栏里的文字（标题 + 按钮字样）。同一页回来时文字一样，就能在栈里认出来。
    const keyOf = (root: HTMLElement) => {
      let head: Element | null = root.querySelector(":scope > .page-header");
      if (!head) {
        const btn = findBackButton(root);
        head = btn ? (btn.closest("header") ?? btn.parentElement) : null;
      }
      const text = (head?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
      return text || `#${root.className.toString().slice(0, 40)}`;
    };

    // 当前显示的那一页：有标准外壳就取最上面的外壳，没有就取整个应用容器
    const topShell = (): HTMLElement | null => {
      const all = document.querySelectorAll<HTMLElement>(".page-shell");
      for (let i = all.length - 1; i >= 0; i--) if (all[i].offsetParent !== null) return all[i];
      const boxes = document.querySelectorAll<HTMLElement>(APP_BOX);
      for (let i = boxes.length - 1; i >= 0; i--) if (boxes[i].offsetParent !== null) return boxes[i];
      return null;
    };

    // 自带拖动/翻页手势的界面：只认从屏幕左边缘起手的右滑，免得抢它们的手势
    const GESTURE_HEAVY =
      'canvas, [draggable="true"], [class*="reading-viewer"], [class*="reading-pdf"], [class*="map-"], [class*="note-wall"], ' +
      '[class*="room-view"], [class*="mixology"], [class*="mix-"], [class*="game"], [class*="vn-"], [class*="douyin"], ' +
      '[class*="story-"], [class*="wb-"], [class*="swipe-action"]';

    const settleNav = (nav: PendingNav) => {
      if (nav.done) return;
      try {
        const cur = topShell();
        if (!cur) return;
        const key = keyOf(cur);
        if (nav.home) {
          nav.done = true;
          stack = [{ key, under: null, scroll: 0 }];
          return;
        }
        if (key === nav.fromKey) return;   // 还没跳转（或者这次点击根本不跳转）
        nav.done = true;
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].key === key) { stack.length = i + 1; return; }   // 回到了栈里已有的页面
        }
        stack.push({ key, under: nav.clone, scroll: nav.scroll });
        if (stack.length > 12) stack.splice(1, stack.length - 12);
      } catch { /* 记不上只是少一个同屏效果 */ }
    };

    const onClickCapture = (event: MouseEvent) => {
      try {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest("input, textarea, select, .swipe-back-under")) return;
        const shell = target.closest<HTMLElement>(".page-shell") ?? target.closest<HTMLElement>(APP_BOX);
        let nav: PendingNav | null = null;
        if (shell) {
          const goingBack = !!target.closest('.page-back-btn, [aria-label^="返回"]');
          const tooBig = shell.classList.contains("chat-room-wrapper") || shell.getElementsByTagName("*").length > SNAPSHOT_MAX_NODES;
          const body = shell.querySelector<HTMLElement>(":scope > .page-body");
          nav = {
            fromKey: keyOf(shell),
            home: false,
            clone: goingBack || tooBig ? null : (shell.cloneNode(true) as HTMLElement),
            scroll: body ? body.scrollTop : 0,
            done: false,
          };
        } else {
          const phone = document.querySelector<HTMLElement>(".phone-shell");
          const layer = phone?.querySelector<HTMLElement>(".phone-swipe-layer");
          if (!phone || !layer || !target.closest(".phone-shell")) return;
          // 在主屏上点的：记下主屏各块的位置，之后垫回去时原样摆放
          const base = phone.getBoundingClientRect();
          phone.querySelectorAll<HTMLElement>(".phone-swipe-layer, .page-controls, footer.dock").forEach((n) => {
            const r = n.getBoundingClientRect();
            homeRects.set(n, { l: r.left - base.left, t: r.top - base.top, w: r.width, h: r.height });
          });
          nav = { fromKey: null, home: true, clone: null, scroll: 0, done: false };
        }
        const pending = nav;
        for (const ms of [0, 160, 480]) window.setTimeout(() => settleNav(pending), ms);
      } catch { /* ignore */ }
    };
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
    // 其它页面右滑：把「上一页」的旧节点临时垫在下面（见下方 prevPages）
    let underNodes: HTMLElement[] | null = null;
    let parentPosReset: HTMLElement | null = null;
    let homeUnder = false;   // 应用的首页右滑：整个应用窗口滑走，露出底下还在的主屏
    let homeMode = false;    // 垫的是主屏（要带壁纸、按原位置摆放）
    let underClone: HTMLElement | null = null;   // 垫的是上一页的快照
    let underScroll = 0;
    let ownsUnder = false;   // underEl 是我们自己插进去的容器（用完要拿走）

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
      underNodes = null;
      parentPosReset = null;
      homeUnder = false;
      homeMode = false;
      underClone = null;
      underScroll = 0;
      ownsUnder = false;
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
      const realShell = target.closest<HTMLElement>(".page-shell");
      const box = target.closest<HTMLElement>(APP_BOX);
      let stdBtn = realShell ? realShell.querySelector<HTMLElement>(STD_BACK) : null;
      let generic = false;
      const shell = realShell ?? box;
      if (!stdBtn && shell && box) {
        // 没有标准返回键的页面（很多内置应用）：按左上角的返回键来认
        stdBtn = findBackButton(shell);
        generic = true;
        if (stdBtn && target.closest(GESTURE_HEAVY) && startX - box.getBoundingClientRect().left > 30) stdBtn = null;
      }
      if (shell) {
        const btn = stdBtn;
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
          } else {
            // 其它页面：按「页面栈」决定底下垫什么
            const key = keyOf(shell);
            let idx = -1;
            for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].key === key) { idx = i; break; } }
            const isAppRoot = !!shell.closest(".chat-main-content") || idx === 0
              || (idx < 0 && generic && (btn.getAttribute("aria-label") || "") === "返回桌面")
              // 从主屏进来后还没发生过页内跳转：不管顶栏文字有没有变（加载中→加载完），都还是应用首页
              || (idx < 0 && stack.length <= 1);
            if (isAppRoot) {
              // 应用首页：上一页是主屏。主屏重新出现时 Float 自己会闪一下，所以这里不提供右滑，
              // 退出应用只能点左上角的返回键。
              pageEl = null;
              backBtn = null;
            } else if (idx > 0 && stack[idx].under) {
              // 二级、三级页面：底下垫进来之前那一页的快照
              pageEl = shell;
              underClone = stack[idx].under;
              underScroll = stack[idx].scroll;
            }
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

    // 把上一页装进一个不可交互的容器，垫在当前页下面
    const STRIP = "iframe, video, audio, script";
    const mountUnderPage = () => {
      const parent = pageEl?.parentElement;
      if (!pageEl || !parent) return;
      try {
        const cs = getComputedStyle(parent);
        const wrap = document.createElement("div");
        wrap.className = "swipe-back-under";
        wrap.setAttribute("inert", "");
        wrap.setAttribute("aria-hidden", "true");
        let cloneBody: HTMLElement | null = null;
        if (underClone) {
          // 二级页面：上一页的快照，铺满当前页的位置
          underClone.querySelectorAll(STRIP).forEach((el) => el.remove());
          underClone.style.transform = "";
          underClone.style.transition = "";
          underClone.style.boxShadow = "";
          underClone.style.position = "absolute";
          underClone.style.inset = "0";
          underClone.style.margin = "0";
          wrap.appendChild(underClone);
          cloneBody = underClone.querySelector<HTMLElement>(":scope > .page-body");
          if (underClone.matches(APP_BOX)) underClone.style.display = getComputedStyle(pageEl).display;
        } else if (underNodes) {
          const phone = homeMode ? pageEl.closest<HTMLElement>(".phone-shell") : null;
          if (phone) {
            // 主屏：盖满整个手机屏幕，带上壁纸，各块按离开时的位置摆
            const pr = parent.getBoundingClientRect();
            const sr = phone.getBoundingClientRect();
            wrap.style.inset = "auto";
            wrap.style.left = `${sr.left - pr.left}px`;
            wrap.style.top = `${sr.top - pr.top}px`;
            wrap.style.width = `${sr.width}px`;
            wrap.style.height = `${sr.height}px`;
            const wallpaper = phone.querySelector<HTMLElement>(":scope > .phone-wallpaper");
            if (wallpaper) {
              const ws = getComputedStyle(wallpaper);
              wrap.style.backgroundColor = ws.backgroundColor;
              wrap.style.backgroundImage = ws.backgroundImage;
              wrap.style.backgroundSize = ws.backgroundSize;
              wrap.style.backgroundPosition = ws.backgroundPosition;
              wrap.style.backgroundRepeat = ws.backgroundRepeat;
            }
          } else if (cs.display.includes("flex")) {
            wrap.style.display = "flex";
            wrap.style.flexDirection = cs.flexDirection;
            wrap.style.alignItems = cs.alignItems;
            wrap.style.gap = cs.gap;
            wrap.style.padding = cs.padding;
          }
          for (const n of underNodes) {
            if (/^(IFRAME|VIDEO|AUDIO|SCRIPT|STYLE|LINK)$/.test(n.tagName)) continue;
            // 内嵌网页/音视频不能重新挂载（会重载），旧页面里的直接去掉
            n.querySelectorAll(STRIP).forEach((el) => el.remove());
            const rect = phone ? homeRects.get(n) : undefined;
            if (rect) {
              n.style.position = "absolute";
              n.style.left = `${rect.l}px`;
              n.style.top = `${rect.t}px`;
              n.style.width = `${rect.w}px`;
              n.style.height = `${rect.h}px`;
              n.style.margin = "0";
            }
            wrap.appendChild(n);
          }
        } else {
          return;
        }
        const dim = document.createElement("div");
        dim.className = "chat-swipe-back-dim";
        wrap.appendChild(dim);
        if (cs.position === "static") {
          parent.style.position = "relative";
          parentPosReset = parent;
        }
        parent.insertBefore(wrap, pageEl);
        if (cloneBody) cloneBody.scrollTop = underScroll;
        pageEl.style.transform = "translate3d(0,0,0)";
        underEl = wrap;
        dimEl = dim;
        ownsUnder = true;
      } catch { /* 垫不上就退回普通滑动 */ }
    };

    const beginBack = () => {
      if (!pageEl) return;
      pageWidth = pageEl.offsetWidth || window.innerWidth;
      pageEl.style.transition = "none";
      pageEl.style.willChange = "transform";
      if (!underEl && (underNodes || underClone)) mountUnderPage();
      if (homeUnder && pageEl.parentElement) {
        const dim = document.createElement("div");
        dim.className = "chat-swipe-back-dim";
        dim.style.zIndex = getComputedStyle(pageEl).zIndex;
        pageEl.parentElement.insertBefore(dim, pageEl);
        dimEl = dim;
      }
      if (underEl || dimEl) {
        pageEl.style.boxShadow = "-6px 0 24px rgba(0, 0, 0, 0.16)";
        if (appEl) {
          appEl.setAttribute("data-swipe-back", "");
          if (navEl) navEl.style.display = "";
          const dim = document.createElement("div");
          dim.className = "chat-swipe-back-dim";
          appEl.appendChild(dim);
          dimEl = dim;
        }
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
        if (event.defaultPrevented) { reset(); return; }        // 页面自己在处理这次滑动
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
        const underWrap = ownsUnder ? underEl : null;
        const posReset = parentPosReset;
        if (under || dim) {
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
            underWrap?.remove();
            if (posReset) posReset.style.position = "";
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

    // 记录「谁顶替了谁」：页面切换时旧页面的节点被移出文档、新页面被插进同一个父节点。
    // 把旧节点记在新页面名下，右滑返回时拿出来垫在下面，就能两页同屏。
    const observer = new MutationObserver((records) => {
      try {
        let groups: Map<Node, { added: HTMLElement[]; removed: HTMLElement[] }> | null = null;
        for (const record of records) {
          if (record.addedNodes.length === 0 && record.removedNodes.length === 0) continue;
          if (!groups) groups = new Map();
          let group = groups.get(record.target);
          if (!group) { group = { added: [], removed: [] }; groups.set(record.target, group); }
          for (const n of Array.from(record.addedNodes)) {
            if (n instanceof HTMLElement && !n.classList.contains("swipe-back-under")) group.added.push(n);
          }
          for (const n of Array.from(record.removedNodes)) {
            if (n instanceof HTMLElement && !n.classList.contains("swipe-back-under") && !n.classList.contains("chat-swipe-back-dim")) group.removed.push(n);
          }
        }
        if (!groups) return;
        const all = groups;
        const minHeight = window.innerHeight * 0.6;
        all.forEach((group, target) => {
          if (group.added.length === 0) return;
          // 被顶掉的旧节点：同一个父节点里移出的，加上外层父节点里同时移出的（比如主屏底部的 Dock）
          const removed = group.removed.filter((n) => !n.isConnected);
          all.forEach((other, otherTarget) => {
            if (otherTarget === target || !otherTarget.contains(target)) return;
            for (const n of other.removed) if (!n.isConnected) removed.push(n);
          });
          if (removed.length === 0) return;
          for (const a of group.added) {
            if (!a.isConnected) continue;
            // 新页面：自己带页面外壳，或者是一整屏大小的容器（内容可能稍后才挂进来）
            if (a.classList.contains("page-shell") || a.querySelector(".page-shell") || a.offsetHeight >= minHeight) {
              prevPages.set(a, removed);
            }
          }
        });
      } catch { /* 记录失败只是少一个同屏效果 */ }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("click", onClickCapture, true);
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClickCapture, true);
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return null;
}
