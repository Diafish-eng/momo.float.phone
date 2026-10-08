"use client";

import { useEffect } from "react";

/**
 * iOS 键盘适配（聊天输入框）。
 *
 * iOS 上键盘是「盖」在网页上的：页面高度不变，系统为了让输入框露出来，会把整张页面往上推，
 * 于是聊天顶栏（对方名字、返回键）被推出屏幕，收键盘时整页再弹回来，看起来就是整个界面抖一下。
 *
 * 微信的做法是页面不动，只有输入栏和消息区跟着键盘升降。这里照做：
 *  1. 手指点输入框、键盘还没出来之前，就先把输入栏抬到「键盘上沿」的位置（消息区底部同步让出空间）。
 *     系统准备弹键盘时发现输入框已经在键盘上方，就不会再去推页面，顶栏原地不动。
 *  2. 抬起/落下用动画跟着键盘一起走（输入栏用 transform，消息区用滚动补间），不留空白、不瞬移。
 *  3. 键盘高度第一次按经验值估，之后以系统实际报告的为准并记住。
 */

const STORE_KEY = "float-ios-kb-height";
const INPUT_SELECTOR = "textarea.chat-input-textarea";
const NEAR_BOTTOM = 160;
const ANIM_MS = 250;
const EASE_CSS = "cubic-bezier(0.215, 0.61, 0.355, 1)";

type Parts = { bar: HTMLElement; body: HTMLElement | null };

