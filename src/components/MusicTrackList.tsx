import React, {
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
  DropAnimation,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  restrictToVerticalAxis,
  restrictToWindowEdges,
} from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import {
  ListChecks,
  Plus,
  Heart,
  Download,
  Trash2,
  Loader2,
  Search,
  Check,
  MoreVertical,
  ListPlus,
  Languages,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MusicTrackItem } from "./MusicTrackItem";
import { AddToPlaylistDrawer } from "./AddToPlaylistDrawer";
import { downloadMusicTrackBatch } from "@/lib/utils/download";
import { useMusicStore } from "@/store/music-store";
import { useAutoLoadMore } from "@/hooks/use-auto-load-more";
import { useExitLayerStore } from "@/hooks/useExitLayer";
import { MusicTrack } from "@/types/music";
import toast from "react-hot-toast";
import { processBatchCPU } from "@/lib/utils";
import { useShallow } from "zustand/react/shallow";

interface MusicTrackListProps {
  tracks: MusicTrack[];
  onPlay: (track: MusicTrack) => void;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  playlistId?: string;
  currentTrackId?: string;
  isPlaying?: boolean;
  onRemove?: (track: MusicTrack, silent?: boolean) => void | Promise<void>;
  onBatchRemove?: (tracks: MusicTrack[]) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loading?: boolean;
  /** 开启后滚动到接近底部即自动加载下一页，底部按钮退化为状态提示 */
  autoLoadMore?: boolean;
  emptyMessage?: string;
  removeLabel?: string;
  confirmRemove?: boolean;
  showSourceBadge?: boolean;
  onReorder?: (newOrder: MusicTrack[]) => void;
  showItemRemove?: boolean;
  preselectedIds?: Set<string>;
  onSelectionModeChange?: (active: boolean) => void;
  /** 提供后，多选菜单显示「写入简体标签」。仅本地音源需要。 */
  onBatchConvertToSimplified?: (tracks: MusicTrack[]) => void;
}

const ROW_HEIGHT = 60;

function SortableTrackItem({
  track,
  enabled,
  children,
}: {
  track: MusicTrack;
  /** 仅多选态可拖拽排序；容器始终渲染，避免进出多选时行被重建 */
  enabled: boolean;
  children: React.ReactElement;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: track.id, disabled: !enabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? transition : undefined,
    zIndex: isDragging ? 1 : 0,
    position: "relative" as const,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {React.cloneElement(children as React.ReactElement<any>, {
        dragHandleProps: listeners,
        isSortable: enabled,
      })}
    </div>
  );
}

