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

/**
 * 自动换源总时限。
 *
 * searchBestMatch 是**串行**遍历音源的，只要有一个源的搜索不返回，
 * 整条链就会一直挂着 —— 播放器处于 loading 状态、既不报错也不跳歌。
 * 超时后必须放行，让上层继续走「跳过下一首」。
 */
const AUTO_MATCH_TIMEOUT = 12_000;

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
 * 检测网易云试听片段（音频时长可能是浮点型）
 * @param duration 音频时长（秒）
 * @param src 当前音频元素 src
 */
export function isNeteaseSampleClip(duration: number, src: string): boolean {
  return (
    [30, 45, 60].some((d) => Math.abs(duration - d) < 1) ||
    src.includes("jdusicrep-ts")
  );
}

/**
 * 自动匹配免费源逻辑
 * @param track 需要匹配的歌曲
 * @param targetSource 可选，指定目标音源（仅搜索该音源）
 * @param pagePath 可选，当前页面路径（手动换源时传入，用于判断同步范围）
 * @param shouldAbort 可选，中止检查回调：搜索完成后、修改状态前调用，返回 true 则静默中止换源
 * @param playAfterMatch 可选，换源成功后立即播放：不在队列时插入到当前曲之后，已在队列时直接定位播放
 * @returns 是否匹配并切换成功
 */
export async function handleAutoMatch(
  track: MusicTrack,
  targetSource?: MusicSource,
  pagePath?: string,
  shouldAbort?: () => boolean,
  playAfterMatch = false
): Promise<boolean> {
  if (track.source && EXCLUDED_FOR_SEARCH.includes(track.source)) {
    return false;
  }
  const toastId = toast.loading("正在搜索免费音源...", {
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
      toast.dismiss(toastId);
      return false;
    }

    // 超时控制：abort 让支持 signal 的 provider 立即收手，
    // race 兜住那些不响应 abort 的原生请求（否则 await 永远不返回）
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
        query: `${track.name} ${track.artist[0]}`,
        sources: aggregatedSources,
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
        // 超时后原请求才失败属于预期，不再当作异常抛出
        if (timedOut) return null;
        throw error;
      });

    const match = await Promise.race([searchPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);

    if (!match) {
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
      toast.dismiss(toastId);
      return false;
    }

    // 仅对 B 站音源保留原歌曲的 name 和 artist，避免标题杂乱与作者错位
    const { bilibiliKeepOriginalMeta } = useMusicStore.getState();
    const finalTrack: MusicTrack =
      match.source === "bilibili" && bilibiliKeepOriginalMeta
        ? { ...match, name: track.name, artist: track.artist }
        : match;

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

    // 判断当前页面上下文（手动换源时基于页面路径，自动换源时基于 contextId）
    const isOnFavoritesPage = pagePath === "/favorites";
    const isOnPlaylistPage = pagePath?.startsWith("/playlist/") ?? false;
    const playlistId = isOnPlaylistPage ? pagePath!.split("/")[2] : null;

    // 手动换源：根据当前页面同步；自动换源：根据 contextId 和设置项同步
    if (isManual) {
      // 手动换源：仅同步当前页面
      if (isOnPlaylistPage && playlistId) {
        updateTrackInPlaylists(track.id, finalTrack, playlistId);
      }
      if (isOnFavoritesPage && isFavorite(track.id)) {
        setFavorites(
          favorites.map((t) => (t.id === track.id ? finalTrack : t))
        );
      }
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
    toast.success(`已切换至: ${sourceLabel}`, { id: toastId });
    return true;
  } catch (error) {
    logger.error("audio-match", "Auto match failed", error);
    toast.error("自动匹配失败", { id: toastId });
    return false;
  }
}
