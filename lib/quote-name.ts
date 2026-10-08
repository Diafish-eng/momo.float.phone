/**
 * 引用小框里显示谁的名字。
 * - mode "remark"：对方显示我给 TA 的备注（没有备注就用本名）
 * - mode "real"  ：对方显示本名
 * 我自己的名字始终用当前身份的名字（Float 没有「对方给我的备注」这个数据）。
 */
export type QuoteNameMode = "remark" | "real";

const MODE_KEY = "float-quote-name-mode";

export function getQuoteNameMode(): QuoteNameMode {
    try {
        return localStorage.getItem(MODE_KEY) === "real" ? "real" : "remark";
    } catch {
        return "remark";
    }
}

export function setQuoteNameMode(mode: QuoteNameMode): void {
    try {
        localStorage.setItem(MODE_KEY, mode);
    } catch { /* ignore */ }
}

export type QuoteNameContext = {
    userName: string;
    charName: string;
    charRemark: string;
    isGroup: boolean;
};

let current: QuoteNameContext = { userName: "", charName: "", charRemark: "", isGroup: false };

/** 聊天室在渲染时登记当前会话的名字，引用气泡渲染时读取 */
export function setQuoteNameContext(next: QuoteNameContext): void {
    current = next;
}

export function resolveQuoteName(args: { quoteRole?: string; quoteSenderName?: string; messageRole: string }): string {
    // 角色自己生成的引用没有记录引用的是谁：单聊里按「引用了我」处理
    const role = args.quoteRole ?? (args.messageRole === "assistant" && !current.isGroup ? "user" : undefined);
    if (role === "user") return current.userName;
    if (role === "assistant") {
        if (current.isGroup) return args.quoteSenderName || "";
        return getQuoteNameMode() === "remark" ? (current.charRemark || current.charName) : current.charName;
    }
    return "";
}
