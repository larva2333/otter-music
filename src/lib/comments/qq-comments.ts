import { commentRequest } from "./http";
import type { FormattedComment } from "@/lib/netease/comment-format";
import type { CommentPage } from "./types";
import type { MusicTrack } from "@/types/music";
import { logger } from "@/lib/logger";
import { cachedFetch } from "@/lib/utils/cache";
import { buildQqSearchApiPath } from "@otter-music/shared";

/**
 * QQ 音乐评论。参考洛雪音乐 v2.12.6：
 * src/renderer/utils/musicSdk/tx/comment.js
 *
 * - 热门：POST https://u.y.qq.com/cgi-bin/musicu.fcg
 *   (music.globalComment.CommentRead / GetHotCommentList)
 * - 最新：POST https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg
 *   两者都需要数字 songId，而曲目里只有 songmid，先反查一次。
 * 无签名、无 cookie。
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36";

const songIdCache = new Map<string, string>();
const QQ_SEARCH_TTL = 24 * 60 * 60 * 1000;

function normalizeName(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[（(【[].*?[)）】\]]/g, "")
    .replace(/[\s\-_·・,，。.!！?？'"“”‘’、/&]/g, "")
    .trim();
}

function formatTime(time: number | string | null | undefined): string {
  if (time === null || time === undefined || time === "") return "";
  const t = Number(time);
  if (!Number.isFinite(t) || t <= 0) return "";
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

/** QQ 的 [em]e400xxx[/em] 占位符 → emoji（常用部分） */
const QQ_EMOJI: Record<string, string> = {
  e400825: "😃",
  e400832: "😊",
  e400824: "😂",
  e400867: "😭",
  e400855: "😡",
  e400408: "👍",
  e400414: "👎",
  e400932: "🙏",
  e401236: "❤️",
  e400622: "💔",
  e400198: "🎉",
  e400768: "🔥",
};

function replaceEmoji(text: string): string {
  return text.replace(
    /\[em\](e\d+)\[\/em\]/g,
    (_, code: string) => QQ_EMOJI[code] ?? ""
  );
}

/**
 * 非 QQ 音源曲目：按「歌名 + 歌手」在 QQ 搜索一首匹配的曲目，拿它的 songmid。
 * 这样播放酷我/网易云的歌时也能拿到 QQ 评论。
 */
async function searchQqSongmid(track: MusicTrack): Promise<string | null> {
  const name = (track.name || "").trim();
  if (!name || name === "未知歌曲") return null;

  const artist = (track.artist || []).find((a) => a && a !== "未知艺术家");
  const keyword = artist ? `${name} ${artist}` : name;
  const targetName = normalizeName(name);
  const targetArtist = normalizeName(artist);

  try {
    const body = (await commentRequest(
      `https://c.y.qq.com${buildQqSearchApiPath(keyword, 1, 8)}`,
      { headers: { "User-Agent": UA, referer: "https://y.qq.com/" } }
    )) as {
      data?: {
        song?: {
          list?: Array<{
            songmid?: string;
            songname?: string;
            singer?: Array<{ name?: string }>;
          }>;
        };
      };
    };

    const list = body?.data?.song?.list ?? [];
    for (const song of list) {
      if (!song.songmid) continue;
      if (normalizeName(song.songname) !== targetName) continue;
      if (targetArtist) {
        const songArtist = normalizeName(song.singer?.[0]?.name);
        if (
          songArtist &&
          !songArtist.includes(targetArtist) &&
          !targetArtist.includes(songArtist)
        ) {
          continue;
        }
      }
      return song.songmid;
    }
  } catch (e) {
    logger.warn("qq-comments", "QQ 搜索曲目失败", e);
  }
  return null;
}

/** 拿到曲目对应的 QQ songmid：QQ 曲目直接用 url_id，其它音源按名搜索 */
async function resolveSongmid(track: MusicTrack): Promise<string | null> {
  if (track.source === "qq" || track.source === "tencent") {
    return track.url_id || track.id.replace(/^qq_/, "") || null;
  }
  const cacheKey = `qq:songmid:${track.name || ""}|${(track.artist || []).join("/")}`;
  return (
    (await cachedFetch<string>(
      cacheKey,
      async () => (await searchQqSongmid(track)) ?? "",
      QQ_SEARCH_TTL
    )) || null
  );
}

