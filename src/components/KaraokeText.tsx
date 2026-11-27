import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { LyricWord } from "@/lib/lyrics";
import { useMusicStore } from "@/store/music-store";

/** 逐字高亮刷新节流：30fps 足够跟唱，别让 WebView 每帧重渲染 */
const KARAOKE_FRAME_MS = 33;

interface KaraokeTextProps {
  words: LyricWord[];
  lineTime: number;
  lyricOffset: number;
  enabled: boolean;
  as?: "p" | "span";
  singleLine?: boolean;
  className?: string;
  style?: CSSProperties;
  dimClassName?: string;
  activeClassName?: string;
}

/**
 * 卡拉OK逐字高亮文本。
 *
 * 播放进度直接读 audio 元素（store 的 currentAudioTime 被节流到 1 秒，
 * 逐字会明显跳字），拿不到 audio 时回退 store。
 */
export const KaraokeText = memo(function KaraokeText({
  words,
  lineTime,
  lyricOffset,
  enabled,
  as = "p",
  singleLine = false,
  className,
  style,
  dimClassName = "text-white/15",
  activeClassName = "text-white",
}: KaraokeTextProps) {
  const [progress, setProgress] = useState({ index: -1, ratio: 0 });
  const progressRef = useRef(progress);

  useEffect(() => {
    progressRef.current = { index: -1, ratio: 0 };
    setProgress(progressRef.current);

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

  const Tag = as;

  return (
    <Tag className={className} style={style}>
      {words.map((w, i) => {
        const done = i < progress.index;
        const singing = enabled && i === progress.index;
        // 唱完就保持 100%，覆盖层不消失，避免唱完瞬间白色「缩回」看着像抖
        const pct = done ? 100 : singing ? Math.round(progress.ratio * 100) : 0;

        return (
          <span
            key={`${w.start}-${i}`}
            className={cn(
              "relative inline-block",
              singleLine
                ? "whitespace-pre"
                : "max-w-full whitespace-pre-wrap wrap-anywhere"
            )}
          >
            {/* 底层：未唱淡色。非当前行不覆盖，继承整行的 future/past 色 */}
            <span className={cn(enabled && dimClassName)}>{w.text}</span>
            {/* 顶层：宽度固定铺满，只用 clip-path 裁切缝。用 width 裁会让
                带尾部空格的字在临界宽度反复重排，看着就是「抖一下」。 */}
            {enabled && pct > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-0",
                  singleLine
                    ? "whitespace-pre"
                    : "whitespace-pre-wrap wrap-anywhere",
                  activeClassName
                )}
                style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
              >
                {w.text}
              </span>
            )}
          </span>
        );
      })}
    </Tag>
  );
});
