// lib/tts-markup.ts — 角色语音里的「语气 / 情绪 / 停顿 / 人声」标记
//
// 角色在语音条、语音/视频通话里用全角龟甲括号〔…〕写标记，例如：
//   〔whispering〕你过来一点〔停顿〕我跟你说个秘密〔chuckling〕嘿嘿
// 选〔〕而不是 [] 的原因：聊天协议 [语音条:…] 的内容里不能出现半角 ]，否则整条语音会被截断。
//
// 只有下面两种〔〕会被当成标记，其余〔注〕这类正常内容原样保留：
//   · 英文标签：〔laughing〕〔soft tone〕〔pause 1.2s〕
//   · 认识的中文写法：〔笑〕〔叹气〕〔停顿〕〔停顿1.5秒〕（见 ZH_ALIASES）
//
// · 显示给用户：stripTtsMarkup() 去掉全部标记（含模型直接写出的 MiniMax 原生 <#0.5#> / (laughs)）。
// · 送去合成：prepareSpeechText() 按服务商换成各自的原生写法，标记本身永远不会被念出来：
//     Fish Audio S2 / S2.1 → [tag]（支持自由描述）
//     Fish Audio S1        → (tag)（官方固定标签集，不认识的丢弃）
//     MiniMax              → 停顿 <#秒#>；情绪 → voice_setting.emotion；
//                            speech-2.8 系列另支持 (laughs) 等语气词，其它模型丢弃语气词
//     OpenAI 等            → 全部去掉
//
// 预设条目「语音语气标记 · Fish Audio / MiniMax」默认关闭；开启后只对绑定了对应语音服务商的角色注入
// （见 ttsPresetEntryGate），两者互不冲突。

import { loadBindingConfig, loadVoiceConfigs, resolveBinding } from "./settings-storage";

// ── 预设条目与服务商的对应关系 ─────────────────────────────────────

export const TTS_FISH_PRESET_ID = "tts_fish_expression";
export const TTS_MINIMAX_PRESET_ID = "tts_minimax_expression";

const TTS_PRESET_PROVIDER: Record<string, string> = {
    [TTS_FISH_PRESET_ID]: "FishAudio",
    [TTS_MINIMAX_PRESET_ID]: "Minimax",
};

function resolveVoiceProvider(characterId: string | undefined): string | null {
    if (!characterId || typeof window === "undefined") return null;
    try {
        const slot = resolveBinding(loadBindingConfig(), characterId, "chat");
        if (!slot.voiceConfigId) return null;
        const vc = loadVoiceConfigs().find(c => c.id === slot.voiceConfigId);
        if (!vc || vc.enableTTS === false) return null;
        return vc.provider || null;
    } catch {
        return null;
    }
}

/**
 * 语音语气预设条目的注入判断。
 * · 不是语音语气条目 → 返回 null（由组装器按原有标签规则处理）
 * · 是 → 只在私聊/群聊里、且至少一个角色绑定了对应服务商时返回 true
 */
export function ttsPresetEntryGate(
    identifier: string,
    activeTags: string[],
    characterIds: Array<string | undefined>,
): boolean | null {
    const provider = TTS_PRESET_PROVIDER[identifier];
    if (!provider) return null;
    if (!activeTags.includes("chat") && !activeTags.includes("group_chat")) return false;
    return characterIds.some(id => resolveVoiceProvider(id) === provider);
}

// ── 标记识别 ──────────────────────────────────────────────────

const MARK_RE = /〔([^〔〕\r\n]{1,48})〕/g;
const EN_TAG_RE = /^\s*[A-Za-z][A-Za-z0-9 .,'\-]{0,47}\s*$/;
const PAUSE_RE = /^\s*(?:pause|break|停顿|停)\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:s|秒)?\s*$/i;
/** MiniMax 原生停顿 <#0.5#>（角色偶尔会直接写出来） */
const MINIMAX_PAUSE_RE = /<#\s*(\d{1,2}(?:\.\d{1,2})?)\s*#>/g;

