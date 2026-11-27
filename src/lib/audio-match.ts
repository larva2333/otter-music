import { toast } from "react-hot-toast";
import { useMusicStore } from "@/store/music-store";
import {
  EXCLUDED_FOR_SEARCH,
  getAggregatedSourcesForMatch,
} from "@/hooks/use-aggregated-sources";
import { musicApi } from "@/lib/music-api";
import { sourceLabels, type MusicSource, type MusicTrack } from "@/types/music";
import {
  isNameMatch,
  isArtistMatch,
  normalizeArtists,
  normalizeText,
  convertT2SOnly,
} from "./utils/music-key";
import { logger } from "@/lib/logger";
import { useUrlCacheStore, buildUrlCacheKey } from "@/store/url-cache-store";
import { useHistoryStore } from "@/store/history-store";
import { trackOriginKey } from "@/store/music-store/playback-slice";

/**
 * 自动换源总时限。
 *
 * searchBestMatch 是**串行**遍历音源的，只要有一个源的搜索不返回，
 * 整条链就会一直挂着 —— 播放器处于 loading 状态、既不报错也不跳歌。
 * 超时后必须放行，让上层继续走「跳过下一首」。
 */
const AUTO_MATCH_TIMEOUT = 12_000;

/** 同一首待延迟解析曲目的并发去重，避免预加载与主播放重复查表 */
const inflightPendingMatches = new Map<string, Promise<MusicTrack | null>>();

function stripPendingSourceFrom(track: MusicTrack): MusicTrack {
  if (!track.pendingSourceFrom) return track;
  const { pendingSourceFrom: _, ...clean } = track;
  return clean;
}

/** 构造切源后最终写入各集合的曲目（处理 B 站保留原歌名/歌手，并清掉待解析标记） */
function buildMatchedFinalTrack(
  originalTrack: MusicTrack,
  match: MusicTrack
): MusicTrack {
  const { bilibiliKeepOriginalMeta } = useMusicStore.getState();
  const base =
    match.source === "bilibili" && bilibiliKeepOriginalMeta
      ? { ...match, name: originalTrack.name, artist: originalTrack.artist }
      : match;
  return stripPendingSourceFrom(base);
}

