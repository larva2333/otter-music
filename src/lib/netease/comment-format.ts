import type { NeteaseBeReplied, NeteaseComment } from "./netease-raw-types";

/**
 * 评论区格式化：对齐洛雪音乐（LX Music）musicSdk/wy/comment.js 的
 * filterComment 行为——把网易云原始评论归一成展示用结构，并把
 * `[大笑]` 这类表情占位符替换成 emoji。
 *
 * 参考：https://github.com/lyswhut/lx-music-desktop
 *   src/renderer/utils/musicSdk/wy/comment.js
 */

/**
 * 网易云评论里的表情占位符 → emoji。
 * 全量对齐洛雪音乐 v2.12.6 的 `musicSdk/wy/comment.js` 映射表。
 */
const EMOJIS: [string, string][] = [
  ["大笑", "😃"],
  ["可爱", "😊"],
  ["憨笑", "☺️"],
  ["色", "😍"],
  ["亲亲", "😙"],
  ["惊恐", "😱"],
  ["流泪", "😭"],
  ["亲", "😚"],
  ["呆", "😳"],
  ["哀伤", "😔"],
  ["呲牙", "😁"],
  ["吐舌", "😝"],
  ["撇嘴", "😒"],
  ["怒", "😡"],
  ["奸笑", "😏"],
  ["汗", "😓"],
  ["痛苦", "😖"],
  ["惶恐", "😰"],
  ["生病", "😨"],
  ["口罩", "😷"],
  ["大哭", "😂"],
  ["晕", "😵"],
  ["发怒", "👿"],
  ["开心", "😄"],
  ["鬼脸", "😜"],
  ["皱眉", "😞"],
  ["流感", "😢"],
  ["爱心", "❤️"],
  ["心碎", "💔"],
  ["钟情", "💘"],
  ["星星", "⭐️"],
  ["生气", "💢"],
  ["便便", "💩"],
  ["强", "👍"],
  ["弱", "👎"],
  ["拜", "🙏"],
  ["牵手", "👫"],
  ["跳舞", "👯‍♀️"],
  ["禁止", "🙅‍♀️"],
  ["这边", "💁‍♀️"],
  ["爱意", "💏"],
  ["示爱", "👩‍❤️‍👨"],
  ["嘴唇", "👄"],
  ["狗", "🐶"],
  ["猫", "🐱"],
  ["猪", "🐷"],
  ["兔子", "🐰"],
  ["小鸡", "🐤"],
  ["公鸡", "🐔"],
  ["幽灵", "👻"],
  ["圣诞", "🎅"],
  ["外星", "👽"],
  ["钻石", "💎"],
  ["礼物", "🎁"],
  ["男孩", "👦"],
  ["女孩", "👧"],
  ["蛋糕", "🎂"],
  ["18", "🔞"],
  ["圈", "⭕"],
  ["叉", "❌"],
];

/** 把 `[大笑]` 这类占位符换成 emoji；不做正则，避免误伤正文里的方括号 */
export function applyEmoji(text: string): string {
  let out = text || "";
  for (const [key, emoji] of EMOJIS) {
    out = out.split(`[${key}]`).join(emoji);
  }
  return out;
}

/** 展示用评论，字段命名跟随洛雪的 filterComment 归一化结果 */
export interface FormattedComment {
  id: number;
  /** 正文（已做表情替换） */
  text: string;
  time: number;
  /** yyyy.MM.dd */
  timeStr: string;
  /** IP 属地 */
  location?: string;
  userName: string;
  avatar?: string;
  likedCount: number;
  /** 被回复的原评论（引用） */
  reply?: {
    userName: string;
    text: string;
  };
}

/** 允许展示的最早时间（2000-01-01）；早于它的基本都是拿不到时间时的脏值 */
const MIN_COMMENT_MS = Date.UTC(2000, 0, 1);

/**
 * 评论时间戳 → yyyy.MM.dd。拿不到有效时间时返回空串，UI 直接不渲染。
 *
 * 各平台评论接口的时间字段并不可靠：可能缺失、为 0、给的是秒而不是毫秒，
 * 或者是极小的脏值。直接丢给 new Date() 就会显示成 1970 年——那不是评论
 * 的真实时间，宁可不显示。这里统一做单位归一 + 合理范围校验。
 */
export function formatCommentTime(
  value: number | string | null | undefined,
  unit: "ms" | "s" = "ms"
): string {
  if (value === null || value === undefined || value === "") return "";
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return "";

  // 按各平台标注的单位换算成毫秒，同时兼容接口偶发给出另一种单位
  let ms = unit === "s" ? raw * 1000 : raw;
  if (unit === "ms" && ms < 1e11) ms *= 1000;
  if (unit === "s" && ms >= 1e14) ms /= 1000;

  // 1970~1999 与明显超前的时间都视为无效
  if (ms < MIN_COMMENT_MS || ms > Date.now() + 24 * 60 * 60 * 1000) return "";

  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function toReply(beReplied?: NeteaseBeReplied[]): FormattedComment["reply"] {
  const raw = beReplied?.[0];
  if (!raw) return undefined;
  return {
    userName: raw.user?.nickname || "",
    text: applyEmoji(raw.content || ""),
  };
}

/** 归一一条原始评论，行为与洛雪 filterComment 一致 */
export function formatComment(item: NeteaseComment): FormattedComment {
  return {
    id: item.commentId,
    text: applyEmoji(item.content || ""),
    time: item.time || 0,
    timeStr: formatCommentTime(item.time),
    location: item.ipLocation?.location,
    userName: item.user?.nickname || "",
    avatar: item.user?.avatarUrl,
    likedCount: item.likedCount || 0,
    reply: toReply(item.beReplied),
  };
}

/** 归一一组原始评论 */
export function formatComments(items?: NeteaseComment[]): FormattedComment[] {
  return (items || []).map(formatComment);
}