const ZH_ALIASES: Record<string, string> = {
    // 停顿
    "停顿": "break", "短停顿": "break", "顿": "break", "停一下": "break", "停": "break",
    "长停顿": "long-break", "停很久": "long-break", "沉默": "long-break",
    // 笑
    "笑": "laughing", "大笑": "laughing", "哈哈大笑": "laughing", "笑出声": "laughing",
    "轻笑": "chuckling", "低笑": "chuckling", "偷笑": "chuckling", "笑了一下": "chuckling", "嗤笑": "chuckling",
    // 哭
    "哭": "sobbing", "抽泣": "sobbing", "哽咽": "sobbing", "啜泣": "sobbing", "大哭": "crying loudly", "嚎啕大哭": "crying loudly",
    // 呼吸
    "叹气": "sighing", "叹息": "sighing",
    "喘气": "panting", "喘": "panting", "喘息": "panting", "气喘吁吁": "panting",
    "倒吸气": "gasping", "倒吸一口气": "gasping", "惊呼": "gasping", "抽气": "gasping",
    "吸气": "inhale", "深吸一口气": "inhale", "呼气": "exhale", "长呼一口气": "exhale", "换气": "breath", "呼吸": "breath",
    // 其它人声
    "打哈欠": "yawning", "哈欠": "yawning", "打呼": "snoring", "打鼾": "snoring",
    "清嗓子": "clear throat", "咳嗽": "coughs", "咳": "coughs",
    "呻吟": "groaning", "闷哼": "groaning",
    "吸鼻子": "sniffs", "喷鼻息": "snorts", "打嗝": "burps", "咂嘴": "lip-smacking",
    "哼歌": "humming", "哼唱": "humming", "嘶": "hissing", "打喷嚏": "sneezes", "喷嚏": "sneezes",
    // 语调
    "小声": "whispering", "耳语": "whispering", "悄悄": "whispering", "低语": "whispering",
    "大喊": "shouting", "喊": "shouting", "吼": "shouting", "尖叫": "screaming",
    "温柔": "soft tone", "轻声": "soft tone", "撒娇": "soft tone", "急促": "in a hurry tone", "着急": "in a hurry tone",
    "重读": "emphasis", "强调": "emphasis",
    // 情绪
    "开心": "happy", "高兴": "happy", "难过": "sad", "伤心": "sad", "生气": "angry", "愤怒": "angry", "兴奋": "excited",
    "平静": "calm", "紧张": "nervous", "自信": "confident", "惊讶": "surprised", "满足": "satisfied", "欣喜": "delighted",
    "害怕": "scared", "担心": "worried", "烦躁": "frustrated", "沮丧": "depressed", "心疼": "empathetic", "害羞": "embarrassed",
    "尴尬": "embarrassed", "嫌弃": "disgusted", "感动": "moved", "骄傲": "proud", "放松": "relaxed", "感激": "grateful",
    "好奇": "curious", "阴阳怪气": "sarcastic", "讽刺": "sarcastic", "不屑": "disdainful", "焦虑": "anxious", "委屈": "upset",
    "失望": "disappointed", "后悔": "regretful", "愧疚": "guilty", "吃醋": "jealous", "期待": "hopeful", "怀念": "nostalgic",
    "寂寞": "lonely", "无聊": "bored", "坚定": "determined", "无奈": "resigned", "困": "yawning",
};

const EN_ALIASES: Record<string, string> = {
    "pause": "break", "short pause": "break", "beat": "break",
    "long pause": "long-break", "long break": "long-break", "silence": "long-break",
    "laugh": "laughing", "laughs": "laughing", "chuckle": "chuckling", "giggle": "chuckling", "giggling": "chuckling",
    "sigh": "sighing", "sighs": "sighing", "pant": "panting", "gasp": "gasping", "gasps": "gasping",
    "cough": "coughs", "coughing": "coughs", "clear-throat": "clear throat", "clearing throat": "clear throat",
    "groan": "groaning", "groans": "groaning", "sniff": "sniffs", "sniffing": "sniffs", "snort": "snorts", "snorting": "snorts",
    "burp": "burps", "hum": "humming", "hiss": "hissing", "hmm": "emm", "um": "emm", "uh": "emm",
    "sneeze": "sneezes", "sneezing": "sneezes", "whisper": "whispering", "shout": "shouting", "scream": "screaming",
    "yawn": "yawning", "snore": "snoring", "cry": "sobbing", "crying": "sobbing", "sob": "sobbing", "breathing": "breath",
    "whistle": "whistles", "whistling": "whistles", "clap": "applause", "clapping": "applause",
    "inhales": "inhale", "exhales": "exhale", "soft": "soft tone",
};

function isMarkupTag(raw: string): boolean {
    const t = raw.trim();
    return EN_TAG_RE.test(t) || PAUSE_RE.test(t) || Object.prototype.hasOwnProperty.call(ZH_ALIASES, t);
}