/** 按目标音源执行带超时的最佳同曲搜索 */
async function searchTargetSourceMatch(
  track: MusicTrack,
  sources: MusicSource[]
): Promise<{ match: MusicTrack | null; timedOut: boolean }> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve(null);
    }, AUTO_MATCH_TIMEOUT);
  });

  const searchPromise = musicApi
    .searchBestMatch({
      query: `${track.name} ${track.artist[0] ?? ""}`.trim(),
      sources,
      signal: controller.signal,
      predicate: (item: MusicTrack) => {
        if (!isNameMatch(track.name, item.name)) return false;
        return isArtistMatch(track.artist, item.artist);
      },
      ranker: (item, originalIndex) =>
        scoreAutoMatchCandidate(track, item, originalIndex),
      targetTrack: track,
    })
    .catch((error) => {
      if (timedOut) return null;
      throw error;
    });

  try {
    const match = await Promise.race([searchPromise, timeoutPromise]);
    return { match, timedOut };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 构造单首曲目直接切换音源标签后的状态 */
function buildDirectSwitchedTrack(
  existing: MusicTrack,
  targetSource: MusicSource
): MusicTrack {
  // 切回原音源且尚未解析时，直接还原成未修改状态
  if (existing.pendingSourceFrom === targetSource) {
    return stripPendingSourceFrom({ ...existing, source: targetSource });
  }
  return {
    ...existing,
    source: targetSource,
    pendingSourceFrom: existing.pendingSourceFrom ?? existing.source,
  };
}

/**
 * 批量直接切换音源标签：只改写各集合中的 `source` 标签并标记 `pendingSourceFrom`，
 * 不发任何网络搜索或校验请求，等到实际播放该曲时再按目标音源解析。
 * @returns 实际发生标签变更的曲目数量
 */
export function batchSwitchTrackSource(
  tracks: MusicTrack[],
  targetSource: MusicSource
): number {
  const targets = tracks.filter((t) => {
    if (t.source && EXCLUDED_FOR_SEARCH.includes(t.source)) return false;
    return t.source !== targetSource;
  });
  if (targets.length === 0) return 0;

  const replaceList = (list: MusicTrack[]) =>
    list.map((item) => {
      const hit = targets.some((src) =>
        isSameTrackAcrossCollections(item, src)
      );
      if (!hit || (item.source && EXCLUDED_FOR_SEARCH.includes(item.source))) {
        return item;
      }
      if (item.source === targetSource) return item;
      return buildDirectSwitchedTrack(item, targetSource);
    });

  const s = useMusicStore.getState();
  const nextOrigins = { ...s.trackOrigins };
  let originsChanged = false;
  for (const t of targets) {
    for (const key of [
      trackOriginKey(t),
      trackOriginKey({ ...t, source: targetSource }),
    ]) {
      if (key in nextOrigins) {
        delete nextOrigins[key];
        originsChanged = true;
      }
    }
  }

  useMusicStore.setState({
    queue: replaceList(s.queue),
    originalQueue: replaceList(s.originalQueue),
    favorites: replaceList(s.favorites),
    searchResults: replaceList(s.searchResults),
    playlists: s.playlists.map((p) => ({
      ...p,
      tracks: replaceList(p.tracks),
    })),
    ...(originsChanged ? { trackOrigins: nextOrigins } : {}),
  });
  useHistoryStore.setState((h) => ({ history: replaceList(h.history) }));
  return targets.length;
}

/**
 * 实际播放/预加载「仅改过音源标签」的曲目时，再向目标音源搜索同曲并同步真实元数据。
 */
export async function resolvePendingSourceMatch(
  track: MusicTrack
): Promise<MusicTrack | null> {
  if (!track.pendingSourceFrom || !track.source) return track;
  if (EXCLUDED_FOR_SEARCH.includes(track.source)) return null;

  const inflightKey = `${track.source}:${track.id}:${track.pendingSourceFrom}`;
  const existing = inflightPendingMatches.get(inflightKey);
  if (existing) return existing;

  const task = (async (): Promise<MusicTrack | null> => {
    try {
      const { match } = await searchTargetSourceMatch(track, [track.source]);
      if (!match) return null;

      const finalTrack = buildMatchedFinalTrack(track, match);
      const quality = useMusicStore.getState().quality;
      useUrlCacheStore
        .getState()
        .delete(
          buildUrlCacheKey(
            finalTrack.source,
            finalTrack.id,
            finalTrack.url_id,
            quality
          )
        );
      useMusicStore.getState().recordTrackOrigin(track, null);
      syncTrackAcrossCollections(track, finalTrack);
      return finalTrack;
    } catch (error) {
      logger.error("audio-match", "Pending source match failed", error, {
        trackId: track.id,
        targetSource: track.source,
      });
      return null;
    }
  })();

  inflightPendingMatches.set(inflightKey, task);
  void task.then(
    () => inflightPendingMatches.delete(inflightKey),
    () => inflightPendingMatches.delete(inflightKey)
  );
  return task;
}

/**
 * 同一首曲目在各集合里的副本可能 id 不同：
 * 换源后 id 变成新音源的 id，而历史/歌单/播放列表里的旧副本还留着原 id。
 * 先按 id+source 精确匹配，再按歌名+歌手兜底（与换源搜索同一套判定）。
 */
function isSameTrackAcrossCollections(a: MusicTrack, b: MusicTrack): boolean {
  if (a.id === b.id && a.source === b.source) return true;
  return isNameMatch(a.name, b.name) && isArtistMatch(a.artist, b.artist);
}

/** 把换源结果同步到所有集合，id 不一致时用歌名+歌手兜底 */
function syncTrackAcrossCollections(
  track: MusicTrack,
  finalTrack: MusicTrack
): void {
  const replace = (list: MusicTrack[]) =>
    list.map((t) => {
      if (!isSameTrackAcrossCollections(t, track)) return t;
      const merged = { ...t, ...finalTrack };
      if (!finalTrack.pendingSourceFrom) {
        return stripPendingSourceFrom(merged);
      }
      return merged;
    });

  const s = useMusicStore.getState();
  useMusicStore.setState({
    queue: replace(s.queue),
    originalQueue: replace(s.originalQueue),
    favorites: replace(s.favorites),
    searchResults: replace(s.searchResults),
    playlists: s.playlists.map((p) => ({
      ...p,
      tracks: replace(p.tracks),
    })),
  });
  useHistoryStore.setState((h) => ({ history: replace(h.history) }));
}

/**
 * 计算自动换源的单源内排序分数，优先保证歌名与歌手完全一致。
 */
function scoreAutoMatchCandidate(
  target: MusicTrack,
  candidate: MusicTrack,
  originalIndex: number
): number {
  let score = 0;
  const sameArtistSet =
    normalizeArtists(target.artist).join("/") ===
    normalizeArtists(candidate.artist).join("/");

  if (sameArtistSet) {
    score += 100;
  } else {
    const tSet = new Set(normalizeArtists(target.artist));
    const cSet = new Set(normalizeArtists(candidate.artist));
    for (const a of tSet) {
      if (cSet.has(a)) {
        score += 40;
        break;
      }
    }
  }

  if (normalizeText(target.name) === normalizeText(candidate.name))
    score += 100;

  // 全量匹配额外加分：简繁体转换后完全一致（保留括号等所有字符）
  if (convertT2SOnly(target.name) === convertT2SOnly(candidate.name)) {
    score += 50;
  }

  score += Math.max(0, 20 - originalIndex);

  return score;
}

/**
 * 自动匹配免费源逻辑
 * @param track 需要匹配的歌曲
 * @param targetSource 可选，指定目标音源（仅搜索该音源）
 * @param pagePath 可选，当前页面路径（手动换源时传入，用于判断同步范围）
 * @param shouldAbort 可选，中止检查回调：搜索完成后、修改状态前调用，返回 true 则静默中止换源
 * @param playAfterMatch 可选，换源成功后立即播放：不在队列时插入到当前曲之后，已在队列时直接定位播放
 * @param silent 可选，静默模式：不弹 toast（批量替换音源时用，由调用方统一报进度）
 * @returns 是否匹配并切换成功
 */
export async function handleAutoMatch(
  track: MusicTrack,
  targetSource?: MusicSource,
  pagePath?: string,
  shouldAbort?: () => boolean,
  playAfterMatch = false,
  silent = false
): Promise<boolean> {
  if (track.source && EXCLUDED_FOR_SEARCH.includes(track.source)) {
    return false;
  }
  const toastId = silent
    ? `auto-match-${track.id}`
    : toast.loading("正在搜索免费音源...", {
        id: `auto-match-${track.id}`,
      });

  try {
    const {
      currentIndex,
      autoMatchContext,
      setAutoMatchContext,
      updateTrackInQueue,
      updateTrackInPlaylists,
      updateTrackInSearch,
      contextId,
      autoMatchFavorites,
      autoMatchPlaylists,
      isFavorite,
      favorites,
      setFavorites,
    } = useMusicStore.getState();

    // 手动指定目标音源时：只搜索该音源，不记录 tried
    const isManual = !!targetSource;
    const ctx =
      currentIndex !== autoMatchContext?.index
        ? { index: currentIndex, tried: new Set<MusicSource>() }
        : autoMatchContext;

    const aggregatedSources = isManual
      ? [targetSource]
      : getAggregatedSourcesForMatch().filter(
          (source) => source !== track.source && !ctx.tried.has(source)
        );

    if (aggregatedSources.length === 0) {
      // 上面已经起了 loading toast，这里直接 return 会把它留下
      if (!silent) toast.dismiss(toastId);
      return false;
    }

    const { match, timedOut } = await searchTargetSourceMatch(
      track,
      aggregatedSources
    );

    if (!match) {
      if (!silent)
        toast.error(timedOut ? "换源搜索超时，已跳过" : "未找到可用音源", {
          id: toastId,
        });
      return false;
    }

    // 搜索耗时期间原音源可能已恢复正常（如流式加载时临时时长被纠正为完整时长），
    // 此时不应覆盖队列曲目
    if (shouldAbort?.()) {
      logger.info(
        "audio-match",
        "Auto match aborted: original source playing normally",
        {
          trackId: track.id,
          source: track.source,
        }
      );
      if (!silent) toast.dismiss(toastId);
      return false;
    }

    const finalTrack = buildMatchedFinalTrack(track, match);

    // 自动模式下记录已尝试的音源（手动指定时不记录，避免干扰后续自动换源）
    if (!isManual) {
      const nextTried = new Set(ctx.tried);
      nextTried.add(track.source);
      setAutoMatchContext({ index: currentIndex, tried: nextTried });
    }

    const { queue, playTrackAsNext, setCurrentIndexAndPlay } =
      useMusicStore.getState();
    const queuedIndex = queue.findIndex((t) => t.id === track.id);

    if (playAfterMatch && queuedIndex === -1) {
      // 原曲不在当前队列：把换源后的曲目插入到当前曲之后并立即播放
      playTrackAsNext(finalTrack);
      const insertedIndex = useMusicStore
        .getState()
        .queue.findIndex((t) => t.id === finalTrack.id);
      if (insertedIndex !== -1) setCurrentIndexAndPlay(insertedIndex);
    } else {
      updateTrackInQueue(track.id, finalTrack);
      // 手动换源后立即播放该曲目（已在队列时直接定位到它，索引不变）
      if (playAfterMatch && queuedIndex !== -1) {
        setCurrentIndexAndPlay(queuedIndex);
      }
    }

    // 换源结果同步到搜索结果列表。列表行的音源标记、以及「···」菜单里
    // 「音源：xx」都读这份数据 —— 不同步就会出现「已经在播新源，
    // 列表和菜单还标着旧源」。
    updateTrackInSearch(track.id, track.source, finalTrack);
    // 旧曲目的「实际供源」记录随曲目一起作废，避免以后搜回同一首时
    // 还挂着上一次的洛雪脚本标记
    useMusicStore.getState().recordTrackOrigin(track, null);

    // 清除目标音源的 URL 缓存，强制重新获取音频 URL
    // 避免复用之前缓存中的试听片段（如 _netease 的 30 秒预览）
    const currentQuality = useMusicStore.getState().quality;
    const newCacheKey = buildUrlCacheKey(
      finalTrack.source,
      finalTrack.id,
      finalTrack.url_id,
      currentQuality
    );
    useUrlCacheStore.getState().delete(newCacheKey);

    // 手动换源（含批量替换）：不管从哪个页面发起，都把这首歌在所有集合里的
    // 副本一起换掉 —— 歌单、播放队列、播放历史、我的喜欢、搜索结果。
    // 各集合里的副本 id 可能不同（换源会换 id），按歌名+歌手兜底匹配。
    if (isManual) {
      void pagePath;
      syncTrackAcrossCollections(track, finalTrack);
    } else {
      // 自动换源：保持原有逻辑
      if (autoMatchPlaylists && contextId?.startsWith("playlist-")) {
        updateTrackInPlaylists(track.id, finalTrack);
      }
      if (
        autoMatchFavorites &&
        contextId === "favorites" &&
        isFavorite(track.id)
      ) {
        setFavorites(
          favorites.map((t) => (t.id === track.id ? finalTrack : t))
        );
      }
    }

    const sourceLabel = sourceLabels[match.source] || match.source;
    if (!silent) toast.success(`已切换至: ${sourceLabel}`, { id: toastId });
    return true;
  } catch (error) {
    logger.error("audio-match", "Auto match failed", error);
    if (!silent) toast.error("自动匹配失败", { id: toastId });
    return false;
  }
}