/** songmid → 数字 songId */
async function getSongId(songmid: string): Promise<string | null> {
  if (!songmid) return null;
  if (songIdCache.has(songmid)) return songIdCache.get(songmid) ?? null;

  try {
    const body = (await commentRequest(
      "https://u.y.qq.com/cgi-bin/musicu.fcg",
      {
        method: "POST",
        headers: { "User-Agent": UA, referer: "https://y.qq.com/" },
        body: {
          comm: { ct: "19", cv: "1859", uin: "0" },
          req: {
            module: "music.pf_song_detail_svr",
            method: "get_song_detail_yqq",
            param: { song_type: 0, song_mid: songmid },
          },
        },
      }
    )) as {
      code?: number;
      req?: { code?: number; data?: { track_info?: { id?: number } } };
    };

    const id = body?.req?.data?.track_info?.id;
    if (body?.code === 0 && body?.req?.code === 0 && id) {
      const songId = String(id);
      songIdCache.set(songmid, songId);
      return songId;
    }
  } catch (e) {
    logger.warn("qq-comments", "songmid 反查 songId 失败", e);
  }
  return null;
}

function normalize(list: unknown[]): FormattedComment[] {
  return list.map((raw, index) => {
    const item = raw as Record<string, unknown>;
    const text = String(item.Content ?? item.rootcommentcontent ?? "");
    const time = item.PubTime ?? item.rootcommenttime ?? null;
    const liked = Number(item.PraiseNum ?? item.praisenum ?? 0) || 0;

    let reply: FormattedComment["reply"];
    const sub = (item.SubComments ?? item.middlecommentcontent) as
      | unknown[]
      | undefined;
    if (sub?.[0]) {
      const r = sub[0] as Record<string, unknown>;
      reply = {
        userName: String(r.Nick ?? r.replynick ?? ""),
        text: replaceEmoji(String(r.Content ?? r.subcommentcontent ?? "")),
      };
    }

    return {
      id: Number(item.SeqNo ?? item.commentid ?? index) || index,
      text: replaceEmoji(text.replace(/\\n/g, "\n")),
      time: Number(time) || 0,
      timeStr: formatTime(time as number | string),
      location: item.Location ? String(item.Location) : undefined,
      userName: String(item.Nick ?? item.rootcommentnick ?? "").replace(
        /^@/,
        ""
      ),
      avatar: (item.Avatar ?? item.avatarurl) as string | undefined,
      likedCount: liked,
      reply,
    };
  });
}

/** 热门评论（page 从 0 开始） */
export async function getQqHotComments(
  track: MusicTrack,
  limit = 20,
  page = 0
): Promise<CommentPage> {
  const songmid = await resolveSongmid(track);
  if (!songmid) throw new Error("QQ 曲目 ID 反查失败");
  const songId = await getSongId(songmid);
  if (!songId) throw new Error("QQ 曲目 ID 反查失败");

  const body = (await commentRequest("https://u.y.qq.com/cgi-bin/musicu.fcg", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      referer: "https://y.qq.com/",
      origin: "https://y.qq.com",
    },
    body: {
      comm: { cv: 4747474, ct: 24, format: "json", platform: "yqq.json" },
      req: {
        module: "music.globalComment.CommentRead",
        method: "GetHotCommentList",
        param: {
          BizType: 1,
          BizId: songId,
          LastCommentSeqNo: "",
          PageSize: limit,
          PageNum: page,
          HotType: 1,
          WithAirborne: 0,
          PicEnable: 1,
        },
      },
    },
  })) as {
    code?: number;
    req?: {
      code?: number;
      data?: { CommentList?: { Comments?: unknown[]; Total?: number } };
    };
  };

  if (body?.code !== 0 || body?.req?.code !== 0) {
    throw new Error("QQ 热门评论请求失败");
  }
  const list = body.req?.data?.CommentList;
  return {
    comments: normalize(list?.Comments ?? []),
    total: Number(list?.Total ?? 0) || 0,
  };
}

/** 最新评论（page 从 0 开始） */
export async function getQqNewComments(
  track: MusicTrack,
  limit = 20,
  page = 0
): Promise<CommentPage> {
  const songmid = await resolveSongmid(track);
  if (!songmid) throw new Error("QQ 曲目 ID 反查失败");
  const songId = await getSongId(songmid);
  if (!songId) throw new Error("QQ 曲目 ID 反查失败");

  const body = (await commentRequest(
    "http://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg",
    {
      method: "POST",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)",
      },
      form: {
        uin: "0",
        format: "json",
        cid: "205360772",
        reqtype: "2",
        biztype: "1",
        topid: songId,
        cmd: "8",
        needmusiccrit: "1",
        pagenum: page,
        pagesize: limit,
      },
    }
  )) as {
    code?: number;
    comment?: { commentlist?: unknown[]; commenttotal?: number };
  };

  if (body?.code !== 0) throw new Error("QQ 最新评论请求失败");
  const c = body?.comment;
  return {
    comments: normalize(c?.commentlist ?? []),
    total: Number(c?.commenttotal ?? 0) || 0,
  };
}
