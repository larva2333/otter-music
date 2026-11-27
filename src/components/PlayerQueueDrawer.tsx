"use client";

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, X, Maximize2, Dices, LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerDescription,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { CachedImage } from "@/components/CachedImage";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMusicCover } from "@/hooks/useMusicCover";
import { useTabIndicatorSync } from "@/hooks/use-tab-indicator-sync";
import { cn } from "@/lib/utils";
import { useHistoryStore } from "@/store/history-store";
import { useMusicStore } from "@/store/music-store";
import type { MusicTrack } from "@/types/music";
import { t2s, t2sArtists } from "@/lib/utils/t2s";

interface PlayerQueueDrawerProps {
  queue: MusicTrack[];
  currentIndex: number;
  isPlaying: boolean;
  isShuffle: boolean;
  onPlay: (index: number) => void;
  onClear: () => void;
  onReshuffle: () => void;
  onRemove: (track: MusicTrack) => void;
  onPlayTrack?: (track: MusicTrack) => void;
  onOpenChange?: (open: boolean) => void;
  /** 弹出方向：默认底部弹出，横屏沉浸模式使用右端侧边栏 */
  direction?: "bottom" | "right";
  trigger: React.ReactNode;
}

interface QueueTrackItemProps {
  track: MusicTrack;
  isCurrent: boolean;
  isPlaying: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

function QueueTrackItem({
  track,
  isCurrent,
  isPlaying,
  onSelect,
  onRemove,
}: QueueTrackItemProps) {
  // 与主列表 TrackCoverThumb 使用一致的小尺寸（120）与 CachedImage(size=80)，
  // 共享缓存并复用离屏解码池，避免二次打开抽屉重新下载/解码 800px 大图。
  const coverUrl = useMusicCover(track, true, 120);

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      isCurrent &&
      !(await confirmDialog({
        title: `确定删除《${t2s(track.name)}》吗？`,
        destructive: true,
        confirmText: "删除",
      }))
    ) {
      return;
    }
    onRemove();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`播放 ${t2s(track.name)}`}
      className={cn(
        // 紧凑行：封面 36 + 上下各 6，两行文字自然撑到 48 左右
        "grid grid-cols-[36px_1fr_auto] items-center gap-3 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-muted/60 active:bg-muted",
        isCurrent && "bg-primary/10"
      )}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect();
      }}
    >
      <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-muted">
        <CachedImage src={coverUrl} alt="" size={80} className="rounded-lg" />

        {/* 极致小巧的顺序波动动画 */}
        {isCurrent && isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center gap-[3px] rounded-lg bg-black/30 backdrop-blur-[2px]">
            <div className="h-1 w-[2.5px] rounded-full bg-primary animate-[audio-bar_1s_ease-in-out_infinite]" />
            <div className="h-1 w-[2.5px] rounded-full bg-primary animate-[audio-bar_1s_ease-in-out_infinite] [animation-delay:200ms]" />
            <div className="h-1 w-[2.5px] rounded-full bg-primary animate-[audio-bar_1s_ease-in-out_infinite] [animation-delay:400ms]" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex flex-col justify-center overflow-hidden">
        <span
          className={cn(
            "text-sm font-medium truncate leading-tight transition-colors",
            isCurrent ? "text-primary" : "text-foreground"
          )}
        >
          {t2s(track.name)}
        </span>
        <span className="text-sm text-muted-foreground/70 truncate leading-tight">
          {t2sArtists(track.artist).join(" / ")}
        </span>
      </div>

      <div className="flex items-center justify-center -mr-2">
        <button
          className="rounded-lg p-2 text-muted-foreground/50 hover:text-foreground"
          onClick={handleRemove}
          title={`删除`}
          aria-label={`删除 ${t2s(track.name)}`}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export function PlayerQueueDrawer({
  queue,
  currentIndex,
  isPlaying,
  isShuffle,
  onPlay,
  onClear,
  onReshuffle,
  onRemove,
  onPlayTrack,
  onOpenChange,
  direction = "bottom",
  trigger,
}: PlayerQueueDrawerProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  const [activeTab, setActiveTab] = useState<"queue" | "history">("queue");
  const { history, removeFromHistory, clearHistory } = useHistoryStore();

  // 标题 tab 的选中横线：与 SubTabBar 同一套平滑滑块，切换只变颜色、横线跟手落位
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabIds = ["queue", "history"] as const;
  const activeTabIndex = activeTab === "queue" ? 0 : 1;
  const { indicatorRef, hasIndicator, initialRect, handleTrackSettle } =
    useTabIndicatorSync({
      barRef: tabsRef,
      activeIndex: activeTabIndex,
      ids: tabIds,
      attrName: "data-queue-tab",
    });
  const prevTabIndexRef = useRef(activeTabIndex);
  useEffect(() => {
    if (prevTabIndexRef.current !== activeTabIndex) {
      prevTabIndexRef.current = activeTabIndex;
      handleTrackSettle(activeTabIndex, true);
    }
  }, [activeTabIndex, handleTrackSettle]);

  // 播放列表与最近播放各有独立滚动容器：切 tab 只切换显示、不卸载，
  // 两个列表的 scrollTop 互不干扰（共用容器会划一个带动另一个）。
  const queueViewportRef = useRef<HTMLDivElement>(null);
  const historyViewportRef = useRef<HTMLDivElement>(null);
  // 自动定位到「当前播放」只在抽屉首次打开时做一次，切 tab 不再触发
  const didInitialLocateRef = useRef(false);
  // Drawer 内容在展开动画里才挂载；等视口就绪再交给 virtualizer 监听滚动，
  // 否则它拿不到 scrollElement，定位后行窗口不会跟着更新。
  const [viewportReady, setViewportReady] = useState(false);
  const ROW_HEIGHT = 50;
  // 两个 tab 都能定位到「当前播放」：队列按序号，历史按 id 找同一首歌
  const currentTrackId = queue[currentIndex]?.id;
  const queueTargetIndex = currentIndex;
  const historyTargetIndex = history.findIndex(
    (track) => track.id === currentTrackId
  );

  // 队列动辄几百首：整列表挂载会让每行各自请求封面，抽屉打开明显卡。
  // 复用 MusicTrackList 的虚拟滚动，只渲染视口附近十几行。
  const virtualizerOpts = {
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    // 首行与标题栏下方的分隔线留出间距，不贴着
    paddingStart: 8,
    initialRect: { width: 0, height: 600 },
  };
  const queueVirtualizer = useVirtualizer({
    ...virtualizerOpts,
    count: queue.length,
    getScrollElement: () => (viewportReady ? queueViewportRef.current : null),
  });
  const historyVirtualizer = useVirtualizer({
    ...virtualizerOpts,
    count: history.length,
    getScrollElement: () => (viewportReady ? historyViewportRef.current : null),
  });
  const activeVirtualizer =
    activeTab === "queue" ? queueVirtualizer : historyVirtualizer;
  const activeTargetIndex =
    activeTab === "queue" ? queueTargetIndex : historyTargetIndex;

  useEffect(() => {
    if (!open) {
      didInitialLocateRef.current = false;
      setViewportReady(false);
    }
  }, [open]);

  // 抽屉内容（滚动视口）在展开动画里才挂载；等视口就绪再交给 virtualizer。
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      if (queueViewportRef.current) setViewportReady(true);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [open]);

  // 首次打开时定位到当前播放：只依赖 open/视口就绪，不依赖 targetIndex，
  // 这样切 tab 改变 targetIndex 时不会重新触发定位。
  useEffect(() => {
    if (!viewportReady || didInitialLocateRef.current || queueTargetIndex < 0)
      return;
    didInitialLocateRef.current = true;
    const timers = [50, 300].map((delay) =>
      window.setTimeout(() => {
        queueVirtualizer.scrollToIndex(queueTargetIndex, { align: "center" });
      }, delay)
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
    // targetIndex 仅取首次打开时的快照，刻意不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportReady, queueVirtualizer]);

  const handleTabChange = (tab: "queue" | "history") => {
    // 切 tab 不触发任何滚动：保持当前滚动位置原状
    setActiveTab(tab);
  };

  /** 滚回当前播放的歌曲（用户在长列表里翻走后一键归位） */
  const scrollToCurrent = () => {
    if (activeTargetIndex >= 0) {
      activeVirtualizer.scrollToIndex(activeTargetIndex, {
        align: "center",
        behavior: "smooth",
      });
    }
  };

  return (
    <Drawer open={open} onOpenChange={setOpen} direction={direction}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent
        data-player-queue-drawer=""
        className={cn(
          "gap-0 outline-none",
          direction === "right"
            ? "h-full max-h-full w-[min(24rem,80vw)] rounded-l-3xl"
            : "h-[75vh] max-h-[75vh] rounded-t-3xl"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <DrawerHeader className="shrink-0 px-6 pb-0 pt-6">
          <div className="flex items-center justify-between">
            {/* 标题 tab：统一粗体，切换只改变颜色；选中横线贴在下方分隔线上 */}
            <div
              ref={tabsRef}
              className="relative flex h-11 items-center gap-6"
            >
              <button
                data-queue-tab="queue"
                onClick={() => handleTabChange("queue")}
                className={cn(
                  "inline-flex h-full items-center text-base font-bold transition-colors whitespace-nowrap",
                  activeTab === "queue"
                    ? "text-foreground"
                    : "text-muted-foreground/70 hover:text-foreground"
                )}
              >
                播放列表{" "}
                <span className="text-xs opacity-60 ml-0.5">
                  {queue.length}
                </span>
              </button>
              <button
                data-queue-tab="history"
                onClick={() => handleTabChange("history")}
                className={cn(
                  "inline-flex h-full items-center text-base font-bold transition-colors whitespace-nowrap",
                  activeTab === "history"
                    ? "text-foreground"
                    : "text-muted-foreground/70 hover:text-foreground"
                )}
              >
                最近播放{" "}
                <span className="text-xs opacity-60 ml-0.5">
                  {history.length}
                </span>
              </button>

              {hasIndicator && initialRect && (
                <div
                  ref={indicatorRef}
                  aria-hidden
                  className="pointer-events-none absolute bottom-0 left-0 h-[2.5px] rounded-full bg-primary"
                  style={{
                    transform: `translate3d(${initialRect.left}px, ${initialRect.top}px, 0)`,
                    width: initialRect.width,
                  }}
                />
              )}
            </div>

            <DrawerDescription className="sr-only">
              当前播放队列，可切换、清空或删除歌曲。
            </DrawerDescription>

            <div className="flex items-center gap-2">
              {activeTab === "queue" && isShuffle && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
                  onClick={onReshuffle}
                  title="再次打乱"
                >
                  <Dices className="h-4 w-4" />
                </Button>
              )}
              {activeTargetIndex >= 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
                  onClick={scrollToCurrent}
                  title="定位到当前播放"
                >
                  <LocateFixed className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
                onClick={() => {
                  setOpen(false);
                  useMusicStore.getState().setIsFullScreenPlayer(false);
                  navigate(
                    activeTab === "queue"
                      ? "/mine?type=queue"
                      : "/mine?type=history"
                  );
                }}
                title={activeTab === "queue" ? "展开播放列表" : "展开历史记录"}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive transition-colors"
                onClick={
                  activeTab === "queue"
                    ? async () => {
                        if (
                          await confirmDialog({
                            title: "确定清空播放列表吗？",
                            destructive: true,
                            confirmText: "清空",
                          })
                        ) {
                          onClear();
                        }
                      }
                    : async () => {
                        if (
                          await confirmDialog({
                            title: "确定清空播放历史吗？",
                            destructive: true,
                            confirmText: "清空",
                          })
                        ) {
                          clearHistory();
                        }
                      }
                }
                title={activeTab === "queue" ? "清空播放列表" : "清空播放历史"}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DrawerHeader>

        {/* 列表区：只保留标题栏下方的分隔线；底部不留额外间距，
            让最后几首歌能显示到原底部导航栏所在的位置 */}
        <div className="min-h-0 flex-1 px-3 pb-[var(--safe-area-bottom)]">
          <div className="relative h-full border-t border-border">
            {/* 两个 tab 各自独立的 ScrollArea：用 visibility:hidden 叠放而非 display:none，
                避免 WebView/浏览器销毁盒模型导致 scrollTop 归零及 virtualizer 尺寸重置 */}
            <div
              data-queue-panel="queue"
              aria-hidden={activeTab !== "queue"}
              className={cn(
                "absolute inset-0",
                activeTab !== "queue" && "invisible pointer-events-none"
              )}
            >
              <ScrollArea className="h-full" viewportRef={queueViewportRef}>
                <div
                  className="relative w-full"
                  style={{ height: queueVirtualizer.getTotalSize() }}
                >
                  {queueVirtualizer.getVirtualItems().map((item) => {
                    const i = item.index;
                    const track = queue[i];
                    const isCurrentTrack = i === currentIndex;

                    return (
                      <div
                        key={item.key}
                        data-index={i}
                        ref={queueVirtualizer.measureElement}
                        className="absolute left-0 top-0 w-full px-1 pb-0.5"
                        style={{ transform: `translateY(${item.start}px)` }}
                      >
                        <QueueTrackItem
                          track={track}
                          isCurrent={isCurrentTrack}
                          isPlaying={isCurrentTrack && isPlaying}
                          onSelect={() => {
                            onPlay(i);
                            setOpen(false);
                          }}
                          onRemove={() => onRemove(track)}
                        />
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            <div
              data-queue-panel="history"
              aria-hidden={activeTab !== "history"}
              className={cn(
                "absolute inset-0",
                activeTab !== "history" && "invisible pointer-events-none"
              )}
            >
              <ScrollArea className="h-full" viewportRef={historyViewportRef}>
                <div
                  className="relative w-full"
                  style={{ height: historyVirtualizer.getTotalSize() }}
                >
                  {historyVirtualizer.getVirtualItems().map((item) => {
                    const i = item.index;
                    const track = history[i];
                    const isCurrentTrack = track.id === currentTrackId;

                    return (
                      <div
                        key={item.key}
                        data-index={i}
                        ref={historyVirtualizer.measureElement}
                        className="absolute left-0 top-0 w-full px-1 pb-0.5"
                        style={{ transform: `translateY(${item.start}px)` }}
                      >
                        <QueueTrackItem
                          track={track}
                          isCurrent={isCurrentTrack}
                          isPlaying={isCurrentTrack && isPlaying}
                          onSelect={() => {
                            // 历史歌曲先加入队列再播放
                            onPlayTrack?.(track);
                            setOpen(false);
                          }}
                          onRemove={() => removeFromHistory(track.id)}
                        />
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
