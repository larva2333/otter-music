"use client";

import { createPortal } from "react-dom";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { labToSrgb, srgbToLab, type SodaColors } from "@/lib/utils/soda-color";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LyricsPanel } from "./LyricsPanel";
import { MusicCover } from "./MusicCover";
import { PlayerProgressBar } from "./PlayerProgressBar";
import { MusicTrack } from "@/types/music";
import {
  ChevronDown,
  Heart,
  ListVideo,
  Shuffle,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  SquareArrowOutUpRight,
  ClockFading,
  Maximize2,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useMounted } from "@/hooks/use-mounted";
import { usePlayerActions } from "@/hooks/usePlayerActions";
import { usePlayerUIState } from "@/hooks/usePlayerUIState";
import { PlayerQueueDrawer } from "./PlayerQueueDrawer";
import { MusicTrackMobileMenu } from "./MusicTrackMobileMenu";
import { AddToPlaylistDrawer } from "./AddToPlaylistDrawer";
import { QualityDrawer } from "./settings/QualityDrawer";
import { PlaybackSpeedDrawer } from "./settings/PlaybackSpeedDrawer";
import { SleepTimerDrawer } from "./settings/SleepTimerDrawer";
import { downloadMusicTrack } from "@/lib/utils/download";
import { getQualityShortLabel } from "@/lib/utils/quality";
import { formatTime } from "@/lib/utils/time";
import {
  useMusicStore,
  type FullScreenBackgroundMode,
} from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import toast from "react-hot-toast";
import { useCoverColors } from "@/hooks/useCoverColors";
import { useLandscapeMode } from "@/hooks/useLandscapeMode";
import { usePlayerSwipeGestures } from "@/hooks/usePlayerSwipeGestures";
import { useSystemBarsStyleOverride } from "@/hooks/useSystemBarsStyleOverride";
import { LandscapePlayer } from "@/components/LandscapePlayer";

/**
 * 播放页展开/收起动画时长，必须与容器上的 `duration-500` 保持一致。
 * 系统栏颜色延后这么久再切，等页面铺满再变。
 */
const PLAYER_TRANSITION_MS = 500;

interface ModeIconProps {
  isRepeat: boolean;
  isShuffle: boolean;
}

function ModeIcon({ isRepeat, isShuffle }: ModeIconProps) {
  if (isRepeat) return <Repeat1 className="h-5 w-5" />;
  if (isShuffle) return <Shuffle className="h-5 w-5" />;
  return <Repeat className="h-5 w-5" />;
}

