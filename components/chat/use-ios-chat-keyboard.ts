"use client";

import { useEffect } from "react";

// iOS（Safari / iOS 版 Chrome / 套壳 WKWebView）聊天室键盘适配。
//
// 现象：移动端整页高度用的是 100lvh，比带工具栏时的可视高度高一截，文档因此可以被滚动。
// 点输入框弹键盘时，iOS 会把整页往上推几百像素来露出输入框——顶栏被推出屏幕、内容钻到
// 状态栏下面；收键盘时又只能滚回到「可滚动的那一截」为止，留下几十像素的偏移，看起来就是
// 「弹一下」、顶栏被切掉一点。
//
// 做法（只动聊天室输入框）：
// - 壁纸、顶栏都不动；只把消息区和输入栏的底边抬到键盘上沿（--ios-chat-keyboard-inset）。
// - 聚焦期间把整页钉住（外层 fixed、文档高度缩到可视区），并记住上一次的键盘高度，一聚焦就先抬好。
// - iOS 26 仍会按「聚焦那一刻输入框的位置」把页面推一下，一收到可视区变化就当场滚回 0
//   （模拟器实测 1～2 帧内拉回）。整页本来就不该滚动、静止时永远是 0，收键盘后也顺手清掉残留偏移。
// - 收键盘时输入栏跟着键盘一起滑下去，等键盘落下再松开整页。
// - 消息区变矮/变高时，保持「离最后一条消息的距离」不变（和微信一样）：本来停在最底下，
//   键盘弹出后看到的还是最后一条；往上翻在看旧消息时，看的还是那几条。
const OPEN_ATTR = "data-ios-chat-keyboard";
// 聊天输入框聚焦期间：整页固定住、文档不可滚动（见 styles/chat.css），iOS 就没有可推的余量
const PIN_ATTR = "data-ios-chat-input";
// 收键盘途中：输入栏跟着键盘一起往下滑（styles/chat.css 里的过渡）
const CLOSING_ATTR = "data-ios-chat-keyboard-closing";
const INSET_VAR = "--ios-chat-keyboard-inset";
const STORAGE_KEY = "float-ios-chat-keyboard-inset";
const MIN_KEYBOARD_PX = 120;

function isIosWebKit(): boolean {
    const ua = navigator.userAgent;
    return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

function chatWrapperOf(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) return null;
    if (!target.closest("[data-ui='input']")) return null;
    return target.closest<HTMLElement>(".chat-room-wrapper");
}

function readStoredInset(): number {
    try {
        const value = Number(localStorage.getItem(STORAGE_KEY));
        return Number.isFinite(value) && value >= MIN_KEYBOARD_PX ? value : 0;
    } catch {
        return 0;
    }
}

function storeInset(value: number) {
    try { localStorage.setItem(STORAGE_KEY, String(Math.round(value))); } catch { /* 无痕模式等写不进去也不影响 */ }
}

