"use client";

import {
  memo,
  useEffect,
  useRef,
  useState,
  useCallback,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { musicApi } from "@/lib/music-api";
import { MusicTrack } from "@/types/music";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Minus,
  Play,
  Plus,
  X,
} from "lucide-react";
import { useMusicStore, type LyricAlign } from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import { useScrimSystemBars } from "@/hooks/useScrimSystemBars";
import { onPageScrollToTop } from "@/lib/scroll-to-top";
import {
  findActiveLyricIndex,
  parseLrc,
  type LyricLine,
  type LyricWord,
} from "@/lib/lyrics";

interface LyricsPanelProps {
  track: MusicTrack | null;
  active?: boolean;
}

/**
 * 用户停手几秒后自动回到「正在播放的那一句」。
 *
 * 手动翻歌词、点状态栏回顶都只是「临时离开」，不是要脱离播放进度；
 * 停手三四秒还没动作，就把视图交还给播放跟随，不用再手动点回来。
 */
const AUTO_RESUME_DELAY = 4000;
// 回顶是一段上滑动画，动画期间不把它算成「用户手动滚动」（否则基准线会闪一下）
const TOP_ANIMATION_LOCK = 700;
// 滚动事件静默这么久，才算「最终停下来」
const SCROLL_SETTLE_DELAY = 200;
// 长按多久弹出歌词样式面板
const LONG_PRESS_DELAY = 500;
const PADDING_LINES = 2;

const LYRIC_MIN_FONT_SIZE = 13;
const LYRIC_MAX_FONT_SIZE = 28;

const ALIGN_OPTIONS: {
  value: LyricAlign;
  label: string;
  icon: typeof AlignLeft;
}[] = [
  { value: "left", label: "居左", icon: AlignLeft },
  { value: "center", label: "居中", icon: AlignCenter },
  { value: "right", label: "居右", icon: AlignRight },
];

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** 逐字高亮刷新节流：30fps 足够跟唱，别让 WebView 每帧重渲染 */
const KARAOKE_FRAME_MS = 33;

/**
 * 当前行的卡拉OK文字。播放进度直接读 audio 元素（store 的 currentAudioTime
 * 被节流到 1 秒，逐字会明显跳字），拿不到 audio 时回退 store。
 */
const KaraokeText = memo(function KaraokeText({
  words,
  lineTime,
  lyricOffset,
  fontSize,
  enabled,
}: {
  words: LyricWord[];
  lineTime: number;
  lyricOffset: number;
  fontSize: number;
  enabled: boolean;
}) {
  const [progress, setProgress] = useState({ index: -1, ratio: 0 });
  const progressRef = useRef(progress);

  useEffect(() => {
    progressRef.current = { index: -1, ratio: 0 };
    setProgress(progressRef.current);

    // 非当前行只借用同一套排版，不跑逐字动画，颜色交给外层 lyric-line
    if (!enabled) return;

    const audio = document.querySelector("audio");
    let raf = 0;
    let last = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < KARAOKE_FRAME_MS) return;
      last = now;

      const current =
        audio?.currentTime ?? useMusicStore.getState().currentAudioTime;
      const ms = (current - lineTime - lyricOffset) * 1000;

      let index = -1;
      let ratio = 0;
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (ms >= w.end) {
          index = i;
          ratio = 1;
          continue;
        }
        if (ms >= w.start) {
          index = i;
          ratio = (ms - w.start) / Math.max(1, w.end - w.start);
        }
        break;
      }

      const prev = progressRef.current;
      if (prev.index !== index || Math.abs(prev.ratio - ratio) > 0.01) {
        progressRef.current = { index, ratio };
        setProgress(progressRef.current);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [words, lineTime, lyricOffset, enabled]);

  return (
    <p
      className="lyric-main font-medium leading-relaxed tracking-wide break-words"
      style={{ fontSize: `${fontSize}px` }}
    >
      {words.map((w, i) => {
        const done = i < progress.index;
        const singing = enabled && i === progress.index;
        // 唱完就保持 100%，覆盖层不消失，避免唱完瞬间白色「缩回」看着像抖
        const pct = done ? 100 : singing ? Math.round(progress.ratio * 100) : 0;

        return (
          <span
            key={`${w.start}-${i}`}
            className="relative inline-block whitespace-pre"
          >
            {/* 底层：未唱淡色。非当前行不覆盖，继承整行的 future/past 色 */}
            <span className={cn(enabled && "text-white/15")}>{w.text}</span>
            {/* 顶层：宽度固定铺满，只用 clip-path 裁切缝。用 width 裁会让
                带尾部空格的字在临界宽度反复重排，看着就是「抖一下」。 */}
            {enabled && pct > 0 && (
              <span
                aria-hidden="true"
                className="absolute inset-0 whitespace-pre text-white"
                style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
              >
                {w.text}
              </span>
            )}
          </span>
        );
      })}
    </p>
  );
});