const BackgroundLayer = memo(
  ({
    colors,
    coverUrl,
    mode,
  }: {
    colors: SodaColors | null;
    coverUrl: string | null;
    mode: FullScreenBackgroundMode;
  }) => {
    const showThemeColor = mode === "theme" && !!colors;
    const showCoverMask = mode === "cover" && coverUrl;
    const dynamicStyle = useMemo(() => {
      if (!showThemeColor || !colors) return undefined;
      const [tr, tg, tb] = colors.top;
      const [br, bg, bb] = colors.bottom;
      // 中间色用上下色的中点，避免两色直连时过渡带出现在歌词区域正中
      const mid = [
        Math.round((tr + br) / 2),
        Math.round((tg + bg) / 2),
        Math.round((tb + bb) / 2),
      ];
      return {
        background: `linear-gradient(to bottom,
        rgb(${tr}, ${tg}, ${tb}) 0%,
        rgb(${mid.join(", ")}) 48%,
        rgb(${br}, ${bg}, ${bb}) 100%)`,
      } as React.CSSProperties;
    }, [colors, showThemeColor]);

    /** 顶部主色光晕：把封面主色再提一层，让小面积主色（如红色标题）也能被感知到 */
    const glowStyle = useMemo(() => {
      if (!showThemeColor || !colors) return undefined;
      const [r, g, b] = colors.dominant;
      // 亮主色（白底封面）若按固定透明度叠加会把顶部糊成一片，白字和图标直接失读，按亮度降透明度
      const l = srgbToLab(colors.dominant)[0];
      const alpha = l > 65 ? 0.12 : l > 45 ? 0.22 : 0.32;
      return {
        background: `radial-gradient(125% 70% at 50% -8%, rgba(${r}, ${g}, ${b}, ${alpha}), transparent 62%)`,
      } as React.CSSProperties;
    }, [colors, showThemeColor]);

    return (
      <div className="absolute inset-0 z-[-1] overflow-hidden bg-zinc-950">
        {/* 动态颜色层 */}
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-1000 ease-in-out",
            showThemeColor ? "opacity-100" : "opacity-0"
          )}
        >
          <div className="absolute inset-0" style={dynamicStyle} />
          <div className="absolute inset-0" style={glowStyle} />
        </div>

        {/* 可读性遮罩：顶部保留封面色调，中下部压暗，保证白色歌词与控件不被彩色背景吞掉 */}
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-1000 bg-linear-to-b from-transparent via-black/12 to-black/55",
            showThemeColor ? "opacity-100" : "opacity-0"
          )}
        />

        {/* 封面遮罩层 */}
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-1000",
            showCoverMask ? "opacity-100" : "opacity-0"
          )}
        >
          {coverUrl && (
            <img
              src={coverUrl}
              alt=""
              aria-hidden="true"
              className="absolute inset-[-32px] h-[calc(100%+64px)] w-[calc(100%+64px)] object-cover blur-3xl scale-110"
            />
          )}
          <div className="absolute inset-0 bg-black/60" />
          <div className="absolute inset-0 bg-linear-to-b from-black/10 via-zinc-950/20 to-black/60" />
        </div>

        {/* 兜底背景层 */}
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-1000",
            showThemeColor || showCoverMask ? "opacity-0" : "opacity-100"
          )}
        >
          <div className="absolute inset-0 bg-linear-to-b from-zinc-900 via-zinc-950 to-black" />
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-2xl h-[60vh] opacity-30 pointer-events-none"
            style={{
              background:
                "radial-gradient(circle at 50% 0%, rgba(255,255,255,0.08) 0%, transparent 70%)",
            }}
          />
        </div>

        {/* 噪点层 */}
        <div className="absolute inset-0 opacity-[0.02] mix-blend-overlay pointer-events-none select-none bg-[url('data:image/svg+xml,...')]" />
      </div>
    );
  }
);
BackgroundLayer.displayName = "BackgroundLayer";

interface FullScreenPlayerProps {
  isFullScreen: boolean;
  onClose: () => void;
}

