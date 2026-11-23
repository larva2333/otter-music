import { useEffect, useRef } from "react";
import { useMusicStore } from "@/store/music-store";
import { resolveTrackUrl } from "@/lib/audio-resolver";
import { shouldSkipOfficialResolve } from "@/lib/playback-access";
import { buildUrlCacheKey, useUrlCacheStore } from "@/store/url-cache-store";
import { logger } from "@/lib/logger";
import type { MusicTrack } from "@/types/music";

/** 一次搜索最多后台预取几首。并发取链，取 3 首的开销和取 1 首接近 */
const MAX_PREFETCH = 3;

/**
 * 搜索结果出来后，后台给前几首 VIP 曲预取直链并写进 URL 缓存。
 *
 * 会员曲必须走洛雪换完整音轨，fish 取链在真机上要十几秒，
 * 用户点歌时同步等就是「延迟太高」。提前预取后点歌直接命中缓存。
 * 预取和正式取链共用 resolveTrackUrl 的 in-flight 去重，不会重复跑。
 */
export function useSearchUrlPrefetch(tracks: MusicTrack[]) {
  const quality = useMusicStore((s) => s.quality);
  const doneRef = useRef<string>("");

  useEffect(() => {
    if (tracks.length === 0) return;
    const q = parseInt(quality, 10) || 192;
    const signature = `${tracks[0]?.id}|${tracks.length}|${q}`;
    if (doneRef.current === signature) return;

    const candidates = tracks
      .filter((t) => shouldSkipOfficialResolve(t))
      .slice(0, MAX_PREFETCH);
    if (candidates.length === 0) {
      doneRef.current = signature;
      return;
    }

    doneRef.current = signature;
    let cancelled = false;

    // 并发预取：fish 单首要 25s，串行的话第 2、3 首要等 50-75s 才轮到，
    // 用户点第 3 首时根本没预取到，还是干等。取链内部已是并发竞速，
    // 多首并行只是多几条网络请求，不会再拖垮 WebView（脚本 runtime 是共享的）。
    void Promise.all(
      candidates.map(async (track) => {
        const trackKey = buildUrlCacheKey(
          track.source,
          track.id,
          track.url_id,
          String(q)
        );
        if (useUrlCacheStore.getState().getEntry(trackKey)?.url) return;
        try {
          const { url } = await resolveTrackUrl(track, q);
          if (cancelled) return;
          if (url) {
            logger.info("useSearchUrlPrefetch", "VIP 曲直链预取完成", {
              trackId: track.id,
              source: track.source,
            });
          }
        } catch {
          // 预取失败无所谓，点歌时会正常重取
        }
      })
    );

    return () => {
      cancelled = true;
    };
  }, [tracks, quality]);
}
