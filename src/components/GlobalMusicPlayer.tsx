"use client";

import { useRef, useEffect, useLayoutEffect } from "react";
import { useMusicStore } from "@/store/music-store";
import { prefetchTrackCover, useMusicCover } from "@/hooks/useMusicCover";
import { useAudioElement } from "@/hooks/useAudioElement";
import { useSeekHandler } from "@/hooks/useSeekHandler";
import { useAudioPlaybackControl } from "@/hooks/useAudioPlaybackControl";
import { useMediaSessionIntegration } from "@/hooks/useMediaSessionIntegration";
import { useAudioEventHandlers } from "@/hooks/useAudioEventHandlers";
import { useAudioTrackLoader } from "@/hooks/useAudioTrackLoader";
import { useAudioPreloader } from "@/hooks/useAudioPreloader";
import { useAudioRouteSafety } from "@/hooks/useAudioRouteSafety";
import { useCarLyric } from "@/hooks/useCarLyric";
import { useDesktopLyric } from "@/hooks/useDesktopLyric";

/** 延后预取相邻曲目封面，避开切歌瞬间 600ms 唱臂/滑入动画窗口 */
const COVER_PREFETCH_DELAY_MS = 750;

export function GlobalMusicPlayer() {
  const audioRef = useAudioElement();
  const queue = useMusicStore((s) => s.queue);
  const currentIndex = useMusicStore((s) => s.currentIndex);
  const currentTrack = queue[currentIndex];
  const setCoverUrl = useMusicStore((s) => s.setCoverUrl);
  const coverUrl = useMusicCover(currentTrack);

  // 用 useLayoutEffect 在浏览器绘制前同步刷新 store，避免切歌首帧残留上一首封面或闪出占位图
  useLayoutEffect(() => {
    setCoverUrl(coverUrl);
  }, [coverUrl, setCoverUrl]);

  // 切歌动画完成后静默预热上一首与下一首封面，下一次左右滑动或点切歌直接命中缓存
  useEffect(() => {
    if (
      queue.length <= 1 ||
      typeof navigator === "undefined" ||
      !navigator.onLine
    ) {
      return;
    }
    const nextTrack = queue[(currentIndex + 1) % queue.length];
    const prevTrack = queue[(currentIndex - 1 + queue.length) % queue.length];
    const timer = setTimeout(() => {
      void prefetchTrackCover(nextTrack);
      if (prevTrack && prevTrack.id !== nextTrack?.id) {
        void prefetchTrackCover(prevTrack);
      }
    }, COVER_PREFETCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [currentTrack?.id, currentIndex, queue]);

  const isSwitchingTrackRef = useRef(false);
  const hasRecordedRef = useRef(false);

  useSeekHandler(audioRef);
  useAudioTrackLoader(audioRef, isSwitchingTrackRef, hasRecordedRef);
  useAudioPlaybackControl(audioRef, isSwitchingTrackRef);
  useAudioEventHandlers(audioRef, isSwitchingTrackRef, hasRecordedRef);
  useAudioRouteSafety(audioRef);
  useMediaSessionIntegration(audioRef, coverUrl);
  useCarLyric();
  useDesktopLyric();
  useAudioPreloader(audioRef);

  return (
    <audio ref={audioRef} className="sr-only" preload="auto" playsInline />
  );
}
