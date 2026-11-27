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
  const viewportRef = useRef<HTMLDivElement>(null);
  const hasScrolledOnOpen = useRef(false);
  // Drawer 内容在展开动画里才挂载；等视口就绪再交给 virtualizer 监听滚动，
  // 否则它拿不到 scrollElement，定位后行窗口不会跟着更新。
  const [viewportReady, setViewportReady] = useState(false);
  const listItems = activeTab === "queue" ? queue : history;
  const ROW_HEIGHT = 50;
  // 两个 tab 都能定位到「当前播放」：队列按序号，历史按 id 找同一首歌
  const currentTrackId = queue[currentIndex]?.id;
  const targetIndex =
    activeTab === "queue"
      ? currentIndex
      : history.findIndex((track) => track.id === currentTrackId);

  // 队列动辄几百首：整列表挂载会让每行各自请求封面，抽屉打开明显卡。
  // 复用 MusicTrackList 的虚拟滚动，只渲染视口附近十几行。
  const virtualizer = useVirtualizer({
    count: listItems.length,
    getScrollElement: () => (viewportReady ? viewportRef.current : null),
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    initialRect: { width: 0, height: 600 },
  });

  useEffect(() => {
    hasScrolledOnOpen.current = false;
    if (!open) setViewportReady(false);
  }, [open]);

  useEffect(() => {
    if (!open || targetIndex < 0 || hasScrolledOnOpen.current) return;
    hasScrolledOnOpen.current = true;

    // 抽屉内容（滚动视口）在展开动画里才挂载。virtualizer.scrollToIndex
    // 在 scrollElement 尚未注册时会静默失效，直接设 viewport 的 scrollTop 最稳。
    const timer = window.setTimeout(() => {
      if (viewportRef.current) setViewportReady(true);
    }, 400);

    return () => window.clearTimeout(timer);
  }, [open, targetIndex]);

  // 视口注册到 virtualizer 之后，由它自己滚动并同步行窗口；
  // 直接改 scrollTop 会被 virtualizer 的初始 offset 覆盖成空白。
  useEffect(() => {
    if (!viewportReady || targetIndex < 0) return;
    const timers = [50, 300].map((delay) =>
      window.setTimeout(() => {
        virtualizer.scrollToIndex(targetIndex, { align: "center" });
      }, delay)
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [viewportReady, targetIndex, virtualizer]);

  const handleTabChange = (tab: "queue" | "history") => {
    setActiveTab(tab);
    viewportRef.current?.scrollTo({ top: 0, behavior: "instant" });
  };

  /** 滚回当前播放的歌曲（用户在长列表里翻走后一键归位） */
  const scrollToCurrent = () => {
    if (targetIndex >= 0) {
      virtualizer.scrollToIndex(targetIndex, {
        align: "center",
        behavior: "smooth",
      });
    }
  };

  return (
    <Drawer open={open} onOpenChange={setOpen} direction={direction}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent
        className={cn(
          "gap-0 outline-none",
          direction === "right"
            ? "h-full max-h-full w-[min(24rem,80vw)] rounded-l-3xl"
            : "h-[75vh] max-h-[75vh] rounded-t-3xl"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <DrawerHeader className="shrink-0 px-6 pb-4 pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <button
                onClick={() => handleTabChange("queue")}
                className={cn(
                  "text-base transition-all whitespace-nowrap",
                  activeTab === "queue"
                    ? "font-bold text-foreground tracking-wide"
                    : "font-medium text-muted-foreground hover:text-foreground"
                )}
              >
                播放列表{" "}
                <span className="text-xs opacity-60 ml-0.5">
                  {queue.length}
                </span>
              </button>
              <button
                onClick={() => handleTabChange("history")}
                className={cn(
                  "text-base transition-all whitespace-nowrap",
                  activeTab === "history"
                    ? "font-bold text-foreground tracking-wide"
                    : "font-medium text-muted-foreground hover:text-foreground"
                )}
              >
                最近播放{" "}
                <span className="text-xs opacity-60 ml-0.5">
                  {history.length}
                </span>
              </button>
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
              {targetIndex >= 0 && (
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

        {/* 列表区：上下各一条分隔线，把歌单夹在标题栏和抽屉底部之间 */}
        <div className="min-h-0 flex-1 px-3 pb-[calc(0.75rem+var(--safe-area-bottom))]">
          <div className="h-full border-y border-border">
            <ScrollArea className="h-full" viewportRef={viewportRef}>
              <div
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((item) => {
                  const i = item.index;
                  const track = listItems[i];
                  const isQueue = activeTab === "queue";
                  const isCurrentTrack = isQueue
                    ? i === currentIndex
                    : track.id === queue[currentIndex]?.id;

                  return (
                    <div
                      key={item.key}
                      data-index={i}
                      ref={virtualizer.measureElement}
                      className="absolute left-0 top-0 w-full px-1 pb-0.5"
                      style={{ transform: `translateY(${item.start}px)` }}
                    >
                      <QueueTrackItem
                        track={track}
                        isCurrent={isCurrentTrack}
                        isPlaying={isCurrentTrack && isPlaying}
                        onSelect={() => {
                          if (isQueue) {
                            onPlay(i);
                          } else {
                            // 历史歌曲先加入队列再播放
                            onPlayTrack?.(track);
                          }
                          setOpen(false);
                        }}
                        onRemove={() =>
                          isQueue
                            ? onRemove(track)
                            : removeFromHistory(track.id)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