export function useIosChatKeyboard() {
    useEffect(() => {
        if (typeof window === "undefined" || !isIosWebKit()) return;
        const viewport = window.visualViewport;
        if (!viewport) return;
        const mobileMq = window.matchMedia("(max-width: 500px) and (hover: none) and (pointer: coarse)");
        const root = document.documentElement;

        let wrapper: HTMLElement | null = null;
        // 最近一次聚焦的聊天室：收键盘时 wrapper 已经清空，还要靠它把消息位置对齐
        let lastWrapper: HTMLElement | null = null;
        let appliedInset = 0;
        let anchorRaf = 0;
        // 没有键盘时可视区的高度；用来判断键盘是不是真的出来了（外接键盘时不会出来）
        let restingHeight = viewport.height;
        let raf = 0;
        const timers: number[] = [];

        const clearTimers = () => {
            while (timers.length) window.clearTimeout(timers.pop());
        };
        const later = (fn: () => void, delays: number[]) => {
            for (const ms of delays) timers.push(window.setTimeout(fn, ms));
        };

        const resetScroll = () => {
            const scroller = document.scrollingElement || document.documentElement;
            if (window.scrollY !== 0 || scroller.scrollTop !== 0) window.scrollTo(0, 0);
        };

        // 消息区高度变化前后，保持离底部的距离；收键盘时消息区底边有 0.3 秒过渡，跟着逐帧对齐
        const keepBottomDistance = (change: () => void) => {
            const scroller = (wrapper || lastWrapper)?.querySelector<HTMLElement>(":scope > .page-body");
            if (!scroller || !scroller.isConnected) { change(); return; }
            const distance = Math.max(0, scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight);
            change();
            const align = () => {
                const target = scroller.scrollHeight - scroller.clientHeight - distance;
                if (Math.abs(scroller.scrollTop - target) > 1) scroller.scrollTop = target;
            };
            align();
            if (anchorRaf) window.cancelAnimationFrame(anchorRaf);
            const until = performance.now() + 450;
            const step = () => {
                align();
                anchorRaf = performance.now() < until ? window.requestAnimationFrame(step) : 0;
            };
            anchorRaf = window.requestAnimationFrame(step);
        };

        const applyInset = (inset: number) => {
            const rounded = Math.max(0, Math.round(inset));
            if (rounded < MIN_KEYBOARD_PX) {
                if (appliedInset) {
                    appliedInset = 0;
                    keepBottomDistance(() => {
                        root.removeAttribute(OPEN_ATTR);
                        root.style.removeProperty(INSET_VAR);
                    });
                }
                return;
            }
            if (Math.abs(rounded - appliedInset) < 2) return;
            appliedInset = rounded;
            keepBottomDistance(() => {
                root.style.setProperty(INSET_VAR, `${rounded}px`);
                root.setAttribute(OPEN_ATTR, "");
            });
        };

        const anyEditableFocused = () => Boolean(document.activeElement?.closest("input, textarea, [contenteditable='true']"));
        const keyboardShown = () => restingHeight - viewport.height >= MIN_KEYBOARD_PX;

        // 收键盘：输入栏和键盘一起往下滑；整页先保持钉住，等键盘真的落下去再松开
        let closing = false;
        const finishClose = () => {
            if (!closing) return;
            closing = false;
            root.removeAttribute(CLOSING_ATTR);
            applyInset(0);
            setPinned(false);
            resetScroll();
        };

        const setPinned = (pinned: boolean) => {
            if (pinned) root.setAttribute(PIN_ATTR, "");
            else root.removeAttribute(PIN_ATTR);
        };

        const measure = () => {
            raf = 0;
            if (closing) {
                if (!keyboardShown()) finishClose();
                return;
            }
            if (!wrapper || !wrapper.isConnected || !mobileMq.matches) {
                if (!wrapper && !anyEditableFocused()) resetScroll();
                return;
            }
            if (!keyboardShown()) return; // 键盘还在弹出途中（或外接键盘）：先保持预抬的高度，由兜底计时器收尾
            resetScroll();
            const visibleBottom = viewport.offsetTop + viewport.height;
            const inset = wrapper.getBoundingClientRect().bottom - visibleBottom;
            applyInset(inset);
            if (appliedInset) storeInset(appliedInset);
        };

        const requestMeasure = () => {
            if (raf) window.cancelAnimationFrame(raf);
            raf = window.requestAnimationFrame(measure);
        };

        const handleFocusIn = (event: FocusEvent) => {
            const nextWrapper = chatWrapperOf(event.target);
            clearTimers();
            if (!nextWrapper) {
                // 聊天室以外的输入框：保持 iOS 原生行为，把聊天室的抬高撤掉。
                // 焦点有时只是一闪而过又回到聊天输入框，稍等确认真的离开了再撤，免得输入栏上下乱跳
                if (!wrapper && !appliedInset && !root.hasAttribute(PIN_ATTR)) return;
                later(() => {
                    if (chatWrapperOf(document.activeElement)) return;
                    wrapper = null;
                    closing = false;
                    root.removeAttribute(CLOSING_ATTR);
                    applyInset(0);
                    setPinned(false);
                }, [150]);
                return;
            }
            wrapper = nextWrapper;
            lastWrapper = nextWrapper;
            closing = false;
            root.removeAttribute(CLOSING_ATTR);
            if (mobileMq.matches) setPinned(true);
            if (mobileMq.matches && !appliedInset && !keyboardShown()) {
                const predicted = readStoredInset();
                if (predicted) applyInset(predicted);
            }
            requestMeasure();
            later(requestMeasure, [120, 300, 600]);
            // 等键盘动画完还是没检测到键盘（外接键盘等），撤掉预抬
            later(() => {
                if (wrapper && !keyboardShown()) applyInset(0);
            }, [800]);
        };

        const handleFocusOut = () => {
            // 焦点可能只是在聊天输入框之间切换、或者一闪而过又回来，稍等再看
            window.setTimeout(() => {
                if (chatWrapperOf(document.activeElement)) return;
                // 焦点跳到了别的输入框：交给上面 focusin 的延迟判断，这里不动
                if (anyEditableFocused()) return;
                const wasChat = Boolean(wrapper);
                wrapper = null;
                clearTimers();
                if (wasChat && appliedInset && keyboardShown()) {
                    closing = true;
                    root.setAttribute(CLOSING_ATTR, "");
                    applyInset(0);
                    later(finishClose, [900]); // 兜底：没等到可视区恢复的事件也要松开
                } else {
                    applyInset(0);
                    setPinned(false);
                }
                resetScroll();
                // 收键盘动画期间 iOS 还会再调整一次滚动，跟着把残留偏移清掉
                later(() => {
                    if (!wrapper && !anyEditableFocused()) resetScroll();
                }, [120, 350, 700, 1000]);
            }, 60);
        };

        const handleViewportChange = () => {
            // 没有任何输入框聚焦、也不在收键盘途中时，可视高度就是「没键盘」的高度
            // （工具栏伸缩、转屏都会变）。键盘正在收的那几帧不算，否则会把半截键盘当成静止高度。
            if (!wrapper && !closing && !anyEditableFocused()) {
                restingHeight = viewport.height;
            }
            // iOS 推页面时最先到的是可视区事件（window 的 scroll 事件要晚一百多毫秒），在这里当场拉回
            if (root.hasAttribute(PIN_ATTR)) resetScroll();
            requestMeasure();
        };

        // 聊天输入框聚焦期间整页不该有任何滚动：iOS 按「聚焦那一刻输入框的位置」去推页面，
        // 这时预抬还没生效，它照样会推一下。在滚动事件里当场拉回（这一步在画面绘制之前），
        // 比等到下一帧再校准少闪一帧。
        const handleWindowScroll = () => {
            if (root.hasAttribute(PIN_ATTR)) resetScroll();
        };

        document.addEventListener("focusin", handleFocusIn);
        window.addEventListener("scroll", handleWindowScroll, { passive: true });
        document.addEventListener("focusout", handleFocusOut);
        viewport.addEventListener("resize", handleViewportChange);
        viewport.addEventListener("scroll", handleViewportChange);

        return () => {
            if (raf) window.cancelAnimationFrame(raf);
            if (anchorRaf) window.cancelAnimationFrame(anchorRaf);
            clearTimers();
            document.removeEventListener("focusin", handleFocusIn);
            window.removeEventListener("scroll", handleWindowScroll);
            document.removeEventListener("focusout", handleFocusOut);
            viewport.removeEventListener("resize", handleViewportChange);
            viewport.removeEventListener("scroll", handleViewportChange);
            root.removeAttribute(OPEN_ATTR);
            root.removeAttribute(PIN_ATTR);
            root.removeAttribute(CLOSING_ATTR);
            root.style.removeProperty(INSET_VAR);
        };
    }, []);
}
