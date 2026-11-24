import { search as neteaseSearch } from "./netease-api";
import type { MusicTrack } from "@/types/music";
import type { NeteaseSong } from "@/lib/netease/netease-models";
import { cachedFetch } from "@/lib/utils/cache";
import { logger } from "@/lib/logger";

/**
 * 评论区曲目 ID 解析。
 *
 * 网易云评论接口只认网易云的歌曲 id（R_SO_4_<neteaseId>）。但项目默认搜索源
 * 是酷我，队列里大量曲目来自 kuwo/qq/kugou 等，它们的 track.id 不是网易云 id，
 * 直接拿去查评论必然为空。这里按「歌名 + 歌手」反查一首网易云曲目做评论源。
 *
 * 匹配策略与 local-provider 的 resolveNeteaseSongId 一致：歌名归一化后必须
 * 完全一致，且歌手有交集时才认，宁可返回 null 也不配错歌的评论。
 */

const PLACEHOLDER_ARTISTS = new Set([
  "未知艺术家",
  "未知歌手",
  "未知",
  "unknown",
  "unknown artist",
  "various artists",
]);

const MATCH_TTL = 24 * 60 * 60 * 1000;

function normalize(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[（(【[].*?[)）】\]]/g, "")
    .replace(/[\s\-_·・,，。.!！?？'"“”‘’、/&]/g, "")
    .trim();
}

function realArtists(track: MusicTrack): string[] {
  return (track.artist || [])
    .map((a) => (a || "").trim())
    .filter((a) => a && !PLACEHOLDER_ARTISTS.has(a.toLowerCase()));
}

/** 判断曲目本身是否已是网易云来源 */
export function isNeteaseTrack(track: MusicTrack): boolean {
  return (
    track.source === "netease" ||
    track.source === "_netease" ||
    track.source === "wy"
  );
}

async function findNeteaseId(track: MusicTrack): Promise<string | null> {
  const name = (track.name || "").trim();
  if (!name || name === "未知歌曲") return null;

  const artists = realArtists(track);
  const keyword = [name, artists[0]].filter(Boolean).join(" ");
  const targetName = normalize(name);
  if (!targetName) return null;

  try {
    const res = await neteaseSearch(keyword, 1, 1, 8);
    const songs = (res.data?.result?.songs || []) as NeteaseSong[];
    const targetArtists = artists.map(normalize).filter(Boolean);

    for (const song of songs) {
      if (normalize(song.name) !== targetName) continue;
      const songArtists = (song.ar || song.artists || [])
        .map((a) => normalize(a?.name))
        .filter(Boolean);
      if (targetArtists.length > 0 && songArtists.length > 0) {
        const hasCommon = songArtists.some((a) =>
          targetArtists.some((t) => a === t || a.includes(t) || t.includes(a))
        );
        if (!hasCommon) continue;
      }
      return String(song.id);
    }
  } catch (e) {
    logger.warn("comment-source", "反查网易云曲目失败", e);
  }
  return null;
}

/**
 * 拿到曲目对应的网易云歌曲 id，用于评论接口。
 * 非网易云曲目走一次带缓存的搜索匹配。
 */
export async function resolveCommentSongId(
  track: MusicTrack
): Promise<string | null> {
  if (isNeteaseTrack(track)) {
    // 网易云曲目 id 可能带历史前缀，统一去掉
    return track.id.replace(/^(netrack_|ne_track_)/, "");
  }

  const cacheKey = `comment:netease-id:${track.source}:${track.name || ""}|${(track.artist || []).join("/")}`;
  const matched = await cachedFetch<string>(
    cacheKey,
    async () => (await findNeteaseId(track)) ?? "",
    MATCH_TTL
  );
  return matched || null;
}
