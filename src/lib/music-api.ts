import type {
  MusicSource,
  MusicTrack,
  SearchPageResult,
  MergedMusicTrack,
  SongLyric,
  SearchIntent,
  SearchSuggestionItem,
} from "@/types/music";
import { cachedFetch } from "@/lib/utils/cache";
import { searchSuggest } from "@/lib/netease/netease-api";
import {
  fetchSearchCategories,
  fetchSearchCategoryPage,
  type SearchCategoryKind,
} from "@/lib/search-categories";
import { MusicProviderFactory, isAbort } from "./music-provider";
import { logger } from "@/lib/logger";
import { withImageSize } from "@/lib/utils/image-url";

// const TTL_SHORT = 60 * 60 * 1000; // 60 minutes
const TTL_LONG = 7 * 24 * 60 * 60 * 1000; // 7 days
/** 签名直链时效不定，与 url-cache-store 的内存 TTL 保持一致，过期即重新解析 */
const TTL_URL = 15 * 60 * 1000; // 15 minutes
const SYNC_PIC_CACHE_LIMIT = 200;
const syncPicCache = new Map<string, string>();

function rememberSyncPic(key: string, url: string) {
  syncPicCache.set(key, url);
  if (syncPicCache.size > SYNC_PIC_CACHE_LIMIT) {
    const oldest = syncPicCache.keys().next().value;
    if (oldest !== undefined) syncPicCache.delete(oldest);
  }
}

/**
 * 自动换源时单个音源的搜索时限。
 * 串行遍历里只要一个源不返回，后面的源就永远轮不到，
 * 播放器会一直停在 loading。超时即跳到下一个源。
 */
const SEARCH_SOURCE_TIMEOUT = 6_000;

