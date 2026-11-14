import { musicApi } from "@/lib/music-api";
import type { MusicTrack } from "@/types/music";
import { useState, useEffect } from "react";
import { logger } from "@/lib/logger";

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

  useEffect(() => {
    if (!track?.pic_id || !enabled) {
      return;
    }

    let active = true;
    const { pic_id, source } = track;

    const fetchCover = async () => {
      try {
        // 传完整曲目：本地音源要靠歌名/歌手在线反查封面，只给路径查不到
        const url = await musicApi.getPic(pic_id, source, 800, track);
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
  }, [track, enabled]);

  // Derived state: if disabled or no track, return null.
  // If the current track doesn't match what we've loaded, return null (it's loading).
  if (
    !enabled ||
    !track?.pic_id ||
    track.pic_id !== state.picId ||
    track.source !== state.source
  ) {
    return null;
  }

  return state.url;
}
