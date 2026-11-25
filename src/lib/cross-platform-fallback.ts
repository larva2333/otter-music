/**
 * 播放失败后的「跨平台换源取链」兜底 —— 对应洛雪桌面版的 findMusic + 换源取链。
 *
 * 洛雪的做法（src/renderer/core/music/utils.ts）：当前源取链失败 → findMusic
 * 用「歌名+歌手+专辑+时长」跨平台搜同曲 → 逐个换源取链，谁先拿到可播链接谁胜出。
 * 这里把同样的思路搬到手机端，但有两处按本项目现状调整：
 *
 * 1. 校验维度：本项目的 MusicTrack 没有时长字段，用「专辑名」代替洛雪的
 *    「时长 ±5 秒」做防翻唱的第二道闸。歌名+歌手必须匹配，专辑名一旦两边
 *    都有就必须一致 —— 只有歌名歌手对得上、但专辑完全不同的，多半是翻唱，
 *    不参与兜底。
 * 2. 取链方式：洛雪换的是「平台」（同一个客户端内置各平台的取链实现）；
 *    这里换的是「音源」——搜到的候选曲目带上它自己的 source，用对应 provider
 *    的 getUrl 取链。这样网易的歌可以换到 QQ/酷我去取，反之亦然。
 *
 * 和 handleAutoMatch 的区别：那个会**替换队列里的曲目**（改 id / 音源标记），
 * 且搜索是串行的；这里只返回一条能播的直链，不动队列、不改 UI 曲目，
 * 与「洛雪源接管」「嗨歌曲接管」的语义一致 —— 用户听到的还是原来那首歌，
 * 只是播放地址来自另一个平台。
 */

import type { MusicTrack } from "@/types/music";
import { musicApi } from "@/lib/music-api";
import { getAggregatedSourcesForMatch } from "@/hooks/use-aggregated-sources";
import {
  isNameMatch,
  isArtistMatch,
  normalizeText,
} from "@/lib/utils/music-key";
import { probeMediaDetail } from "@/lib/utils/media-probe";
import { resolveViaLxPlayback } from "@/lib/imported-sources/lx-playback";
import { logger } from "@/lib/logger";

/** 搜索时每个平台取几条候选 */
const SEARCH_COUNT = 10;

/** 单个平台搜索/取链的预算 */
const PER_SOURCE_TIMEOUT = 8000;

/** 完整音轨的最小字节数，与 lx-playback 一致（挡掉约 960KB 的试听片段） */
const MIN_FULL_TRACK_BYTES = 1_000_000;

