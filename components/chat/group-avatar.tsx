"use client";

// 群聊头像（成员头像 2×2 拼图），移植自 float-Yyk 的共享相册（AGPL-3.0）

import { ChatFallbackAvatar } from "./chat-fallback-avatar";

type Member = { avatar?: string | null };

export function GroupAvatar({ src, members }: { src?: string; members: Member[] }) {
    if (src) return <img src={src} alt="群聊头像" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} />;
    return <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 1, padding: 2, width: "100%", height: "100%", overflow: "hidden", borderRadius: "inherit", background: "#e9e9eb" }}>
        {Array.from({ length: 4 }, (_, index) => <span key={index} style={{ overflow: "hidden", minHeight: 0, background: "#f6f6f8" }}>
            {members[index]?.avatar ? <img src={members[index].avatar!} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : members[index] ? <ChatFallbackAvatar /> : null}
        </span>)}
    </span>;
}