function normTag(raw: string): string {
    const t = raw.trim().replace(/\s+/g, " ");
    if (Object.prototype.hasOwnProperty.call(ZH_ALIASES, t)) return ZH_ALIASES[t];
    const low = t.toLowerCase().replace(/_/g, " ");
    return EN_ALIASES[low] || low;
}

/** 停顿标记 → 秒数；不是停顿返回 null */
function pauseSeconds(raw: string): number | null {
    const m = raw.trim().match(PAUSE_RE);
    if (m) return Math.min(99.99, Math.max(0.01, Number(m[1])));
    const n = normTag(raw);
    if (n === "break") return 0.4;
    if (n === "long-break") return 1.0;
    return null;
}

// ── 各家支持的标签 ─────────────────────────────────────────────

/** Fish S1 固定标签集（S2 / S2.1 支持自由描述，不限于此表） */
const FISH_S1_TAGS = new Set([
    "happy", "sad", "angry", "excited", "calm", "nervous", "confident", "surprised", "satisfied", "delighted", "scared", "worried",
    "upset", "frustrated", "depressed", "empathetic", "embarrassed", "disgusted", "moved", "proud", "relaxed", "grateful", "curious",
    "sarcastic", "disdainful", "unhappy", "anxious", "hysterical", "indifferent", "uncertain", "doubtful", "confused", "disappointed",
    "regretful", "guilty", "ashamed", "jealous", "envious", "hopeful", "optimistic", "pessimistic", "nostalgic", "lonely", "bored",
    "contemptuous", "sympathetic", "compassionate", "determined", "resigned",
    "in a hurry tone", "shouting", "screaming", "whispering", "soft tone",
    "laughing", "chuckling", "sobbing", "crying loudly", "sighing", "groaning", "panting", "gasping", "yawning", "snoring",
    "audience laughing", "background laughter", "crowd laughing", "break", "long-break",
]);

/** MiniMax speech-2.8 系列支持的语气词 */
const MINIMAX_INTERJECTIONS: Record<string, string> = {
    "laughing": "(laughs)", "chuckling": "(chuckle)", "coughs": "(coughs)", "clear throat": "(clear-throat)",
    "groaning": "(groans)", "breath": "(breath)", "panting": "(pant)", "inhale": "(inhale)", "exhale": "(exhale)",
    "gasping": "(gasps)", "sniffs": "(sniffs)", "sighing": "(sighs)", "snorts": "(snorts)", "burps": "(burps)",
    "lip-smacking": "(lip-smacking)", "humming": "(humming)", "hissing": "(hissing)", "emm": "(emm)", "sneezes": "(sneezes)",
    "whistles": "(whistles)", "crying": "(crying)", "applause": "(applause)",
    "sobbing": "(crying)", "crying loudly": "(crying)",
    // MiniMax 没有打哈欠，用长呼气代替
    "yawning": "(exhale)",
};

/** 模型直接写出的 MiniMax 原生语气词，如 (laughs)（只认官方词，正常括号内容不碰） */
const MINIMAX_NATIVE_RE = new RegExp(
    `[(（]\\s*(${[...new Set(Object.values(MINIMAX_INTERJECTIONS).map(v => v.slice(1, -1)))].map(s => s.replace(/-/g, "\\-")).join("|")})\\s*[)）]`,
    "gi",
);

/** 情绪标签 → MiniMax voice_setting.emotion（只取 MiniMax 支持的取值） */
const MINIMAX_EMOTION_OF: Record<string, string> = {
    happy: "happy", excited: "happy", delighted: "happy", satisfied: "happy", proud: "happy", grateful: "happy",
    optimistic: "happy", hopeful: "happy", confident: "happy", curious: "happy",
    sad: "sad", depressed: "sad", lonely: "sad", disappointed: "sad", regretful: "sad", moved: "sad", unhappy: "sad",
    nostalgic: "sad", guilty: "sad", ashamed: "sad", resigned: "sad", upset: "sad",
    angry: "angry", frustrated: "angry", furious: "angry", hysterical: "angry", jealous: "angry", envious: "angry",
    scared: "fearful", fearful: "fearful", nervous: "fearful", anxious: "fearful", worried: "fearful", terrified: "fearful",
    disgusted: "disgusted", contemptuous: "disgusted", disdainful: "disgusted",
    surprised: "surprised", shocked: "surprised", confused: "surprised",
    calm: "calm", relaxed: "calm", indifferent: "calm", empathetic: "calm", sympathetic: "calm", compassionate: "calm",
    neutral: "neutral", fluent: "fluent",
};

// ── 对外接口 ──────────────────────────────────────────────────

