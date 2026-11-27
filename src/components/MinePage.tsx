"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
  DropAnimation,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  restrictToVerticalAxis,
  restrictToWindowEdges,
} from "@dnd-kit/modifiers";
import {
  Plus,
  MoreVertical,
  GripVertical,
  Trash2,
  Pencil,
  History,
  Import,
  Pause,
  Play,
  Search,
  X,
  ListChecks,
  Check,
  ArrowDownUp,
  ArrowUp,
  ArrowDown,
  Download,
  CornerDownRight,
  RefreshCw,
  Image,
  CopyMinus,
  FolderPlus,
  Link2,
} from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from "./ui/drawer";
import { Label } from "./ui/label";
import { PlaylistCover } from "./PlaylistCover";
import { PlaylistIcon } from "./PlaylistIcon";
import { MusicPlaylistView } from "./MusicPlaylistView";
import { LocalMusicPage } from "./LocalMusicPage";
import { QueuePage } from "./QueuePage";
import { useMusicStore } from "@/store/music-store";
import { useHistoryStore } from "@/store/history-store";
import { useDownloadStore } from "@/store/download-store";
import { useShallow } from "zustand/react/shallow";
import { Button } from "./ui/button";
import { confirmDialog, promptDialog } from "./ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { toastUtils } from "@/lib/utils/toast";
import {
  buildDownloadKey,
  downloadMusicTrackBatch,
} from "@/lib/utils/download";
import { deduplicateTracks } from "@/lib/utils/music";
import { batchSwitchTrackSource } from "@/lib/audio-match";
import { getAllVisibleSourcesForSwitch } from "@/hooks/use-aggregated-sources";
import { getSourceLabel } from "@/lib/imported-sources/labels";
import { musicApi } from "@/lib/music-api";
import { logger } from "@/lib/logger";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

import { useSearchParams } from "react-router-dom";
import { MINE_TYPE_IDS, useRootTabSwipe } from "@/hooks/use-root-tab-swipe";
import { useActivePlaylists } from "@/hooks/use-active-playlists";
import { PlaylistImportDrawer } from "./PlaylistImportDrawer";
import { getPlayAllStartIndex, usePlayHelper } from "@/hooks/usePlayHelper";
import { usePlayContextHandler } from "@/hooks/usePlayContextHandler";
import { usePagerSwipe } from "@/hooks/use-pager-swipe";
import { useIsRootTabActive, useRootPager } from "@/hooks/use-root-pager";
import { useTabIndicatorSync } from "@/hooks/use-tab-indicator-sync";
import { useLoadMoreOnVisible } from "@/hooks/use-load-more-on-visible";
import { useTabReclick } from "@/hooks/use-tab-reclick";
import { useSearchBackClear } from "@/hooks/useSearchBackClear";
import { useExitLayerStore } from "@/hooks/useExitLayer";
import { setDragSelecting } from "@/hooks/gesture-axis";
import {
  saveScrollPositions,
  restoreScrollPositions,
} from "@/lib/scroll-snapshot";
import { cn } from "@/lib/utils";
import type { MusicSource, MusicTrack, Playlist } from "@/types/music";
import { t2s } from "@/lib/utils/t2s";

interface MinePageProps {
  onSelectPlaylist: (playlistId: string) => void;
}

/** 「歌单」页的 4 个 type */
type MineTab = "mine" | "queue" | "history" | "local";

/** 歌单页各列表「上滑加载」每批的条数 */
const MINE_LIST_PAGE_SIZE = 10;

const MINE_TABS: { id: MineTab; label: string }[] = [
  { id: "mine", label: "我的歌单" },
  { id: "queue", label: "播放列表" },
  { id: "history", label: "播放历史" },
  { id: "local", label: "本地音乐" },
];

/** 还没挂载过的分页用轻量骨架占位：滑出来时不是一块白 */
function PaneSkeleton({ title }: { title: string }) {
  return (
    <div className="flex-1 min-h-0 overflow-hidden px-5 pb-10">
      <div className="flex items-center justify-between mb-3 px-1 pt-1">
        <h2 className="text-base font-bold tracking-wide text-foreground">
          {title}
        </h2>
      </div>
      <div className="space-y-px">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-2.5 py-1.5 px-4">
            <div className="h-9 w-9 shrink-0 rounded-md bg-muted/60" />
            <div className="flex-1 min-w-0 space-y-2">
              <div
                className={cn(
                  "h-3 rounded-full bg-muted/70",
                  index % 3 === 0 ? "w-3/5" : "w-4/5"
                )}
              />
              <div className="h-2.5 w-2/5 rounded-full bg-muted/50" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface MinePlaylistItemProps {
  playlist: Playlist;
  index: number;
  isCurrent: boolean;
  isSelectionMode: boolean;
  isSelected: boolean;
  isEditing: boolean;
  editingName: string;
  playbackBadge: React.ReactNode;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  isSortable?: boolean;
  className?: string;
  onOpenMenu: () => void;
  onSelect: () => void;
  onToggleSelect: () => void;
  onLongPress: () => void;
  onPlayPlaylist: () => void;
  onEditingNameChange: (val: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
}

const playlistDropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: "0.4",
      },
    },
  }),
};

