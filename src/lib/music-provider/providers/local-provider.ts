import { IMusicProvider } from "../interface";
import {
  MusicTrack,
  SearchPageResult,
  SongLyric,
  SearchIntent,
} from "@/types/music";
import { Capacitor } from "@capacitor/core";
import { LocalMusicPlugin } from "@/plugins/local-music";
import { logger } from "@/lib/logger";
import { IS_NATIVE } from "@/lib/api/config";
import { cachedFetch } from "@/lib/utils/cache";
import {
  search as neteaseSearch,
  getSongDetail,
  getLyric as neteaseGetLyric,
} from "@/lib/netease/netease-api";

/**
 * 本地曲目的「元信息兜底」缓存时长。
 *
 * 本地文件的内嵌封面/歌词是即时读取的，这里只缓存**在线匹配**的结果，
 * 包括“确认查不到”这个负结果——否则每次播放无封面的本地歌都会重新发一次搜索请求。
 */
const LOCAL_META_TTL = 30 * 24 * 60 * 60 * 1000;

interface NeteaseSongBrief {
  id: number | string;
  name?: string;
  ar?: Array<{ name?: string }>;
  artists?: Array<{ name?: string }>;
}

/** 标签缺失时的占位歌手，参与匹配只会把结果全部筛掉，必须当“无歌手”处理。 */
const PLACEHOLDER_ARTISTS = new Set([
  "未知艺术家",
  "未知歌手",
  "未知",
  "unknown",
  "unknown artist",
  "various artists",
]);

