"use client";

import { ListVideo, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useMusicStore } from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import { useCoverColors } from "@/hooks/useCoverColors";
import { cn } from "@/lib/utils";
import { PlayerQueueDrawer } from "./PlayerQueueDrawer";
import { confirmDialog } from "./ui/confirm-dialog";
import { MusicCover } from "./MusicCover";
import { AudioOriginLabel } from "./AudioOriginLabel";
import { VinylCover } from "./VinylCover";
import { Marquee } from "./ui/marquee";
import { KaraokeText } from "./KaraokeText";
import { musicApi } from "@/lib/music-api";
import { findActiveLyricIndex, parseLrc, type LyricLine } from "@/lib/lyrics";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import type { MusicTrack } from "@/types/music";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { t2s, t2sArtists } from "@/lib/utils/t2s";
import { formatMediaTime } from "@/lib/utils/music";
import {
  labToSrgb,
  srgbToLab,
  type RGB,
  type SodaColors,
} from "@/lib/utils/soda-color";

const AUTO_HIDE_CONTROLS_MS = 3000;
const SWIPE_THRESHOLD_PX = 8;
const SWIPE_UP_OPEN_THRESHOLD_PX = 28;

interface BottomProgressPalette {
  trackBg: string;
  fillBg: string;
  thumbBg: string;
  thumbShadow: string;
}

function rgbCss([r, g, b]: RGB): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function rgbaCss([r, g, b]: RGB, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 播放条单行歌词展示器：
 * - 一句歌词只展示一遍，不循环滚动、也不拼接下一句；
 * - 超出可用宽度时，随本句唱词进度从 0 平滑滚到末尾；
 * - 切到下一句立即回到起点从头展示。
 */
function LyricLineScroller({
  line,
  nextLineTime,
  duration,
  lyricOffset,
  playing,
  controlsVisible,
  isDragging,
  lightTint,
  tinted,
}: {
  line: LyricLine;
  nextLineTime: number | null;
  duration: number;
  lyricOffset: number;
  playing: boolean;
  controlsVisible: boolean;
  isDragging: boolean;
  lightTint: boolean;
  tinted: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);

  // 计算本句结束时间：优先取逐字末字时间，其次取下一句开始时间，最后兜底 5s
  const wordEndTime =
    line.words && line.words.length > 0
      ? line.time + line.words[line.words.length - 1].end / 1000
      : null;
  const lineEndTime =
    nextLineTime !== null
      ? nextLineTime
      : duration > line.time
        ? duration
        : line.time + 5;
  const effectiveEnd = Math.max(
    line.time + 0.5,
    wordEndTime !== null
      ? Math.min(lineEndTime, wordEndTime)
      : Math.min(lineEndTime, line.time + 8)
  );

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content) content.style.transform = "translate3d(0px, 0, 0)";

    const measure = () => {
      const containerW =
        containerRef.current?.getBoundingClientRect().width ?? 0;
      const contentW = contentRef.current?.getBoundingClientRect().width ?? 0;
      const diff = containerW > 0 ? contentW - containerW : 0;
      setOverflowPx(diff > 1 ? diff : 0);
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [line]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const audio = document.querySelector("audio");
    const current =
      audio?.currentTime ?? useMusicStore.getState().currentAudioTime;
    const span = Math.max(0.5, effectiveEnd - line.time);
    const startScrollTime = line.time + lyricOffset + span * 0.15;
    const endScrollTime = line.time + lyricOffset + span * 0.85;
    const scrollDuration = Math.max(0.2, endScrollTime - startScrollTime);

    const setImmediateOffset = (x: number) => {
      content.style.transition = "none";
      content.style.transform = `translate3d(${-x}px, 0, 0)`;
    };

    if (overflowPx <= 0) {
      setImmediateOffset(0);
      return;
    }

    if (!playing || controlsVisible || isDragging) {
      const ratio = Math.min(
        1,
        Math.max(0, (current - startScrollTime) / scrollDuration)
      );
      setImmediateOffset(overflowPx * ratio);
      return;
    }

    if (current >= endScrollTime) {
      setImmediateOffset(overflowPx);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let raf = 0;

    if (current < startScrollTime) {
      setImmediateOffset(0);
      const delayMs = Math.max(0, (startScrollTime - current) * 1000);
      timer = setTimeout(() => {
        timer = null;
        content.style.transition = `transform ${scrollDuration}s linear`;
        content.style.transform = `translate3d(${-overflowPx}px, 0, 0)`;
      }, delayMs);
    } else {
      const ratio = Math.min(
        1,
        Math.max(0, (current - startScrollTime) / scrollDuration)
      );
      const remainingSec = Math.max(0.1, endScrollTime - current);
      setImmediateOffset(overflowPx * ratio);
      raf = requestAnimationFrame(() => {
        raf = 0;
        content.style.transition = `transform ${remainingSec}s linear`;
        content.style.transform = `translate3d(${-overflowPx}px, 0, 0)`;
      });
    }

    return () => {
      if (timer !== null) clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [
    overflowPx,
    playing,
    controlsVisible,
    isDragging,
    effectiveEnd,
    line.time,
    lyricOffset,
  ]);

  return (
    <div
      ref={containerRef}
      data-testid="now-playing-lyric"
      className={cn(
        "relative flex-1 min-w-0 overflow-hidden whitespace-nowrap select-none",
        overflowPx > 0 &&
          "[-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_6px,black_calc(100%-12px),transparent_100%)] [mask-image:linear-gradient(to_right,transparent_0%,black_6px,black_calc(100%-12px),transparent_100%)]"
      )}
    >
      <div
        ref={contentRef}
        data-testid="now-playing-lyric-track"
        className="inline-flex items-baseline whitespace-nowrap will-change-transform"
      >
        {line.words && line.words.length > 0 ? (
          <KaraokeText
            as="span"
            singleLine
            words={line.words}
            lineTime={line.time}
            lyricOffset={lyricOffset}
            enabled={playing && !controlsVisible && !isDragging}
            className="text-sm font-medium whitespace-nowrap"
            dimClassName={
              lightTint
                ? "text-foreground/40"
                : tinted
                  ? "text-white/40"
                  : "text-muted-foreground/70"
            }
            activeClassName={
              tinted && !lightTint ? "text-white" : "text-foreground"
            }
          />
        ) : (
          <span
            className={cn(
              "font-medium transition-colors duration-300 text-sm",
              tinted && !lightTint ? "text-white" : "text-foreground"
            )}
          >
            {t2s(line.text)}
          </span>
        )}
      </div>
    </div>
  );
}

/** 统一绑定触摸/鼠标全局拖拽监听，返回解绑函数 */
function bindGlobalDragListeners(
  isTouch: boolean,
  onMove: (clientX: number, clientY: number, e: Event) => void,
  onEnd: () => void
): () => void {
  if (isTouch) {
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY, e);
    };
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }
  const onMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY, e);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onEnd);
  return () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onEnd);
  };
}

