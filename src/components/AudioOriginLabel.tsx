"use client";

import { Zap } from "lucide-react";
import { useMusicStore } from "@/store/music-store";
import { getSourceLabel } from "@/lib/imported-sources/labels";
import { cn } from "@/lib/utils";
import type { AudioOriginVia } from "@/store/music-store/playback-slice";

/** 非「平台音源」场景的说明文案 */
const NON_PLATFORM_LABELS: Partial<Record<AudioOriginVia, string>> = {
  download: "本地下载",
  offline: "离线缓存",
  local: "本地文件",
};

interface AudioOriginLabelProps {
  className?: string;
  /** 是否带「·」前缀，跟在歌手后面时用 */
  withDot?: boolean;
}

/**
 * 播放界面上的「当前用的音源」。
 *
 * 显示的是这次播放**实际取链的那一方**：平台官方接口就给平台名，
 * 洛雪脚本接管就显示脚本名 —— 这正是用户想确认的信息
 * （「到底是谁在供源」），而不是曲目搜索时所在的音源。
 */
export function AudioOriginLabel({
  className,
  withDot = true,
}: AudioOriginLabelProps) {
  const origin = useMusicStore((state) => state.currentAudioOrigin);
  if (!origin) return null;

  const isLx = origin.via === "lx";
  const label = isLx
    ? origin.lxName || getSourceLabel(origin.source)
    : NON_PLATFORM_LABELS[origin.via] || getSourceLabel(origin.source);
  if (!label) return null;

  return (
    <span
      className={cn(
        // 必须是 inline-block 而不是 inline-flex：flex 容器的 baseline
        // 取自第一个子项，图标会把整块往下拽，和歌名/歌手的文字基线对不齐。
        // inline 的 baseline 就是文字基线，图标用绝对定位不参与基线计算。
        "relative inline-block whitespace-nowrap",
        isLx && "pl-[13px]",
        className
      )}
      title={isLx ? `洛雪脚本接管播放：${label}` : `当前音源：${label}`}
    >
      {isLx && (
        <Zap
          className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2"
          aria-hidden
        />
      )}
      {withDot ? `· ${label}` : label}
    </span>
  );
}
