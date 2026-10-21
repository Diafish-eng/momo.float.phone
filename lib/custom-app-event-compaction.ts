// 小程序写进角色记忆的事件，放进提示词前先压短（只影响发给模型的内容，存着的原文不动）。
//
// - 「羁绊手札·日程」：同一天同一角色只留最新一版；今天的日程完整保留（只去掉每段重复的说明文字），
//   其它日子只留每个时段的标题，角色还记得那天大概在干什么。
// - 其它小程序事件：超过 400 字的截短（帖子正文在前面会留下，后面的长描述截掉）。

import type { CustomAppTimelineEntry } from "./custom-app-storage";

const GENERIC_MAX_CHARS = 400;
const SCHEDULE_HEADER = /^\[羁绊手札·日程[^\]]*\]\s*日期=(\d{4}-\d{2}-\d{2})；角色=([^；]+)；修订=(\d+)。\s*分段(\d+)\/(\d+)/;
const SCHEDULE_NOTICE_START = "本版本完整替代";
const SLOT_LINE = /^(\d{1,2}:\d{2}[–\-~～]\d{1,2}:\d{2})｜([^｜\n]+)/;

type ScheduleInfo = { date: string; role: string; revision: number; part: number; parts: number };

function parseSchedule(summary: string): ScheduleInfo | null {
  const match = SCHEDULE_HEADER.exec(summary);
  if (!match) return null;
  return { date: match[1], role: match[2].trim(), revision: Number(match[3]), part: Number(match[4]), parts: Number(match[5]) };
}

/** 角色所在时区的今天（YYYY-MM-DD） */
export function todayInTimeZone(timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
}

function stripNotice(summary: string): string {
  // 去掉每段开头那一整段重复的使用说明（第一段保留一份）
  return summary.split("\n").filter(line => !line.trim().startsWith(SCHEDULE_NOTICE_START)).join("\n");
}

function slotTitles(summary: string): string[] {
  return summary.split("\n").flatMap(line => {
    const match = SLOT_LINE.exec(line.trim());
    return match ? [`${match[1].split(/[–\-~～]/)[0]} ${match[2].trim().slice(0, 24)}`] : [];
  });
}

/**
 * 把一个角色的小程序事件压短。返回要放进提示词的 [事件, 压短后的文字]；
 * 被新版本替代、或已合并进同一天摘要的分段会被省略。
 */
export function compactCustomAppEvents(entries: CustomAppTimelineEntry[], today: string): Array<{ entry: CustomAppTimelineEntry; summary: string }> {
  const latestRevision = new Map<string, number>();
  for (const entry of entries) {
    const info = parseSchedule(entry.summary);
    if (!info) continue;
    const key = `${info.date}|${info.role}`;
    latestRevision.set(key, Math.max(latestRevision.get(key) || 0, info.revision));
  }

  // 非今天的日程：同一天的几个分段合成一条标题摘要，挂在第一段上
  const otherDayTitles = new Map<string, string[]>();
  for (const entry of entries) {
    const info = parseSchedule(entry.summary);
    if (!info || info.date === today) continue;
    const key = `${info.date}|${info.role}`;
    if (info.revision !== latestRevision.get(key)) continue;
    const list = otherDayTitles.get(key) || [];
    list.push(...slotTitles(entry.summary));
    otherDayTitles.set(key, list);
  }

  const emittedOtherDay = new Set<string>();
  const result: Array<{ entry: CustomAppTimelineEntry; summary: string }> = [];
  for (const entry of entries) {
    const info = parseSchedule(entry.summary);
    if (!info) {
      const text = entry.summary.length > GENERIC_MAX_CHARS
        ? `${entry.summary.slice(0, GENERIC_MAX_CHARS)}…（后面较长，已省略）`
        : entry.summary;
      result.push({ entry, summary: text });
      continue;
    }
    const key = `${info.date}|${info.role}`;
    if (info.revision !== latestRevision.get(key)) continue; // 旧版本已被替代
    if (info.date === today) {
      result.push({ entry, summary: info.part === 1 ? entry.summary : stripNotice(entry.summary) });
      continue;
    }
    if (emittedOtherDay.has(key)) continue;
    emittedOtherDay.add(key);
    const titles = otherDayTitles.get(key) || [];
    const when = info.date < today ? "那天的安排（只是当时的计划，不代表都发生了）" : "之后的安排（还没发生）";
    result.push({ entry, summary: `[羁绊手札·日程] ${info.date} ${info.role}${when}：${titles.length ? titles.join("；") : "（无）"}` });
  }
  return result;
}