export function IosKeyboardFit() {
  useEffect(() => {
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const vv = window.visualViewport;
    // 调试开关：在电脑浏览器里也启用这套逻辑，方便用模拟触摸排查（正常使用不会打开）
    let forced = false;
    try { forced = localStorage.getItem("float-ios-kb-debug") === "1"; } catch { /* ignore */ }
    if ((!isIOS && !forced) || !vv) return;

    const root = document.documentElement;
    let active = false;
    let applied = 0;
    let offTimer = 0;
    let verifyTimer = 0;
    let animBar: HTMLElement | null = null;
    let animEnd = 0;
    let lastParts: Parts | null = null;

    const layoutHeight = () => root.clientHeight || window.innerHeight;
    const measured = () => Math.max(0, Math.round(layoutHeight() - vv.height));

    const remembered = () => {
      try {
        const n = Number(localStorage.getItem(STORE_KEY));
        if (Number.isFinite(n) && n > 120 && n < layoutHeight() * 0.75) return n;
      } catch { /* ignore */ }
      return Math.round(layoutHeight() * 0.46);
    };

    const partsOf = (input: HTMLElement): Parts | null => {
      const bar = input.closest<HTMLElement>(".chat-input-bar");
      const room = input.closest<HTMLElement>(".chat-room-wrapper");
      if (!bar || !room) return null;
      return { bar, body: room.querySelector<HTMLElement>(":scope > .page-body") };
    };

    const setVar = (height: number) => {
      applied = Math.max(0, Math.round(height));
      if (applied > 0) {
        root.style.setProperty("--ios-kb", `${applied}px`);
        root.setAttribute("data-ios-kb", "");
      } else {
        root.style.removeProperty("--ios-kb");
        root.removeAttribute("data-ios-kb");
      }
    };

    let animBody: HTMLElement | null = null;
    let animBodyScroll: number | null = null;

    const stopAnim = () => {
      if (animEnd) { window.clearTimeout(animEnd); animEnd = 0; }
      if (animBar) {
        animBar.style.transition = "";
        animBar.style.transform = "";
        animBar.style.willChange = "";
        animBar = null;
      }
      if (animBody) {
        animBody.style.transition = "";
        animBody.style.transform = "";
        animBody.style.willChange = "";
        animBody.style.top = "";
        animBody.style.overflowAnchor = "";
        if (animBodyScroll !== null) animBody.scrollTop = animBodyScroll;
        animBody = null;
        animBodyScroll = null;
      }
    };

    /**
     * 消息区的滑动：不去逐帧改滚动位置（会和浏览器自己的滚动修正打架，变成瞬移），
     * 而是把消息区整块用 transform 平移。为了平移时顶部不露空，先把它的盒子向上加长 distance，
     * 滚动位置相应减去 distance——画面完全不变，但上方多出了可以滑进来的内容。
     *   fromShift → toShift：整块相对最终位置的位移（向下为正）
     *   restScroll：动画结束、撤掉加长后应有的滚动位置
     */
    const slideBody = (body: HTMLElement, distance: number, baseScroll: number, fromShift: number, toShift: number, restScroll: number) => {
      animBody = body;
      animBodyScroll = restScroll;
      body.style.overflowAnchor = "none";
      body.style.transition = "none";
      body.style.willChange = "transform";
      body.style.top = `${-distance}px`;
      body.scrollTop = baseScroll;
      body.style.transform = `translate3d(0, ${fromShift}px, 0)`;
      void body.offsetHeight;
      body.style.transition = `transform ${ANIM_MS}ms ${EASE_CSS}`;
      body.style.transform = `translate3d(0, ${toShift}px, 0)`;
    };

    /** 抬起：先把最终位置摆好（系统据此判断不用推页面），再从原位置动画过去 */
    const raise = (parts: Parts, height: number, animate: boolean) => {
      stopAnim();
      const { bar, body } = parts;
      lastParts = parts;
      const barBefore = bar.getBoundingClientRect().bottom;
      const nearBottom = body ? body.scrollHeight - body.scrollTop - body.clientHeight < NEAR_BOTTOM : false;
      const scrollBefore = body ? body.scrollTop : 0;
      setVar(height);
      const lift = barBefore - bar.getBoundingClientRect().bottom;   // 这次读取同时强制完成排版
      const scrollTarget = body && nearBottom ? Math.max(0, body.scrollHeight - body.clientHeight) : scrollBefore;
      if (body) body.scrollTop = scrollTarget;
      if (!animate || lift <= 0) return () => {};
      // 返回「开始动画」：调用方要先让输入框聚焦（系统此时读到的是最终位置），再启动动画
      return () => {
        animBar = bar;
        bar.style.transition = "none";
        bar.style.willChange = "transform";
        bar.style.transform = `translate3d(0, ${lift}px, 0)`;
        const distance = scrollTarget - scrollBefore;
        if (body && distance > 0) slideBody(body, distance, scrollBefore, distance, 0, scrollTarget);
        void bar.offsetHeight;
        bar.style.transition = `transform ${ANIM_MS}ms ${EASE_CSS}`;
        bar.style.transform = "translate3d(0, 0, 0)";
        animEnd = window.setTimeout(() => { animEnd = 0; stopAnim(); }, ANIM_MS + 40);
      };
    };

    /** 落下：输入栏和消息区跟着键盘一起回到底部，动画结束后再撤掉占位 */
    const lower = () => {
      stopAnim();
      const parts = lastParts;
      lastParts = null;
      if (!parts || applied === 0 || !parts.bar.isConnected || parts.bar.offsetParent === null) { setVar(0); return; }
      const { bar, body } = parts;
      const keep = applied;
      const barUp = bar.getBoundingClientRect().bottom;
      const scrollNow = body ? body.scrollTop : 0;
      // 量出「撤掉占位后」输入栏落到哪、消息区最多能滚到哪，再恢复现场
      setVar(0);
      const drop = bar.getBoundingClientRect().bottom - barUp;
      const maxAfter = body ? Math.max(0, body.scrollHeight - body.clientHeight) : 0;
      setVar(keep);
      if (body) body.scrollTop = scrollNow;
      if (drop <= 0) { setVar(0); return; }
      const scrollAfter = Math.min(scrollNow, maxAfter);
      const distance = scrollNow - scrollAfter;
      animBar = bar;
      bar.style.willChange = "transform";
      bar.style.transition = `transform ${ANIM_MS}ms ${EASE_CSS}`;
      bar.style.transform = `translate3d(0, ${drop}px, 0)`;
      if (body && distance > 0) slideBody(body, distance, scrollAfter, 0, distance, scrollAfter);
      animEnd = window.setTimeout(() => {
        animEnd = 0;
        // 同一帧里：撤占位 + 撤位移，画面不变
        if (animBar) animBar.style.transition = "none";
        if (animBody) animBody.style.transition = "none";
        setVar(0);
        stopAnim();
      }, ANIM_MS + 20);
    };

    const reconcile = () => {
      if (!active) return;
      const real = measured();
      if (real >= 60) {
        if (Math.abs(real - applied) >= 2 && !animBar) {
          const body = lastParts?.body ?? null;
          const nearBottom = body ? body.scrollHeight - body.scrollTop - body.clientHeight < NEAR_BOTTOM : false;
          setVar(real);
          if (body && nearBottom) body.scrollTop = body.scrollHeight;
        }
        try { localStorage.setItem(STORE_KEY, String(real)); } catch { /* ignore */ }
      } else if (applied > 0 && !animBar) {
        // 没有软键盘（外接键盘等）：不占位
        setVar(0);
      }
      // 万一系统还是推了页面，立刻拉回来
      if (vv.offsetTop > 0 || window.scrollY > 0) window.scrollTo(0, 0);
    };

    const isChatInput = (target: EventTarget | null): target is HTMLElement =>
      target instanceof HTMLElement && target.matches(INPUT_SELECTOR);

    const activate = () => {
      if (offTimer) { window.clearTimeout(offTimer); offTimer = 0; }
      active = true;
      if (verifyTimer) window.clearTimeout(verifyTimer);
      verifyTimer = window.setTimeout(reconcile, 700);
    };

    // 手指点输入框：键盘出来之前先摆好位置，再由我们来聚焦
    let touchX = 0;
    let touchY = 0;
    let touchInput: HTMLElement | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchInput = null;
      if (event.touches.length !== 1 || !isChatInput(event.target)) return;
      touchInput = event.target;
      touchX = event.touches[0].clientX;
      touchY = event.touches[0].clientY;
    };
    const onTouchEnd = (event: TouchEvent) => {
      const input = touchInput;
      touchInput = null;
      if (!input || event.target !== input) return;
      const touch = event.changedTouches[0];
      if (!touch || Math.abs(touch.clientX - touchX) > 10 || Math.abs(touch.clientY - touchY) > 10) return;
      if (document.activeElement === input) return;                    // 已经在输入：照常移动光标
      if ((input as HTMLTextAreaElement).disabled) return;
      const parts = partsOf(input);
      if (!parts) return;
      if (event.cancelable) event.preventDefault();
      activate();
      const start = raise(parts, applied > 0 ? applied : (measured() >= 60 ? measured() : remembered()), true);
      input.focus({ preventScroll: true });
      start();
    };

    const onFocusIn = (event: FocusEvent) => {
      if (!isChatInput(event.target)) return;
      activate();
      if (applied === 0) {
        const parts = partsOf(event.target);
        if (parts) raise(parts, measured() >= 60 ? measured() : remembered(), false)();
      }
    };

    const onFocusOut = (event: FocusEvent) => {
      if (!isChatInput(event.target)) return;
      if (offTimer) window.clearTimeout(offTimer);
      // 稍等一下：面板切换时输入框会「失焦→马上又聚焦」，别来回抖
      offTimer = window.setTimeout(() => {
        offTimer = 0;
        if (isChatInput(document.activeElement)) return;
        active = false;
        if (verifyTimer) { window.clearTimeout(verifyTimer); verifyTimer = 0; }
        lower();
      }, 0);
    };

    const onViewport = () => { if (active) reconcile(); };

    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    vv.addEventListener("resize", onViewport);
    vv.addEventListener("scroll", onViewport);
    return () => {
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      vv.removeEventListener("resize", onViewport);
      vv.removeEventListener("scroll", onViewport);
      if (offTimer) window.clearTimeout(offTimer);
      if (verifyTimer) window.clearTimeout(verifyTimer);
      stopAnim();
      setVar(0);
    };
  }, []);

  return null;
}
