/**
 * 播放失败后用嗨歌曲换一条能播的直链。
 *
 * 嗨歌曲站点直链相对稳定，作为官方/洛雪都取不到链时的兜底。和洛雪不同，
 * 它没有「同一首歌的 id 映射」，只能按歌名+歌手搜同名曲，再取它的直链；
 * 只换播放地址，不改队列里的曲目（与洛雪接管一致）。
 *
 * 放在独立文件：useAudioTrackLoader 只负责调度，搜索/匹配/探活都在这里，
 * 便于单测，也不会让那个 hook 越写越长。
 */

import type { MusicTrack } from "@/types/music";
import { musicApi } from "@/lib/music-api";
import { isNameMatch, isArtistMatch } from "@/lib/utils/music-key";
import { probeMediaReachable } from "@/lib/utils/media-probe";
import { logger } from "@/lib/logger";

/** 兜底搜索取前几条，匹配歌名+歌手后挑第一条 */
const SEARCH_COUNT = 5;

export interface HigequFallbackResult {
  url: string;
  /** 命中的嗨歌曲曲目 id，写 URL 缓存/来源标记用 */
  trackId: string;
}

/**
 * 给当前曲目找一条嗨歌曲直链。
 *
 * @returns 命中且探活通过的直链；找不到或不可播都返回 null，由调用方继续原有兜底
 */
export async function resolveViaHigequFallback(
  track: MusicTrack,
  timeoutMs: number
): Promise<HigequFallbackResult | null> {
  if (!track.name) return null;

  try {
    const query = track.artist?.length
      ? `${track.name} ${track.artist[0]}`
      : track.name;
    const { items } = await musicApi.search(query, "higequ", 1, SEARCH_COUNT);

    const match = items.find(
      (item) =>
        isNameMatch(track.name, item.name) &&
        isArtistMatch(track.artist, item.artist)
    );
    if (!match) return null;

    const url = await musicApi.getUrl(match.url_id || match.id, "higequ", 320);
    if (!url || !/^https?:\/\//.test(url)) return null;

    const reachable = await probeMediaReachable(url, timeoutMs);
    if (reachable === "fail") {
      logger.warn(`嗨歌曲兜底链接不可播：${match.name} ${url.slice(0, 160)}`);
      return null;
    }
    // unknown（探活请求超时等非确定失败）仍放行：嗨歌曲直链本来就常不回 Range，
    // 交给播放器实播判断，和洛雪兜底对 unknown 的处理一致
    return { url, trackId: match.id };
  } catch (error) {
    logger.warn("嗨歌曲兜底取链失败", error as Error, {
      trackId: track.id,
      name: track.name,
    });
    return null;
  }
}
