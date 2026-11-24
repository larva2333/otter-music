import type { MusicTrack } from "@/types/music";
import { formatComments } from "@/lib/netease/comment-format";
import { getHotComments, getNewComments } from "@/lib/netease/netease-api";
import { resolveCommentSongId } from "@/lib/netease/comment-source";
import { getQqHotComments, getQqNewComments } from "./qq-comments";
import { getKuwoHotComments, getKuwoNewComments } from "./kuwo-comments";
import { logger } from "@/lib/logger";
import type { CommentPage, CommentTab } from "./types";
import type { CommentSourcePreference } from "./options";

export type { CommentPage, CommentTab } from "./types";

/**
 * 多平台评论获取，按优先级降级：
 *   网易云 → QQ 音乐 → 酷我
 *
 * 当前能获取到评论的平台（参考洛雪 v2.12.6）：
 * - 网易云 wy（需签名，风控最严）
 * - QQ 音乐 tx（无签名无 cookie，最稳）
 * - 酷我 kw（单个 GET，无签名）
 * - 酷狗 kg / 咪咕 mg 暂未接入
 *
 * 支持分页：page 从 0 开始，返回该页评论 + 平台报告的总数。
 * 降级策略：某平台「请求失败」或「返回 0 条」都视为无数据，继续下一个平台。
 */

export interface CommentResult extends CommentPage {
  /** 实际提供评论的平台，用于 UI 标注 */
  source: "netease" | "qq" | "kuwo" | null;
}

/** 取单个平台、单页评论 */
async function fetchFromSource(
  source: "netease" | "qq" | "kuwo",
  track: MusicTrack,
  tab: CommentTab,
  limit: number,
  page: number
): Promise<CommentPage> {
  if (source === "netease") {
    const songId = await resolveCommentSongId(track);
    if (!songId) return { comments: [], total: 0 };
    if (tab === "hot") {
      const res = await getHotComments(songId, limit, limit * page);
      const list = res?.hotComments?.length
        ? res.hotComments
        : res?.topComments || [];
      return {
        comments: formatComments(list),
        total: Number(res?.total ?? 0) || 0,
      };
    }
    const res = await getNewComments(songId, page + 1, limit, 1, 0);
    return {
      comments: formatComments(res?.comments),
      total: Number(res?.totalCount ?? 0) || 0,
    };
  }

  if (source === "qq") {
    return tab === "hot"
      ? getQqHotComments(track, limit, page)
      : getQqNewComments(track, limit, page);
  }

  return tab === "hot"
    ? getKuwoHotComments(track, limit, page)
    : getKuwoNewComments(track, limit, page);
}

/**
 * 按网易云 → QQ → 酷我顺序取评论，返回第一个有数据的平台。
 * 全部失败/为空时返回空列表。
 */
export async function getTrackComments(
  track: MusicTrack,
  tab: CommentTab,
  limit = 20,
  page = 0,
  preference: CommentSourcePreference = "auto"
): Promise<CommentResult> {
  // 指定了平台：只取该平台，不做降级（用户主动选择，取不到就显示空）
  if (preference !== "auto") {
    try {
      const result = await fetchFromSource(preference, track, tab, limit, page);
      return {
        ...result,
        source: result.comments.length > 0 ? preference : null,
      };
    } catch (e) {
      logger.warn("comments", `${preference} 评论获取失败`, e, {
        trackId: track.id,
        tab,
        page,
      });
      return { comments: [], total: 0, source: null };
    }
  }

  for (const source of ["netease", "qq", "kuwo"] as const) {
    try {
      const result = await fetchFromSource(source, track, tab, limit, page);
      if (result.comments.length > 0) return { ...result, source };
      logger.info("comments", `${source} 评论为空，尝试下一个平台`, {
        trackId: track.id,
        tab,
        page,
      });
    } catch (e) {
      logger.warn("comments", `${source} 评论获取失败，尝试下一个平台`, e, {
        trackId: track.id,
        tab,
        page,
      });
    }
  }
  return { comments: [], total: 0, source: null };
}
