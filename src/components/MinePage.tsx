"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SquarePlus,
  MoreVertical,
  Trash2,
  Pencil,
  History,
  Link2,
  Pause,
  Play,
} from "lucide-react";
import { PlaylistCover } from "./PlaylistCover";
import { PlaylistIcon } from "./PlaylistIcon";
import { MusicPlaylistView } from "./MusicPlaylistView";
import { LocalMusicPage } from "./LocalMusicPage";
import { QueuePage } from "./QueuePage";
import { useMusicStore } from "@/store/music-store";
import { useHistoryStore } from "@/store/history-store";
import { useShallow } from "zustand/react/shallow";
import { Button } from "./ui/button";
import { confirmDialog } from "./ui/confirm-dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

import { useSearchParams } from "react-router-dom";
import { MINE_TYPE_IDS, useRootTabSwipe } from "@/hooks/use-root-tab-swipe";
import { useActivePlaylists } from "@/hooks/use-active-playlists";
import { PlaylistImportDrawer } from "./PlaylistImportDrawer";
import { getPlayAllStartIndex, usePlayHelper } from "@/hooks/usePlayHelper";
import { usePlayContextHandler } from "@/hooks/usePlayContextHandler";
import { usePagerSwipe } from "@/hooks/use-pager-swipe";
import { useAutoLoadMore } from "@/hooks/use-auto-load-more";
import { useTabReclick } from "@/hooks/use-tab-reclick";
import { MineEdgePreview } from "./MineEdgePreview";
import { cn } from "@/lib/utils";
import type { MusicTrack } from "@/types/music";
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
      <div className="space-y-1">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 p-2">
            <div className="h-12 w-12 shrink-0 rounded-lg bg-muted/60" />
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
  const [indicator, setIndicator] = useState<{
    left: number;
    width: number;
  } | null>(null);
  const { createPlaylist, renamePlaylist, deletePlaylist } = useMusicStore(
    useShallow((state) => ({
      createPlaylist: state.createPlaylist,
      renamePlaylist: state.renamePlaylist,
      deletePlaylist: state.deletePlaylist,
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

  /* 我的歌单卡片列表「上滑加载」：首屏 10 个，滚动到底部附近再补一批 */
  const minePaneRef = useRef<HTMLDivElement>(null);
  const [mineVisible, setMineVisible] = useState(MINE_LIST_PAGE_SIZE);
  // 歌单数据变化后回到第一批（渲染期比较引用，避免 effect 里 setState 级联渲染）
  const [seenPlaylists, setSeenPlaylists] = useState(activePlaylists);
  if (seenPlaylists !== activePlaylists) {
    setSeenPlaylists(activePlaylists);
    setMineVisible(MINE_LIST_PAGE_SIZE);
  }
  const mineHasMore = mineVisible < activePlaylists.length;
  useAutoLoadMore({
    containerRef: minePaneRef,
    enabled: true,
    hasMore: mineHasMore,
    loading: false,
    onLoadMore: () =>
      setMineVisible((c) =>
        Math.min(c + MINE_LIST_PAGE_SIZE, activePlaylists.length)
      ),
    contentKey: Math.min(mineVisible, activePlaylists.length),
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

  /** 手势锁定横向后提前挂载相邻页，滑出来时直接是真实内容而不是骨架 */
  const ensureVisited = useCallback((index: number) => {
    const tab = MINE_TABS[index];
    if (!tab) return;
    setVisitedTabs((prev) =>
      prev.has(tab.id) ? prev : new Set(prev).add(tab.id)
    );
  }, []);

  // 顶部 tab 固定，只平移下面 4 页的轨道；到两端时整页（含 tab）滑出，
  // 露出相邻根 tab 的骨架屏，松手后才真正跳转。
  usePagerSwipe(
    { viewportRef, trackRef, stageRef },
    {
      count: MINE_TABS.length,
      index: activeIndex,
      onChange: (index) => activateTab(MINE_TABS[index].id),
      onEdge: rootEdge,
      onNeighborIntent: ensureVisited,
    }
  );

  // 再次点击底部「歌单」tab：在当前页内循环切换 type（不跨页、不回第一个）
  useTabReclick("mine", () => {
    const index = MINE_TABS.findIndex((t) => t.id === activeTab);
    activateTab(MINE_TABS[(index + 1) % MINE_TABS.length].id);
  });

  // 选中滑块位置跟随当前 type 平移（rAF 里测量，避免同步 setState 级联渲染）
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const bar = tabsBarRef.current;
      const btn = bar?.querySelector<HTMLElement>(
        `[data-tab-id="${activeTab}"]`
      );
      if (!bar || !btn) {
        setIndicator(null);
        return;
      }
      setIndicator({ left: btn.offsetLeft, width: btn.offsetWidth });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeTab]);

  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(
    null
  );
  const [editingName, setEditingName] = useState("");

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
        {/* type 切换栏：固定不动，只有下面的内容轨道跟手 */}
        <div
          ref={tabsBarRef}
          className="relative shrink-0 flex items-center gap-1 px-2 pt-2.5 pb-2 overflow-x-auto no-scrollbar"
        >
          {indicator && (
            <div
              aria-hidden
              className="absolute left-0 top-2.5 h-8 rounded-full bg-primary pointer-events-none"
              style={{
                transform: `translateX(${indicator.left}px)`,
                width: indicator.width,
                transition: "transform 250ms ease, width 250ms ease",
              }}
            />
          )}
          {MINE_TABS.map((tab) => (
            <button
              key={tab.id}
              data-tab-id={tab.id}
              onClick={() => activateTab(tab.id)}
              className={cn(
                "relative flex-1 h-8 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
                activeTab === tab.id
                  ? "text-primary-foreground"
                  : "text-muted-foreground bg-secondary/30"
              )}
            >
              {tab.label}
            </button>
          ))}
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
            <div className="flex h-full w-full shrink-0 flex-col">
              {visitedTabs.has("mine") ? (
                <div
                  ref={minePaneRef}
                  data-mine-pane="mine"
                  // 只有当前可见的面板挂 data-page-scroll：回顶 / 滚动恢复都按这个标记
                  // 找容器，其余面板不参与。
                  data-page-scroll={activeTab === "mine" ? "" : undefined}
                  aria-hidden={activeTab !== "mine"}
                  className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 pb-bottom-stack"
                >
                  {/* 标题栏 */}
                  <div className="flex items-start justify-between mb-3 px-1 pt-1">
                    <h2 className="text-base font-bold text-foreground tracking-wide">
                      我的歌单
                    </h2>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 text-sm text-muted-foreground hover:text-foreground px-2"
                        onClick={() => setIsImportOpen(true)}
                      >
                        <Link2 className="h-[13px] w-[13px]" />
                        导入
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 text-sm text-muted-foreground hover:text-foreground px-2"
                        onClick={() => setIsCreateOpen(true)}
                      >
                        <SquarePlus className="h-[13px] w-[13px]" />
                        新建
                      </Button>
                    </div>
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                      <DialogContent className="max-w-sm">
                        <DialogHeader>
                          <DialogTitle>新建歌单</DialogTitle>
                        </DialogHeader>
                        <div className="pb-1">
                          <Input
                            autoFocus
                            placeholder="歌单名称"
                            value={newPlaylistName}
                            onChange={(e) => setNewPlaylistName(e.target.value)}
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

                  {activePlaylists.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <PlaylistIcon className="h-10 w-10 text-muted-foreground/40 mb-2" />
                      <p className="text-muted-foreground text-sm">暂无歌单</p>
                      <p className="text-muted-foreground/60 text-xs mt-1">
                        点击"新建"创建你的第一个歌单
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {activePlaylists.slice(0, mineVisible).map((playlist) => (
                        <div
                          key={playlist.id}
                          className="flex items-center gap-3 p-2 rounded-xl transition-colors cursor-pointer group"
                          onClick={() => onSelectPlaylist(playlist.id)}
                        >
                          <div
                            className="relative shrink-0 overflow-hidden rounded-lg"
                            role="button"
                            aria-label={`播放歌单 ${t2s(playlist.name)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              playPlaylist(
                                playlist.tracks.filter(
                                  (track) => track.is_deleted !== true
                                ),
                                `playlist-${playlist.id}`
                              );
                            }}
                          >
                            <PlaylistCover
                              playlist={playlist}
                              className="h-13 w-13 rounded-lg object-cover"
                              previewable={false}
                            />
                            {renderPlaybackBadge(`playlist-${playlist.id}`)}
                          </div>
                          <div className="flex-1 min-w-0">
                            {editingPlaylistId === playlist.id ? (
                              <Input
                                autoFocus
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  if (e.key === "Enter")
                                    handleRename(playlist.id);
                                  if (e.key === "Escape") {
                                    setEditingPlaylistId(null);
                                    setEditingName("");
                                  }
                                }}
                                onBlur={() => handleRename(playlist.id)}
                                className="h-7 text-sm"
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <>
                                <p
                                  className={`font-medium text-sm truncate transition-colors ${
                                    contextId === `playlist-${playlist.id}`
                                      ? "text-primary"
                                      : "text-foreground"
                                  }`}
                                >
                                  {t2s(playlist.name)}
                                </p>
                                <p className="text-xs text-muted-foreground/80 mt-0.5">
                                  {
                                    playlist.tracks.filter(
                                      (track) => track.is_deleted !== true
                                    ).length
                                  }{" "}
                                  首 ·{" "}
                                  {format(playlist.createdAt, "yyyy-MM-dd")}
                                </p>
                              </>
                            )}
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="p-2 text-muted-foreground/60 hover:text-foreground transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingPlaylistId(playlist.id);
                                  setEditingName(t2s(playlist.name));
                                }}
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                重命名
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(playlist.id);
                                }}
                              >
                                <Trash2 className="text-destructive h-4 w-4 mr-2" />
                                删除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ))}
                      {/* 上滑加载提示（自动加载，无需点击） */}
                      {activePlaylists.length > MINE_LIST_PAGE_SIZE && (
                        <div className="flex h-8 items-center justify-center text-xs text-muted-foreground/60 tracking-wide">
                          {mineHasMore ? "上滑加载更多" : "没有更多了"}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <PaneSkeleton title="我的歌单" />
              )}
            </div>

            {/* 播放列表 */}
            <div className="flex h-full w-full shrink-0 flex-col">
              {visitedTabs.has("queue") ? (
                <div
                  data-mine-pane="queue"
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

            {/* 播放历史 */}
            <div className="flex h-full w-full shrink-0 flex-col">
              {visitedTabs.has("history") ? (
                <div
                  data-mine-pane="history"
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
                        <button
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
                          className="flex items-center gap-1.5 px-3 h-8 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          清空
                        </button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <PaneSkeleton title="播放历史" />
              )}
            </div>

            {/* 本地音乐 */}
            <div className="flex h-full w-full shrink-0 flex-col">
              {visitedTabs.has("local") ? (
                <div
                  data-mine-pane="local"
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

      {/* 两端整页滑出时露出的相邻根 tab 骨架屏 */}
      <MineEdgePreview side="prev" />
      <MineEdgePreview side="next" />
    </div>
  );
}