/**
 * 底部进度条配色：兼顾「与底色反差明显」和「融入封面/主题不突兀」。
 * - 深色有彩封面：取封面色相，抬高明度至清晰亮色（L=80）配高亮同系圆球；
 * - 浅色有彩封面：取封面色相，压深至浓郁深色（L=24）配深色圆球，保持强烈反差；
 * - 无彩色封面 / 未开启封面背景：采用高反差中性前景（浅底墨黑 / 深底亮银），与播放按钮同系。
 */
function buildBottomProgressPalette(
  colors: SodaColors | null,
  lightTint: boolean,
  tinted: boolean,
  isDarkTheme: boolean
): BottomProgressPalette {
  let hue: [number, number] | null = null;
  if (tinted && colors) {
    const domLab = srgbToLab(colors.dominant);
    if (Math.hypot(domLab[1], domLab[2]) >= 8) {
      hue = [domLab[1], domLab[2]];
    } else {
      const topLab = srgbToLab(colors.top);
      // 浅色模式下经过 8-bit RGB 量化后的 LIGHT_MIN_CHROMA=10 可能落在 9~10 之间，阈值放宽到 6
      if (Math.hypot(topLab[1], topLab[2]) >= 6) {
        hue = [topLab[1], topLab[2]];
      }
    }
  }

  if (lightTint) {
    const trackBg = "rgba(23, 34, 43, 0.16)";
    if (hue) {
      const angle = Math.atan2(hue[1], hue[0]);
      // 浅底使用中等明度 L=46 + 更高色度，避免 L=24 发黑看不出封面色调，同时保持高反差
      const c = Math.min(60, Math.max(42, Math.hypot(hue[0], hue[1]) * 1.35));
      const fillRgb = labToSrgb([46, c * Math.cos(angle), c * Math.sin(angle)]);
      const thumbRgb = labToSrgb([
        38,
        c * 0.9 * Math.cos(angle),
        c * 0.9 * Math.sin(angle),
      ]);
      return {
        trackBg,
        fillBg: rgbCss(fillRgb),
        thumbBg: rgbCss(thumbRgb),
        thumbShadow: `0 0 6px ${rgbaCss(fillRgb, 0.45)}`,
      };
    }
    return {
      trackBg,
      fillBg: "#17222b",
      thumbBg: "#0f172a",
      thumbShadow: "0 0 6px rgba(23, 34, 43, 0.45)",
    };
  }

  if (tinted) {
    const trackBg = "rgba(255, 255, 255, 0.24)";
    if (hue) {
      const angle = Math.atan2(hue[1], hue[0]);
      const c = Math.min(54, Math.max(34, Math.hypot(hue[0], hue[1]) * 1.15));
      const fillRgb = labToSrgb([80, c * Math.cos(angle), c * Math.sin(angle)]);
      const thumbC = Math.min(26, c * 0.45);
      const thumbRgb = labToSrgb([
        91,
        thumbC * Math.cos(angle),
        thumbC * Math.sin(angle),
      ]);
      return {
        trackBg,
        fillBg: rgbCss(fillRgb),
        thumbBg: rgbCss(thumbRgb),
        thumbShadow: `0 0 7px ${rgbaCss(fillRgb, 0.7)}`,
      };
    }
    return {
      trackBg,
      fillBg: "#e2e8f0",
      thumbBg: "#ffffff",
      thumbShadow: "0 0 6px rgba(255, 255, 255, 0.65)",
    };
  }

  if (isDarkTheme) {
    return {
      trackBg: "rgba(255, 255, 255, 0.24)",
      fillBg: "#e2e8f0",
      thumbBg: "#ffffff",
      thumbShadow: "0 0 6px rgba(255, 255, 255, 0.65)",
    };
  }

  return {
    trackBg: "rgba(23, 34, 43, 0.16)",
    fillBg: "#17222b",
    thumbBg: "#0f172a",
    thumbShadow: "0 0 6px rgba(23, 34, 43, 0.45)",
  };
}