export function MusicTrackList({
  tracks,
  onPlay,
  scrollContainerRef,
  playlistId,
  currentTrackId,
  isPlaying,
  onRemove,
  onBatchRemove,
  onLoadMore,
  hasMore,
  loading,
  autoLoadMore = false,
  emptyMessage = "暂无歌曲",
  removeLabel = "删除",
  confirmRemove,
  showSourceBadge = false,
  onReorder,
  showItemRemove = true,
  preselectedIds,
  onSelectionModeChange,
  onBatchConvertToSimplified,
}: MusicTrackListProps) {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isAddToPlaylistOpen, setIsAddToPlaylistOpen] = useState(false);
  const internalRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(
    // 长按 350ms 才进入拖拽，避免手指一碰行就开始拖（滑动多选也靠滑动手势）
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 350,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const enableDnd = isSelectionMode && !!onReorder;
  const trackIds = useMemo(() => tracks.map((t) => t.id), [tracks]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (active.id !== over?.id && onReorder) {
      const oldIndex = tracks.findIndex((t) => t.id === active.id);
      const newIndex = tracks.findIndex((t) => t.id === over?.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        onReorder(arrayMove(tracks, oldIndex, newIndex));
      }
    }
  };

  const {
    quality,
    addBatchToFavorites,
    addBatchToNextPlay,
    showSourceBadge: storeShowBadge,
  } = useMusicStore(
    useShallow((state) => ({
      quality: state.quality,
      addBatchToFavorites: state.addBatchToFavorites,
      addBatchToNextPlay: state.addBatchToNextPlay,
      showSourceBadge: state.showSourceBadge,
    }))
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  /* ---------------- 长按后滑动多选 ----------------
   *
   * 手指按住某行 450ms 进入多选，这一行就是"笔刷起点"：
   * 起点被选中 → 不抬手划过的行全部选中；起点被取消 → 划过的行全部取消。
   * 整段手势是同一种状态，不再逐行 toggle（靠 lastDragIdRef 去掉同一行的重复处理）。
   *
   * 监听挂在 document 上而不是行元素上：长按瞬间列表会切到多选形态（出现勾选框、
   * 排序页还会多包一层拖拽容器），行元素有机会被重建，挂在行上的 touch 序列会断掉。
   */
  const lastDragIdRef = useRef<string | null>(null);
  const stopDragSelectRef = useRef<(() => void) | null>(null);

  const startDragSelect = useCallback(
    (anchorId: string, paintSelected: boolean) => {
      lastDragIdRef.current = anchorId;
      if (stopDragSelectRef.current) return; // 上一次还没结束（理论上不会），别叠监听

      const applyAt = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        const row =
          el instanceof Element ? el.closest("[data-track-id]") : null;
        const id = row?.getAttribute("data-track-id");
        if (!id || id === lastDragIdRef.current) return;
        lastDragIdRef.current = id;
        setSelectedIds((prev) => {
          if (prev.has(id) === paintSelected) return prev;
          const next = new Set(prev);
          if (paintSelected) next.add(id);
          else next.delete(id);
          return next;
        });
      };

      const onMove = (e: TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        // 滑动多选期间不能让它滚起来，否则行会从指下跑掉
        if (e.cancelable) e.preventDefault();
        applyAt(touch.clientX, touch.clientY);
      };

      const finish = () => {
        document.removeEventListener("touchmove", onMove);
        document.removeEventListener("touchend", finish);
        document.removeEventListener("touchcancel", finish);
        stopDragSelectRef.current = null;
        lastDragIdRef.current = null;
      };

      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", finish);
      document.addEventListener("touchcancel", finish);
      stopDragSelectRef.current = finish;
    },
    []
  );

  // 列表在长按中途被卸载时，document 上的监听必须收回
  useEffect(() => {
    return () => {
      stopDragSelectRef.current?.();
    };
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(
      selectedIds.size === tracks.length
        ? new Set()
        : new Set(tracks.map((t) => t.id))
    );
  }, [selectedIds.size, tracks]);

  // 外部预选：去重等功能触发时，合并 ID 并进入选择模式
  useEffect(() => {
    if (!preselectedIds || preselectedIds.size === 0) return;
    setIsSelectionMode(true);
    setSelectedIds((prev) => {
      if (prev.size === 0) return preselectedIds;
      const merged = new Set(prev);
      preselectedIds.forEach((id) => merged.add(id));
      return merged;
    });
  }, [preselectedIds]);

  const resetSelection = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
    onSelectionModeChange?.(false);
  }, [onSelectionModeChange]);

  /* 多选态注册成「退出层」：系统返回键 / 安卓返回手势先退出多选，
   * 而不是直接退出歌单详情页。RootLayout 的 backButton 处理会优先消费这层。
   * 用 ref 转发回调，避免调用方传内联函数时反复重注册。 */
  const resetSelectionRef = useRef(resetSelection);
  resetSelectionRef.current = resetSelection;
  const pushExitLayer = useExitLayerStore((s) => s.push);
  const popExitLayer = useExitLayerStore((s) => s.pop);

  useEffect(() => {
    if (!isSelectionMode) return;
    const id = pushExitLayer({ close: () => resetSelectionRef.current() });
    return () => popExitLayer(id);
  }, [isSelectionMode, pushExitLayer, popExitLayer]);

  const getSelectedTracks = useCallback(
    () => tracks.filter((t) => selectedIds.has(t.id)),
    [tracks, selectedIds]
  );

  const handleBatchFavorites = () => {
    const selected = getSelectedTracks();
    if (!selected.length) return;
    addBatchToFavorites(selected);
    toast.success(`已喜欢 ${selected.length} 首`);
    resetSelection();
  };

  /** 批量添加到下一首（单次 setState，无迭代） */
  const handleBatchNextPlay = () => {
    const selected = getSelectedTracks();
    if (!selected.length) return;
    addBatchToNextPlay(selected);
    toast.success(`已添加 ${selected.length} 首`);
    resetSelection();
  };

  const handleBatchRemove = async () => {
    if (!onRemove && !onBatchRemove) return;
    const count = selectedIds.size;
    // confirmRemove=false 表示上层自带确认弹窗（本地音乐页的删除对话框）。
    // 这里再 confirm 一次就会出现「弹两次」。
    const delegatesConfirm = confirmRemove === false;
    if (
      !delegatesConfirm &&
      !(await confirmDialog({
        title: `确定${removeLabel}选中的 ${count} 首歌曲吗？`,
        destructive: true,
        confirmText: removeLabel,
      }))
    )
      return;

    const selected = getSelectedTracks();
    if (onBatchRemove) {
      onBatchRemove(selected);
      // 上层的对话框还没确认，抢在前面报「已删除」是假的
      if (!delegatesConfirm) toast.success(`已${removeLabel} ${count} 首`);
      resetSelection();
      return;
    }

    const toastId = toast.loading(`${removeLabel}中 0/${count}`);
    await processBatchCPU(
      selected,
      (t) => onRemove!(t, true),
      (c, t) => toast.loading(`${removeLabel}中 ${c}/${t}`, { id: toastId })
    );
    toast.success(`已${removeLabel} ${count} 首`, { id: toastId });
    resetSelection();
  };

  const handleBatchDownload = async () => {
    const selected = getSelectedTracks();
    if (!selected.length) return;
    resetSelection();
    await downloadMusicTrackBatch(selected, parseInt(quality));
  };

  /** 写入简体标签：交给上层检测与确认，这里只负责把选中项传出去 */
  const handleBatchConvertToSimplified = () => {
    const selected = getSelectedTracks();
    if (!selected.length || !onBatchConvertToSimplified) return;
    onBatchConvertToSimplified(selected);
    resetSelection();
  };

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: "0.3",
        },
      },
    }),
  };

  const virtualizer = useVirtualizer({
    count: tracks.length + 1,
    getScrollElement: () => scrollContainerRef?.current ?? internalRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  /* ---------------- 上滑自动加载 ---------------- */
  useAutoLoadMore({
    containerRef: scrollContainerRef ?? internalRef,
    enabled: autoLoadMore,
    hasMore,
    loading,
    onLoadMore,
    contentKey: tracks.length,
  });

  if (tracks.length === 0 && !loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground/60">
        <Search className="h-8 w-8 mb-3 opacity-20" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  const renderHeader = () => (
    <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="grid items-center gap-4 px-4 h-10 text-xs text-muted-foreground grid-cols-[1.75rem_1fr_auto]">
        {!isSelectionMode ? (
          <>
            <div className="text-center">#</div>
            <div>标题</div>
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  setIsSelectionMode(true);
                  onSelectionModeChange?.(true);
                }}
              >
                <ListChecks className="h-3.5 w-3.5" />
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* 第一列：全选复选框 */}
            <div className="flex justify-center">
              <Checkbox
                checked={
                  selectedIds.size > 0 && selectedIds.size === tracks.length
                }
                onCheckedChange={toggleSelectAll}
              />
            </div>

            {/* 第二列：已选统计 */}
            <div className="flex items-center min-w-0">
              <span className="text-[13px] text-foreground truncate">
                已选 {selectedIds.size} 首
              </span>
            </div>

            {/* 第三列：更多操作 + 退出 */}
            <div className="flex items-center gap-1 justify-end">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 mr-1.5" // 对齐下方 GripVertical
                    disabled={selectedIds.size === 0}
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="end" className="w-40 p-1">
                  <div
                    className="flex items-center px-2 py-1.5 text-[13px] rounded-sm hover:bg-accent cursor-pointer"
                    onClick={handleBatchNextPlay}
                  >
                    <Plus className="mr-2 h-3.5 w-3.5" /> 添加到播放列表
                  </div>
                  <div
                    className="flex items-center px-2 py-1.5 text-[13px] rounded-sm hover:bg-accent cursor-pointer"
                    onClick={handleBatchFavorites}
                  >
                    <Heart className="mr-2 h-3.5 w-3.5" /> 喜欢
                  </div>
                  <div
                    className="flex items-center px-2 py-1.5 text-[13px] rounded-sm hover:bg-accent cursor-pointer"
                    onClick={handleBatchDownload}
                  >
                    <Download className="mr-2 h-3.5 w-3.5" /> 下载
                  </div>
                  <div
                    className="flex items-center px-2 py-1.5 text-[13px] rounded-sm hover:bg-accent cursor-pointer"
                    onClick={() => setIsAddToPlaylistOpen(true)}
                  >
                    <ListPlus className="mr-2 h-3.5 w-3.5" /> 添加到歌单
                  </div>
                  {onBatchConvertToSimplified && (
                    <div
                      className="flex items-center px-2 py-1.5 text-[13px] rounded-sm hover:bg-accent cursor-pointer"
                      data-testid="batch-convert-traditional"
                      onClick={handleBatchConvertToSimplified}
                    >
                      <Languages className="mr-2 h-3.5 w-3.5" /> 写入简体标签
                    </div>
                  )}
                  {(onRemove || onBatchRemove) && (
                    <>
                      <div className="border-t my-1" />
                      <div
                        className="flex items-center px-2 py-1.5 text-[13px] rounded-sm hover:bg-accent cursor-pointer text-destructive"
                        onClick={handleBatchRemove}
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" /> {removeLabel}
                      </div>
                    </>
                  )}
                </PopoverContent>
              </Popover>

              {/* 退出选择模式按钮 */}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={resetSelection}
              >
                <Check className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
  return (
    <div className="flex flex-col w-full" ref={internalRef}>
      {renderHeader()}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        id="dnd-context"
      >
        <SortableContext
          items={trackIds}
          strategy={verticalListSortingStrategy}
          disabled={!enableDnd}
        >
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const track = tracks[item.index];
              const content = track ? (
                <MusicTrackItem
                  track={track}
                  playlistId={playlistId}
                  index={item.index}
                  isCurrent={track.id === currentTrackId}
                  isPlaying={isPlaying}
                  onPlay={() => onPlay(track)}
                  showCheckbox={isSelectionMode}
                  isSelected={selectedIds.has(track.id)}
                  onSelect={() => toggleSelect(track.id)}
                  // 长按任意一行切换这行的选中状态，并以该状态作为整段滑动的笔刷：
                  // 起点选中 → 后续划过的行全选中；起点取消 → 后续全取消
                  onLongPress={() => {
                    const paintSelected = !selectedIds.has(track.id);
                    setIsSelectionMode(true);
                    onSelectionModeChange?.(true);
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (paintSelected) next.add(track.id);
                      else next.delete(track.id);
                      return next;
                    });
                    startDragSelect(track.id, paintSelected);
                  }}
                  onRemove={
                    !isSelectionMode && onRemove && showItemRemove
                      ? () => onRemove(track)
                      : undefined
                  }
                  removeLabel={removeLabel}
                  confirmRemove={confirmRemove}
                  quality={quality}
                  showSourceBadge={
                    isSelectionMode || storeShowBadge || showSourceBadge
                  }
                />
              ) : (
                <div className="px-3 pb-20 pt-2 h-full">
                  {onLoadMore ? (
                    autoLoadMore ? (
                      <div className="flex h-8 items-center justify-center gap-2 text-xs text-muted-foreground">
                        {loading ? (
                          <>
                            <Loader2 className="animate-spin w-3.5 h-3.5" />
                            <span>加载中...</span>
                          </>
                        ) : hasMore ? (
                          <span className="tracking-wide">上滑加载更多</span>
                        ) : (
                          <span className="tracking-wide uppercase opacity-70">
                            没有更多了
                          </span>
                        )}
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs text-muted-foreground h-8"
                        onClick={onLoadMore}
                        disabled={!hasMore || loading}
                      >
                        {loading ? (
                          <Loader2 className="animate-spin w-3.5 h-3.5 mr-2" />
                        ) : hasMore ? (
                          "加载更多"
                        ) : (
                          "没有更多了"
                        )}
                      </Button>
                    )
                  ) : (
                    <div className="h-full" />
                  )}
                </div>
              );

              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {track && onReorder ? (
                    <SortableTrackItem track={track} enabled={enableDnd}>
                      {content}
                    </SortableTrackItem>
                  ) : (
                    content
                  )}
                </div>
              );
            })}
          </div>
        </SortableContext>
        <DragOverlay
          modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}
          dropAnimation={dropAnimation}
        >
          {activeId
            ? (() => {
                const track = tracks.find((t) => t.id === activeId);
                if (!track) return null;
                return (
                  <MusicTrackItem
                    track={track}
                    playlistId={playlistId}
                    index={tracks.findIndex((t) => t.id === activeId)}
                    isCurrent={track.id === currentTrackId}
                    isPlaying={isPlaying}
                    onPlay={() => {}}
                    showCheckbox={isSelectionMode}
                    isSelected={selectedIds.has(track.id)}
                    quality={quality}
                    showSourceBadge={true}
                    dragHandleProps={{ style: { cursor: "grabbing" } }}
                    isSortable={true}
                    className="bg-background border rounded-md shadow-xl scale-105 ring-1 ring-primary/20 cursor-grabbing opacity-90"
                  />
                );
              })()
            : null}
        </DragOverlay>
      </DndContext>

      <AddToPlaylistDrawer
        open={isAddToPlaylistOpen}
        onOpenChange={setIsAddToPlaylistOpen}
        tracks={getSelectedTracks()}
        onDone={resetSelection}
      />
    </div>
  );
}
