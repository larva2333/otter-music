import { musicApi } from "@/lib/music-api";
import type { MusicTrack } from "@/types/music";
import { useState, useEffect } from "react";
import { logger } from "@/lib/logger";
import { forceHttps } from "@otter-music/shared";

const COVER_SIZE = 800;
const PREFETCHED_LIMIT = 60;
const prefetchedUrls = new Set<string>();

function markPrefetched(url: string) {
  prefetchedUrls.add(url);
  if (prefetchedUrls.size > PREFETCHED_LIMIT) {
    const oldest = prefetchedUrls.values().next().value;
    if (oldest !== undefined) prefetchedUrls.delete(oldest);
  }
}

/**
 * 静默预取指定曲目的封面 URL 并预下载/解码进浏览器图片缓存，
 * 消除切歌时「接口查链 + 图片网络下载」带来的视觉延迟。
 */
export async function prefetchTrackCover(
  track: MusicTrack | null | undefined
): Promise<void> {
  if (!track?.pic_id || typeof Image === "undefined") return;
  try {
    const raw =
      musicApi.getSyncPic(track.pic_id, track.source, COVER_SIZE) ??
      (await musicApi.getPic(track.pic_id, track.source, COVER_SIZE, track));
    const url = forceHttps(raw);
    if (!url || prefetchedUrls.has(url)) return;
    markPrefetched(url);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (typeof img.decode === "function") {
        void img.decode().catch(() => {});
      }
    };
    img.src = url;
  } catch {
    // 预加载静默失败，不影响主播放流程
  }
}

export function useMusicCover(
  track: MusicTrack | null | undefined,
  enabled: boolean = true
) {
  const [state, setState] = useState<{
    url: string | null;
    picId: string | undefined;
    source: string | undefined;
  }>({
    url: null,
    picId: undefined,
    source: undefined,
  });

  // 渲染期同步直出已知封面（HTTP 直链 / 会话内已缓存结果），避免先返回 null 闪出占位图
  const syncUrl =
    enabled && track?.pic_id
      ? musicApi.getSyncPic(track.pic_id, track.source, COVER_SIZE)
      : null;

  useEffect(() => {
    if (!track?.pic_id || !enabled || syncUrl !== null) {
      return;
    }

    let active = true;
    const { pic_id, source } = track;

    const fetchCover = async () => {
      try {
        // 传完整曲目：本地音源要靠歌名/歌手在线反查封面，只给路径查不到
        const url = await musicApi.getPic(pic_id, source, COVER_SIZE, track);
        if (active) {
          setState({ url, picId: pic_id, source });
        }
      } catch (e) {
        logger.error("useMusicCover", "Failed to fetch cover:", e);
        if (active) {
          setState({ url: null, picId: pic_id, source });
        }
      }
    };

    fetchCover();

    return () => {
      active = false;
    };
  }, [track, enabled, syncUrl]);

  if (!enabled || !track?.pic_id) {
    return null;
  }

  if (syncUrl !== null) {
    return syncUrl;
  }

  // 尚未异步解析完成时返回 null
  if (track.pic_id !== state.picId || track.source !== state.source) {
    return null;
  }

  return state.url;
}