interface MusicNowPlayingBarProps {
  onOpenFullScreen?: () => void;
}

/**
 * 全站唯一的迷你播放条：固定胶囊形态（不随页面放大）。
 *
 * 历史上有 isTab 分支——非 tab 页会渲染成全宽底栏（更大的封面、更高的内边距）。
 * 进入歌单/专辑等二级页时突然"放大 + 下移"的观感就是它造成的，已移除。
 * 需要改高度/尺寸时只改这里，布局位置由 MusicLayout 负责。
 */
export function MusicNowPlayingBar({
  onOpenFullScreen,
}: MusicNowPlayingBarProps) {
  const {
    isPlaying,
    currentAudioTime,
    duration,
    isShuffle,
    queue,
    currentIndex,
    coverUrl,
    togglePlay,
    seek,
    setCurrentIndexAndPlay,
    skipToNext,
    skipToPrevious,
    clearQueue,
    reshuffle,
    removeFromQueue,
    playTrackAsNext,
    coverStyle,
    vinylColor,
    showBarBackground,
    lightThemeLightBackground,
    lyricOffset,
  } = useMusicStore(
    useShallow((state) => ({
      isPlaying: state.isPlaying,
      currentAudioTime: state.currentAudioTime,
      duration: state.duration,
      isShuffle: state.isShuffle,
      queue: state.queue,
      currentIndex: state.currentIndex,
      coverUrl: state.coverUrl,
      togglePlay: state.togglePlay,
      seek: state.seek,
      setCurrentIndexAndPlay: state.setCurrentIndexAndPlay,
      skipToNext: state.skipToNext,
      skipToPrevious: state.skipToPrevious,
      clearQueue: state.clearQueue,
      reshuffle: state.reshuffle,
      removeFromQueue: state.removeFromQueue,
      playTrackAsNext: state.playTrackAsNext,
      coverStyle: state.coverStyle,
      vinylColor: state.vinylColor,
      showBarBackground: state.showBarBackground,
      lightThemeLightBackground: state.lightThemeLightBackground,
      lyricOffset: state.lyricOffset,
    }))
  );

  const [controlsVisible, setControlsVisible] = useState(false);
  const controlsVisibleRef = useRef(controlsVisible);
  useEffect(() => {
    controlsVisibleRef.current = controlsVisible;
  }, [controlsVisible]);
  const barRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleAutoHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setControlsVisible(false);
    }, AUTO_HIDE_CONTROLS_MS);
  }, [clearHideTimer]);

  // 展开控制按钮后，3 秒内无任何操作自动收起恢复原状；同时点外部立即收起
  useEffect(() => {
    if (!controlsVisible) {
      clearHideTimer();
      return;
    }
    scheduleAutoHide();
    const handlePointerDown = (e: PointerEvent) => {
      if (barRef.current?.contains(e.target as Node)) return;
      setControlsVisible(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      clearHideTimer();
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [controlsVisible, scheduleAutoHide, clearHideTimer]);

  const currentTrack = queue[currentIndex] || null;

  // 胶囊背景取封面主色：深色主题压到深色区间（白字可读），
  // 浅色主题抬到高明度区间（浅底深字），两种主题都保留封面色相。
  // 取色失败时回退卡片底色。
  const isDarkTheme = useIsDarkTheme();
  const isLightTheme = !isDarkTheme;
  // 浅色主题是否走浅色取色由设置决定；关闭背景开关时干脆不取色（省一次图片解码）
  const useLightColors = isLightTheme && lightThemeLightBackground;
  const { colors } = useCoverColors(
    showBarBackground ? coverUrl : null,
    useLightColors ? "light" : "dark"
  );
  const tinted = showBarBackground && !!colors;
  const [r1, g1, b1] = colors?.top ?? [0, 0, 0];
  const [r2, g2, b2] = colors?.bottom ?? [0, 0, 0];
  // 文字明暗只看取到的背景本身：切换主题的那一拍可能还沿用上一模式的颜色，
  // 按背景亮度选黑白，任何时候都不会出现白字浅底。
  const lightTint = tinted && 0.299 * r1 + 0.587 * g1 + 0.114 * b1 > 150;
  const barStyle = tinted
    ? {
        backgroundImage: `linear-gradient(to right, rgb(${r1}, ${g1}, ${b1}) 0%, rgb(${r2}, ${g2}, ${b2}) 100%)`,
        // 渐变的 origin 默认是 padding-box 而 clip 是 border-box：平铺会把右端深色折到左边 1px 边框、左端亮色折到右边 1px 边框。
        backgroundOrigin: "border-box",
      }
    : undefined;
  const progressPalette = useMemo(
    () =>
      buildBottomProgressPalette(
        colors ?? null,
        lightTint,
        tinted,
        isDarkTheme
      ),
    [colors, lightTint, tinted, isDarkTheme]
  );

  const playTrack = useCallback(
    (index: number) => {
      setCurrentIndexAndPlay(index);
    },
    [setCurrentIndexAndPlay]
  );

  const handleClearQueue = async () => {
    if (
      await confirmDialog({
        title: "确定要清空播放列表吗？",
        destructive: true,
        confirmText: "清空",
      })
    ) {
      clearQueue();
      toast.success("播放列表已清空");
    }
  };

  const handleRemoveFromQueue = useCallback(
    (track: MusicTrack) => {
      removeFromQueue(track.id);
    },
    [removeFromQueue]
  );

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime =
    Number.isFinite(currentAudioTime) && currentAudioTime > 0
      ? Math.min(currentAudioTime, safeDuration || currentAudioTime)
      : 0;

  // 播放条任意位置左右滑动进度
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const dragTimeRef = useRef(0);
  const didSwipeRef = useRef(false);
  const lastTouchTimeRef = useRef(0);
  const swipeResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayTime = isDragging ? dragTime : safeCurrentTime;
  const progress =
    safeDuration > 0
      ? Math.min(100, Math.max(0, (displayTime / safeDuration) * 100))
      : 0;

  // 播放条歌词：切歌时拉取（musicApi.getLyric 自带缓存），播放中 10fps 检查换行
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [rafLyricIndex, setRafLyricIndex] = useState(-1);
  const rafLyricIndexRef = useRef(-1);

  const trackId = currentTrack?.id ?? null;
  const lyricId = currentTrack?.lyric_id ?? null;
  const lyricSource = currentTrack?.source ?? null;

  useEffect(() => {
    setLyricLines([]);
    rafLyricIndexRef.current = -1;
    setRafLyricIndex(-1);

    if (!currentTrack || !lyricId || !lyricSource) return;
    let cancelled = false;

    musicApi
      .getLyric(lyricId, lyricSource, currentTrack)
      .then((res) => {
        if (cancelled) return;
        const parsed = res ? parseLrc(res.lyric, res.tlyric) : [];
        setLyricLines(parsed);
        if (parsed.length > 0) {
          const audio = document.querySelector("audio");
          const current =
            audio?.currentTime ?? useMusicStore.getState().currentAudioTime;
          const idx = findActiveLyricIndex(parsed, current, lyricOffset);
          rafLyricIndexRef.current = idx;
          setRafLyricIndex(idx);
        }
      })
      .catch(() => {
        if (!cancelled) setLyricLines([]);
      });

    return () => {
      cancelled = true;
    };
    // 仅按歌曲标识与歌词源拉取，避免对象引用变动重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, lyricId, lyricSource]);

  useEffect(() => {
    if (!isPlaying || lyricLines.length === 0) return;

    const audio = document.querySelector("audio");
    let raf = 0;
    let last = 0;

    const syncIndex = () => {
      const current =
        audio?.currentTime ?? useMusicStore.getState().currentAudioTime;
      const next = findActiveLyricIndex(lyricLines, current, lyricOffset);
      if (next !== rafLyricIndexRef.current) {
        rafLyricIndexRef.current = next;
        setRafLyricIndex(next);
      }
    };

    syncIndex();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 100) return;
      last = now;
      syncIndex();
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, lyricLines, lyricOffset]);

  const activeLyricIndex =
    isPlaying && lyricLines.length > 0
      ? isDragging
        ? findActiveLyricIndex(lyricLines, displayTime, lyricOffset)
        : rafLyricIndex
      : -1;
  const activeLyricLine =
    activeLyricIndex >= 0 ? (lyricLines[activeLyricIndex] ?? null) : null;
  const nextLyricTime =
    activeLyricIndex >= 0 && activeLyricIndex + 1 < lyricLines.length
      ? lyricLines[activeLyricIndex + 1].time
      : null;
  const showLyric = isPlaying && activeLyricLine !== null;

  const progressTrackRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressThumbRef = useRef<HTMLDivElement>(null);
  const prevProgressSnapRef = useRef<{ trackId?: string; progress: number }>({
    trackId: undefined,
    progress: 0,
  });

  // timeupdate 每 1000ms 节流推送一次：正常递增时切 1000ms 线性过渡衔接；拖动或切歌则即刻响应
  useLayoutEffect(() => {
    const prev = prevProgressSnapRef.current;
    const smooth =
      !isDragging &&
      isPlaying &&
      prev.trackId === currentTrack?.id &&
      progress >= prev.progress &&
      progress - prev.progress <= 5;
    const dur = isDragging ? "0ms" : smooth ? "1000ms" : "200ms";
    const timing = smooth ? "linear" : "ease-out";

    for (const el of [progressFillRef.current, progressThumbRef.current]) {
      if (!el) continue;
      el.style.transitionDuration = dur;
      el.style.transitionTimingFunction = timing;
    }

    prevProgressSnapRef.current = {
      trackId: currentTrack?.id,
      progress,
    };
  }, [currentTrack?.id, isDragging, isPlaying, progress]);

  useEffect(() => {
    return () => {
      if (swipeResetTimerRef.current !== null) {
        clearTimeout(swipeResetTimerRef.current);
      }
    };
  }, []);

  const clearSwipeFlag = useCallback(() => {
    didSwipeRef.current = false;
    if (swipeResetTimerRef.current !== null) {
      clearTimeout(swipeResetTimerRef.current);
      swipeResetTimerRef.current = null;
    }
  }, []);

  const armSwipeClickSuppression = useCallback(() => {
    didSwipeRef.current = true;
    if (swipeResetTimerRef.current !== null) {
      clearTimeout(swipeResetTimerRef.current);
    }
    // 兜底：部分环境下抬手后不一定派发 click，避免标志残留吞掉下一次点击
    swipeResetTimerRef.current = setTimeout(() => {
      didSwipeRef.current = false;
      swipeResetTimerRef.current = null;
    }, 120);
  }, []);

  const updateProgressByDelta = useCallback(
    (
      startX: number,
      startTime: number,
      clientX: number,
      trackWidth: number
    ) => {
      if (trackWidth <= 0) return;
      const deltaRatio = (clientX - startX) / trackWidth;
      const nextTime = Math.min(
        safeDuration,
        Math.max(0, startTime + deltaRatio * safeDuration)
      );
      setDragTime(nextTime);
      dragTimeRef.current = nextTime;
    },
    [safeDuration]
  );

  const beginSwipeTracking = useCallback(
    (startX: number, startY: number, isTouch: boolean) => {
      if (isTouch) {
        lastTouchTimeRef.current = Date.now();
        clearSwipeFlag();
      } else {
        // 屏蔽 touchend 后 WebView 补发的兼容 mousedown
        if (Date.now() - lastTouchTimeRef.current < 400) return;
        clearSwipeFlag();
      }
      const startTime = safeCurrentTime;
      let dragging = false;
      let openedFullScreen = false;
      let cleanup = () => {};

      const onMove = (clientX: number, clientY: number, e: Event) => {
        if (openedFullScreen) return;
        const dx = clientX - startX;
        const dy = clientY - startY;

        if (!dragging) {
          // 纵向明显上滑：直接拉起全屏播放页
          if (
            dy <= -SWIPE_UP_OPEN_THRESHOLD_PX &&
            Math.abs(dy) > Math.abs(dx) * 1.2
          ) {
            openedFullScreen = true;
            didSwipeRef.current = true;
            if (e.cancelable) e.preventDefault();
            clearHideTimer();
            setControlsVisible(false);
            onOpenFullScreen?.();
            cleanup();
            armSwipeClickSuppression();
            return;
          }

          // 不因轻微纵向抖动提前注销监听，只要横向位移达标即可进入拖拽进度
          if (
            safeDuration <= 0 ||
            Math.abs(dx) < SWIPE_THRESHOLD_PX ||
            Math.abs(dx) < Math.abs(dy) * 0.75
          ) {
            return;
          }
          dragging = true;
          didSwipeRef.current = true;
          clearHideTimer();
          setIsDragging(true);
        }

        if (e.cancelable) e.preventDefault();
        const barWidth = barRef.current?.getBoundingClientRect().width || 0;
        updateProgressByDelta(startX, startTime, clientX, barWidth);
      };

      const onEnd = () => {
        if (isTouch) lastTouchTimeRef.current = Date.now();
        cleanup();
        if (!dragging) return;
        setIsDragging(false);
        seek(dragTimeRef.current);
        if (controlsVisibleRef.current) scheduleAutoHide();
        armSwipeClickSuppression();
      };

      cleanup = bindGlobalDragListeners(isTouch, onMove, onEnd);
    },
    [
      armSwipeClickSuppression,
      clearHideTimer,
      clearSwipeFlag,
      onOpenFullScreen,
      safeCurrentTime,
      safeDuration,
      scheduleAutoHide,
      seek,
      updateProgressByDelta,
    ]
  );

  // 按住进度条头部圆球直接进入拖拽：取消 8px 门槛、暂停自动收起，且绝不触发播放条单击隐藏
  const beginThumbDrag = useCallback(
    (startX: number, isTouch: boolean) => {
      if (isTouch) {
        lastTouchTimeRef.current = Date.now();
      } else if (Date.now() - lastTouchTimeRef.current < 400) {
        return;
      }
      clearHideTimer();
      clearSwipeFlag();
      didSwipeRef.current = true;
      if (safeDuration <= 0) {
        armSwipeClickSuppression();
        return;
      }

      const startTime = safeCurrentTime;
      let moved = false;
      dragTimeRef.current = startTime;
      setDragTime(startTime);
      setIsDragging(true);

      let cleanup = () => {};
      const onMove = (clientX: number, _clientY: number, e: Event) => {
        if (e.cancelable) e.preventDefault();
        if (Math.abs(clientX - startX) >= 1) moved = true;
        const trackWidth =
          progressTrackRef.current?.getBoundingClientRect().width ||
          barRef.current?.getBoundingClientRect().width ||
          0;
        updateProgressByDelta(startX, startTime, clientX, trackWidth);
      };

      const onEnd = () => {
        if (isTouch) lastTouchTimeRef.current = Date.now();
        cleanup();
        setIsDragging(false);
        if (moved) seek(dragTimeRef.current);
        if (controlsVisibleRef.current) scheduleAutoHide();
        armSwipeClickSuppression();
      };

      cleanup = bindGlobalDragListeners(isTouch, onMove, onEnd);
    },
    [
      armSwipeClickSuppression,
      clearHideTimer,
      clearSwipeFlag,
      safeCurrentTime,
      safeDuration,
      scheduleAutoHide,
      seek,
      updateProgressByDelta,
    ]
  );

  const timeText = `${formatMediaTime(displayTime)}/${formatMediaTime(safeDuration)}`;
  const useLightPlayButton = lightTint || (!tinted && !isDarkTheme);

  const handleOpenPlayer = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setControlsVisible(false);
      onOpenFullScreen?.();
    },
    [onOpenFullScreen]
  );

  if (!currentTrack) {
    return null; // 使用 null 替代 undefined 更符合 React 规范
  }

  const progressExpanded = controlsVisible || isDragging;

  // 抽屉内容和列表按钮在 React 树里是 bar 的后代，触摸会冒泡到这里。
  // 只按 target 判断来源、跳过手势跟踪，绝不能用 stopPropagation ——
  // 那会截断事件到 document 的原生冒泡，让 VAUL Drawer 的拖拽/滚动手势失效。
  const isFromQueueDrawer = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest("[data-player-queue-drawer], [data-queue-drawer-zone]");

  return (
    <div className="px-3 touch-none">
      <div
        ref={barRef}
        data-now-playing-bar=""
        onClickCapture={(e) => {
          if (didSwipeRef.current) {
            e.stopPropagation();
            e.preventDefault();
            clearSwipeFlag();
          }
        }}
        onClick={() => setControlsVisible((prev) => !prev)}
        onMouseDown={(e) => {
          if (isFromQueueDrawer(e.target)) return;
          beginSwipeTracking(e.clientX, e.clientY, false);
        }}
        onTouchStart={(e) => {
          if (isFromQueueDrawer(e.target)) return;
          if (e.touches[0]) {
            beginSwipeTracking(
              e.touches[0].clientX,
              e.touches[0].clientY,
              true
            );
          }
        }}
        // 胶囊必须是实色：半透明 / 磨砂会让滚动内容透上来，滑动时忽明忽暗
        className={cn(
          "relative flex items-center transition-all duration-300 gap-2 px-2 py-1.5 rounded-full border border-transparent shadow-[0_2px_10px_rgba(15,46,66,0.10)] cursor-pointer select-none touch-none",
          lightTint
            ? "border-black/5"
            : tinted
              ? "border-white/10"
              : "bg-card dark:border-white/10"
        )}
        style={barStyle}
      >
        {/* 左侧封面 / 唱片：单击直接进入全屏播放页 */}
        <button
          type="button"
          onClick={handleOpenPlayer}
          aria-label="打开播放页"
          className={cn(
            "relative z-10 shrink-0 overflow-hidden transition-all duration-300 focus:outline-none cursor-pointer",
            coverStyle === "vinyl"
              ? "rounded-full h-9 w-9"
              : "rounded-md shadow-sm h-8 w-8"
          )}
        >
          {coverStyle === "vinyl" ? (
            <VinylCover
              src={coverUrl}
              alt={currentTrack.name}
              isPlaying={isPlaying}
              className="h-full w-full"
              iconClassName="h-3.5 w-3.5"
              discColor={vinylColor}
              showTonearm={false}
            />
          ) : (
            <MusicCover
              src={coverUrl}
              alt={currentTrack.name}
              className="w-full h-full"
              iconClassName="h-4 w-4"
            />
          )}
        </button>

        {/* 中间区：默认态信息层与展开态按钮层叠加，切换时交叉淡入淡出 */}
        <div className="relative z-10 flex-1 min-w-0 h-9 flex items-center overflow-hidden">
          <div
            aria-hidden={controlsVisible}
            data-testid="now-playing-info"
            className={cn(
              "absolute inset-0 flex items-center min-w-0 gap-1.5 ml-0.5 transition-opacity duration-200 ease-out",
              controlsVisible ? "opacity-0 pointer-events-none" : "opacity-100"
            )}
          >
            {showLyric ? (
              <LyricLineScroller
                line={activeLyricLine}
                nextLineTime={nextLyricTime}
                duration={safeDuration}
                lyricOffset={lyricOffset}
                playing={isPlaying}
                controlsVisible={controlsVisible}
                isDragging={isDragging}
                lightTint={lightTint}
                tinted={tinted}
              />
            ) : (
              <>
                <Marquee
                  className="flex-1 min-w-0"
                  speed={28}
                  gap={32}
                  pauseOnHover={false}
                  play={!controlsVisible}
                  fadeEdges
                  resetKey={`${currentTrack.id}:${currentTrack.name}:${currentTrack.artist.join(",")}`}
                >
                  <span
                    className={cn(
                      "font-medium transition-colors duration-300 text-sm",
                      tinted && !lightTint ? "text-white" : "text-foreground"
                    )}
                  >
                    {t2s(currentTrack.name)}
                  </span>
                  <span
                    className={cn(
                      "ml-1.5 transition-colors duration-300 text-xs",
                      lightTint
                        ? "text-foreground/60"
                        : tinted
                          ? "text-white/70"
                          : "text-muted-foreground"
                    )}
                  >
                    - {t2sArtists(currentTrack.artist).join(", ")}
                  </span>
                </Marquee>
                <AudioOriginLabel
                  className={cn(
                    "shrink-0 text-xs transition-colors duration-300",
                    lightTint
                      ? "text-foreground/50"
                      : tinted
                        ? "text-white/55"
                        : "text-muted-foreground/80"
                  )}
                />
                <span
                  data-testid="now-playing-time"
                  className={cn(
                    "shrink-0 text-xs tabular-nums transition-colors duration-300",
                    lightTint
                      ? "text-foreground/55"
                      : tinted
                        ? "text-white/65"
                        : "text-muted-foreground/85"
                  )}
                >
                  {timeText}
                </span>
              </>
            )}
          </div>

          <div
            aria-hidden={!controlsVisible}
            data-testid="now-playing-controls"
            className={cn(
              "absolute inset-0 flex items-center justify-center gap-5 transition-opacity duration-200 ease-out",
              controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
          >
            <button
              type="button"
              disabled={!controlsVisible}
              tabIndex={controlsVisible ? 0 : -1}
              className={cn(
                "p-1.5 transition-colors focus:outline-none",
                lightTint
                  ? "text-foreground/70 hover:text-foreground"
                  : tinted
                    ? "text-white/80 hover:text-white"
                    : "text-muted-foreground hover:text-foreground"
              )}
              onClick={(e) => {
                e.stopPropagation();
                scheduleAutoHide();
                skipToPrevious();
              }}
              aria-label="上一首"
            >
              <SkipBack
                className="h-4 w-4 transition-all duration-300"
                fill="currentColor"
              />
            </button>

            {/* 实心圆形播放/暂停按钮：与全屏播放页保持一致 */}
            <button
              type="button"
              disabled={!controlsVisible}
              tabIndex={controlsVisible ? 0 : -1}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95 focus:outline-none",
                useLightPlayButton
                  ? "player-play-btn-light"
                  : "bg-white text-black shadow-md"
              )}
              onClick={(e) => {
                e.stopPropagation();
                scheduleAutoHide();
                togglePlay();
              }}
              aria-label={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? (
                <Pause className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
              )}
            </button>

            <button
              type="button"
              disabled={!controlsVisible}
              tabIndex={controlsVisible ? 0 : -1}
              className={cn(
                "p-1.5 transition-colors focus:outline-none",
                lightTint
                  ? "text-foreground/70 hover:text-foreground"
                  : tinted
                    ? "text-white/80 hover:text-white"
                    : "text-muted-foreground hover:text-foreground"
              )}
              onClick={(e) => {
                e.stopPropagation();
                scheduleAutoHide();
                skipToNext();
              }}
              aria-label="下一首"
            >
              <SkipForward
                className="h-4 w-4 transition-all duration-300"
                fill="currentColor"
              />
            </button>
          </div>
        </div>

        {/* 隔离列表按钮与抽屉 Portal 的 React 冒泡：
            - click 冒泡会触发胶囊的展开/收起切换，这里拦掉；
            - touchstart/mousedown 不能拦（会截断事件到 document 的原生冒泡，
              让 VAUL Drawer 拖拽/滚动失效），改由 bar 手势入口按 target 标记跳过。
            DrawerPortal 虽挂到 body，但在 React 树里仍是本 div 的后代。 */}
        <div
          data-queue-drawer-zone=""
          className="relative z-10 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <PlayerQueueDrawer
            queue={queue}
            currentIndex={currentIndex}
            isPlaying={isPlaying}
            isShuffle={isShuffle}
            onPlay={playTrack}
            onClear={handleClearQueue}
            onReshuffle={reshuffle}
            onRemove={handleRemoveFromQueue}
            onPlayTrack={playTrackAsNext}
            onOpenChange={(open) => {
              if (open) setControlsVisible(false);
            }}
            trigger={
              <button
                type="button"
                className={cn(
                  "transition-all shrink-0 focus:outline-none p-1.5",
                  lightTint
                    ? "text-foreground/60 hover:text-foreground"
                    : tinted
                      ? "text-white/70 hover:text-white"
                      : "text-muted-foreground hover:text-foreground"
                )}
                aria-label="播放列表"
              >
                <ListVideo className="transition-all duration-300 h-4 w-4" />
              </button>
            }
          />
        </div>

        {/* 跨骑在胶囊底边框正中（bottom-[-0.5px] translate-y-1/2，inset-x-6 避开左右 24px 半圆弧）的进度条：
            - 轨道本身无单击事件；
            - 平常为 1px 细线与底边框重合，不显示头部圆球；展开控制按钮或滑动时进度条变粗且显现圆球；
            - 展开后按住头部圆球可直接拖拽进度，不触发播放条单击隐藏。 */}
        <div
          aria-hidden
          data-testid="now-playing-progress-slider"
          className="pointer-events-none absolute inset-x-6 -bottom-[0.5px] translate-y-1/2 z-20 flex items-center select-none"
        >
          <div
            ref={progressTrackRef}
            data-testid="now-playing-progress-track"
            className={cn(
              "relative w-full transition-[height] duration-200 ease-out",
              progressExpanded ? "h-[2px]" : "h-[1px]"
            )}
          >
            <div
              className="h-full w-full rounded-full overflow-hidden"
              style={{ backgroundColor: progressPalette.trackBg }}
            >
              <div
                ref={progressFillRef}
                data-testid="now-playing-progress"
                className="h-full w-full origin-left rounded-full will-change-transform transition-transform duration-200 ease-out"
                style={{
                  backgroundColor: progressPalette.fillBg,
                  transform: `scaleX(${progress / 100})`,
                }}
              />
            </div>

            {/* 进度头部小圆球：常驻显示以标示进度；展开后放大并启用 32×32 热区可直接按住拖拽 */}
            <div
              ref={progressThumbRef}
              aria-hidden
              className="pointer-events-none absolute inset-0 will-change-transform transition-transform duration-200 ease-out"
              style={{ transform: `translateX(${progress}%)` }}
            >
              <div
                data-testid="now-playing-progress-thumb"
                onMouseDown={(e) => {
                  if (!controlsVisible) return;
                  e.stopPropagation();
                  beginThumbDrag(e.clientX, false);
                }}
                onTouchStart={(e) => {
                  if (!controlsVisible || !e.touches[0]) return;
                  e.stopPropagation();
                  beginThumbDrag(e.touches[0].clientX, true);
                }}
                onClick={(e) => {
                  if (controlsVisibleRef.current) e.stopPropagation();
                }}
                className={cn(
                  "absolute left-0 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center opacity-100 transition-[opacity,transform] duration-200 ease-out touch-none",
                  controlsVisible
                    ? "pointer-events-auto cursor-grab active:cursor-grabbing"
                    : "pointer-events-none"
                )}
              >
                <div
                  className={cn(
                    "rounded-full transition-[width,height,transform] duration-150",
                    progressExpanded ? "h-2.5 w-2.5" : "h-1.5 w-1.5",
                    isDragging && "scale-125"
                  )}
                  style={{
                    backgroundColor: progressPalette.thumbBg,
                    boxShadow: progressPalette.thumbShadow,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
