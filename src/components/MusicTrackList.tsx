import React, {
  RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
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
  ArrowDownUp,
  ArrowUp,
  ArrowDown,
  Link2,
  RefreshCw,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MusicTrackItem } from "./MusicTrackItem";
import { AddToPlaylistDrawer } from "./AddToPlaylistDrawer";
import { downloadMusicTrackBatch } from "@/lib/utils/download";
import { useMusicStore } from "@/store/music-store";
import { useLoadMoreOnVisible } from "@/hooks/use-load-more-on-visible";
import { useExitLayerStore } from "@/hooks/useExitLayer";
import { setDragSelecting } from "@/hooks/gesture-axis";
import { MusicSource, MusicTrack } from "@/types/music";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { batchSwitchTrackSource } from "@/lib/audio-match";
import { getAllVisibleSourcesForSwitch } from "@/hooks/use-aggregated-sources";
import { getSourceLabel } from "@/lib/imported-sources/labels";
import toast from "react-hot-toast";
import { processBatchCPU, cn } from "@/lib/utils";
import { sortTracks, type TrackSortKey } from "@/lib/utils/sort-tracks";
import { useShallow } from "zustand/react/shallow";

interface MusicTrackListProps {
  tracks: MusicTrack[];
  onPlay: (track: MusicTrack) => void;
  scrollContainerRef?: RefObject<HTMLElement | null>;
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
  /** 行首显示封面（代替序号），用于推荐流这类轻量列表 */
  showCover?: boolean;
  /** 第二列信息左侧显示小封面（保留第一列序号），对齐「我的歌单」列表样式 */
  showInlineCover?: boolean;
  /**
   * 不渲染顶部「# / 排序 / 多选」表头（纯内容列表）。
   * 表头同时承载批量操作条，隐藏后没有地方放「退出多选 / 全选」，
   * 所以这个模式下一并禁用长按多选，用行尾菜单做单曲操作。
   */
  hideHeader?: boolean;
  /** 是否显示批量「替换音源」。本地音乐/离线歌单这类曲目没有可换的音源，传 false 隐藏入口 */
  showReplaceSource?: boolean;
  /** 紧凑行（播放列表这类纯队列视图用）：行内上下留白更小、估算行高更矮 */
  dense?: boolean;
  /**
   * 增量展示（「上滑加载」分页）：首屏只渲染前 incrementalBatch 行，
   * 滚动接近底部时再补一批。数据都在内存里的列表（播放历史/本地音乐等）
   * 用它避免一次铺开全部行。传 0/undefined 表示一次渲染全部（虚拟滚动照常生效）。
   */
  incrementalBatch?: number;
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
  showCover,
  showInlineCover,
  hideHeader,
  showReplaceSource = true,
  dense = true,
  incrementalBatch,
}: MusicTrackListProps) {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isAddToPlaylistOpen, setIsAddToPlaylistOpen] = useState(false);
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const [replaceSourceOpen, setReplaceSourceOpen] = useState(false);
  const internalRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(
    // 专属拖拽手柄已启用 touch-none，200ms 轻按即可起拖，兼顾防误触与跟手响应
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const enableDnd = isSelectionMode && !!onReorder;

  /**
   * 列表视图排序：点击表头弹出下拉框选择（默认排序 / 按歌名 / 按专辑 / 按歌手）。
   * 选中某字段后表头显示字段名 + 升/降序箭头；再次选择同一字段切换升降序；
   * 换字段则回到升序。仅影响展示顺序（不落盘）。
   */
  type SortField = "name" | "album" | "artist" | "time";
  const [sortState, setSortState] = useState<{
    field: SortField | "default";
    dir: "asc" | "desc";
  }>({ field: "default", dir: "asc" });

  const FIELD_LABELS: Record<SortField, string> = {
    name: "歌名",
    album: "专辑",
    artist: "歌手",
    time: "添加时间",
  };

  const handleSortSelect = useCallback((field: SortField | "default") => {
    setSortState((prev) =>
      field === "default"
        ? { field: "default", dir: "asc" }
        : field === prev.field
          ? // 同一字段再次选择：切换升降序
            { field, dir: prev.dir === "asc" ? "desc" : "asc" }
          : // 换字段：回到升序
            { field, dir: "asc" }
    );
  }, []);

  const displayTracks = useMemo(() => {
    if (sortState.field === "default") return tracks;
    return sortTracks(
      tracks,
      `${sortState.field}-${sortState.dir}` as TrackSortKey
    );
  }, [tracks, sortState]);

  /* --- 增量展示（上滑加载分页） --- */
  const [visibleCount, setVisibleCount] = useState(
    incrementalBatch && incrementalBatch > 0 ? incrementalBatch : Infinity
  );
  // 数据变化（切列表/重排/刷新）后回到第一批
  useEffect(() => {
    setVisibleCount(
      incrementalBatch && incrementalBatch > 0 ? incrementalBatch : Infinity
    );
  }, [tracks, incrementalBatch]);
  const limitedTracks = useMemo(
    () =>
      incrementalBatch && incrementalBatch > 0
        ? displayTracks.slice(0, visibleCount)
        : displayTracks,
    [displayTracks, visibleCount, incrementalBatch]
  );
  const hasMoreLocal =
    !!incrementalBatch &&
    incrementalBatch > 0 &&
    visibleCount < displayTracks.length;
  const loadMoreLocal = useCallback(() => {
    setVisibleCount((c) =>
      Math.min(c + (incrementalBatch ?? 0), displayTracks.length)
    );
  }, [incrementalBatch, displayTracks.length]);

  const trackIds = useMemo(
    () => displayTracks.map((t) => t.id),
    [displayTracks]
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (active.id !== over?.id && onReorder) {
      const oldIndex = displayTracks.findIndex((t) => t.id === active.id);
      const newIndex = displayTracks.findIndex((t) => t.id === over?.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        onReorder(arrayMove(displayTracks, oldIndex, newIndex));
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
      // 挡住下拉刷新 / 分类横滑：笔刷手势的 touchmove 在 document 上才 preventDefault，
      // 等它执行时滚动容器上的刷新监听已经把指示器拉出来了
      setDragSelecting(true);

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
        setDragSelecting(false);
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

  // 「替换音源」选源弹窗同样挂一层退出栈：返回键先关它，再退出多选
  useEffect(() => {
    if (!replaceSourceOpen) return;
    const id = pushExitLayer({ close: () => setReplaceSourceOpen(false) });
    return () => popExitLayer(id);
  }, [replaceSourceOpen, pushExitLayer, popExitLayer]);

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

  /**
   * 批量直接切换音源标签：只更新各列表中的音源标识，不实时搜源或校验，
   * 等到实际播放该曲时再向目标音源解析曲目与播放链接。
   */
  const handleBatchReplaceSource = (target: MusicSource) => {
    const selected = getSelectedTracks();
    if (!selected.length) return;
    setBatchMenuOpen(false);
    setReplaceSourceOpen(false);
    const switched = batchSwitchTrackSource(selected, target);
    if (switched > 0) {
      toast.success(`已将 ${switched} 首音源切换为${getSourceLabel(target)}`);
    } else {
      toast(`所选歌曲已是${getSourceLabel(target)}或不支持换源`);
    }
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

  /* --- 列表在滚动容器里的偏移（上方还有表头/标题等内容时需要） ---
     不测量的话，virtualizer 会把 scrollTop 直接当列表内偏移用，
     渲染的行窗口整体前移，滚得越深偏得越多。 */
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    if (!scrollContainerRef) return;
    const measure = () => {
      const sc = scrollContainerRef.current;
      const lc = listContainerRef.current;
      if (!sc || !lc) return;
      const margin = Math.max(
        0,
        Math.round(
          lc.getBoundingClientRect().top -
            sc.getBoundingClientRect().top +
            sc.scrollTop
        )
      );
      setScrollMargin((prev) => (prev === margin ? prev : margin));
    };
    measure();
    // 等一帧再补测一次：上方内容（标题/封面等）经常在首帧后才定型
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    if (internalRef.current) ro.observe(internalRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [scrollContainerRef, tracks.length, hideHeader, dense, sortState.field]);

  const virtualizer = useVirtualizer({
    count: limitedTracks.length + 1,
    getScrollElement: () => scrollContainerRef?.current ?? internalRef.current,
    estimateSize: () => (dense ? 52 : ROW_HEIGHT),
    overscan: 8,
    scrollMargin,
  });

  /* ---------------- 上滑自动加载 ---------------- */
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const scrollRootRef = scrollContainerRef ?? internalRef;
  // 用 IntersectionObserver 代替 scroll 事件：嵌套滚动容器里 scroll 事件可能
  // 监听不到，哨兵进入视口即加载，WebView 里更可靠
  useLoadMoreOnVisible({
    sentinelRef: loadMoreSentinelRef,
    rootRef: scrollRootRef,
    enabled:
      (autoLoadMore || hasMoreLocal) && !loading && (hasMoreLocal || !!hasMore),
    onLoadMore: hasMoreLocal ? loadMoreLocal : onLoadMore!,
  });
  // 首屏不足一屏时哨兵本就可见，observer 会触发；这里不再需要 scroll/contentKey 补检测

  // 底部状态行：增量展示用内部 loadMoreLocal，服务端分页用外部 onLoadMore
  const footerLoadMore = hasMoreLocal ? loadMoreLocal : onLoadMore;
  const footerAuto = autoLoadMore || hasMoreLocal;
  const footerHasMore = hasMoreLocal || !!hasMore;

  if (tracks.length === 0 && !loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground/60">
        <Search className="h-8 w-8 mb-3 opacity-20" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  const renderHeader = () => (
    <div className="sticky top-0 z-20 border-b bg-background">
      <div
        className={cn(
          "grid items-center px-4 h-10 text-sm font-bold text-muted-foreground",
          showCover
            ? "gap-3 grid-cols-[2.5rem_1fr_auto]"
            : "gap-4 grid-cols-[1.75rem_1fr_auto]"
        )}
      >
        {!isSelectionMode ? (
          <>
            <div className="text-center">#</div>
            {/* 点击弹出排序下拉框；表头显示当前排序状态（默认排序 / 歌名↑ / 歌名↓…） */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1 -ml-1 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="切换列表排序"
                >
                  {sortState.field === "default" ? (
                    <>
                      <ArrowDownUp className="h-3 w-3" />
                      默认排序
                    </>
                  ) : (
                    <>
                      {FIELD_LABELS[sortState.field]}
                      {sortState.dir === "asc" ? (
                        <ArrowUp className="h-3 w-3 text-primary" />
                      ) : (
                        <ArrowDown className="h-3 w-3 text-primary" />
                      )}
                    </>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  className={cn(
                    sortState.field === "default" &&
                      "bg-accent text-primary-foreground"
                  )}
                  onClick={() => handleSortSelect("default")}
                >
                  默认排序
                  {sortState.field === "default" && (
                    <Check className="h-3.5 w-3.5 ml-auto text-primary-foreground" />
                  )}
                </DropdownMenuItem>
                {(["name", "album", "artist", "time"] as const).map((field) => (
                  <DropdownMenuItem
                    key={field}
                    className={cn(
                      sortState.field === field &&
                        "bg-accent text-primary-foreground"
                    )}
                    onClick={() => handleSortSelect(field)}
                  >
                    按{FIELD_LABELS[field]}
                    {sortState.field === field && (
                      <Check className="h-3.5 w-3.5 ml-auto text-primary-foreground" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
              <span className="text-sm text-foreground truncate">
                已选 {selectedIds.size} 首
              </span>
            </div>

            {/* 第三列：更多操作 + 退出 */}
            <div className="flex items-center gap-1 justify-end">
              <Popover open={batchMenuOpen} onOpenChange={setBatchMenuOpen}>
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
                    className="flex items-center px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer"
                    onClick={handleBatchNextPlay}
                  >
                    <Plus className="mr-2 h-3.5 w-3.5" /> 添加到播放列表
                  </div>
                  <div
                    className="flex items-center px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer"
                    onClick={handleBatchFavorites}
                  >
                    <Heart className="mr-2 h-3.5 w-3.5" /> 喜欢
                  </div>
                  <div
                    className="flex items-center px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer"
                    onClick={handleBatchDownload}
                  >
                    <Download className="mr-2 h-3.5 w-3.5" /> 下载
                  </div>
                  {showReplaceSource && (
                    <div
                      className="flex items-center px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer"
                      onClick={() => {
                        setBatchMenuOpen(false);
                        setReplaceSourceOpen(true);
                      }}
                    >
                      <RefreshCw className="mr-2 h-3.5 w-3.5" /> 替换音源
                    </div>
                  )}
                  <div
                    className="flex items-center px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer"
                    onClick={() => setIsAddToPlaylistOpen(true)}
                  >
                    <ListPlus className="mr-2 h-3.5 w-3.5" /> 添加到歌单
                  </div>
                  {(onRemove || onBatchRemove) && (
                    <>
                      <div className="border-t my-1" />
                      <div
                        className="flex items-center px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer text-destructive"
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
      {hideHeader ? null : renderHeader()}
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
            ref={listContainerRef}
            className="relative w-full"
            style={{
              height: Math.max(0, virtualizer.getTotalSize() - scrollMargin),
            }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const track = limitedTracks[item.index];
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
                  onLongPress={
                    hideHeader
                      ? undefined
                      : () => {
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
                        }
                  }
                  onRemove={
                    !isSelectionMode && onRemove && showItemRemove
                      ? () => onRemove(track)
                      : undefined
                  }
                  removeLabel={removeLabel}
                  confirmRemove={confirmRemove}
                  quality={quality}
                  showCover={showCover}
                  showInlineCover={showInlineCover}
                  showSourceBadge={
                    isSelectionMode || storeShowBadge || showSourceBadge
                  }
                  className={dense ? "py-1.5" : undefined}
                />
              ) : (
                <div className="px-3 pb-20 pt-2 h-full">
                  {footerLoadMore ? (
                    footerAuto ? (
                      <div
                        ref={loadMoreSentinelRef}
                        className="flex h-8 items-center justify-center gap-2 text-xs text-muted-foreground"
                      >
                        {footerHasMore ? (
                          <>
                            <Loader2 className="animate-spin w-3.5 h-3.5" />
                            <span>加载中...</span>
                          </>
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
                        onClick={footerLoadMore}
                        disabled={!footerHasMore || loading}
                      >
                        {loading ? (
                          <Loader2 className="animate-spin w-3.5 h-3.5 mr-2" />
                        ) : footerHasMore ? (
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
                  style={{
                    transform: `translateY(${item.start - scrollMargin}px)`,
                  }}
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
        {typeof document !== "undefined" &&
          createPortal(
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
                        showCover={showCover}
                        showInlineCover={showInlineCover}
                        showSourceBadge={true}
                        dragHandleProps={{ style: { cursor: "grabbing" } }}
                        isSortable={true}
                        className={cn(
                          dense && "py-1.5",
                          "bg-background border rounded-md shadow-xl scale-105 ring-1 ring-primary/20 cursor-grabbing opacity-90"
                        )}
                      />
                    );
                  })()
                : null}
            </DragOverlay>,
            document.body
          )}
      </DndContext>

      <AddToPlaylistDrawer
        open={isAddToPlaylistOpen}
        onOpenChange={setIsAddToPlaylistOpen}
        tracks={getSelectedTracks()}
        onDone={resetSelection}
      />

      <Dialog open={replaceSourceOpen} onOpenChange={setReplaceSourceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>替换音源 · 已选 {selectedIds.size} 首</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
            {getAllVisibleSourcesForSwitch().map((source) => (
              <Button
                key={source}
                variant="ghost"
                className="justify-start w-full"
                onClick={() => handleBatchReplaceSource(source)}
              >
                <Link2 className="mr-2 h-4 w-4 shrink-0" />
                {getSourceLabel(source)}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