export const musicApi = {
  /* ---------------- 搜索 ---------------- */

  async search(
    query: string,
    source: MusicSource = "joox",
    page = 1,
    count = 20,
    signal?: AbortSignal,
    searchIntent?: SearchIntent | null
  ): Promise<SearchPageResult<MusicTrack>> {
    if (source === "all") {
      return this.searchAll(query, page, count, signal, searchIntent);
    }

    return MusicProviderFactory.getProvider(source).search(
      query,
      page,
      count,
      signal,
      searchIntent
    );
  },

  /* ---------------- 全网搜索 ---------------- */

  async searchAll(
    query: string,
    page = 1,
    count = 20,
    signal?: AbortSignal,
    searchIntent?: SearchIntent | null
  ): Promise<SearchPageResult<MergedMusicTrack>> {
    const provider = MusicProviderFactory.getProvider("all");
    return provider.search(query, page, count, signal, searchIntent) as Promise<
      SearchPageResult<MergedMusicTrack>
    >;
  },

  /** 聚合 / 网易云搜索时，歌手、专辑、歌单各走一次类型搜索。 */
  searchCategories(query: string) {
    return fetchSearchCategories(query);
  },

  /** 歌手、专辑、歌单的后续页。offset 为已加载条数。 */
  searchCategoryPage(query: string, kind: SearchCategoryKind, offset: number) {
    return fetchSearchCategoryPage(query, kind, offset);
  },

  /* ---------------- 最佳匹配搜索（串行） ---------------- */

  async searchBestMatch({
    query,
    sources,
    predicate,
    count = 20,
    signal,
    ranker,
    targetTrack,
  }: {
    query: string;
    sources: MusicSource[];
    predicate: (track: MusicTrack) => boolean;
    count?: number;
    signal?: AbortSignal;
    ranker?: (track: MusicTrack, originalIndex: number) => number;
    targetTrack?: MusicTrack;
  }): Promise<MusicTrack | null> {
    for (const source of sources) {
      if (signal?.aborted) return null;
      try {
        const provider = MusicProviderFactory.getProvider(source);
        const effectivePredicate =
          targetTrack && provider.getAutoMatchPredicate
            ? provider.getAutoMatchPredicate(targetTrack)
            : predicate;
        const effectiveQuery =
          targetTrack && provider.getAutoMatchQuery
            ? provider.getAutoMatchQuery(targetTrack, query)
            : query;
        const effectiveCount =
          targetTrack && provider.getAutoMatchCount
            ? provider.getAutoMatchCount(targetTrack)
            : count;
        const effectiveRanker =
          targetTrack && provider.getAutoMatchRanker
            ? provider.getAutoMatchRanker(targetTrack)
            : ranker;
        const res = await (() => {
          let timer: ReturnType<typeof setTimeout> | null = null;
          const timeout = new Promise<null>((resolve) => {
            timer = setTimeout(() => {
              logger.warn(
                "music-api",
                `Search timed out for source: ${source}`,
                { timeout: SEARCH_SOURCE_TIMEOUT }
              );
              resolve(null);
            }, SEARCH_SOURCE_TIMEOUT);
          });
          return Promise.race([
            provider
              .search(effectiveQuery, 1, effectiveCount, signal)
              .catch((e) => {
                if (isAbort(e)) throw e;
                logger.warn(
                  "music-api",
                  `Search failed for source: ${source}`,
                  e
                );
                return null;
              }),
            timeout,
          ]).finally(() => {
            if (timer) clearTimeout(timer);
          });
        })();
        if (!res) continue;
        const match = effectiveRanker
          ? res.items
              .map((track, originalIndex) => ({ track, originalIndex }))
              .filter(({ track }) => effectivePredicate(track))
              .sort(
                (a, b) =>
                  effectiveRanker(b.track, b.originalIndex) -
                    effectiveRanker(a.track, a.originalIndex) ||
                  a.originalIndex - b.originalIndex
              )[0]?.track
          : res.items.find(effectivePredicate);
        if (match) return match;
      } catch (e) {
        if (isAbort(e)) throw e;
        logger.warn("music-api", `Search failed for source: ${source}`, e);
      }
    }
    return null;
  },

  /* ---------------- URL ---------------- */

  async getUrl(
    idOrUrl: string,
    source: MusicSource,
    br = 192,
    options?: { forceRefresh?: boolean }
  ): Promise<string | null> {
    if (idOrUrl.startsWith("http")) return idOrUrl;
    const key = `url:${source}:${idOrUrl}:${br}`;

    return cachedFetch<string | null>(
      key,
      async () => {
        try {
          const track = { id: idOrUrl, url_id: idOrUrl, source } as MusicTrack;
          return await MusicProviderFactory.getProvider(source).getUrl(
            track,
            br
          );
        } catch (e) {
          logger.error("music-api", "getUrl failed", e);
          return null;
        }
      },
      TTL_URL,
      options?.forceRefresh
    );
  },

  /* ---------------- 封面 ---------------- */

  /**
   * 同步获取已知封面 URL：
   * 1. 已是 HTTP 直链（非 B 站需走代理的封面）直接附带缩略参数同步返回；
   * 2. 非直链 ID 若本会话已查过，直接命中内存缓存秒回，避免切歌先闪出占位图标。
   */
  getSyncPic(
    idOrUrl: string,
    source: MusicSource,
    size: number = 800
  ): string | null {
    if (!idOrUrl) return null;
    if (idOrUrl.startsWith("http") && source !== "bilibili") {
      return withImageSize(idOrUrl, size) ?? idOrUrl;
    }
    const key = `pic:v3:${source}:${idOrUrl}:${size}`;
    return syncPicCache.get(key) ?? null;
  },

  /**
   * `trackInfo` 传入完整曲目对象。本地音源必须传：
   * `LocalProvider.getPic` 要靠歌名/歌手去网易云反查封面，只给文件路径查不到。
   * 缓存键已升到 v3，旧版本缓存的空结果（匹配时没有元信息）不会再命中。
   */
  async getPic(
    idOrUrl: string,
    source: MusicSource,
    size: number = 800,
    trackInfo?: MusicTrack | null
  ): Promise<string | null> {
    if (idOrUrl.startsWith("http") && source !== "bilibili") {
      return withImageSize(idOrUrl, size) ?? idOrUrl;
    }
    // v2：咪咕封面由相对路径改为补全 CDN 域名，旧缓存需作废，避免继续命中失效地址
    // v3：本地曲目改为携带完整元信息在线匹配，旧的「匹配失败」缓存需作废
    const key = `pic:v3:${source}:${idOrUrl}:${size}`;
    const resolved = await cachedFetch<string | null>(
      key,
      async () => {
        try {
          const track = trackInfo
            ? ({ ...trackInfo, source, pic_id: idOrUrl } as MusicTrack)
            : ({ id: idOrUrl, pic_id: idOrUrl, source } as MusicTrack);
          return await MusicProviderFactory.getProvider(source).getPic(
            track,
            size
          );
        } catch (e) {
          logger.error("music-api", "getPic failed", e);
          return null;
        }
      },
      TTL_LONG
    );
    if (resolved) rememberSyncPic(key, resolved);
    return resolved;
  },

  /* ---------------- 歌词 ---------------- */

  /** `trackInfo` 同 `getPic`：本地音源需要歌名/歌手才能在线匹配歌词。 */
  async getLyric(
    id: string,
    source: MusicSource,
    trackInfo?: MusicTrack | null
  ): Promise<SongLyric | null> {
    // v2：本地曲目改为携带完整元信息在线匹配，旧的「匹配失败」缓存需作废
    const key = `lyric:v2:${source}:${id}`;

    return cachedFetch<SongLyric | null>(
      key,
      async () => {
        try {
          const track = trackInfo
            ? ({ ...trackInfo, source, lyric_id: id } as MusicTrack)
            : ({ id, lyric_id: id, source } as MusicTrack);
          return await MusicProviderFactory.getProvider(source).getLyric(track);
        } catch (e) {
          logger.error("music-api", "getLyric failed", e);
          return null;
        }
      },
      TTL_LONG
    );
  },

  /* ---------------- 搜索建议 ---------------- */

  async getSearchSuggestions(query: string): Promise<SearchSuggestionItem[]> {
    const q = query.trim();
    if (!q) return [];

    try {
      const s = await searchSuggest(q);
      if (!s) return [];

      const seen = new Set<string>();
      const suggestions: SearchSuggestionItem[] = [];

      const pushUnique = (
        text: string,
        type: SearchSuggestionItem["type"],
        id?: string | number
      ) => {
        text = text.trim();
        if (!text) return;

        const key = `${type}:${text}`;
        if (seen.has(key)) return;

        seen.add(key);
        suggestions.push({
          text,
          type,
          id: id === null ? undefined : String(id),
          source: "_netease",
        });
      };

      const addTop = <T>(
        list: T[] | undefined,
        type: SearchSuggestionItem["type"],
        format: (item: T) => string
      ) => {
        for (const item of list?.slice(0, 3) ?? []) {
          pushUnique(format(item), type, (item as { id?: string | number }).id);
        }
      };

      addTop(s.artists, "artist", (a) => a.name);
      addTop(
        s.songs,
        "song",
        (song) =>
          `${song.name} - ${song.artists?.map((a) => a.name).join("/") ?? ""}`
      );
      addTop(s.albums, "album", (a) => `${a.name} - ${a.artist?.name ?? ""}`);
      addTop(s.playlists, "playlist", (p) => p.name);

      return suggestions;
    } catch (e) {
      logger.warn("music-api", "Search suggest failed", e);
      return [];
    }
  },
};
