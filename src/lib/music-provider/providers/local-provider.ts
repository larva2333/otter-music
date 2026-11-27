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
import { useLocalMusicStore } from "@/store/local-music-store";
import {
  search as neteaseSearch,
  getSongDetail,
  getLyric as neteaseGetLyric,
} from "@/lib/netease/netease-api";
import { searchQqMusic, getQqMusicLyric } from "@/lib/qqmusic/qqmusic-api";
import { KuwoSearchProvider } from "./kuwo-search-provider";
import { HigequProvider } from "./higequ-provider";
import { getHigequSongDetail, parseHigequRid } from "@/lib/higequ/higequ-api";
import { t2s } from "@/lib/utils/t2s";

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

/**
 * 网易对短时间内的批量搜索会返回 405「操作频繁」。
 * 本地列表一次可能给几百首歌匹配元信息，这里把所有在线搜索串行化并留间隔；
 * 命中限流后网易侧全局退避，避免把「请求失败」误判成「查无此歌」再缓存 30 天。
 */
const SEARCH_INTERVAL_MS = 500;
const RATE_LIMIT_BACKOFF_MS = 60_000;
let lastSearchAt = 0;
let rateLimitedUntil = 0;
let searchQueue: Promise<unknown> = Promise.resolve();

function isRateLimitError(error: unknown): boolean {
  return /405|操作频繁|too many requests/i.test(String(error));
}

/** 网易搜索串行排队，间隔 500ms，避免触发 405 风控 */
function queuedFetch<T>(run: () => Promise<T>): Promise<T> {
  const task = searchQueue.then(async () => {
    const wait = SEARCH_INTERVAL_MS - (Date.now() - lastSearchAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastSearchAt = Date.now();
    return run();
  });
  searchQueue = task.catch(() => null);
  return task;
}

/** 网易退避期内直接跳过（null = 不写缓存，退避结束后可重试） */
async function queuedNeteaseSearch(keyword: string) {
  if (Date.now() < rateLimitedUntil) return null;
  return queuedFetch(() => neteaseSearch(keyword, 1, 1, 8));
}

/**
 * 兜底音源（QQ/酷我/嗨歌曲）用有限并发，不再受网易的串行间隔拖慢：
 * 本地列表几百首歌逐一匹配时，串行 500ms 要跑几分钟，体验等于「拿不到」。
 */
const FALLBACK_CONCURRENCY = 6;
let fallbackActive = 0;
const fallbackWaiters: Array<() => void> = [];

async function withFallbackConcurrency<T>(run: () => Promise<T>): Promise<T> {
  while (fallbackActive >= FALLBACK_CONCURRENCY) {
    await new Promise<void>((resolve) => fallbackWaiters.push(resolve));
  }
  fallbackActive++;
  try {
    return await run();
  } finally {
    fallbackActive--;
    fallbackWaiters.shift()?.();
  }
}

/** 归一化歌名用于匹配：繁简统一、去括号补充说明、标点和空白，统一小写。 */
function normalizeForMatch(value: string | null | undefined): string {
  if (!value) return "";
  return t2s(value)
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
    const response = await queuedNeteaseSearch(keyword);
    if (!response) return null;
    const payload = (
      response as unknown as {
        data?: {
          code?: number;
          msg?: string;
          result?: { songs?: NeteaseSongBrief[] };
        };
      }
    ).data;
    // 限流/接口异常时 result 为空，必须当成「请求失败」而不是「查无此歌」
    if (payload?.code !== undefined && payload.code !== 200) {
      throw new Error(`网易搜索失败 code=${payload.code} ${payload.msg ?? ""}`);
    }
    const songs = payload?.result?.songs ?? [];

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
    // 确认匹配不到：空串可以缓存，30 天内不再重复搜索
    return "";
  } catch (e) {
    if (isRateLimitError(e)) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    }
    logger.warn("local-provider", "在线匹配失败", e);
    // null = 请求失败，不写缓存，退避结束后可重试
    return null;
  }
}

/**
 * 带缓存的在线曲目匹配。
 * 空串 = 确认匹配不到（可缓存）；null = 请求失败/限流（不缓存）。
 * v4：之前 v2 把 405 限流当成空结果缓存了 30 天，全部作废。
 * v5：补充「妳→你」等异体字归一化后重跑未命中曲目。
 */