function SortablePlaylistItem({
  playlist,
  enabled,
  children,
}: {
  playlist: Playlist;
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
  } = useSortable({ id: playlist.id, disabled: !enabled });

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

/**
 * 我的歌单列表单行：参考 MusicTrackItem 布局与手势
 * - 第一列：序号（多选模式为复选框）
 * - 第二列：封面 + 名称/曲数/日期
 * - 第三列：拖拽手柄（多选可排序时）+ 操作菜单
 * - 长按 450ms 进入多选并支持滑动连续选择
 */
function MinePlaylistItem({
  playlist,
  index,
  isCurrent,
  isSelectionMode,
  isSelected,
  isEditing,
  editingName,
  playbackBadge,
  dragHandleProps,
  isSortable,
  className,
  onOpenMenu,
  onSelect,
  onToggleSelect,
  onLongPress,
  onPlayPlaylist,
  onEditingNameChange,
  onCommitRename,
  onCancelRename,
}: MinePlaylistItemProps) {
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  };

  useEffect(() => cancelLongPress, []);

  const handleRowTouchStart = (e: React.TouchEvent) => {
    if (isEditing) return;
    const touch = e.touches[0];
    if (!touch) return;
    longPressFiredRef.current = false;
    longPressStartRef.current = { x: touch.clientX, y: touch.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressFiredRef.current = true;
      onLongPress();
      window.setTimeout(() => {
        longPressFiredRef.current = false;
      }, 1000);
    }, 450);
  };

  const handleRowTouchMove = (e: React.TouchEvent) => {
    const start = longPressStartRef.current;
    const touch = e.touches[0];
    if (!start || !touch) return;
    if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 8) {
      cancelLongPress();
    }
  };

  const handleRowClick = () => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    if (isSelectionMode) {
      onToggleSelect();
    } else {
      onSelect();
    }
  };

  const trackCount = playlist.tracks.filter(
    (track) => track.is_deleted !== true
  ).length;

  return (
    <div
      data-playlist-id={playlist.id}
      className={cn(
        "group grid items-center px-4 py-1.5 gap-4 grid-cols-[1.75rem_1fr_auto] transition-all text-sm cursor-pointer select-none",
        isSelected && isSelectionMode
          ? "bg-primary/10"
          : isCurrent
            ? "bg-primary/10"
            : "hover:bg-muted/50",
        className
      )}
    >
      <div
        className="col-span-2 grid items-center gap-4 grid-cols-[1.75rem_1fr]"
        onClick={handleRowClick}
        onTouchStart={handleRowTouchStart}
        onTouchMove={handleRowTouchMove}
        onTouchEnd={cancelLongPress}
        onTouchCancel={cancelLongPress}
        onContextMenu={(e) => {
          if (!isEditing) e.preventDefault();
        }}
      >
        {/* 第一列：序号 / 复选框 */}
        <div className="flex justify-center shrink-0">
          {isSelectionMode ? (
            <Checkbox
              checked={isSelected}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={onToggleSelect}
            />
          ) : (
            <span
              className={cn(
                "font-mono text-muted-foreground opacity-70",
                isCurrent && "text-primary opacity-100"
              )}
            >
              {index + 1}
            </span>
          )}
        </div>

        {/* 第二列：封面 + 名称 */}
        <div className="min-w-0 flex items-center gap-2.5">
          <div
            className="relative shrink-0 overflow-hidden rounded-md"
            role={isSelectionMode ? undefined : "button"}
            aria-label={
              isSelectionMode ? undefined : `播放歌单 ${t2s(playlist.name)}`
            }
            onClick={(e) => {
              if (isSelectionMode) return;
              e.stopPropagation();
              onPlayPlaylist();
            }}
          >
            <PlaylistCover
              playlist={playlist}
              className="h-9 w-9 rounded-md object-cover"
              previewable={false}
            />
            {playbackBadge}
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            {isEditing ? (
              <Input
                autoFocus
                value={editingName}
                onChange={(e) => onEditingNameChange(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") onCommitRename();
                  if (e.key === "Escape") onCancelRename();
                }}
                onBlur={onCommitRename}
                className="h-7 text-sm"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <p
                  className={cn(
                    "font-medium text-sm truncate transition-colors",
                    isCurrent ? "text-primary" : "text-foreground"
                  )}
                >
                  {t2s(playlist.name)}
                </p>
                <p className="text-xs text-muted-foreground opacity-70 truncate">
                  {trackCount} 首 · {format(playlist.createdAt, "yyyy-MM-dd")}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 第三列：拖拽手柄（多选排序时）+ 菜单按钮 */}
      <div className="flex items-center justify-end gap-1">
        {isSortable && (
          <div
            {...dragHandleProps}
            className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground/50 hover:text-foreground transition-colors touch-none select-none mr-1"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu();
          }}
          aria-label="歌单操作"
          title="更多"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function MinePage({ onSelectPlaylist }: MinePageProps) {
  const [searchParams] = useSearchParams();
  const requestedType = searchParams.get("type");
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const tabsBarRef = useRef<HTMLDivElement>(null);
  // 跨 tab 滑动落点由 ?type= 带过来（本地 state 不跨路由保留）
  const initialTab: MineTab =
    MINE_TYPE_IDS.find((id) => id === requestedType) ?? "mine";
  const [activeTab, setActiveTab] = useState<MineTab>(initialTab);
  /* 四个 type 的内容一旦进来就常驻，切 tab 只切「显示」不再整块重挂。
     不这么做的话，每次点 tab 都要重新挂载整份列表（本地音乐 435 首实测
     一次 250~300ms 的主线程长任务），连续点几下就能明显感觉到卡、慢半拍。
     visitedTabs 与 activeTab 在同一个事件里一起更新，避免「面板晚一帧才出现」。 */
  const [visitedTabs, setVisitedTabs] = useState<Set<MineTab>>(
    () => new Set<MineTab>([initialTab])
  );
  const {
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addBatchToPlaylist,
    updatePlaylist,
    removeBatchFromPlaylist,
    addBatchToNextPlay,
    reorderPlaylists,
    quality,
  } = useMusicStore(
    useShallow((state) => ({
      createPlaylist: state.createPlaylist,
      renamePlaylist: state.renamePlaylist,
      deletePlaylist: state.deletePlaylist,
      addBatchToPlaylist: state.addBatchToPlaylist,
      updatePlaylist: state.updatePlaylist,
      removeBatchFromPlaylist: state.removeBatchFromPlaylist,
      addBatchToNextPlay: state.addBatchToNextPlay,
      reorderPlaylists: state.reorderPlaylists,
      quality: state.quality,
    }))
  );
  const { playContext, togglePlay, isShuffle, isPlaying, contextId } =
    useMusicStore(
      useShallow((state) => ({
        playContext: state.playContext,
        togglePlay: state.togglePlay,
        isShuffle: state.isShuffle,
        isPlaying: state.isPlaying,
        contextId: state.contextId,
      }))
    );
  const currentTrackId = useMusicStore((s) => s.queue[s.currentIndex]?.id);
  const queue = useMusicStore((s) => s.queue);
  const history = useHistoryStore((s) => s.history);
  const { handlePlay } = usePlayHelper();
  const historyOnPlay = usePlayContextHandler(history, "history");
  const queueOnPlay = usePlayContextHandler(queue, "queue");
  const activePlaylists = useActivePlaylists();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const normalizedQuery = t2s(searchQuery).trim().toLowerCase();
  const filteredPlaylists = normalizedQuery
    ? activePlaylists.filter((playlist) =>
        t2s(playlist.name).toLowerCase().includes(normalizedQuery)
      )
    : activePlaylists;

  type PlaylistSortField = "name" | "count" | "time";
  const [playlistSortState, setPlaylistSortState] = useState<{
    field: PlaylistSortField | "default";
    dir: "asc" | "desc";
  }>({ field: "default", dir: "asc" });
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  const PLAYLIST_SORT_LABELS: Record<PlaylistSortField, string> = {
    name: "名称",
    count: "歌曲数",
    time: "创建时间",
  };

  const handlePlaylistSortSelect = useCallback(
    (field: PlaylistSortField | "default") => {
      setPlaylistSortState((prev) =>
        field === "default"
          ? { field: "default", dir: "asc" }
          : field === prev.field
            ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
            : { field, dir: "asc" }
      );
    },
    []
  );

  const displayPlaylists = useMemo(() => {
    if (playlistSortState.field === "default") return filteredPlaylists;
    const list = [...filteredPlaylists];
    const dir = playlistSortState.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      if (playlistSortState.field === "name") {
        cmp = t2s(a.name).localeCompare(t2s(b.name), "zh-CN");
      } else if (playlistSortState.field === "count") {
        const countA = a.tracks.filter((t) => t.is_deleted !== true).length;
        const countB = b.tracks.filter((t) => t.is_deleted !== true).length;
        cmp = countA - countB;
      } else if (playlistSortState.field === "time") {
        cmp = a.createdAt - b.createdAt;
      }
      return cmp * dir;
    });
    return list;
  }, [filteredPlaylists, playlistSortState]);

  const [menuPlaylist, setMenuPlaylist] = useState<Playlist | null>(null);
  const [coverTargetPlaylist, setCoverTargetPlaylist] =
    useState<Playlist | null>(null);
  const [coverUrlInput, setCoverUrlInput] = useState("");
  const [replaceSourcePlaylists, setReplaceSourcePlaylists] = useState<
    Playlist[]
  >([]);
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);

  // 滑动或滚动时自动关闭打开的排序菜单，避免菜单悬浮停留在错误位置或阻挡滑动
  useEffect(() => {
    if (!sortMenuOpen) return;
    let touchStart: { x: number; y: number } | null = null;
    const closeAll = () => setSortMenuOpen(false);
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      touchStart = t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touchStart) {
        closeAll();
        return;
      }
      const t = e.touches[0];
      if (!t) return;
      if (Math.hypot(t.clientX - touchStart.x, t.clientY - touchStart.y) > 6) {
        closeAll();
      }
    };
    window.addEventListener("scroll", closeAll, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      window.removeEventListener("scroll", closeAll, { capture: true });
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, [sortMenuOpen]);

  // 替换音源弹窗挂到退出栈，返回键优先关闭
  useEffect(() => {
    if (replaceSourcePlaylists.length === 0) return;
    const id = useExitLayerStore
      .getState()
      .push({ close: () => setReplaceSourcePlaylists([]) });
    return () => useExitLayerStore.getState().pop(id);
  }, [replaceSourcePlaylists.length]);

  /* 我的歌单卡片列表「上滑加载」：首屏 10 个，滚动到底部附近再补一批 */
  const minePaneRef = useRef<HTMLDivElement>(null);
  const [mineVisible, setMineVisible] = useState(MINE_LIST_PAGE_SIZE);
  // 歌单数据或搜索条件变化后回到第一批（渲染期比较，避免 effect 里 setState 级联渲染）
  const [seenPlaylists, setSeenPlaylists] = useState(activePlaylists);
  const [seenQuery, setSeenQuery] = useState(normalizedQuery);
  if (seenPlaylists !== activePlaylists || seenQuery !== normalizedQuery) {
    setSeenPlaylists(activePlaylists);
    setSeenQuery(normalizedQuery);
    setMineVisible(MINE_LIST_PAGE_SIZE);
  }
  const mineHasMore = mineVisible < filteredPlaylists.length;
  const mineSentinelRef = useRef<HTMLDivElement>(null);
  // 用哨兵进入视口触发加载，绕开 scroll 事件在嵌套滚动容器里监听不到的问题
  useLoadMoreOnVisible({
    sentinelRef: mineSentinelRef,
    rootRef: minePaneRef,
    enabled: mineHasMore,
    onLoadMore: () =>
      setMineVisible((c) =>
        Math.min(c + MINE_LIST_PAGE_SIZE, filteredPlaylists.length)
      ),
  });

  /* 切 type 的唯一入口：同时把目标面板标记为「已挂载」，两件事在同一次
     setState 批次里，面板不会晚一帧才出现。 */
  const activateTab = useCallback((id: MineTab) => {
    setVisitedTabs((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    setActiveTab(id);
  }, []);

  const activeIndex = Math.max(
    0,
    MINE_TABS.findIndex((t) => t.id === activeTab)
  );
  const rootEdge = useRootTabSwipe("mine");
  const rootPager = useRootPager();
  const isPageActive = useIsRootTabActive("mine");

  useSearchBackClear({
    enabled: isPageActive && activeTab === "mine",
    focused: isSearchFocused,
    value: searchQuery,
    onClear: () => setSearchQuery(""),
    onDismiss: () => searchInputRef.current?.blur(),
  });

  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);
  const savedTabBeforeAlignRef = useRef<MineTab | null>(null);

  // 响应 URL ?type= 参数变化（渲染期同步，避免 effect 内 setState 级联渲染）
  const [seenRequestedType, setSeenRequestedType] = useState(requestedType);
  if (seenRequestedType !== requestedType) {
    setSeenRequestedType(requestedType);
    const matched = MINE_TYPE_IDS.find((id) => id === requestedType);
    if (matched) activateTab(matched);
  }

  // 跨页滑动对齐协议：从喜欢滑入对齐首个 type（mine），从设置滑入对齐末尾 type（local）
  useEffect(() => {
    if (!rootPager) return;
    return rootPager.registerAligner("/mine", {
      previewAlign: (edge) => {
        const target =
          edge === "start"
            ? MINE_TYPE_IDS[0]
            : MINE_TYPE_IDS[MINE_TYPE_IDS.length - 1];
        if (
          savedTabBeforeAlignRef.current === null &&
          activeTabRef.current !== target
        ) {
          savedTabBeforeAlignRef.current = activeTabRef.current;
        }
        if (activeTabRef.current !== target) {
          activateTab(target);
        }
      },
      cancelAlign: () => {
        const prev = savedTabBeforeAlignRef.current;
        savedTabBeforeAlignRef.current = null;
        if (prev && prev !== activeTabRef.current) {
          activateTab(prev);
        }
      },
      commitAlign: () => {
        savedTabBeforeAlignRef.current = null;
      },
    });
  }, [rootPager, activateTab]);

  /** 手势锁定横向后提前挂载相邻页，滑出来时直接是真实内容而不是骨架 */
  const ensureVisited = useCallback((index: number) => {
    const tab = MINE_TABS[index];
    if (!tab) return;
    setVisitedTabs((prev) =>
      prev.has(tab.id) ? prev : new Set(prev).add(tab.id)
    );
  }, []);

  // 空闲时自动预挂载左右直接邻居，避免手势刚启动时临时挂载重列表卡顿
  useEffect(() => {
    if (!isPageActive) return;
    const targets = [
      MINE_TABS[activeIndex - 1]?.id,
      MINE_TABS[activeIndex + 1]?.id,
    ].filter((id): id is MineTab => Boolean(id));
    if (targets.every((id) => visitedTabs.has(id))) return;
    const timer = setTimeout(() => {
      setVisitedTabs((prev) => {
        if (targets.every((id) => prev.has(id))) return prev;
        const next = new Set(prev);
        targets.forEach((id) => next.add(id));
        return next;
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [isPageActive, activeIndex, visitedTabs]);

  // 非邻近面板用 hidden 移出渲染树，切出前保存 scrollTop、切近时同步还原
  const prevMineIdxRef = useRef(activeIndex);
  useLayoutEffect(() => {
    const prevIdx = prevMineIdxRef.current;
    prevMineIdxRef.current = activeIndex;
    const track = trackRef.current;
    if (!track || prevIdx === activeIndex) return;
    Array.from(track.children).forEach((shell, idx) => {
      const inner = shell.firstElementChild as HTMLElement | null;
      if (!inner) return;
      const wasNear = Math.abs(idx - prevIdx) <= 1;
      const isNear = Math.abs(idx - activeIndex) <= 1;
      if (wasNear && !isNear) saveScrollPositions(inner);
      else if (!wasNear && isNear) restoreScrollPositions(inner);
    });
  }, [activeIndex]);

  const {
    indicatorRef,
    mirrorRef,
    barWidth,
    hasIndicator,
    initialRect,
    handleTrackDrag,
    handleTrackSettle,
  } = useTabIndicatorSync({
    barRef: tabsBarRef,
    activeIndex,
    ids: MINE_TYPE_IDS,
    attrName: "data-tab-id",
  });

  // 顶部 tab 固定，只平移下面 4 页的轨道；到两端时联动根级轨道整页（含 tab）滑出，
  // 真实露出相邻根页的内容。
  usePagerSwipe(
    { viewportRef, trackRef, stageRef },
    {
      count: MINE_TABS.length,
      index: activeIndex,
      onChange: (index) => activateTab(MINE_TABS[index].id),
      onEdge: rootEdge,
      onNeighborIntent: ensureVisited,
      onTrackDrag: handleTrackDrag,
      onTrackSettle: handleTrackSettle,
      rootTab: "mine",
      isPageActive,
    }
  );

  // 再次点击底部「歌单」tab：不再切换顶部 type，仅将当前列表滚回顶部
  useTabReclick("mine", () => {
    viewportRef.current
      ?.querySelector<HTMLElement>("[data-page-scroll]")
      ?.scrollTo({ top: 0, behavior: "smooth" });
  });

  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(
    null
  );
  const [editingName, setEditingName] = useState("");

  /* ---- 歌单多选 ---- */
  const [isPlaylistSelectionMode, setIsPlaylistSelectionMode] = useState(false);
  const [activePlaylistDragId, setActivePlaylistDragId] = useState<
    string | null
  >(null);
  const playlistSensors = useSensors(
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
  const canReorderPlaylists = isPlaylistSelectionMode && !searchQuery.trim();
  const visiblePlaylists = useMemo(
    () => displayPlaylists.slice(0, mineVisible),
    [displayPlaylists, mineVisible]
  );
  const playlistIds = useMemo(
    () => visiblePlaylists.map((p) => p.id),
    [visiblePlaylists]
  );
  const handlePlaylistDragStart = (event: DragStartEvent) => {
    setActivePlaylistDragId(event.active.id as string);
  };
  const handlePlaylistDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActivePlaylistDragId(null);
    if (active.id !== over?.id) {
      const oldIndex = displayPlaylists.findIndex((p) => p.id === active.id);
      const newIndex = displayPlaylists.findIndex((p) => p.id === over?.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderPlaylists(arrayMove(displayPlaylists, oldIndex, newIndex));
        if (playlistSortState.field !== "default") {
          setPlaylistSortState({ field: "default", dir: "asc" });
        }
      }
    }
  };
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<Set<string>>(
    new Set()
  );

  const togglePlaylistSelect = useCallback((id: string) => {
    setSelectedPlaylistIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const togglePlaylistSelectAll = useCallback(() => {
    setSelectedPlaylistIds((prev) =>
      prev.size === filteredPlaylists.length
        ? new Set()
        : new Set(filteredPlaylists.map((p) => p.id))
    );
  }, [filteredPlaylists]);

  const resetPlaylistSelection = useCallback(() => {
    setIsPlaylistSelectionMode(false);
    setSelectedPlaylistIds(new Set());
  }, []);

  // 多选态注册退出层：返回键先退多选
  const resetPlaylistSelectionRef = useRef(resetPlaylistSelection);
  useEffect(() => {
    resetPlaylistSelectionRef.current = resetPlaylistSelection;
  }, [resetPlaylistSelection]);
  const pushExitLayer = useExitLayerStore((s) => s.push);
  const popExitLayer = useExitLayerStore((s) => s.pop);

  useEffect(() => {
    if (!isPlaylistSelectionMode) return;
    const id = pushExitLayer({
      close: () => resetPlaylistSelectionRef.current(),
    });
    return () => popExitLayer(id);
  }, [isPlaylistSelectionMode, pushExitLayer, popExitLayer]);

  /* ---- 长按后滑动多选（与 MusicTrackList 一致） ---- */
  const lastDragPlaylistIdRef = useRef<string | null>(null);
  const stopDragSelectRef = useRef<(() => void) | null>(null);

  const startDragSelect = useCallback(
    (anchorId: string, paintSelected: boolean) => {
      lastDragPlaylistIdRef.current = anchorId;
      if (stopDragSelectRef.current) return;
      setDragSelecting(true);

      const applyAt = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        const row =
          el instanceof Element ? el.closest("[data-playlist-id]") : null;
        const id = row?.getAttribute("data-playlist-id");
        if (!id || id === lastDragPlaylistIdRef.current) return;
        lastDragPlaylistIdRef.current = id;
        setSelectedPlaylistIds((prev) => {
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
        if (e.cancelable) e.preventDefault();
        applyAt(touch.clientX, touch.clientY);
      };

      const finish = () => {
        document.removeEventListener("touchmove", onMove);
        document.removeEventListener("touchend", finish);
        document.removeEventListener("touchcancel", finish);
        stopDragSelectRef.current = null;
        lastDragPlaylistIdRef.current = null;
        setDragSelecting(false);
      };

      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", finish);
      document.addEventListener("touchcancel", finish);
      stopDragSelectRef.current = finish;
    },
    []
  );

  useEffect(() => {
    return () => {
      stopDragSelectRef.current?.();
    };
  }, []);

  const handleBatchDeletePlaylists = async () => {
    const count = selectedPlaylistIds.size;
    if (count === 0) return;
    if (
      !(await confirmDialog({
        title: `确定要删除选中的 ${count} 个歌单吗？`,
        destructive: true,
        confirmText: "删除",
      }))
    )
      return;
    selectedPlaylistIds.forEach((id) => deletePlaylist(id));
    toast.success(`已删除 ${count} 个歌单`);
    resetPlaylistSelection();
  };

  /** 获取歌单内有效曲目 */
  const getActivePlaylistTracks = (playlist: Playlist) =>
    playlist.tracks.filter((track) => track.is_deleted !== true);

  /** 收集多个歌单的有效曲目（按歌单顺序去重） */
  const collectUniqueTracks = (playlists: Playlist[]) => {
    const seenIds = new Set<string>();
    const tracks: MusicTrack[] = [];
    for (const pl of playlists) {
      for (const track of pl.tracks) {
        if (track.is_deleted === true || seenIds.has(track.id)) continue;
        seenIds.add(track.id);
        tracks.push(track);
      }
    }
    return tracks;
  };

  /** 获取多选模式下选中的歌单（按展示顺序） */
  const getSelectedPlaylists = () =>
    displayPlaylists.filter((p) => selectedPlaylistIds.has(p.id));

  /** 合并选中的多个歌单到新歌单 */
  const handleMergeToNewPlaylist = async () => {
    const selectedPlaylists = getSelectedPlaylists();
    if (selectedPlaylists.length === 0) return;

    setBatchMenuOpen(false);
    const newName = await promptDialog({
      title: "合并到新歌单",
      placeholder: "请输入新歌单名称",
      defaultValue: "合并歌单",
      confirmText: "创建",
    });
    if (!newName || !newName.trim()) return;

    const mergedTracks = collectUniqueTracks(selectedPlaylists);
    const newPlaylistId = createPlaylist(newName.trim());
    if (mergedTracks.length > 0) {
      addBatchToPlaylist(newPlaylistId, mergedTracks);
    }
    toast.success(
      `已合并 ${selectedPlaylists.length} 个歌单（共 ${mergedTracks.length} 首）`
    );
    resetPlaylistSelection();
  };

  /** 下载一个或多个歌单 */
  const handleDownloadPlaylists = async (playlists: Playlist[]) => {
    const activeTracks = collectUniqueTracks(playlists);
    if (!activeTracks.length) {
      toast.error("歌单暂无歌曲");
      return;
    }
    await downloadMusicTrackBatch(activeTracks, parseInt(quality));
  };

  /** 添加一个或多个歌单到播放 */
  const handleAddPlaylistsToPlay = (playlists: Playlist[]) => {
    const activeTracks = collectUniqueTracks(playlists);
    if (!activeTracks.length) {
      toast.error("歌单暂无歌曲");
      return;
    }
    addBatchToNextPlay(activeTracks);
    toast.success(`已添加 ${activeTracks.length} 首到播放列表`);
  };

  /** 对一个或多个歌单执行去重 */
  const handleDeduplicatePlaylists = async (playlists: Playlist[]) => {
    const musicStore = useMusicStore.getState();
    const downloadStore = useDownloadStore.getState();

    const perPlaylist: { id: string; trackIdsToDelete: string[] }[] = [];
    let totalRemoved = 0;
    const allTracksToLike: MusicTrack[] = [];

    for (const pl of playlists) {
      const result = deduplicateTracks(
        getActivePlaylistTracks(pl),
        (id) => musicStore.isFavorite(id),
        (track) =>
          downloadStore.hasRecord(buildDownloadKey(track.source, track.id))
      );
      if (result.removedCount > 0) {
        totalRemoved += result.removedCount;
        perPlaylist.push({
          id: pl.id,
          trackIdsToDelete: result.trackIdsToDelete,
        });
        allTracksToLike.push(...result.tracksToLike);
      }
    }

    if (totalRemoved === 0) {
      toastUtils.info("没有发现重复歌曲");
      return;
    }

    if (allTracksToLike.length > 0) {
      allTracksToLike.forEach((track) => {
        musicStore.addToFavorites(track);
      });
      toast.success(`已合并 ${allTracksToLike.length} 首歌曲的喜欢状态`);
    }

    if (
      await confirmDialog({
        title: `发现 ${totalRemoved} 首重复歌曲，是否立即移除？`,
        destructive: true,
        confirmText: "移除",
      })
    ) {
      perPlaylist.forEach(({ id, trackIdsToDelete }) => {
        removeBatchFromPlaylist(id, trackIdsToDelete);
      });
      toast.success(`已移除 ${totalRemoved} 首重复歌曲`);
    }
  };

  /** 替换音源（支持单个或多个歌单） */
  const handlePlaylistReplaceSource = (target: MusicSource) => {
    if (replaceSourcePlaylists.length === 0) return;
    const activeTracks = collectUniqueTracks(replaceSourcePlaylists);
    setReplaceSourcePlaylists([]);
    if (!activeTracks.length) {
      toast.error("歌单暂无歌曲");
      return;
    }
    const switched = batchSwitchTrackSource(activeTracks, target);
    if (switched > 0) {
      toast.success(`已将 ${switched} 首音源切换为${getSourceLabel(target)}`);
    } else {
      toast(`所选歌曲已是${getSourceLabel(target)}或不支持换源`);
    }
  };

  /** 抽屉操作：从第一首歌曲获取封面 */
  const handleUseFirstTrackCover = async () => {
    if (!coverTargetPlaylist) return;
    const activeTracks = getActivePlaylistTracks(coverTargetPlaylist);
    const firstTrack = activeTracks[0];
    if (firstTrack?.pic_id) {
      try {
        const url = await musicApi.getPic(
          firstTrack.pic_id,
          firstTrack.source,
          800,
          firstTrack
        );
        if (url) {
          setCoverUrlInput(url);
        } else {
          toast.error("获取封面失败");
        }
      } catch (e) {
        logger.error("MinePage", "Get playlist cover failed", e, {
          playlistId: coverTargetPlaylist.id,
        });
        toast.error("获取封面出错");
      }
    } else {
      toast.error("第一首歌曲没有封面");
    }
  };

  /** 抽屉操作：保存封面 */
  const handleSaveCover = () => {
    if (!coverTargetPlaylist) return;
    if (coverUrlInput && !coverUrlInput.startsWith("http")) {
      toast.error("请输入有效的图片链接");
      return;
    }
    updatePlaylist(coverTargetPlaylist.id, { coverUrl: coverUrlInput });
    setCoverTargetPlaylist(null);
    toast.success("封面设置成功");
  };

  const handleCreatePlaylist = () => {
    if (!newPlaylistName.trim()) {
      toast.error("请输入歌单名称");
      return;
    }
    createPlaylist(newPlaylistName);
    setNewPlaylistName("");
    setIsCreateOpen(false);
    toast.success("歌单创建成功");
  };

  const handleRename = (playlistId: string) => {
    if (!editingName.trim()) {
      toast.error("请输入歌单名称");
      return;
    }
    renamePlaylist(playlistId, editingName);
    setEditingPlaylistId(null);
    setEditingName("");
    toast.success("歌单重命名成功");
  };

  const handleDelete = async (playlistId: string) => {
    if (
      await confirmDialog({
        title: "确定要删除这个歌单吗？",
        destructive: true,
        confirmText: "删除",
      })
    ) {
      deletePlaylist(playlistId);
      toast.success("歌单已删除");
    }
  };

  /**
   * 点击封面直接播放歌单
   * - 空歌单提示；同一歌单正在上下文中则暂停/继续；否则整单播放
   */
  const playPlaylist = (tracks: MusicTrack[], ctxId: string) => {
    if (!tracks.length) {
      toast.error("歌单暂无歌曲");
      return;
    }
    if (contextId === ctxId) {
      togglePlay();
      return;
    }
    playContext(tracks, getPlayAllStartIndex(tracks.length, isShuffle), ctxId);
  };

  /**
   * 封面播放状态角标：仅当前歌单是播放上下文时显示，
   * 播放中显示暂停图标，暂停时显示播放图标；非当前歌单不渲染
   */
  const renderPlaybackBadge = (ctxId: string) => {
    if (contextId !== ctxId) return null;
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/35">
        <div className="h-5 w-5 shrink-0 flex-[0_0_20px] min-w-5 min-h-5">
          {isPlaying ? (
            <Pause
              size={20}
              className="h-full w-full text-white fill-current"
            />
          ) : (
            <Play size={20} className="h-full w-full text-white fill-current" />
          )}
        </div>
      </div>
    );
  };

  return (
    <div ref={stageRef} data-mine-stage className="relative h-full w-full">
      <div className="flex h-full flex-col bg-background">
        {/* type 切换栏：固定不动，只有下面的内容轨道跟手；
            双层反色胶囊滑块（z-10 实色盖住灰底，内部镜像文字精准反色） */}
        <div className="shrink-0 px-2 pt-2.5 pb-2 [contain:layout_style]">
          <div ref={tabsBarRef} className="relative flex items-center gap-1">
            {MINE_TABS.map((tab) => (
              <button
                key={tab.id}
                data-tab-id={tab.id}
                onClick={() => activateTab(tab.id)}
                className="relative flex-1 h-8 rounded-full text-sm font-medium whitespace-nowrap text-muted-foreground bg-secondary/30"
              >
                {tab.label}
              </button>
            ))}
            {hasIndicator && initialRect && (
              <div
                ref={indicatorRef}
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 z-10 h-8 overflow-hidden rounded-full bg-primary"
                style={{
                  transform: `translate3d(${initialRect.left}px, ${initialRect.top}px, 0)`,
                  width: initialRect.width,
                }}
              >
                <div
                  ref={mirrorRef}
                  className="flex h-full items-center gap-1"
                  style={{
                    width: barWidth || "100%",
                    transform: `translate3d(${-initialRect.left}px, ${-initialRect.top}px, 0)`,
                  }}
                >
                  {MINE_TABS.map((tab) => (
                    <span
                      key={tab.id}
                      className="flex flex-1 h-8 items-center justify-center text-sm font-medium whitespace-nowrap text-primary-foreground"
                    >
                      {tab.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 内容分页：顶部 tab 固定，这里只平移 4 页轨道 */}
        <div
          ref={viewportRef}
          data-mine-viewport
          className="relative flex-1 min-h-0 overflow-hidden"
        >
          <div
            ref={trackRef}
            data-mine-track
            className="flex h-full will-change-transform"
          >
            {/* 我的歌单 */}
            <div className="h-full w-full shrink-0">
              <div
                className={cn(
                  "flex h-full w-full flex-col [contain:layout_style_paint]",
                  Math.abs(0 - activeIndex) > 1 && "hidden"
                )}
              >
                {visitedTabs.has("mine") ? (
                  <div
                    ref={minePaneRef}
                    data-mine-pane="mine"
                    // 只有当前可见的面板挂 data-page-scroll：回顶 / 滚动恢复都按这个标记
                    // 找容器，其余面板不参与。
                    data-page-scroll={activeTab === "mine" ? "" : undefined}
                    aria-hidden={activeTab !== "mine"}
                    className="flex-1 min-h-0 overflow-y-auto scrollbar-hide pb-bottom-stack"
                  >
                    {/* Header：与「我的喜欢」及另外 3 个列表一致（标题+右上角按钮 + 整宽圆角搜索框） */}
                    <div>
                      <div className="flex shrink-0 items-center gap-2 px-5 pt-2 pb-2.5">
                        <h2 className="line-clamp-1 text-base font-bold tracking-wide text-foreground">
                          我的歌单
                        </h2>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {filteredPlaylists.length} 个歌单
                        </span>
                        <div className="ml-auto flex shrink-0 items-center gap-1.5">
                          <Button
                            variant="secondary"
                            size="icon"
                            className="h-8 w-8 rounded-full shrink-0"
                            aria-label="导入歌单"
                            title="导入"
                            onClick={() => setIsImportOpen(true)}
                          >
                            <Import className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="secondary"
                            size="icon"
                            className="h-8 w-8 rounded-full shrink-0"
                            aria-label="新建歌单"
                            title="新建"
                            onClick={() => setIsCreateOpen(true)}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="shrink-0 px-5 pb-3">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            ref={searchInputRef}
                            placeholder="搜索..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onFocus={() => setIsSearchFocused(true)}
                            onBlur={() => setIsSearchFocused(false)}
                            className={cn(
                              "h-9 w-full rounded-full pl-9 text-sm",
                              searchQuery && "pr-9"
                            )}
                          />
                          {searchQuery && (
                            <button
                              type="button"
                              onClick={() => {
                                setSearchQuery("");
                                searchInputRef.current?.focus();
                              }}
                              aria-label="清除搜索"
                              className="absolute right-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-muted-foreground/20 text-muted-foreground transition-colors hover:bg-muted-foreground/30 hover:text-foreground"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <Dialog
                        open={isCreateOpen}
                        onOpenChange={setIsCreateOpen}
                      >
                        <DialogContent className="max-w-sm">
                          <DialogHeader>
                            <DialogTitle>新建歌单</DialogTitle>
                          </DialogHeader>
                          <div className="pb-1">
                            <Input
                              autoFocus
                              placeholder="歌单名称"
                              value={newPlaylistName}
                              onChange={(e) =>
                                setNewPlaylistName(e.target.value)
                              }
                              onKeyDown={(e) =>
                                e.key === "Enter" && handleCreatePlaylist()
                              }
                            />
                          </div>
                          <DialogFooter>
                            <Button
                              onClick={handleCreatePlaylist}
                              className="h-11"
                            >
                              创建
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                      <PlaylistImportDrawer
                        open={isImportOpen}
                        onOpenChange={setIsImportOpen}
                      />
                    </div>

                    <div>
                      {activePlaylists.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
                          <PlaylistIcon className="h-10 w-10 text-muted-foreground/40 mb-2" />
                          <p className="text-muted-foreground text-sm">
                            暂无歌单
                          </p>
                          <p className="text-muted-foreground/60 text-xs mt-1">
                            点击"新建"创建你的第一个歌单
                          </p>
                        </div>
                      ) : filteredPlaylists.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
                          <PlaylistIcon className="h-10 w-10 text-muted-foreground/40 mb-2" />
                          <p className="text-muted-foreground text-sm">
                            没有找到匹配的歌单
                          </p>
                        </div>
                      ) : (
                        <>
                          {/* 表头：与 MusicTrackList 对齐（# + 排序 + 多选按钮） */}
                          <div className="sticky top-0 z-20 border-b bg-background">
                            <div className="grid items-center px-4 h-10 text-sm font-bold text-muted-foreground gap-4 grid-cols-[1.75rem_1fr_auto]">
                              {!isPlaylistSelectionMode ? (
                                <>
                                  <div className="text-center">#</div>
                                  <DropdownMenu
                                    modal={false}
                                    open={sortMenuOpen}
                                    onOpenChange={setSortMenuOpen}
                                  >
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        className="flex items-center gap-1 -ml-1 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors justify-self-start"
                                        aria-label="切换歌单排序"
                                      >
                                        {playlistSortState.field ===
                                        "default" ? (
                                          <>
                                            <ArrowDownUp className="h-3 w-3" />
                                            默认排序
                                          </>
                                        ) : (
                                          <>
                                            {
                                              PLAYLIST_SORT_LABELS[
                                                playlistSortState.field
                                              ]
                                            }
                                            {playlistSortState.dir === "asc" ? (
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
                                          playlistSortState.field ===
                                            "default" &&
                                            "bg-accent text-primary-foreground"
                                        )}
                                        onClick={() =>
                                          handlePlaylistSortSelect("default")
                                        }
                                      >
                                        默认排序
                                        {playlistSortState.field ===
                                          "default" && (
                                          <Check className="h-3.5 w-3.5 ml-auto text-primary-foreground" />
                                        )}
                                      </DropdownMenuItem>
                                      {(["name", "count", "time"] as const).map(
                                        (field) => (
                                          <DropdownMenuItem
                                            key={field}
                                            className={cn(
                                              playlistSortState.field ===
                                                field &&
                                                "bg-accent text-primary-foreground"
                                            )}
                                            onClick={() =>
                                              handlePlaylistSortSelect(field)
                                            }
                                          >
                                            按{PLAYLIST_SORT_LABELS[field]}
                                            {playlistSortState.field ===
                                              field && (
                                              <Check className="h-3.5 w-3.5 ml-auto text-primary-foreground" />
                                            )}
                                          </DropdownMenuItem>
                                        )
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      aria-label="多选歌单"
                                      onClick={() =>
                                        setIsPlaylistSelectionMode(true)
                                      }
                                    >
                                      <ListChecks className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="flex justify-center">
                                    <Checkbox
                                      checked={
                                        selectedPlaylistIds.size > 0 &&
                                        selectedPlaylistIds.size ===
                                          filteredPlaylists.length
                                      }
                                      onCheckedChange={togglePlaylistSelectAll}
                                    />
                                  </div>
                                  <div className="flex items-center min-w-0">
                                    <span className="text-sm text-foreground truncate">
                                      已选 {selectedPlaylistIds.size} 个
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 justify-end">
                                    <Popover
                                      open={batchMenuOpen}
                                      onOpenChange={setBatchMenuOpen}
                                    >
                                      <PopoverTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="h-7 w-7 mr-1.5"
                                          disabled={
                                            selectedPlaylistIds.size === 0
                                          }
                                          aria-label="批量操作"
                                        >
                                          <MoreVertical className="w-3.5 h-3.5" />
                                        </Button>
                                      </PopoverTrigger>
                                      <PopoverContent
                                        side="bottom"
                                        align="end"
                                        className="w-40 p-1"
                                      >
                                        <div
                                          className="flex items-center px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer"
                                          onClick={handleMergeToNewPlaylist}
                                        >
                                          <FolderPlus className="mr-2 h-3.5 w-3.5" />
                                          合并到新歌单
                                        </div>
                                        <div
                                          className="flex items-center px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer"
                                          onClick={() => {
                                            setBatchMenuOpen(false);
                                            const targets =
                                              getSelectedPlaylists();
                                            resetPlaylistSelection();
                                            handleDownloadPlaylists(targets);
                                          }}
                                        >
                                          <Download className="mr-2 h-3.5 w-3.5" />
                                          下载
                                        </div>
                                        <div
                                          className="flex items-center px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer"
                                          onClick={() => {
                                            setBatchMenuOpen(false);
                                            handleAddPlaylistsToPlay(
                                              getSelectedPlaylists()
                                            );
                                            resetPlaylistSelection();
                                          }}
                                        >
                                          <Plus className="mr-2 h-3.5 w-3.5" />
                                          添加到播放
                                        </div>
                                        <div
                                          className="flex items-center px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer"
                                          onClick={() => {
                                            setBatchMenuOpen(false);
                                            setReplaceSourcePlaylists(
                                              getSelectedPlaylists()
                                            );
                                            resetPlaylistSelection();
                                          }}
                                        >
                                          <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                          替换音源
                                        </div>
                                        <div
                                          className="flex items-center px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer"
                                          onClick={() => {
                                            setBatchMenuOpen(false);
                                            const targets =
                                              getSelectedPlaylists();
                                            resetPlaylistSelection();
                                            handleDeduplicatePlaylists(targets);
                                          }}
                                        >
                                          <CopyMinus className="mr-2 h-3.5 w-3.5" />
                                          列表去重
                                        </div>
                                        <div className="border-t my-1" />
                                        <div
                                          className="flex items-center px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer text-destructive"
                                          onClick={() => {
                                            setBatchMenuOpen(false);
                                            handleBatchDeletePlaylists();
                                          }}
                                        >
                                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                                          删除
                                        </div>
                                      </PopoverContent>
                                    </Popover>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      aria-label="退出多选"
                                      onClick={resetPlaylistSelection}
                                    >
                                      <Check className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          <DndContext
                            sensors={playlistSensors}
                            collisionDetection={closestCenter}
                            onDragStart={handlePlaylistDragStart}
                            onDragEnd={handlePlaylistDragEnd}
                            id="mine-playlist-dnd"
                          >
                            <SortableContext
                              items={playlistIds}
                              strategy={verticalListSortingStrategy}
                              disabled={!canReorderPlaylists}
                            >
                              <div>
                                {visiblePlaylists.map((playlist, index) => {
                                  const itemNode = (
                                    <MinePlaylistItem
                                      key={playlist.id}
                                      playlist={playlist}
                                      index={index}
                                      isCurrent={
                                        contextId === `playlist-${playlist.id}`
                                      }
                                      isSelectionMode={isPlaylistSelectionMode}
                                      isSelected={selectedPlaylistIds.has(
                                        playlist.id
                                      )}
                                      isEditing={
                                        editingPlaylistId === playlist.id
                                      }
                                      editingName={editingName}
                                      playbackBadge={renderPlaybackBadge(
                                        `playlist-${playlist.id}`
                                      )}
                                      onOpenMenu={() =>
                                        setMenuPlaylist(playlist)
                                      }
                                      onSelect={() =>
                                        onSelectPlaylist(playlist.id)
                                      }
                                      onToggleSelect={() =>
                                        togglePlaylistSelect(playlist.id)
                                      }
                                      onLongPress={() => {
                                        const paintSelected =
                                          !selectedPlaylistIds.has(playlist.id);
                                        setIsPlaylistSelectionMode(true);
                                        setSelectedPlaylistIds((prev) => {
                                          const next = new Set(prev);
                                          if (paintSelected)
                                            next.add(playlist.id);
                                          else next.delete(playlist.id);
                                          return next;
                                        });
                                        startDragSelect(
                                          playlist.id,
                                          paintSelected
                                        );
                                      }}
                                      onPlayPlaylist={() =>
                                        playPlaylist(
                                          playlist.tracks.filter(
                                            (track) => track.is_deleted !== true
                                          ),
                                          `playlist-${playlist.id}`
                                        )
                                      }
                                      onEditingNameChange={setEditingName}
                                      onCommitRename={() =>
                                        handleRename(playlist.id)
                                      }
                                      onCancelRename={() => {
                                        setEditingPlaylistId(null);
                                        setEditingName("");
                                      }}
                                    />
                                  );
                                  return canReorderPlaylists ? (
                                    <SortablePlaylistItem
                                      key={playlist.id}
                                      playlist={playlist}
                                      enabled={canReorderPlaylists}
                                    >
                                      {itemNode}
                                    </SortablePlaylistItem>
                                  ) : (
                                    itemNode
                                  );
                                })}
                                {/* 上滑加载提示（自动加载，无需点击） */}
                                {filteredPlaylists.length >
                                  MINE_LIST_PAGE_SIZE && (
                                  <div
                                    ref={mineSentinelRef}
                                    className="flex h-8 items-center justify-center text-xs text-muted-foreground/60 tracking-wide"
                                  >
                                    {mineHasMore ? "加载中..." : "没有更多了"}
                                  </div>
                                )}
                              </div>
                            </SortableContext>
                            {typeof document !== "undefined" &&
                              createPortal(
                                <DragOverlay
                                  modifiers={[
                                    restrictToVerticalAxis,
                                    restrictToWindowEdges,
                                  ]}
                                  dropAnimation={playlistDropAnimation}
                                >
                                  {activePlaylistDragId
                                    ? (() => {
                                        const dragPlaylist =
                                          displayPlaylists.find(
                                            (p) => p.id === activePlaylistDragId
                                          );
                                        if (!dragPlaylist) return null;
                                        const dragIndex =
                                          displayPlaylists.findIndex(
                                            (p) => p.id === activePlaylistDragId
                                          );
                                        return (
                                          <MinePlaylistItem
                                            playlist={dragPlaylist}
                                            index={dragIndex}
                                            isCurrent={
                                              contextId ===
                                              `playlist-${dragPlaylist.id}`
                                            }
                                            isSelectionMode={
                                              isPlaylistSelectionMode
                                            }
                                            isSelected={selectedPlaylistIds.has(
                                              dragPlaylist.id
                                            )}
                                            isEditing={false}
                                            editingName=""
                                            playbackBadge={renderPlaybackBadge(
                                              `playlist-${dragPlaylist.id}`
                                            )}
                                            dragHandleProps={{
                                              style: { cursor: "grabbing" },
                                            }}
                                            isSortable={true}
                                            className="bg-background border rounded-md shadow-xl scale-105 ring-1 ring-primary/20 cursor-grabbing opacity-90"
                                            onOpenMenu={() => {}}
                                            onSelect={() => {}}
                                            onToggleSelect={() => {}}
                                            onLongPress={() => {}}
                                            onPlayPlaylist={() => {}}
                                            onEditingNameChange={() => {}}
                                            onCommitRename={() => {}}
                                            onCancelRename={() => {}}
                                          />
                                        );
                                      })()
                                    : null}
                                </DragOverlay>,
                                document.body
                              )}
                          </DndContext>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <PaneSkeleton title="我的歌单" />
                )}
              </div>
            </div>

            {/* 播放列表 */}
            <div className="h-full w-full shrink-0">
              <div
                className={cn(
                  "flex h-full w-full flex-col [contain:layout_style_paint]",
                  Math.abs(1 - activeIndex) > 1 && "hidden"
                )}
              >
                {visitedTabs.has("queue") ? (
                  <div
                    data-mine-pane="queue"
                    data-page-active={activeTab === "queue" ? "true" : "false"}
                    aria-hidden={activeTab !== "queue"}
                    className="flex h-full min-h-0 flex-col"
                  >
                    <QueuePage
                      embedded
                      queue={queue}
                      currentTrackId={currentTrackId}
                      isPlaying={isPlaying}
                      onPlay={queueOnPlay}
                      onRemove={(track) =>
                        useMusicStore.getState().removeFromQueue(track.id)
                      }
                      onClear={() => useMusicStore.getState().clearQueue()}
                    />
                  </div>
                ) : (
                  <PaneSkeleton title="播放列表" />
                )}
              </div>
            </div>

            {/* 播放历史 */}
            <div className="h-full w-full shrink-0">
              <div
                className={cn(
                  "flex h-full w-full flex-col [contain:layout_style_paint]",
                  Math.abs(2 - activeIndex) > 1 && "hidden"
                )}
              >
                {visitedTabs.has("history") ? (
                  <div
                    data-mine-pane="history"
                    data-page-active={
                      activeTab === "history" ? "true" : "false"
                    }
                    aria-hidden={activeTab !== "history"}
                    className="flex h-full min-h-0 flex-col"
                  >
                    <MusicPlaylistView
                      title="播放历史"
                      compactHeader
                      tracks={history}
                      icon={<History className="h-8 w-8 text-primary/80" />}
                      onPlay={historyOnPlay}
                      incrementalBatch={MINE_LIST_PAGE_SIZE}
                      onRemove={(track) =>
                        useHistoryStore.getState().removeFromHistory(track.id)
                      }
                      currentTrackId={currentTrackId}
                      isPlaying={isPlaying}
                      action={
                        history.length > 0 ? (
                          <Button
                            variant="secondary"
                            size="icon"
                            className="h-8 w-8 rounded-full"
                            aria-label="清空播放历史"
                            onClick={async () => {
                              if (
                                await confirmDialog({
                                  title: "确定清空播放历史吗？",
                                  destructive: true,
                                  confirmText: "清空",
                                })
                              ) {
                                useHistoryStore.getState().clearHistory();
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : undefined
                      }
                    />
                  </div>
                ) : (
                  <PaneSkeleton title="播放历史" />
                )}
              </div>
            </div>

            {/* 本地音乐 */}
            <div className="h-full w-full shrink-0">
              <div
                className={cn(
                  "flex h-full w-full flex-col [contain:layout_style_paint]",
                  Math.abs(3 - activeIndex) > 1 && "hidden"
                )}
              >
                {visitedTabs.has("local") ? (
                  <div
                    data-mine-pane="local"
                    data-page-active={activeTab === "local" ? "true" : "false"}
                    aria-hidden={activeTab !== "local"}
                    className="flex h-full min-h-0 flex-col"
                  >
                    <LocalMusicPage
                      embedded
                      onPlay={handlePlay}
                      currentTrackId={currentTrackId}
                      isPlaying={isPlaying}
                    />
                  </div>
                ) : (
                  <PaneSkeleton title="本地音乐" />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 歌单操作抽屉（与 MusicTrackMobileMenu 样式一致，无分割线） */}
      <Drawer
        open={!!menuPlaylist}
        onOpenChange={(open) => {
          if (!open) setMenuPlaylist(null);
        }}
      >
        <DrawerContent onClick={(e) => e.stopPropagation()}>
          <DrawerTitle className="sr-only">歌单菜单</DrawerTitle>
          {menuPlaylist && (
            <>
              <div className="flex items-center gap-4 px-6 py-4">
                <PlaylistCover
                  playlist={menuPlaylist}
                  className="h-16 w-16 rounded-lg shadow-md shrink-0"
                  previewable={false}
                />
                <div className="min-w-0">
                  <div className="font-bold line-clamp-2 text-base">
                    {t2s(menuPlaylist.name)}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {getActivePlaylistTracks(menuPlaylist).length} 首 ·{" "}
                    {format(menuPlaylist.createdAt, "yyyy-MM-dd")}
                  </div>
                </div>
              </div>

              <div className="px-4 pb-4 flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
                <Button
                  variant="ghost"
                  className="justify-start w-full"
                  onClick={() => {
                    const target = menuPlaylist;
                    setMenuPlaylist(null);
                    handleDownloadPlaylists([target]);
                  }}
                >
                  <Download className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">下载</span>
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start w-full"
                  onClick={() => {
                    const target = menuPlaylist;
                    setMenuPlaylist(null);
                    handleAddPlaylistsToPlay([target]);
                  }}
                >
                  <CornerDownRight className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">添加到播放</span>
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start w-full"
                  onClick={() => {
                    const target = menuPlaylist;
                    setMenuPlaylist(null);
                    setReplaceSourcePlaylists([target]);
                  }}
                >
                  <RefreshCw className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">替换音源</span>
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start w-full"
                  onClick={() => {
                    const target = menuPlaylist;
                    setMenuPlaylist(null);
                    setCoverUrlInput(target.coverUrl || "");
                    setCoverTargetPlaylist(target);
                  }}
                >
                  <Image className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">设置封面</span>
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start w-full"
                  onClick={() => {
                    const target = menuPlaylist;
                    setMenuPlaylist(null);
                    handleDeduplicatePlaylists([target]);
                  }}
                >
                  <CopyMinus className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">列表去重</span>
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start w-full"
                  onClick={() => {
                    const target = menuPlaylist;
                    setMenuPlaylist(null);
                    setEditingPlaylistId(target.id);
                    setEditingName(t2s(target.name));
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">重命名</span>
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start w-full text-destructive hover:text-destructive"
                  onClick={() => {
                    const target = menuPlaylist;
                    setMenuPlaylist(null);
                    handleDelete(target.id);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">删除</span>
                </Button>
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>

      {/* 设置封面抽屉 */}
      <Drawer
        open={!!coverTargetPlaylist}
        onOpenChange={(open) => {
          if (!open) setCoverTargetPlaylist(null);
        }}
      >
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle>设置封面</DrawerTitle>
          </DrawerHeader>
          <div className="grid gap-4 px-4 pb-4">
            <div className="grid gap-2">
              <Label htmlFor="mineCoverUrl">封面图片链接</Label>
              <Input
                id="mineCoverUrl"
                value={coverUrlInput}
                onChange={(e) => setCoverUrlInput(e.target.value)}
                placeholder="请输入图片 URL"
              />
            </div>
            <Button
              variant="secondary"
              onClick={handleUseFirstTrackCover}
              disabled={
                !coverTargetPlaylist ||
                getActivePlaylistTracks(coverTargetPlaylist).length === 0
              }
            >
              从第一首歌曲获取
            </Button>
          </div>
          <DrawerFooter className="pt-0">
            <Button onClick={handleSaveCover} className="h-11">
              保存
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* 替换音源弹窗 */}
      <Dialog
        open={replaceSourcePlaylists.length > 0}
        onOpenChange={(open) => {
          if (!open) setReplaceSourcePlaylists([]);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              替换音源 ·{" "}
              {replaceSourcePlaylists.length === 1
                ? t2s(replaceSourcePlaylists[0].name)
                : `已选 ${replaceSourcePlaylists.length} 个歌单`}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
            {getAllVisibleSourcesForSwitch().map((source) => (
              <Button
                key={source}
                variant="ghost"
                className="justify-start w-full"
                onClick={() => handlePlaylistReplaceSource(source)}
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