const LyricLineView = memo(function LyricLineView({
  line,
  isActive,
  isPast,
  isBaseLine,
  align,
  fontSize,
  lyricOffset,
}: {
  line: LyricLine;
  isActive: boolean;
  isPast: boolean;
  isBaseLine: boolean;
  align: LyricAlign;
  fontSize: number;
  lyricOffset: number;
}) {
  const translationSize = Math.max(11, Math.round(fontSize * (15 / 18)));

  return (
    <div
      className={cn(
        "lyric-line w-full max-w-3xl px-6 sm:px-8",
        "select-none",
        "transition-all duration-300 ease-out",
        "origin-center",
        align === "center" && "text-center",
        align === "left" && "text-left",
        align === "right" && "text-right",
        // 背景跟随封面主色后不再保证是纯黑，非当前行必须提亮并带阴影，否则会被彩色背景吞掉。
        // 阴影与浅色底下的取色都收敛到 global.css 的 .lyric-* 里：
        // 深色底用黑投影，浅色底换成白柔光，否则黑投影落在浅底上就是一团脏灰。
        isActive
          ? "lyric-active text-white opacity-100 hover:text-white/70"
          : isPast
            ? "text-white/60 opacity-100 hover:text-white/80"
            : // 没唱到的行整体压到 25%，和已唱行、当前行拉开层次；
              // 浅色底的覆盖规则在 global.css 的 .lyric-line:not(.lyric-active)
              "lyric-future text-white/25 opacity-100 hover:text-white/70",
        // 基准线行加浅色背景框；py 与 -my 等额抵消，保证行间距不变
        // self-start 阻止 flex 拉伸，避免抵消后的内边距被压缩
        isBaseLine && "-my-2.5 self-start rounded-xl bg-white/10 py-2.5"
      )}
    >
      {line.words && line.words.length > 0 ? (
        // 有逐字数据的行始终走同一套 span 排版，只在当前行开启高亮，
        // 避免「切到当前行时字突然合并/变样」
        <KaraokeText
          words={line.words}
          lineTime={line.time}
          lyricOffset={lyricOffset}
          fontSize={fontSize}
          enabled={isActive}
        />
      ) : (
        <p
          className="lyric-main font-medium leading-relaxed tracking-wide break-words"
          style={{ fontSize: `${fontSize}px` }}
        >
          {line.text}
        </p>
      )}

      {line.ttext && (
        <p
          className="lyric-trans mt-1 font-medium leading-relaxed break-words transition-colors duration-300"
          style={{ fontSize: `${translationSize}px` }}
        >
          {line.ttext}
        </p>
      )}
    </div>
  );
});

