"use client";

import { Zap } from "lucide-react";
import { useMusicStore } from "@/store/music-store";
import {
  trackOriginKey,
  type AudioOriginVia,
} from "@/store/music-store/playback-slice";
import { getSourceLabel } from "@/lib/imported-sources/labels";
import type { MusicTrack } from "@/types/music";

/** 非「平台音源」场景的说明文案 */
const NON_PLATFORM_LABELS: Partial<Record<AudioOriginVia, string>> = {
  download: "本地下载",
  offline: "离线缓存",
  local: "本地文件",
};

export interface TrackSourceLabelProps {
  track: MusicTrack;
  className?: string;
  /** 曲目还没播过时，是否回退显示它自身所属的平台（列表徽章需要） */
  fallbackToTrack?: boolean;
}

/**
 * 列表行 / 「···」菜单里的「这首歌实际用的音源」。
 *
 * 与播放条的 AudioOriginLabel 读同一份决策结果：
 * - 换源成功：曲目本身已被替换，`track.source` 就是新平台；
 * - 洛雪脚本接管：曲目没换，只有 `trackOrigins` 里记着是哪个脚本供的链，
 *   这里必须优先读它，否则列表和菜单会一直标着旧平台。
 */
export function TrackSourceLabel({
  track,
  className,
  fallbackToTrack = true,
}: TrackSourceLabelProps) {
  const origin = useMusicStore(
    (state) => state.trackOrigins[trackOriginKey(track)]
  );

  const isLx = origin?.via === "lx";
  const label = isLx
    ? origin.lxName || getSourceLabel(track.source)
    : origin?.via
      ? NON_PLATFORM_LABELS[origin.via] || getSourceLabel(track.source)
      : fallbackToTrack
        ? getSourceLabel(track.source)
        : "";

  if (!label) return null;

  return (
    <span
      className={`inline-flex min-w-0 items-center gap-0.5 ${className ?? ""}`}
      title={isLx ? `洛雪脚本接管播放：${label}` : `当前音源：${label}`}
    >
      {isLx && <Zap className="h-2.5 w-2.5 shrink-0" aria-hidden />}
      <span className="truncate">{label}</span>
    </span>
  );
}
