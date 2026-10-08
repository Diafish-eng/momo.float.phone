/**
 * 「美化包优先」标记。
 *
 * 第三方美化包（主题里粘贴的全局 CSS / 聊天 App CSS / 单个会话 CSS）都是照 Float
 * 原生外观写的。只要有美化包在生效，就给 <html> 挂上 data-skin-pack="on"，
 * styles/wechat-skin.css 里的微信外观规则看到这个标记就整体让位，
 * 页面回到「Float 原生 + 美化包」，美化包按它本来的样子显示。
 *
 * 只改字体 / 只改 :root 颜色变量的小段 CSS 不算美化包，不会让微信外观让位。
 *
 * 整个机制受「美化包优先」开关控制（「我」页，默认关）：关着时永远是微信外观，
 * 不会因为备份里带着旧 CSS 就悄悄变回原生布局。
 */

const ATTR = "data-skin-pack";
const BOOT_KEY = "float-skin-pack";
const sources = new Set<string>();
// 单个会话自带的美化（只在这个会话打开时才算数）
const roomPacks = new Set<string>();
let activeRoom: string | null = null;

/** 这段 CSS 里有没有真正改页面元素的规则（排除注释、@import、@font-face、:root 变量块） */
export function isSkinPackCss(css: string | null | undefined): boolean {
  if (!css) return false;
  const rest = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import[^;]*;/g, "")
    .replace(/@font-face\s*\{[^}]*\}/g, "")
    .replace(/(^|\})\s*(:root|html|body)\s*\{[^}]*\}/g, "$1");
  return rest.includes("{");
}

const MODE_KEY = "float-skin-pack-mode";

/** 「美化包优先」开关：默认关（始终微信外观）；开了才按上面的规则自动让位 */
export function isSkinPackYieldEnabled(): boolean {
  try { return localStorage.getItem(MODE_KEY) === "auto"; } catch { return false; }
}

export function setSkinPackYieldEnabled(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(MODE_KEY, "auto");
    else localStorage.removeItem(MODE_KEY);
  } catch { /* ignore */ }
  apply();
}

function apply() {
  if (typeof document === "undefined") return;
  const on = isSkinPackYieldEnabled()
    && (sources.size > 0 || (activeRoom !== null && roomPacks.has(activeRoom)));
  if (on) document.documentElement.setAttribute(ATTR, "on");
  else document.documentElement.removeAttribute(ATTR);
}

/**
 * 登记 / 注销一个美化包来源。persist=true 的来源（全局、聊天 App 级）会记到
 * localStorage，开屏脚本据此提前挂标记，避免刷新时先闪一下微信外观。
 */
export function setSkinPackSource(source: string, active: boolean, persist = false) {
  if (active) sources.add(source);
  else sources.delete(source);
  apply();
  if (!persist) return;
  try {
    const raw = localStorage.getItem(BOOT_KEY) || "";
    const saved = new Set(raw.split(",").filter(Boolean));
    if (active) saved.add(source);
    else saved.delete(source);
    if (saved.size > 0) localStorage.setItem(BOOT_KEY, Array.from(saved).join(","));
    else localStorage.removeItem(BOOT_KEY);
  } catch { /* 存不了就算了，只是少一次防闪 */ }
}

/** 聊天室登记：这个会话自己有没有带美化 CSS */
export function setRoomSkinPack(sessionId: string, active: boolean) {
  if (active) roomPacks.add(sessionId);
  else roomPacks.delete(sessionId);
  apply();
}

/** 当前打开的是哪个会话（没打开聊天室传 null） */
export function setActiveSkinRoom(sessionId: string | null) {
  activeRoom = sessionId;
  apply();
}