function tidy(s: string): string {
    return s
        .replace(/[ \t　]{2,}/g, " ")
        .replace(/^[ \t　]+|[ \t　]+$/gm, "");
}

/** 文本里是否带语音标记 */
export function hasTtsMarkup(text: string): boolean {
    if (!text) return false;
    if (text.includes("<#") && new RegExp(MINIMAX_PAUSE_RE.source).test(text)) return true;
    if (/[(（]/.test(text) && new RegExp(MINIMAX_NATIVE_RE.source, "i").test(text)) return true;
    if (!text.includes("〔")) return false;
    for (const m of text.matchAll(MARK_RE)) if (isMarkupTag(m[1])) return true;
    return false;
}

/** 给用户看的文字：去掉全部语音标记（不认识的〔中文内容〕原样保留） */
export function stripTtsMarkup(text: string): string {
    if (!hasTtsMarkup(text)) return text;
    return tidy(
        text
            .replace(MARK_RE, (all, raw: string) => (isMarkupTag(raw) ? "" : all))
            .replace(MINIMAX_PAUSE_RE, "")
            .replace(MINIMAX_NATIVE_RE, ""),
    );
}

export type PreparedSpeech = { text: string; emotion?: string };

/**
 * 把带标记的文字转换成该服务商的合成文本。无论哪家，标记本身都不会被念出来。
 * 没有标记时原样返回，不改动任何文字。
 */
export function prepareSpeechText(text: string, provider: string, model?: string): PreparedSpeech {
    if (!hasTtsMarkup(text)) return { text };
    const m = String(model || "").toLowerCase();

    if (provider === "FishAudio") {
        const s1 = m === "s1";
        const wrap = (tag: string) => (s1 ? `(${tag})` : `[${tag}]`);
        const out = text
            .replace(MINIMAX_PAUSE_RE, (_, sec: string) => wrap(Number(sec) >= 0.8 ? "long-break" : "break"))
            .replace(MINIMAX_NATIVE_RE, "")
            .replace(MARK_RE, (all, raw: string) => {
                if (!isMarkupTag(raw)) return all;
                const sec = pauseSeconds(raw);
                if (sec !== null) return wrap(sec >= 0.8 ? "long-break" : "break");
                const tag = normTag(raw).replace(/[[\]()]/g, "");
                if (s1) return FISH_S1_TAGS.has(tag) ? `(${tag})` : "";
                return `[${tag}]`;
            });
        return { text: tidy(out).trim() };
    }

    if (provider === "Minimax") {
        const interjections = m.includes("2.8");
        let emotion: string | undefined;
        const PAUSE = (sec: number) => `\u0000P${sec}\u0000`;
        const out = text
            .replace(MINIMAX_PAUSE_RE, (_, sec: string) => PAUSE(Number(sec)))
            .replace(MINIMAX_NATIVE_RE, (all) => (interjections ? all.replace(/[（]/, "(").replace(/[）]/, ")").replace(/\s+/g, "").toLowerCase() : ""))
            .replace(MARK_RE, (all, raw: string) => {
                if (!isMarkupTag(raw)) return all;
                const sec = pauseSeconds(raw);
                if (sec !== null) return PAUSE(sec);
                const tag = normTag(raw);
                const emo = MINIMAX_EMOTION_OF[tag];
                if (emo) { if (!emotion) emotion = emo; return ""; }
                if (interjections && MINIMAX_INTERJECTIONS[tag]) return MINIMAX_INTERJECTIONS[tag];
                return "";
            });
        return { text: tidy(placeMinimaxPauses(out)).trim(), emotion };
    }

    // 不支持语气控制的服务商：全部去掉
    return { text: stripTtsMarkup(text).trim() };
}

/** MiniMax 规则：停顿要夹在两段能念出来的文字之间，连续的停顿合并，开头/结尾的停顿丢掉 */
function placeMinimaxPauses(s: string): string {
    const parts = s.split(/\u0000P([\d.]+)\u0000/);
    const speakable = (seg: string) => /[\p{L}\p{N}]/u.test(seg.replace(/\([a-z-]+\)/g, ""));
    let out = "";
    let pending = 0;
    for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 1) { pending += Number(parts[i]) || 0; continue; }
        const seg = parts[i];
        if (pending > 0 && speakable(seg) && speakable(out)) {
            const sec = Math.min(99.99, Math.max(0.01, pending));
            out += `<#${Number(sec.toFixed(2))}#>`;
        }
        if (speakable(seg)) pending = 0;
        out += seg;
    }
    return out;
}
