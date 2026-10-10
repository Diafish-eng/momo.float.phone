/**
 * Built-in sticker pack data.
 * Each sticker has a name (for AI matching via [表情:name]) and a URL.
 * Built-in packs use emoji as the default display; stickerUrl can point to
 * packaged image assets when a pack provides dedicated files.
 */

import { findCustomStickerByName, isStickerUsableByCharacter } from "./custom-sticker-storage";
import { loadCharacters } from "./character-storage";

export interface StickerItem {
    name: string;
    emoji: string;     // fallback emoji display
    stickerUrl?: string; // real sticker image path (optional)
}

export const STICKER_PACKS: { name: string; stickers: StickerItem[] }[] = [
    {
        name: "经典表情",
        stickers: [
            { name: "捂脸", emoji: "🤦" },
            { name: "偷笑", emoji: "🤭" },
            { name: "大哭", emoji: "😭" },
            { name: "害羞", emoji: "😊" },
            { name: "发呆", emoji: "😶" },
            { name: "得意", emoji: "😏" },
            { name: "汗", emoji: "😅" },
            { name: "亲亲", emoji: "😘" },
            { name: "爱心", emoji: "❤️" },
            { name: "心碎", emoji: "💔" },
            { name: "抱抱", emoji: "🤗" },
            { name: "叹气", emoji: "😮‍💨" },
            { name: "委屈", emoji: "🥺" },
            { name: "嘿嘿", emoji: "😁" },
            { name: "加油", emoji: "💪" },
            { name: "OK", emoji: "👌" },
            { name: "比心", emoji: "🫰" },
            { name: "鼓掌", emoji: "👏" },
            { name: "拳头", emoji: "✊" },
            { name: "玫瑰", emoji: "🌹" },
            { name: "再见", emoji: "👋" },
            { name: "太阳", emoji: "☀️" },
            { name: "月亮", emoji: "🌙" },
            { name: "蛋糕", emoji: "🎂" },
            { name: "礼物", emoji: "🎁" },
            { name: "咖啡", emoji: "☕" },
            { name: "啤酒", emoji: "🍺" },
            { name: "庆祝", emoji: "🎉" },
            { name: "火", emoji: "🔥" },
            { name: "闪电", emoji: "⚡" },
            { name: "思考", emoji: "🤔" },
            { name: "微笑", emoji: "😊" },
            { name: "笑哭", emoji: "😂" },
            { name: "坏笑", emoji: "😈" },
            { name: "翻白眼", emoji: "🙄" },
            { name: "无语", emoji: "😑" },
            { name: "生气", emoji: "😤" },
            { name: "惊讶", emoji: "😲" },
            { name: "恐惧", emoji: "😨" },
            { name: "撇嘴", emoji: "😒" },
            { name: "色", emoji: "😍" },
            { name: "呲牙", emoji: "😬" },
            { name: "吐舌", emoji: "😛" },
            { name: "尴尬", emoji: "😓" },
            { name: "睡觉", emoji: "😴" },
            { name: "酷", emoji: "😎" },
            { name: "衰", emoji: "😩" },
            { name: "吐", emoji: "🤮" },
            { name: "调皮", emoji: "😜" },
            { name: "大笑", emoji: "😆" },
            { name: "难过", emoji: "😢" },
            { name: "疑问", emoji: "❓" },
            { name: "嘘", emoji: "🤫" },
            { name: "晕", emoji: "😵" },
            { name: "奋斗", emoji: "💪" },
            { name: "可怜", emoji: "🥹" },
            { name: "强", emoji: "👍" },
            { name: "弱", emoji: "👎" },
            { name: "握手", emoji: "🤝" },
            { name: "胜利", emoji: "✌️" },
            { name: "抱拳", emoji: "🙏" },
            { name: "勾引", emoji: "😏" },
            { name: "嘴唇", emoji: "💋" },
            { name: "西瓜", emoji: "🍉" },
            { name: "饭", emoji: "🍚" },
            { name: "猪头", emoji: "🐷" },
            { name: "狗", emoji: "🐶" },
            { name: "猫", emoji: "🐱" },
            { name: "骷髅", emoji: "💀" },
            { name: "鬼", emoji: "👻" },
        ],
    },
];

/**
 * Find a sticker by name (for AI [表情:name] matching).
 * Returns the emoji fallback if no real stickerUrl.
 */
export function findStickerByName(name: string): StickerItem | undefined {
    for (const pack of STICKER_PACKS) {
        const found = pack.stickers.find(s => s.name === name);
        if (found) return found;
    }
    return undefined;
}

/**
 * 校验表情包名称是否可用：内置表情或任一给定角色的自定义表情包中存在该名称。
 * 用于「丢弃角色输出的无效表情包」开关。
 */
export function isKnownStickerLabel(label: string, characterIds: (string | undefined)[]): boolean {
    const name = (label || "").trim();
    if (!name) return false;
    if (findStickerByName(name)) return true;
    for (const cid of characterIds) {
        if (!cid) continue;
        // 与聊天气泡用同一套查找（含容错），保证「能显示出来的」不会被当成无效表情丢掉
        if (findCustomStickerByName(cid, name)) return true;
    }
    return false;
}

/**
 * 历史里角色发过的表情，现在是否已经失效（表情被删、或图集不再绑定给 TA）。
 * 失效的名字留在历史里，模型会照着继续发，聊天里就只剩一个灰色的 [名字]。
 * 只在能按名字唯一确定角色时才判定；拿不准一律当作有效，不动历史。
 */
export function isStaleCharacterStickerLabel(label: string, charName: string): boolean {
    const name = (label || "").trim();
    if (!name || !charName) return false;
    if (findStickerByName(name)) return false;
    const owners = loadCharacters().filter(c => c.name === charName);
    if (owners.length !== 1) return false;
    return !isStickerUsableByCharacter(owners[0].id, name);
}
