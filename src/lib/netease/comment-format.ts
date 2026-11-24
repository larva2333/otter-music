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

function formatTime(time: number): string {
  if (!time) return "";
  const d = new Date(time);
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
    timeStr: formatTime(item.time),
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
