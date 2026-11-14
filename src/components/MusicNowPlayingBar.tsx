"use client";

import { ListVideo, Pause, Play } from "lucide-react";
import { useMusicStore } from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import { PlayerQueueDrawer } from "./PlayerQueueDrawer";
import { MusicCover } from "./MusicCover";
import { useCallback } from "react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import type { MusicTrack } from "@/types/music";

interface MusicNowPlayingBarProps {
  onOpenFullScreen?: () => void;
  isTab?: boolean;
}

export function MusicNowPlayingBar({
  onOpenFullScreen,
  isTab = true,
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
    clearQueue,
    reshuffle,
    removeFromQueue,
    playTrackAsNext,
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
      clearQueue: state.clearQueue,
      reshuffle: state.reshuffle,
      removeFromQueue: state.removeFromQueue,
      playTrackAsNext: state.playTrackAsNext,
    }))
  );

  const currentTrack = queue[currentIndex] || null;

  const playTrack = useCallback(
    (index: number) => {
      setCurrentIndexAndPlay(index);
    },
    [setCurrentIndexAndPlay]
  );

  const handleClearQueue = () => {
    if (confirm("确定要清空播放列表吗？")) {
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
    <div className={cn(isTab ? "px-3" : "w-full")}>
      <div
        className={cn(
          // 胶囊必须是实色：半透明 / 磨砂会让滚动内容透上来，滑动时忽明忽暗
          "flex items-center transition-all duration-300",
          isTab
            ? "gap-2 px-2 py-1.5 rounded-full border border-transparent dark:border-white/10 bg-card shadow-[0_2px_10px_rgba(15,46,66,0.10)]"
            : "gap-3 px-4 py-2.5 bg-background border-t border-border/50 pb-[calc(0.75rem+var(--safe-area-bottom))]"
        )}
      >
        {/* 不含列表按钮，避免遮罩层关闭时 ghost click 误触发全屏 */}
        <div
          className="flex items-center flex-1 min-w-0 cursor-pointer"
          onClick={() => onOpenFullScreen?.()}
        >
          {/* 专辑封面 */}
          <div
            className={cn(
              "relative shrink-0 overflow-hidden rounded-md transition-all duration-300 shadow-sm",
              isTab ? "h-8 w-8" : "h-11 w-11"
            )}
          >
            <MusicCover
              src={coverUrl}
              alt={currentTrack.name}
              className="w-full h-full"
              iconClassName={isTab ? "h-4 w-4" : "h-5 w-5"}
            />
          </div>

          {/* 歌曲信息 - 单行 */}
          <p className="flex-1 min-w-0 truncate flex items-baseline gap-1.5 ml-2">
            <span
              className={cn(
                "font-medium text-foreground transition-all duration-300",
                isTab ? "text-sm" : "text-base"
              )}
            >
              {currentTrack.name}
            </span>
            <span
              className={cn(
                "text-muted-foreground truncate transition-all duration-300",
                "text-xs"
              )}
            >
              - {currentTrack.artist?.join(", ")}
            </span>
          </p>

          {/* 圆环播放按钮 - 参照网易云：视觉体量贴近纯图标，不宜过大 */}
          <div
            className={cn(
              "relative shrink-0 transition-all duration-300 ml-2",
              isTab ? "w-4 h-4" : "w-[22px] h-[22px]"
            )}
          >
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
                className="text-foreground/20 dark:text-foreground/28 transition-all duration-300"
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
                className="text-primary transition-[stroke-dashoffset] duration-300"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                transform="rotate(-90 20 20)"
              />
            </svg>

            {/* 播放按钮 */}
            <button
              className="absolute inset-0 flex items-center justify-center text-primary hover:text-primary/80 transition-colors focus:outline-none"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              aria-label={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? (
                <Pause
                  className={cn(
                    "fill-current transition-all duration-300",
                    isTab ? "h-3 w-3" : "h-4 w-4"
                  )}
                />
              ) : (
                <Play
                  className={cn(
                    "fill-current ml-0.5 transition-all duration-300",
                    isTab ? "h-3 w-3" : "h-4 w-4"
                  )}
                />
              )}
            </button>
          </div>
        </div>

        {/* 与可点击区域为兄弟节点，ghost click 不会冒泡 */}
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
                "text-muted-foreground hover:text-foreground transition-all shrink-0 focus:outline-none",
                isTab ? "p-1.5" : "p-2 ml-1"
              )}
              aria-label="播放列表"
            >
              <ListVideo
                className={cn(
                  "transition-all duration-300",
                  isTab ? "h-4 w-4" : "h-[22px] w-[22px]"
                )}
              />
            </button>
          }
        />
      </div>
    </div>
  );
}