export function FullScreenPlayer({
  isFullScreen,
  onClose,
}: FullScreenPlayerProps) {
  const isMounted = useMounted();
  /**
   * 播放器背景恒为深色（封面主色 / zinc-950），系统栏必须用浅色图标。
   * 否则浅色主题下会按主题设成深色图标，落在深色背景上就是黑底黑图标。
   *
   * 延后到展开动画结束再生效：否则点播放条的一瞬间状态栏就跳成浅色图标，
   * 而此时页面还没铺满，观感是「颜色先变、页面后到」。
   */
  useSystemBarsStyleOverride(true, isFullScreen, PLAYER_TRANSITION_MS);
  /** 横屏沉浸模式：手动进入后锁定横屏，由独立的 LandscapePlayer 渲染 */
  const {
    isLandscapeMode,
    enter: enterLandscapeMode,
    exit: exitLandscapeMode,
  } = useLandscapeMode(isFullScreen);
  const {
    showLyrics,
    setShowLyrics,
    moreDrawerOpen,
    setMoreDrawerOpen,
    isAddToPlaylistOpen,
    setIsAddToPlaylistOpen,
    qualityDrawerOpen,
    setQualityDrawerOpen,
    speedDrawerOpen,
    setSpeedDrawerOpen,
    sleepDrawerOpen,
    setSleepDrawerOpen,
  } = usePlayerUIState(isFullScreen);

  const {
    queue,
    quality,
    currentIndex,
    setCurrentIndexAndPlay,
    clearQueue,
    reshuffle,
    removeFromQueue,
    playTrackAsNext,
    currentAudioUrl,
    fullScreenBackgroundMode,
    coverSize,
    coverRadius,
    playbackSpeed,
    sleepTimerIsActive,
    sleepTimerRemaining,
    isPlaying,
    isLoading,
    isRepeat,
    isShuffle,
    togglePlay,
    toggleRepeat,
    toggleShuffle,
    coverUrl,
  } = useMusicStore(
    useShallow((state) => ({
      queue: state.queue,
      currentIndex: state.currentIndex,
      setCurrentIndexAndPlay: state.setCurrentIndexAndPlay,
      clearQueue: state.clearQueue,
      reshuffle: state.reshuffle,
      removeFromQueue: state.removeFromQueue,
      playTrackAsNext: state.playTrackAsNext,
      currentAudioUrl: state.currentAudioUrl,
      quality: state.quality,
      fullScreenBackgroundMode: state.fullScreenBackgroundMode,
      coverSize: state.coverSize,
      coverRadius: state.coverRadius,
      playbackSpeed: state.playbackSpeed,
      sleepTimerIsActive: state.sleepTimerIsActive,
      sleepTimerRemaining: state.sleepTimerRemaining,
      isPlaying: state.isPlaying,
      isLoading: state.isLoading,
      isRepeat: state.isRepeat,
      isShuffle: state.isShuffle,
      togglePlay: state.togglePlay,
      toggleRepeat: state.toggleRepeat,
      toggleShuffle: state.toggleShuffle,
      coverUrl: state.coverUrl,
    }))
  );

  const currentTrack = queue[currentIndex] || null;

  const [isCoverPreviewOpen, setIsCoverPreviewOpen] = useState(false);

  /** 封面长按 → 打开图片预览（无封面时提示） */
  const handleCoverLongPress = () => {
    if (!coverUrl) {
      toast.error("暂无封面");
      return;
    }
    setIsCoverPreviewOpen(true);
  };

  const {
    handleShare,
    handleToggleLike,
    isCurrentTrackFavorite,
    trackInfoPressHandlers,
    coverPressHandlers,
  } = usePlayerActions(currentTrack, currentAudioUrl, handleCoverLongPress);

  const { colors: backgroundColors } = useCoverColors(
    coverUrl && fullScreenBackgroundMode === "theme" ? coverUrl : null
  );

  /** 封面投影色：背景基色 Lab 亮度 -20，与背景渐变同色相，避免高饱和主色形成突兀彩色光晕 */
  const shadowColor = useMemo(() => {
    if (!backgroundColors) return null;
    const lab = srgbToLab(backgroundColors.top);
    return labToSrgb([Math.max(0, lab[0] - 20), lab[1], lab[2]]);
  }, [backgroundColors]);

  const playTrack = (index: number) => setCurrentIndexAndPlay(index);

  const handleClearQueue = () => {
    if (confirm("确定要清空播放列表吗？")) {
      clearQueue();
      toast.success("播放列表已清空");
    }
  };

  const handleRemoveFromQueue = (track: MusicTrack) => {
    removeFromQueue(track.id);
  };

  const handlePrev = useCallback(() => {
    if (queue.length === 0) return;
    setCurrentIndexAndPlay((currentIndex - 1 + queue.length) % queue.length);
  }, [queue.length, currentIndex, setCurrentIndexAndPlay]);

  const handleNext = useCallback(() => {
    if (queue.length === 0) return;
    setCurrentIndexAndPlay((currentIndex + 1) % queue.length);
  }, [queue.length, currentIndex, setCurrentIndexAndPlay]);

  const gestureAreaRef = useRef<HTMLDivElement | null>(null);

  /**
   * 歌词页、封面预览、横屏沉浸模式都不接手势：
   * 歌词要能原生滚动，预览要能双指缩放，横屏有自己的交互。
   */
  const swipeEnabled =
    isFullScreen && !showLyrics && !isCoverPreviewOpen && !isLandscapeMode;

  /**
   * touch-action 必须同步关掉：否则 WebView 把上滑当页面滚动手势，
   * 手指抬起后的惯性期内紧接着的 tap 只用于「停止滚动」，click 根本不会派发，
   * 表现就是「上滑之后再点一下没反应」。封面页本来就没有要原生滚动的内容。
   */
  const gestureAreaStyle = {
    touchAction: swipeEnabled ? "none" : "auto",
  } as const;

  const swipe = usePlayerSwipeGestures({
    enabled: swipeEnabled,
    onClose,
    onPrev: handlePrev,
    onNext: handleNext,
    // 轻点在 touchend 里处理：不依赖 click，避免上滑/滚动后点击被 WebView 吞掉
    onTap: () => {
      if (isCoverPreviewOpen) return;
      setShowLyrics(!showLyrics);
    },
    containerRef: gestureAreaRef,
  });

  /** 下拉跟手位移只作用于整页容器；松手后交回 CSS transition 回弹或滑出 */
  const dragStyle =
    swipe.isDragging || swipe.dragY > 0
      ? {
          transform: `translateY(${swipe.dragY}px)`,
          transition: swipe.isDragging
            ? "none"
            : "transform 500ms cubic-bezier(0.32, 0.72, 0, 1)",
        }
      : undefined;

  if (!isMounted) return null;

  // 循环切换播放模式：none → repeat → shuffle → none
  const handleModeToggle = () => {
    if (!isShuffle && !isRepeat) toggleRepeat();
    else if (isRepeat) {
      toggleRepeat();
      toggleShuffle();
    } else toggleShuffle();
  };

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 transition-transform duration-500 ease-in-out flex flex-col",
        isFullScreen ? "translate-y-0" : "translate-y-full"
      )}
      style={dragStyle}
    >
      {/* 背景渲染层 */}
      <BackgroundLayer
        colors={backgroundColors}
        coverUrl={coverUrl}
        mode={fullScreenBackgroundMode}
      />

      {/* 横屏沉浸模式：独立组件，覆盖于普通布局之上 */}
      {isLandscapeMode && (
        <LandscapePlayer
          background={
            <BackgroundLayer
              colors={backgroundColors}
              coverUrl={coverUrl}
              mode={fullScreenBackgroundMode}
            />
          }
          onExit={exitLandscapeMode}
        />
      )}

      <header className="shrink-0 grid grid-cols-3 items-center px-6 pt-[calc(1rem+var(--safe-area-top))] relative z-10">
        <div className="flex justify-start">
          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 text-white/60 hover:bg-white/10 hover:text-white"
            onClick={() => {
              onClose();
            }}
          >
            <ChevronDown className="h-6 w-6" />
          </Button>
        </div>
        <div className="flex justify-center">
          {!showLyrics && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs tracking-widest text-white/50 hover:text-white hover:bg-white/10 h-8 px-3"
              onClick={() => setQualityDrawerOpen(true)}
            >
              {getQualityShortLabel(quality)}
            </Button>
          )}
        </div>
        <div className="flex items-center justify-end">
          {showLyrics ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 text-white/60 hover:bg-white/10 hover:text-white"
              onClick={enterLandscapeMode}
              aria-label="横屏沉浸播放"
              title="横屏沉浸播放"
            >
              <Maximize2 className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 text-white/60 hover:bg-white/10 hover:text-white"
              onClick={handleShare}
              aria-label="分享"
              title="分享"
            >
              <SquareArrowOutUpRight className="h-5 w-5" />
            </Button>
          )}
        </div>
      </header>

      <div
        ref={gestureAreaRef}
        className="flex-1 flex flex-col items-center justify-center px-2 relative z-10 overflow-hidden cursor-pointer"
        {...swipe.handlers}
        style={gestureAreaStyle}
        onClick={() => {
          // 封面预览打开期间不切换歌词，避免长按后的 click 冒泡到这里
          if (isCoverPreviewOpen) return;
          // 滑动切歌/收起后浏览器还会补一次 click，这里吞掉，否则会顺带切到歌词页
          if (swipe.shouldSuppressClick()) return;
          setShowLyrics(!showLyrics);
        }}
      >
        {showLyrics ? (
          <div className="w-full h-full">
            <LyricsPanel track={currentTrack} active={isFullScreen} />
          </div>
        ) : (
          <div
            {...coverPressHandlers}
            title="长按预览图片"
            className={cn(
              "relative aspect-square overflow-hidden transition-transform duration-500 ring-1 ring-white/5",
              isPlaying ? "scale-100" : "scale-[0.95]"
            )}
            style={{
              width: `min(${coverSize}px, calc(100vw - 16px), 70svh)`,
              borderRadius: coverRadius,
              boxShadow:
                fullScreenBackgroundMode === "theme" && shadowColor
                  ? `0 30px 60px -12px rgba(${shadowColor.join(", ")}, 0.4)`
                  : "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
            }}
          >
            <MusicCover
              src={coverUrl}
              alt={currentTrack?.name}
              className="h-full w-full object-cover dark select-none touch-none"
              iconClassName="h-16 w-16 text-white/30"
              previewOpen={isCoverPreviewOpen}
              onPreviewOpenChange={setIsCoverPreviewOpen}
            />
          </div>
        )}
      </div>

      <div className="shrink-0 px-8 py-4 relative z-10">
        <div className="flex items-center justify-between">
          <div
            className={cn("min-w-0 flex-1 cursor-pointer select-none")}
            onMouseDown={trackInfoPressHandlers.onMouseDown}
            onMouseUp={trackInfoPressHandlers.onMouseUp}
            onMouseLeave={trackInfoPressHandlers.onMouseLeave}
            onTouchStart={trackInfoPressHandlers.onTouchStart}
            onTouchEnd={trackInfoPressHandlers.onTouchEnd}
            title="长按复制歌曲信息"
          >
            <h2 className="truncate text-xl font-semibold text-white">
              {currentTrack?.name || "未知歌曲"}
            </h2>
            <p className="truncate text-sm text-white/60 mt-1">
              {currentTrack?.artist?.join(", ") || "未知歌手"}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-white/70 hover:bg-white/10 hover:text-white"
              onClick={(e) => {
                e.stopPropagation();
                handleToggleLike();
              }}
            >
              <Heart
                className={cn(
                  "h-6 w-6 transition-all",
                  isCurrentTrackFavorite && "fill-primary text-primary"
                )}
              />
            </Button>
            {currentTrack && (
              <>
                <MusicTrackMobileMenu
                  track={currentTrack}
                  open={moreDrawerOpen}
                  onOpenChange={setMoreDrawerOpen}
                  onAddToPlaylist={() => {
                    setIsAddToPlaylistOpen(true);
                  }}
                  onDownload={() => {
                    downloadMusicTrack(currentTrack, parseInt(quality));
                  }}
                  isFavorite={isCurrentTrackFavorite}
                  onToggleLike={() => {
                    handleToggleLike();
                  }}
                  triggerClassName="h-10 w-10 text-white/70 hover:bg-white/10 hover:text-white"
                  onNavigate={() => {
                    onClose();
                  }}
                />
                <AddToPlaylistDrawer
                  open={isAddToPlaylistOpen}
                  onOpenChange={setIsAddToPlaylistOpen}
                  track={currentTrack}
                />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-8 relative z-10">
        <PlayerProgressBar
          className="relative"
          leftTimeSuffix={
            playbackSpeed !== 1.0 ? (
              <span className="ml-1 text-[0.7em] align-sub opacity-70">
                x{playbackSpeed.toFixed(1)}
              </span>
            ) : null
          }
          centerContent={
            sleepTimerIsActive ? (
              <span className="flex items-center gap-1 text-[0.85em]">
                <ClockFading className="w-2.5 h-2.5" />
                {formatTime(sleepTimerRemaining)}
              </span>
            ) : null
          }
          onLeftTimeClick={() => setSpeedDrawerOpen(true)}
          onRightTimeClick={() => setSleepDrawerOpen(true)}
          onCenterClick={() => setSleepDrawerOpen(true)}
        />
      </div>

      <div className="shrink-0 flex items-center justify-between px-8 py-6 pb-[calc(2rem+var(--safe-area-bottom))] relative z-10">
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 transition-colors text-white/70 hover:text-white hover:bg-white/10"
          onClick={handleModeToggle}
        >
          <ModeIcon isRepeat={isRepeat} isShuffle={isShuffle} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 text-white/70 hover:bg-white/10 hover:text-white"
          onClick={handlePrev}
        >
          <SkipBack className="h-6 w-6 fill-current" />
        </Button>
        <Button
          size="icon"
          className="h-16 w-16 rounded-full bg-white text-black shadow-lg hover:scale-105 transition-all active:scale-95"
          onClick={togglePlay}
          disabled={isLoading}
        >
          {isLoading ? (
            <Spinner className="h-7 w-7 text-black" />
          ) : isPlaying ? (
            <Pause className="h-7 w-7 fill-current" />
          ) : (
            <Play className="h-7 w-7 fill-current ml-1" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 text-white/70 hover:bg-white/10 hover:text-white"
          onClick={handleNext}
        >
          <SkipForward className="h-6 w-6 fill-current" />
        </Button>
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
            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 text-white/70 hover:bg-white/10 hover:text-white"
            >
              <ListVideo className="h-5 w-5" />
            </Button>
          }
        />
      </div>

      <QualityDrawer
        open={qualityDrawerOpen}
        onOpenChange={setQualityDrawerOpen}
      />
      <PlaybackSpeedDrawer
        open={speedDrawerOpen}
        onOpenChange={setSpeedDrawerOpen}
      />
      <SleepTimerDrawer
        open={sleepDrawerOpen}
        onOpenChange={setSleepDrawerOpen}
      />
    </div>,
    document.body
  );
}
