"use client";

import { ListVideo, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useMusicStore } from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import { useCoverColors } from "@/hooks/useCoverColors";
import { cn } from "@/lib/utils";
import { PlayerQueueDrawer } from "./PlayerQueueDrawer";
import { confirmDialog } from "./ui/confirm-dialog";
import { MusicCover } from "./MusicCover";
import { VinylCover } from "./VinylCover";
import { useCallback } from "react";
import toast from "react-hot-toast";
import type { MusicTrack } from "@/types/music";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { t2s, t2sArtists } from "@/lib/utils/t2s";

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
    }))
  );

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
      }
    : undefined;

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

  const progress = duration > 0 ? (currentAudioTime / duration) * 100 : 0;
  // viewBox 为 40×40；进度弧描边较粗（3.6），半径取 18.2 使其外缘正好落在 20 处
  // （不被 SVG 视口裁切），轨道描边更细所以内缩一点，视觉上"实心弧 + 细引导线"
  const radius = 18.2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress / 100);

  if (!currentTrack) {
    return null; // 使用 null 替代 undefined 更符合 React 规范
  }

  return (
    <div className="px-3">
      <div
        // 胶囊必须是实色：半透明 / 磨砂会让滚动内容透上来，滑动时忽明忽暗
        className={cn(
          "flex items-center transition-all duration-300 gap-2 px-2 py-1.5 rounded-full border border-transparent shadow-[0_2px_10px_rgba(15,46,66,0.10)]",
          lightTint
            ? "border-black/5"
            : tinted
              ? "border-white/10"
              : "bg-card dark:border-white/10"
        )}
        style={barStyle}
      >
        {/* 不含列表按钮，避免遮罩层关闭时 ghost click 误触发全屏 */}
        <div
          className="flex items-center flex-1 min-w-0 cursor-pointer"
          onClick={() => onOpenFullScreen?.()}
        >
          {/* 专辑封面：跟随播放页选择的封面样式。播放页是黑胶，胶囊里也必须是黑胶，
              否则同一个封面在两地长得不一样（用户明确要求"外面显示一样的"）。
              32px 的小盘面不放唱臂骨架，只有黑胶盘+中心封面。 */}
          {coverStyle === "vinyl" ? (
            <div className="relative shrink-0 overflow-hidden rounded-full transition-all duration-300 h-9 w-9">
              <VinylCover
                src={coverUrl}
                alt={currentTrack.name}
                isPlaying={isPlaying}
                className="h-full w-full"
                iconClassName="h-3.5 w-3.5"
                discColor={vinylColor}
                showTonearm={false}
              />
            </div>
          ) : (
            <div className="relative shrink-0 overflow-hidden rounded-md transition-all duration-300 shadow-sm h-8 w-8">
              <MusicCover
                src={coverUrl}
                alt={currentTrack.name}
                className="w-full h-full"
                iconClassName="h-4 w-4"
              />
            </div>
          )}

          {/* 歌曲信息 - 单行 */}
          <p className="flex-1 min-w-0 truncate flex items-baseline gap-1.5 ml-2">
            <span
              className={cn(
                "font-medium transition-all duration-300 text-sm",
                tinted && !lightTint ? "text-white" : "text-foreground"
              )}
            >
              {t2s(currentTrack.name)}
            </span>
            <span
              className={cn(
                "truncate transition-all duration-300 text-xs",
                lightTint
                  ? "text-foreground/60"
                  : tinted
                    ? "text-white/70"
                    : "text-muted-foreground"
              )}
            >
              - {t2sArtists(currentTrack.artist).join(", ")}
            </span>
          </p>
        </div>

        {/* 播放控制：上一首 / 播放 / 下一首。整组放在点击区外面，
            点击这些按钮不会冒泡去打开全屏播放 */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            className={cn(
              "p-1 transition-colors focus:outline-none",
              lightTint
                ? "text-foreground/60 hover:text-foreground"
                : tinted
                  ? "text-white/70 hover:text-white"
                  : "text-muted-foreground hover:text-foreground"
            )}
            onClick={skipToPrevious}
            aria-label="上一首"
          >
            <SkipBack
              className="h-3.5 w-3.5 transition-all duration-300"
              fill="currentColor"
            />
          </button>

          {/* 圆环播放按钮 - 参照网易云：视觉体量贴近纯图标，不宜过大 */}
          <div className="relative shrink-0 transition-all duration-300 w-4 h-4">
            {/* SVG 圆环进度 (利用 viewBox 自动等比缩放) */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 40 40">
              {/* 背景圆环 */}
              <circle
                cx="20"
                cy="20"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                className={cn(
                  "transition-all duration-300",
                  lightTint
                    ? "text-foreground/15"
                    : tinted
                      ? "text-white/25"
                      : "text-foreground/20 dark:text-foreground/28"
                )}
              />
              {/* 进度圆环 - 从上方开始 */}
              <circle
                cx="20"
                cy="20"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="3.6"
                strokeLinecap="round"
                className={cn(
                  "transition-[stroke-dashoffset] duration-300",
                  tinted && !lightTint ? "text-white" : "text-primary"
                )}
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                transform="rotate(-90 20 20)"
              />
            </svg>

            {/* 播放按钮 */}
            <button
              className={cn(
                "absolute inset-0 flex items-center justify-center transition-colors focus:outline-none",
                tinted && !lightTint
                  ? "text-white hover:text-white/80"
                  : "text-primary hover:text-primary/80"
              )}
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              aria-label={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? (
                <Pause className="fill-current transition-all duration-300 h-2.5 w-2.5" />
              ) : (
                <Play className="fill-current transition-all duration-300 h-2.5 w-2.5" />
              )}
            </button>
          </div>

          <button
            className={cn(
              "p-1 transition-colors focus:outline-none",
              lightTint
                ? "text-foreground/60 hover:text-foreground"
                : tinted
                  ? "text-white/70 hover:text-white"
                  : "text-muted-foreground hover:text-foreground"
            )}
            onClick={skipToNext}
            aria-label="下一首"
          >
            <SkipForward
              className="h-3.5 w-3.5 transition-all duration-300"
              fill="currentColor"
            />
          </button>
        </div>
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
          trigger={
            <button
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
    </div>
  );
}
