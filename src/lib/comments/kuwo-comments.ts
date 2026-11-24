import { commentRequest } from "./http";
import type { FormattedComment } from "@/lib/netease/comment-format";
import type { CommentPage } from "./types";
import type { MusicTrack } from "@/types/music";

/**
 * 酷我音乐评论。参考洛雪音乐 v2.12.6：
 * src/renderer/utils/musicSdk/kw/comment.js
 * 单个 GET、无签名无 cookie，sid 直接用曲目的 url_id（数字 rid）。
 */

const UA = "Dalvik/2.1.0 (Linux; U; Android 9;)";

function formatTime(time: number | string | null | undefined): string {
  if (time === null || time === undefined || time === "") return "";
  const t = Number(time);
  if (!Number.isFinite(t) || t <= 0) return "";
  const d = new Date(t * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function buildUrl(
  type: "get_comment" | "get_rec_comment",
  sid: string,
  limit: number,
  page: number
) {
  const params = new URLSearchParams({
    f: "web",
    type,
    aapiver: "1",
    prod: "kwplayer_ar_10.5.2.0",
    digest: "15",
    sid,
    // 酷我用 start 偏移分页：start = 每页条数 × 页码
    start: String(limit * page),
    msgflag: "1",
    count: String(limit),
    newver: "3",
    uid: "0",
  });
  return `http://ncomment.kuwo.cn/com.s?${params.toString()}`;
}

function normalize(list: unknown[]): FormattedComment[] {
  return list.map((raw, index) => {
    const item = raw as Record<string, unknown>;
    let reply: FormattedComment["reply"];
    const sub = item.child_comments as unknown[] | undefined;
    if (sub?.[0]) {
      const r = sub[0] as Record<string, unknown>;
      reply = {
        userName: String(r.u_name ?? ""),
        text: String(r.msg ?? ""),
      };
    }
    return {
      id: Number(item.id ?? index) || index,
      text: String(item.msg ?? ""),
      time: Number(item.time ?? 0) || 0,
      timeStr: formatTime(item.time as number | string),
      userName: String(item.u_name ?? ""),
      avatar: item.u_pic as string | undefined,
      likedCount: Number(item.like_num ?? 0) || 0,
      reply,
    };
  });
}

async function fetchComments(
  sid: string,
  type: "get_comment" | "get_rec_comment",
  limit: number,
  page: number
): Promise<CommentPage> {
  const body = (await commentRequest(buildUrl(type, sid, limit, page), {
    headers: { "User-Agent": UA },
  })) as {
    code?: string | number;
    comments?: unknown[];
    hot_comments?: unknown[];
    comments_counts?: number;
    hot_comments_counts?: number;
  };

  if (String(body?.code) !== "200") throw new Error("酷我评论请求失败");
  const isHot = type === "get_rec_comment";
  const list = isHot ? body.hot_comments : body.comments;
  const total = isHot ? body.hot_comments_counts : body.comments_counts;
  return {
    comments: normalize(list ?? []),
    total: Number(total ?? 0) || 0,
  };
}

export async function getKuwoHotComments(
  track: MusicTrack,
  limit = 20,
  page = 0
): Promise<CommentPage> {
  const sid = track.url_id || track.id.replace(/^kw_/, "");
  if (!sid) throw new Error("酷我曲目 ID 缺失");
  return fetchComments(sid, "get_rec_comment", limit, page);
}

export async function getKuwoNewComments(
  track: MusicTrack,
  limit = 20,
  page = 0
): Promise<CommentPage> {
  const sid = track.url_id || track.id.replace(/^kw_/, "");
  if (!sid) throw new Error("酷我曲目 ID 缺失");
  return fetchComments(sid, "get_comment", limit, page);
}