export function LyricsPanel({ track, active = true }: LyricsPanelProps) {
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [centerLineIndex, setCenterLineIndex] = useState(-1);
  const [baselineVisible, setBaselineVisible] = useState(false);
  // 长按歌词弹出的样式面板
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  // 样式面板的黑色遮罩会铺到状态栏底下，弹出期间状态栏图标改成浅色
  useScrimSystemBars(stylePanelOpen);
  // 点了状态栏「回顶」之后暂停跟随播放进度，否则下一句一到就把视图拽回去
  const [followPaused, setFollowPaused] = useState(false);
  // 基准线只在「滚动最终停稳」那一刻算一次，滚动过程中完全不碰它。
  // 之前逐帧跟随 + CSS transition，每帧都会重启一次过渡，缓动永远追不上，所以一路抖。
  const baselineRef = useRef<HTMLDivElement>(null);
  const baselineVisibleRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 每行中心换算到「滚动内容坐标系」后缓存，停稳时只读 scrollTop，
  // 不用逐行 getBoundingClientRect（那会强制同步布局）。
  const lineCentersRef = useRef<number[]>([]);
  const centerIdxRef = useRef(-1);
  const isUserScrollingRef = useRef(false);

  const {
    currentTime,
    seek,
    seekTimestamp,
    lyricAlign,
    lyricFontSize,
    lyricOffset,
    setLyricAlign,
    setLyricFontSize,
  } = useMusicStore(
    useShallow((state) => ({
      currentTime: state.currentAudioTime,
      seek: state.seek,
      seekTimestamp: state.seekTimestamp,
      lyricAlign: state.lyricAlign,
      lyricFontSize: state.lyricFontSize,
      lyricOffset: state.lyricOffset,
      setLyricAlign: state.setLyricAlign,
      setLyricFontSize: state.setLyricFontSize,
    }))
  );

  const trackId = track?.id ?? null;
  const lyricId = track?.lyric_id ?? null;
  const source = track?.source ?? null;

  /**
   * store 的 currentAudioTime 被 timeupdate 节流到 1 秒，用它算「当前行」，
   * 每句开头最多晚 1 秒才切到该行，逐字高亮也就跟着慢半拍。
   * 这里单独读 audio 的即时时间，10fps 足够跟上唱词，又不会让整页每帧重渲染。
   */
  const [fastTime, setFastTime] = useState(currentTime);
  useEffect(() => {
    const audio = document.querySelector("audio");
    if (!audio) return;

    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 100) return;
      last = now;
      setFastTime(audio.currentTime);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const activeIndex =
    lyrics.length > 0
      ? Math.max(0, findActiveLyricIndex(lyrics, fastTime, lyricOffset))
      : 0;

  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAutoScrollingRef = useRef(false);
  // 回顶动画期间把自动滚动的锁临时打开，动画结束再交还
  const topAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 停手几秒后恢复播放跟随：收起基准线、解掉「用户正在滚动」，回到当前句 */
  const scheduleFollowResume = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      scrollTimeoutRef.current = null;
      isUserScrollingRef.current = false;
      centerIdxRef.current = -1;
      baselineVisibleRef.current = false;
      setIsUserScrolling(false);
      setBaselineVisible(false);
      setCenterLineIndex(-1);
      setFollowPaused(false);
    }, AUTO_RESUME_DELAY);
  }, []);

  // 长按：按住 500ms 且没有明显位移才算，滑动/惯性滚动的 pointercancel 会取消它
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    longPressOriginRef.current = null;
  }, []);

  const handleLyricPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;

      cancelLongPress();
      longPressOriginRef.current = { x: e.clientX, y: e.clientY };

      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        // 长按松手后浏览器还会补一次 click，会让外层把歌词切成封面，这里吞掉
        suppressClickRef.current = true;
        // 兜底复位，避免某次没有补 click 时把下一次正常点击也吞了
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 600);
        setStylePanelOpen(true);
        navigator.vibrate?.(10);
      }, LONG_PRESS_DELAY);
    },
    [cancelLongPress]
  );

  const handleLyricPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const origin = longPressOriginRef.current;

      if (!origin) return;

      // 手指移动超过 10px 视为滚动，不再算长按
      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 10) {
        cancelLongPress();
      }
    },
    [cancelLongPress]
  );

  const handleLyricClickCapture = useCallback((e: ReactMouseEvent) => {
    if (!suppressClickRef.current) return;

    suppressClickRef.current = false;
    e.stopPropagation();
    e.preventDefault();
  }, []);

  useEffect(() => {
    return () => cancelLongPress();
  }, [cancelLongPress]);

  const handleSeek = useCallback(
    (time: number) => {
      seek(time);

      setIsUserScrolling(false);
      setCenterLineIndex(-1);
      setBaselineVisible(false);
      setFollowPaused(false);

      isUserScrollingRef.current = false;
      centerIdxRef.current = -1;
      baselineVisibleRef.current = false;

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }

      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    },
    [seek]
  );

  const measureLineCenters = useCallback(() => {
    const container = viewportRef.current;

    if (!container) return;

    // 把每行中心的视口坐标换算到滚动内容坐标系（scrollTop = 0 时的位置），
    // 这样滚动过程中只要读 scrollTop 就能算出基准线位置。
    const origin = container.getBoundingClientRect().top - container.scrollTop;

    lineCentersRef.current = lineRefs.current.map((el) => {
      if (!el) return 0;

      const rect = el.getBoundingClientRect();

      return rect.top + rect.height / 2 - origin;
    });
  }, []);

  // 停稳后才执行：算出离视口中心最近的一句，把基准线一次性放过去
  const snapBaseline = useCallback(() => {
    const container = viewportRef.current;

    if (!container) return;

    measureLineCenters();

    const centers = lineCentersRef.current;

    if (centers.length === 0) return;

    const viewportCenter = container.scrollTop + container.clientHeight / 2;

    let closestIdx = 0;
    let closestDist = Infinity;

    for (let i = 0; i < centers.length; i += 1) {
      const dist = Math.abs(centers[i] - viewportCenter);

      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }

    // 限制在可视范围内，避免顶到遮罩外面看不见
    const top = Math.min(
      Math.max(centers[closestIdx] - container.scrollTop, 12),
      container.clientHeight - 12
    );

    centerIdxRef.current = closestIdx;

    if (baselineRef.current) {
      baselineRef.current.style.top = `${top}px`;
    }

    baselineVisibleRef.current = true;
    setCenterLineIndex(closestIdx);
    setBaselineVisible(true);
  }, [measureLineCenters]);

  const handleScroll = useCallback(() => {
    const container = viewportRef.current;

    if (!container) return;

    if (isAutoScrollingRef.current) return;

    if (lyrics.length === 0) return;

    // 回顶后自己把列表滚回当前句附近：视为想继续跟着唱，恢复自动跟随
    if (followPaused) {
      const el = lineRefs.current[activeIndex];

      if (el) {
        const offset =
          el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;

        if (Math.abs(container.scrollTop - offset) < 240) {
          setFollowPaused(false);
        }
      }
    }

    // 滚动期间线钉在视口正中：给一个固定参照，能看清滑到哪儿了，
    // 但它不跟着动、也不算最近的行，等停稳了才吸附过去。
    if (!isUserScrollingRef.current) {
      isUserScrollingRef.current = true;
      setIsUserScrolling(true);
      setCenterLineIndex(-1);
      centerIdxRef.current = -1;
      baselineVisibleRef.current = true;
      setBaselineVisible(true);

      if (baselineRef.current) {
        baselineRef.current.style.top = `${container.clientHeight / 2}px`;
      }
    } else if (centerIdxRef.current >= 0) {
      // 停稳吸附之后又接着滚：线退回正中，等下一次停稳再算
      centerIdxRef.current = -1;
      setCenterLineIndex(-1);

      if (baselineRef.current) {
        baselineRef.current.style.top = `${container.clientHeight / 2}px`;
      }
    }

    // 停稳判定：滚动事件静默 200ms 才算「最终停下来」，惯性滑行期间不会误触发
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
    }

    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      snapBaseline();
    }, SCROLL_SETTLE_DELAY);

    // 停稳后再过几秒仍无操作，收起基准线、恢复播放跟随
    scheduleFollowResume();
  }, [
    lyrics.length,
    snapBaseline,
    followPaused,
    activeIndex,
    scheduleFollowResume,
  ]);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
      }

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = viewportRef.current;

    if (!container) return;

    container.addEventListener("scroll", handleScroll, {
      passive: true,
    });

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [handleScroll]);

  useEffect(() => {
    if (!trackId || !source || !active) return;

    if (!lyricId) {
      queueMicrotask(() => {
        setLoading(false);
        setError("暂无歌词");
        setLyrics([]);
      });

      return;
    }

    let cancelled = false;

    queueMicrotask(() => {
      setLoading(true);
      setError("");
      // 换歌 = 换一份歌词：清掉上一首「回顶」带来的跟随暂停
      setFollowPaused(false);
    });

    musicApi
      // 传完整曲目：本地音源要靠歌名/歌手在线反查歌词，只给文件路径查不到
      .getLyric(lyricId, source, track)
      .then((res) => {
        if (cancelled) return;

        if (!res) {
          setError("暂无歌词");
          setLyrics([]);
          return;
        }

        setLyrics(parseLrc(res.lyric, res.tlyric));
      })
      .catch(() => {
        if (cancelled) return;

        setError("歌词加载失败");
        setLyrics([]);
      })
      .finally(() => {
        if (cancelled) return;

        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [track, trackId, lyricId, source, active]);

  useEffect(() => {
    if (isUserScrolling || followPaused) return;

    const container = viewportRef.current;
    const el = lineRefs.current[activeIndex];

    if (!container || !el) return;

    const offset =
      el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;

    isAutoScrollingRef.current = true;

    container.scrollTo({
      top: offset,
      behavior: "smooth",
    });

    const onScrollEnd = () => {
      isAutoScrollingRef.current = false;
    };

    container.addEventListener("scrollend", onScrollEnd, {
      once: true,
    });

    return () => {
      isAutoScrollingRef.current = false;
      container.removeEventListener("scrollend", onScrollEnd);
    };
  }, [activeIndex, isUserScrolling, followPaused]);

  useEffect(() => {
    flushSync(() => {
      setIsUserScrolling(false);
      setCenterLineIndex(-1);
      setBaselineVisible(false);
      // 用户主动跳转后就该跟着新位置走，取消「回顶」带来的暂停
      setFollowPaused(false);
    });

    isUserScrollingRef.current = false;
    centerIdxRef.current = -1;
    baselineVisibleRef.current = false;

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }

    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, [seekTimestamp]);

  /**
   * 点状态栏「回顶」：歌词列表注册成主滚动容器，系统回顶会把它归零。
   *
   * 回顶是一段上滑动画（scrollPageToTop 默认 smooth），动画期间先把「自动滚动」
   * 的锁临时打开，免得滚动事件被当成用户手滑、把基准线闪出来。
   *
   * 归零的同时必须暂停跟随，否则下一句一到又会被拉回中间 —— 回顶就等于白按。
   * 但暂停只是临时的：停手 AUTO_RESUME_DELAY 之后自动回到正在唱的那一句。
   * 点某句歌词（seek）、换歌、自己滚回当前句附近也会立刻恢复。
   */
  useEffect(() => {
    const container = viewportRef.current;

    if (!container) return;

    container.setAttribute("data-page-scroll", "");

    return onPageScrollToTop(() => {
      // 回调在滚动之前触发，这里读到的还是旧位置
      if (container.scrollTop <= 0) return;

      setFollowPaused(true);
      isAutoScrollingRef.current = true;

      if (topAnimTimerRef.current) {
        clearTimeout(topAnimTimerRef.current);
      }

      topAnimTimerRef.current = setTimeout(() => {
        topAnimTimerRef.current = null;
        isAutoScrollingRef.current = false;
      }, TOP_ANIMATION_LOCK);

      scheduleFollowResume();
    });
  }, [trackId, lyrics.length, scheduleFollowResume]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      if (topAnimTimerRef.current) {
        clearTimeout(topAnimTimerRef.current);
      }
    };
  }, []);

  if (!track) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-white/40">
        选择歌曲查看歌词
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-white/40">
        加载歌词中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-white/40">
        {error}
      </div>
    );
  }

  if (lyrics.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-white/40">
        暂无歌词
      </div>
    );
  }

  const LyricsList = (
    <div
      className={cn(
        "w-full flex flex-col",
        "py-[45%]",
        "gap-5",
        lyricAlign === "center" && "items-center",
        lyricAlign === "left" && "items-start",
        lyricAlign === "right" && "items-end"
      )}
      onPointerDown={handleLyricPointerDown}
      onPointerMove={handleLyricPointerMove}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onClickCapture={handleLyricClickCapture}
      // 长按不弹系统菜单（iOS 的呼出菜单/放大镜）
      onContextMenu={(e) => e.preventDefault()}
      style={{ WebkitTouchCallout: "none" }}
    >
      {Array.from({ length: PADDING_LINES }).map((_, i) => (
        <div key={`pad-top-${i}`} className="h-6 shrink-0" />
      ))}

      {lyrics.map((line, i) => (
        <div
          key={`${line.time}-${i}`}
          ref={(el) => {
            lineRefs.current[i] = el;
          }}
          className={cn(
            "w-full flex",
            lyricAlign === "center" && "justify-center",
            lyricAlign === "left" && "justify-start",
            lyricAlign === "right" && "justify-end"
          )}
        >
          <LyricLineView
            line={line}
            isActive={i === activeIndex}
            isPast={i < activeIndex}
            isBaseLine={i === centerLineIndex}
            align={lyricAlign}
            fontSize={lyricFontSize}
            lyricOffset={lyricOffset}
          />
        </div>
      ))}

      {Array.from({ length: PADDING_LINES }).map((_, i) => (
        <div key={`pad-bottom-${i}`} className="h-6 shrink-0" />
      ))}
    </div>
  );

  const centerLine = centerLineIndex >= 0 ? lyrics[centerLineIndex] : null;

  const baselineTime = centerLine ? (
    <span
      className={cn(
        "min-w-9 shrink-0 text-xs tabular-nums text-white/60",
        lyricAlign === "left" && "text-right"
      )}
    >
      {formatTime(centerLine.time)}
    </span>
  ) : null;

  // 图标仅为视觉提示，点击由外层整条基准线接管，扩大触控范围
  const baselineIcon = centerLine ? (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center",
        "rounded-full",
        "bg-white/10 backdrop-blur-sm",
        "text-white",
        "transition-colors",
        "group-hover:bg-white/20 group-active:bg-white/30"
      )}
    >
      <Play size={14} className="ml-0.5 fill-current" />
    </span>
  ) : null;

  return (
    <div
      data-lyrics-panel=""
      className="relative h-full flex flex-col overflow-hidden"
    >
      <ScrollArea
        className={cn(
          "h-full w-full",
          "**:data-[slot=scroll-area-scrollbar]:w-1.5",
          "**:data-[slot=scroll-area-thumb]:bg-white/10",
          "**:data-[slot=scroll-area-thumb]:hover:bg-white/30"
        )}
        viewportRef={viewportRef}
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)",
        }}
      >
        {LyricsList}
      </ScrollArea>

      {/* 容器常驻，靠 opacity 显隐：否则每次开始滚动都要重新挂载，
          top 得从 0 现算，会闪一下 */}
      <div
        ref={baselineRef}
        className={cn(
          "absolute inset-x-0 z-10 -translate-y-1/2 px-4",
          "transition-[top,opacity] duration-200 ease-out",
          baselineVisible ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        style={{ top: 0 }}
      >
        {centerLine ? (
          <button
            type="button"
            onClick={(e) => {
              // 阻止冒泡到全屏播放器的歌词区域，否则会同时切换到封面模式
              e.stopPropagation();
              handleSeek(centerLine.time);
            }}
            className="group flex w-full items-center gap-3 py-2 outline-none"
            aria-label="从此句开始播放"
          >
            {lyricAlign === "right" && (
              <>
                {baselineIcon}
                {baselineTime}
              </>
            )}

            {lyricAlign === "center" && baselineTime}

            <div className="h-px flex-1 bg-white/20" />

            {lyricAlign === "center" && baselineIcon}

            {lyricAlign === "left" && (
              <>
                {baselineTime}
                {baselineIcon}
              </>
            )}
          </button>
        ) : (
          // 滚动中：只留一条悬在正中的横线当参照，不带时间和播放按钮
          <div className="flex w-full items-center">
            <div className="h-px flex-1 bg-white/20" />
          </div>
        )}
      </div>

      {/* 长按歌词弹出的样式面板 */}
      {stylePanelOpen &&
        createPortal(
          <div className="fixed inset-0 z-500 flex items-end justify-center">
            <div
              data-no-tap
              className="absolute inset-0 bg-black/60 animate-in fade-in duration-200"
              onClick={(e) => {
                e.stopPropagation();
                setStylePanelOpen(false);
              }}
            />

            <div
              data-no-tap
              className={cn(
                "relative mb-6 w-[min(420px,calc(100%-32px))] rounded-2xl p-4",
                "bg-neutral-900/95 ring-1 ring-white/10 shadow-2xl backdrop-blur-xl",
                "animate-in slide-in-from-bottom-4 duration-200"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-white">歌词样式</span>

                <button
                  type="button"
                  onClick={() => setStylePanelOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex rounded-xl bg-white/5 p-1">
                {ALIGN_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLyricAlign(value)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs transition-all",
                      lyricAlign === value
                        ? "bg-white/15 text-white"
                        : "text-white/50 hover:text-white/80"
                    )}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-3">
                <span className="shrink-0 text-xs text-white/60">字号</span>

                <button
                  type="button"
                  onClick={() =>
                    setLyricFontSize(
                      Math.max(LYRIC_MIN_FONT_SIZE, lyricFontSize - 1)
                    )
                  }
                  disabled={lyricFontSize <= LYRIC_MIN_FONT_SIZE}
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    "bg-white/10 text-white transition-colors active:bg-white/20",
                    "disabled:opacity-30"
                  )}
                  aria-label="减小字号"
                >
                  <Minus size={16} />
                </button>

                <span className="flex-1 text-center text-sm tabular-nums text-white">
                  {lyricFontSize}px
                </span>

                <button
                  type="button"
                  onClick={() =>
                    setLyricFontSize(
                      Math.min(LYRIC_MAX_FONT_SIZE, lyricFontSize + 1)
                    )
                  }
                  disabled={lyricFontSize >= LYRIC_MAX_FONT_SIZE}
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    "bg-white/10 text-white transition-colors active:bg-white/20",
                    "disabled:opacity-30"
                  )}
                  aria-label="增大字号"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