async function resolveNeteaseSongId(track: MusicTrack): Promise<string | null> {
  const cacheKey = `local:match:v5:${track.name || ""}|${(track.artist || []).join("/")}`;
  return cachedFetch<string>(
    cacheKey,
    () => searchNeteaseSongId(track),
    LOCAL_META_TTL
  );
}

type FallbackSource = "qq" | "kuwo" | "higequ";

interface FallbackMatch {
  coverUrl: string;
  lyricId: string;
  source: FallbackSource;
}

const kuwoProvider = new KuwoSearchProvider();
const higequProvider = new HigequProvider();

/** 单个兜底音源搜索，歌名归一化一致 + 歌手有交集才采用 */
async function searchFallbackMeta(
  track: MusicTrack,
  source: FallbackSource
): Promise<FallbackMatch | null> {
  const name = (track.name || "").trim();
  if (!name || name === "未知歌曲" || name === "未知艺术家") return null;

  const artists = realArtists(track);
  const keyword = [name, artists[0]].filter(Boolean).join(" ");
  const targetName = normalizeForMatch(name);
  if (!targetName) return null;

  try {
    let items: MusicTrack[];
    if (source === "qq") {
      items = (await withFallbackConcurrency(() => searchQqMusic(keyword, 1)))
        .items;
    } else if (source === "kuwo") {
      items = (
        await withFallbackConcurrency(() => kuwoProvider.search(keyword, 1, 20))
      ).items;
    } else {
      items = (
        await withFallbackConcurrency(() =>
          higequProvider.search(keyword, 1, 20)
        )
      ).items;
    }

    const normalizedArtists = artists.map(normalizeForMatch).filter(Boolean);

    for (const item of items) {
      if (normalizeForMatch(item.name) !== targetName) continue;

      const itemArtists = (item.artist || [])
        .map(normalizeForMatch)
        .filter(Boolean);
      if (normalizedArtists.length > 0 && itemArtists.length > 0) {
        const hasCommonArtist = itemArtists.some((a) =>
          normalizedArtists.some(
            (target) => a === target || a.includes(target) || target.includes(a)
          )
        );
        if (!hasCommonArtist) continue;
      }

      const lyricId = item.lyric_id || item.url_id || item.id;
      if (!lyricId) continue;

      // 嗨歌曲搜索页不带封面（pic_id 只是标记位），需解析播放页
      let coverUrl = source === "higequ" ? "" : item.pic_id || "";
      if (!coverUrl && source === "higequ") {
        const rid = parseHigequRid(lyricId);
        if (rid) {
          const detail = await withFallbackConcurrency(() =>
            getHigequSongDetail(rid)
          );
          coverUrl = detail?.coverUrl || "";
        }
      }
      if (!coverUrl) continue;
      return { coverUrl, lyricId, source };
    }
    return null;
  } catch (e) {
    logger.warn("local-provider", `${source} 匹配失败`, e);
    return null;
  }
}

/** 兜底顺序：QQ → 酷我 → 嗨歌曲；空对象 = 全源确认匹配不到 */
async function searchAllFallbackMeta(
  track: MusicTrack
): Promise<FallbackMatch> {
  const sources: FallbackSource[] = ["qq", "kuwo", "higequ"];
  for (const source of sources) {
    const hit = await searchFallbackMeta(track, source);
    if (hit) return hit;
  }
  return { coverUrl: "", lyricId: "", source: "qq" };
}

async function resolveFallbackMeta(
  track: MusicTrack
): Promise<FallbackMatch | null> {
  const cacheKey = `local:fallback-match:v3:${track.name || ""}|${(track.artist || []).join("/")}`;
  return cachedFetch<FallbackMatch>(
    cacheKey,
    () => searchAllFallbackMeta(track),
    LOCAL_META_TTL
  );
}