/** 归一化歌名用于匹配：去掉括号补充说明、标点和空白，统一小写。 */
function normalizeForMatch(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[（(【[].*?[)）】\]]/g, "")
    .replace(/[\s\-_·・,，。.!！?？'"“”‘’、/&]/g, "")
    .trim();
}

/** 本地曲目可用的真实歌手列表，过滤占位值。 */
function realArtists(track: MusicTrack): string[] {
  return (track.artist || [])
    .map((a) => (a || "").trim())
    .filter((a) => a && !PLACEHOLDER_ARTISTS.has(a.toLowerCase()));
}

/**
 * 本地文件反查网易云曲目 ID。
 *
 * 只接受**歌名归一化后完全一致**的结果；本地有歌手信息时还要求至少一个歌手对得上。
 * 宁可返回 null，也不要给用户的私人文件配错封面。
 */
async function searchNeteaseSongId(track: MusicTrack): Promise<string | null> {
  const name = (track.name || "").trim();
  if (!name || name === "未知歌曲" || name === "未知艺术家") return null;

  const artists = realArtists(track);
  const keyword = [name, artists[0]].filter(Boolean).join(" ");
  const targetName = normalizeForMatch(name);
  if (!targetName) return null;

  try {
    const response = await neteaseSearch(keyword, 1, 1, 8);
    const songs =
      (
        response as unknown as {
          data?: { result?: { songs?: NeteaseSongBrief[] } };
        }
      ).data?.result?.songs ?? [];

    const normalizedArtists = artists.map(normalizeForMatch).filter(Boolean);

    for (const song of songs) {
      if (normalizeForMatch(song.name) !== targetName) continue;

      const songArtists = (song.ar ?? song.artists ?? [])
        .map((item) => normalizeForMatch(item?.name))
        .filter(Boolean);

      if (normalizedArtists.length > 0 && songArtists.length > 0) {
        const hasCommonArtist = songArtists.some((item) =>
          normalizedArtists.some(
            (target) =>
              item === target || item.includes(target) || target.includes(item)
          )
        );
        if (!hasCommonArtist) continue;
      }

      return String(song.id);
    }
  } catch (e) {
    logger.warn("local-provider", "在线匹配失败", e);
  }
  return null;
}

/** 带缓存的在线曲目匹配，空串表示确认匹配不到。 */
async function resolveNeteaseSongId(track: MusicTrack): Promise<string> {
  // v2：不再把「未知艺术家」等占位歌手带进匹配，旧的失败结果需作废
  const cacheKey = `local:match:v2:${track.name || ""}|${(track.artist || []).join("/")}`;
  const matched = await cachedFetch<string>(
    cacheKey,
    async () => (await searchNeteaseSongId(track)) ?? "",
    LOCAL_META_TTL
  );
  return matched ?? "";
}

export class LocalProvider implements IMusicProvider {
  source = "local" as const;

  async search(
    _query: string,
    _page: number,
    _count: number,
    _signal?: AbortSignal,
    _intent?: SearchIntent
  ): Promise<SearchPageResult<MusicTrack>> {
    return { items: [], hasMore: false };
  }

  async getUrl(track: MusicTrack, _br?: number): Promise<string | null> {
    const path = track.url_id;

    if (IS_NATIVE) {
      try {
        const result = await LocalMusicPlugin.getLocalFileUrl({
          localPath: path,
        });
        if (result.success && result.url) {
          return Capacitor.convertFileSrc(result.url);
        }
        logger.error("local-provider", "getLocalFileUrl failed", result.error);
        return null;
      } catch (e) {
        logger.error("local-provider", "getLocalFileUrl error", e);
        return null;
      }
    }
    return Capacitor.convertFileSrc(path);
  }

  /**
   * 封面优先级：内嵌封面 → 在线匹配（网易云，按歌名+歌手反查）→ null。
   * 在线结果按 localPath 缓存，无封面时缓存空值避免反复请求。
   */
  async getPic(track: MusicTrack, size: number = 800): Promise<string | null> {
    const localPath = track.pic_id;
    if (!localPath || !IS_NATIVE) return null;

    const embedded = await this.readEmbeddedCover(localPath);
    if (embedded) return embedded;

    const cached = await cachedFetch<string>(
      `local:cover:v3:${localPath}:${size}`,
      async () => {
        const songId = await resolveNeteaseSongId(track);
        if (!songId) return "";
        try {
          const song = await getSongDetail(songId);
          const url = song?.al?.picUrl;
          return url ? `${url}?param=${size}y${size}` : "";
        } catch (e) {
          logger.warn("local-provider", "在线封面获取失败", e);
          return "";
        }
      },
      LOCAL_META_TTL
    );

    return cached || null;
  }

  /**
   * 歌词优先级：内嵌歌词 → 同名 .lrc 文件 → 在线匹配 → null。
   * 侧挂 .lrc 不缓存，用户改了文件立即生效。
   */
  async getLyric(track: MusicTrack): Promise<SongLyric | null> {
    const localPath = track.lyric_id;
    if (!localPath || !IS_NATIVE) return null;

    const embedded = await this.readEmbeddedLyrics(localPath);
    if (embedded) return embedded;

    const cached = await cachedFetch<SongLyric>(
      `local:lyric:v3:${localPath}`,
      async () => {
        const songId = await resolveNeteaseSongId(track);
        if (!songId) return { lyric: "" };
        try {
          const res = await neteaseGetLyric(songId);
          return {
            lyric: res?.data?.lrc?.lyric || "",
            tlyric: res?.data?.tlyric?.lyric || "",
          };
        } catch (e) {
          logger.warn("local-provider", "在线歌词获取失败", e);
          return { lyric: "" };
        }
      },
      LOCAL_META_TTL
    );

    if (!cached || !cached.lyric) return null;
    return cached;
  }

  private async readEmbeddedCover(localPath: string): Promise<string | null> {
    try {
      const result = await LocalMusicPlugin.getEmbeddedCover({ localPath });
      if (result.success && result.dataUrl) return result.dataUrl;
      return null;
    } catch (e) {
      logger.error("local-provider", "getEmbeddedCover error", e, {
        localPath,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  private async readEmbeddedLyrics(
    localPath: string
  ): Promise<SongLyric | null> {
    try {
      const result = await LocalMusicPlugin.getEmbeddedLyrics({ localPath });
      if (result.success && result.lyric) {
        return { lyric: result.lyric, tlyric: result.tlyric ?? "" };
      }
      return null;
    } catch (e) {
      logger.error("local-provider", "getEmbeddedLyrics error", e, {
        localPath,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }
}