export interface CrossPlatformFallbackResult {
  url: string;
  /** 命中的候选曲目（供 UI 显示来源、写 origin 标记） */
  track: MusicTrack;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

/**
 * 严格校验候选是不是同一首歌，而非同名翻唱。
 *
 * - 歌名、歌手必须匹配（复用全项目统一的简繁/别名归一化工具）
 * - 专辑名两边都有时必须一致；任一边缺失时放行（老数据可能没有专辑）
 */
export function isSameSong(track: MusicTrack, candidate: MusicTrack): boolean {
  if (!isNameMatch(track.name, candidate.name)) return false;
  if (!isArtistMatch(track.artist, candidate.artist)) return false;

  const album = normalizeText(track.album);
  const candidateAlbum = normalizeText(candidate.album);
  if (album && candidateAlbum && album !== candidateAlbum) return false;

  return true;
}

/** 歌名+歌手一致，不校验专辑：严格候选全失败时的最后兜底 */
export function isSameRecording(
  track: MusicTrack,
  candidate: MusicTrack
): boolean {
  return (
    isNameMatch(track.name, candidate.name) &&
    isArtistMatch(track.artist, candidate.artist)
  );
}

/** 候选曲目取链 + 探活，返回第一个可播完整直链 */
async function tryCandidate(
  candidate: MusicTrack,
  quality: number,
  budgetMs = PER_SOURCE_TIMEOUT
): Promise<CrossPlatformFallbackResult | null> {
  const id = candidate.url_id || candidate.id;
  if (!id) return null;

  const timeout = Math.min(Math.max(budgetMs, 1), PER_SOURCE_TIMEOUT);
  let url = await withTimeout(
    musicApi.getUrl(id, candidate.source, quality),
    timeout
  );
  if (!url || !/^https?:\/\//.test(url)) {
    // 酷我等源的官方取链固定返回 null（需要签名），正常播放是靠洛雪脚本
    // 补链的。自动兜底若不补这一步，明明手动换源能播的歌会被误判为无源。
    const lx = await withTimeout(
      resolveViaLxPlayback(candidate, quality),
      timeout
    );
    url = lx && /^https?:\/\//.test(lx.url) ? lx.url : null;
  }
  if (!url) return null;

  const detail = await withTimeout(probeMediaDetail(url, 4000), timeout);
  if (!detail || detail.reachable !== "ok") {
    logger.warn(
      `跨平台换源链接不可播(${detail?.reachable ?? "timeout"})：${candidate.source} ${url.slice(0, 120)}`
    );
    return null;
  }
  if (detail.totalBytes !== null && detail.totalBytes < MIN_FULL_TRACK_BYTES) {
    logger.warn(
      `跨平台换源返回试听片段(${detail.totalBytes}B)：${candidate.source}`
    );
    return null;
  }
  return { url, track: candidate };
}

/** 并发取链，谁先拿到完整可播直链谁胜出；全部落空返回 null */
async function firstPlayable(
  candidates: MusicTrack[],
  quality: number,
  deadline: number
): Promise<CrossPlatformFallbackResult | null> {
  if (candidates.length === 0) return null;
  return new Promise((resolve) => {
    let settled = false;
    let pending = candidates.length;
    const finish = (result: CrossPlatformFallbackResult | null) => {
      if (settled) return;
      if (result) {
        settled = true;
        resolve(result);
        return;
      }
      pending -= 1;
      if (pending === 0) {
        settled = true;
        resolve(null);
      }
    };
    for (const candidate of candidates) {
      const remaining = Math.max(1, deadline - Date.now());
      void tryCandidate(candidate, quality, remaining).then(finish, () =>
        finish(null)
      );
    }
  });
}

/**
 * 跨平台换源取链：并发搜多个平台，严格筛同曲，再并发取链，谁先拿到完整可播直链谁胜出。
 *
 * @returns 命中即返回直链与命中的曲目；未找到或在 budgetMs 内没结果返回 null
 */
export async function resolveViaCrossPlatform(
  track: MusicTrack,
  quality: number,
  budgetMs = 20000
): Promise<CrossPlatformFallbackResult | null> {
  if (!track.name) return null;

  // 排除当前源本身（它已经失败了），以及本地/播客这类没有跨平台意义的源
  const sources = getAggregatedSourcesForMatch().filter(
    (s) => s !== track.source && s !== "higequ"
  );
  if (sources.length === 0) return null;

  const query = track.artist?.length
    ? `${track.name} ${track.artist[0]}`
    : track.name;

  const deadline = Date.now() + budgetMs;

  try {
    // 并发搜索所有平台（洛雪 findMusic 的核心：Promise.all，而不是串行）
    const searchResults = await Promise.all(
      sources.map(async (source) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return [] as MusicTrack[];
        const res = await withTimeout(
          musicApi.search(query, source, 1, SEARCH_COUNT),
          Math.min(remaining, PER_SOURCE_TIMEOUT)
        );
        return res?.items ?? [];
      })
    );

    // 先按「歌名 + 歌手 + 专辑」严格筛同曲；专辑不一致的同名同歌手曲放到
    // 第二梯队，只有严格候选全部取链失败才用。手动换源只校验歌名+歌手，
    // 自动兜底不该比手动更苛刻（同一歌手同一首歌常因专辑版本不同被误杀）。
    const sameRecording = searchResults
      .flat()
      .filter((item) => isSameRecording(track, item));
    const strict = sameRecording.filter((item) => isSameSong(track, item));
    const loose = sameRecording.filter((item) => !isSameSong(track, item));
    if (sameRecording.length === 0) {
      logger.info("跨平台换源未找到同曲", { name: track.name });
      return null;
    }

    logger.info(`跨平台换源命中 ${sameRecording.length} 个候选，并发取链`, {
      name: track.name,
      sources: sameRecording.map((c) => c.source),
    });

    const strictHit = await firstPlayable(strict, quality, deadline);
    if (strictHit) return strictHit;

    if (loose.length > 0 && Date.now() < deadline) {
      logger.info("严格候选全部失败，退回同曲同歌手但专辑不同的候选", {
        name: track.name,
        sources: loose.map((c) => c.source),
      });
      return await firstPlayable(loose, quality, deadline);
    }
    return null;
  } catch (error) {
    logger.warn("跨平台换源失败", error as Error, {
      trackId: track.id,
      name: track.name,
    });
    return null;
  }
}