/** 各兜底源取歌词方式不同，统一成 SongLyric */
async function fetchFallbackLyric(
  match: FallbackMatch
): Promise<SongLyric | null> {
  try {
    if (match.source === "qq") {
      const lrc = await getQqMusicLyric(match.lyricId);
      return lrc?.lyric ? { lyric: lrc.lyric, tlyric: lrc.tlyric ?? "" } : null;
    }
    if (match.source === "kuwo") {
      return await kuwoProvider.getLyric({
        lyric_id: match.lyricId,
      } as MusicTrack);
    }
    return await higequProvider.getLyric({
      lyric_id: match.lyricId,
    } as MusicTrack);
  } catch (e) {
    logger.warn("local-provider", `${match.source} 歌词获取失败`, e);
    return null;
  }
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
   * 封面优先级：内嵌封面 → 在线匹配（网易云 → QQ → 酷我 → 嗨歌曲）→ null。
   * 在线结果按 localPath 缓存，无封面时缓存空值避免反复请求。
   */
  async getPic(track: MusicTrack, size: number = 800): Promise<string | null> {
    const localPath = track.pic_id;
    if (!localPath || !IS_NATIVE) return null;

    const embedded = await this.readEmbeddedCover(localPath);
    if (embedded) return embedded;

    // 之前在线匹配到的结果已经写回本地音乐 store，直接用
    const saved = useLocalMusicStore
      .getState()
      .files.find((f) => f.localPath === localPath)?.matchedCoverUrl;
    if (saved) return saved;

    const cached = await cachedFetch<string | null>(
      `local:cover:v5:${localPath}:${size}`,
      async () => {
        const songId = await resolveNeteaseSongId(track);
        if (songId) {
          try {
            const song = await getSongDetail(songId);
            const url = song?.al?.picUrl;
            if (url) return `${url}?param=${size}y${size}`;
          } catch (e) {
            logger.warn("local-provider", "在线封面获取失败", e);
          }
        }
        // 网易限流/查无此歌 → 多源兜底
        const fb = await resolveFallbackMeta(track);
        if (fb?.coverUrl) return fb.coverUrl;
        // 只有「确认两边都没有」才缓存空值；请求失败留空，下次可重试
        return songId === "" ? "" : null;
      },
      LOCAL_META_TTL
    );

    if (cached) {
      // 写回本地音乐 store，随列表持久化；下次直接命中不再走匹配
      useLocalMusicStore
        .getState()
        .updateLocalMeta(localPath, { matchedCoverUrl: cached });
    }
    return cached || null;
  }

  /**
   * 歌词优先级：内嵌歌词 → 在线匹配（网易云 → QQ → 酷我 → 嗨歌曲）→ null。
   * 侧挂 .lrc 不缓存，用户改了文件立即生效。
   */
  async getLyric(track: MusicTrack): Promise<SongLyric | null> {
    const localPath = track.lyric_id;
    if (!localPath || !IS_NATIVE) return null;

    const embedded = await this.readEmbeddedLyrics(localPath);
    if (embedded) return embedded;

    // 之前在线匹配到的结果已经写回本地音乐 store，直接用
    const savedFile = useLocalMusicStore
      .getState()
      .files.find((f) => f.localPath === localPath);
    if (savedFile?.matchedLyric) {
      return {
        lyric: savedFile.matchedLyric,
        tlyric: savedFile.matchedTlyric ?? "",
      };
    }

    const cached = await cachedFetch<SongLyric>(
      `local:lyric:v5:${localPath}`,
      async () => {
        const songId = await resolveNeteaseSongId(track);
        if (songId) {
          try {
            const res = await neteaseGetLyric(songId);
            const lyric = res?.data?.lrc?.lyric;
            if (lyric) {
              return {
                lyric,
                tlyric: res?.data?.tlyric?.lyric || "",
              };
            }
          } catch (e) {
            logger.warn("local-provider", "在线歌词获取失败", e);
          }
        }
        // 网易限流/查无此歌 → 多源兜底
        const fb = await resolveFallbackMeta(track);
        if (fb?.lyricId) {
          const lrc = await fetchFallbackLyric(fb);
          if (lrc?.lyric) return lrc;
        }
        // 只有「确认两边都没有」才缓存空值；请求失败留空，下次可重试
        return songId === "" ? { lyric: "" } : null;
      },
      LOCAL_META_TTL
    );

    if (!cached || !cached.lyric) return null;
    // 写回本地音乐 store，随列表持久化
    useLocalMusicStore.getState().updateLocalMeta(localPath, {
      matchedLyric: cached.lyric,
      matchedTlyric: cached.tlyric ?? "",
    });
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
