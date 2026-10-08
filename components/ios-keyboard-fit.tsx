"use client";

import { useEffect } from "react";

/**
 * iOS 键盘适配（聊天输入框）。
 *
 * iOS 上键盘是「盖」在网页上的：页面高度不变，系统为了让输入框露出来，会把整张页面往上推，
 * 于是聊天顶栏（对方名字、返回键）被推出屏幕，收键盘时整页再弹回来，看起来就是「整个界面闪一下」。
 *
 * 微信的做法是页面不动、只把聊天区域压矮。这里照做：聊天输入框一获得焦点，就把整个手机画面的高度
 * 减去键盘高度（顶栏留在原位、消息区变矮、输入栏正好贴在键盘上沿），系统发现输入框已经露在外面，
 * 就不会再推页面。键盘高度第一次按经验值估，之后以系统实际报告的为准并记下来。
 */

const STORE_KEY = "float-ios-kb-height";
const INPUT_SELECTOR = "textarea.chat-input-textarea";
const NEAR_BOTTOM = 160;

export function IosKeyboardFit() {
  useEffect(() => {
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const vv = window.visualViewport;
    if (!isIOS || !vv) return;

    const root = document.documentElement;
    let active = false;
    let applied = 0;
    let offTimer = 0;
    let verifyTimer = 0;

    const layoutHeight = () => root.clientHeight || window.innerHeight;
    const measured = () => Math.max(0, Math.round(layoutHeight() - vv.height));

    const remembered = () => {
      try {
        const n = Number(localStorage.getItem(STORE_KEY));
        if (Number.isFinite(n) && n > 120 && n < layoutHeight() * 0.75) return n;
      } catch { /* ignore */ }
      return Math.round(layoutHeight() * 0.48);
    };

    // 当前显示着的聊天消息区；贴着底的时候，压矮/恢复之后仍然贴着底
    const stickyBodies = () => {
      const list: HTMLElement[] = [];
      document.querySelectorAll<HTMLElement>(".chat-room-wrapper > .page-body").forEach((el) => {
        if (el.offsetParent === null) return;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM) list.push(el);
      });
      return list;
    };

    const apply = (height: number) => {
      const next = Math.max(0, Math.round(height));
      if (next === applied) return;
      const sticky = stickyBodies();
      applied = next;
      if (next > 0) {
        root.style.setProperty("--ios-kb", `${next}px`);
        root.setAttribute("data-ios-kb", "");
      } else {
        root.style.removeProperty("--ios-kb");
        root.style.removeProperty("--ios-vv-top");
        root.removeAttribute("data-ios-kb");
      }
      for (const el of sticky) el.scrollTop = el.scrollHeight;
    };

    const syncPan = () => {
      if (!active || applied === 0) return;
      // 估的高度比实际小、系统还是推了一点页面时：把画面跟着挪回可视区域
      const top = Math.max(0, Math.round(vv.offsetTop));
      if (top > 0) root.style.setProperty("--ios-vv-top", `${top}px`);
      else root.style.removeProperty("--ios-vv-top");
      if (window.scrollY > 0) window.scrollTo(0, 0);
    };

    const reconcile = () => {
      if (!active) return;
      const real = measured();
      if (real >= 60) {
        if (Math.abs(real - applied) >= 2) apply(real);
        try { localStorage.setItem(STORE_KEY, String(real)); } catch { /* ignore */ }
      } else if (applied > 0) {
        // 没有软键盘（外接键盘等）：不压矮
        apply(0);
      }
      syncPan();
    };

    const isChatInput = (target: EventTarget | null): target is HTMLElement =>
      target instanceof HTMLElement && target.matches(INPUT_SELECTOR);

    const onFocusIn = (event: FocusEvent) => {
      if (!isChatInput(event.target)) return;
      if (offTimer) { window.clearTimeout(offTimer); offTimer = 0; }
      active = true;
      if (applied === 0) apply(measured() >= 60 ? measured() : remembered());
      if (verifyTimer) window.clearTimeout(verifyTimer);
      verifyTimer = window.setTimeout(reconcile, 700);
    };

    const onFocusOut = (event: FocusEvent) => {
      if (!isChatInput(event.target)) return;
      if (offTimer) window.clearTimeout(offTimer);
      // 稍等一下：面板切换时输入框会「失焦→马上又聚焦」，别来回抖
      offTimer = window.setTimeout(() => {
        offTimer = 0;
        const focused = document.activeElement;
        if (isChatInput(focused)) return;
        active = false;
        if (verifyTimer) { window.clearTimeout(verifyTimer); verifyTimer = 0; }
        apply(0);
      }, 30);
    };

    const onViewport = () => { if (active) reconcile(); };

    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    vv.addEventListener("resize", onViewport);
    vv.addEventListener("scroll", onViewport);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      vv.removeEventListener("resize", onViewport);
      vv.removeEventListener("scroll", onViewport);
      if (offTimer) window.clearTimeout(offTimer);
      if (verifyTimer) window.clearTimeout(verifyTimer);
      root.style.removeProperty("--ios-kb");
      root.style.removeProperty("--ios-vv-top");
      root.removeAttribute("data-ios-kb");
    };
  }, []);

  return null;
}
