import { Button } from "@/components/ui/button";
import { Play, Search, Heart, X } from "lucide-react";
import { filterTracks } from "@/lib/utils/filter-tracks";
import { MusicTrackList } from "./MusicTrackList";
import { Input } from "@/components/ui/input";
import { useState, useMemo, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { PlaylistOperations } from "./PlaylistOperations";
import { MusicTrack } from "@/types/music";
import { useMusicStore } from "@/store/music-store";
import { useDownloadStore } from "@/store/download-store";
import { buildDownloadKey } from "@/lib/utils/download";
import toast from "react-hot-toast";
import { createTrackFromUrl, deduplicateTracks } from "@/lib/utils/music";
import { toastUtils } from "@/lib/utils/toast";
import { exportPlaylist } from "@/lib/utils/playlist-backup";
import { AddByUrlDrawer } from "./AddByUrlDrawer";
import { usePagerSwipe } from "@/hooks/use-pager-swipe";
import { useRootTabSwipe } from "@/hooks/use-root-tab-swipe";
import { useIsRootTabActive } from "@/hooks/use-root-pager";
import { useTabReclick } from "@/hooks/use-tab-reclick";
import { useSearchBackClear } from "@/hooks/useSearchBackClear";

interface FavoritesViewProps {
  tracks: MusicTrack[];
  onPlay: (track: MusicTrack | null, index?: number) => void;
  currentTrackId?: string;
  isPlaying?: boolean;
  onReorder?: (tracks: MusicTrack[]) => void;
}

export function FavoritesView({
  tracks,
  onPlay,
  currentTrackId,
  isPlaying,
  onReorder,
}: FavoritesViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isAddByUrlOpen, setIsAddByUrlOpen] = useState(false);
  const [dedupeSelectedIds, setDedupeSelectedIds] = useState<
    Set<string> | undefined
  >();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isPageActive = useIsRootTabActive("favorites");

  // 搜索框聚焦时，返回键＝清空内容并收起键盘（一步到位），不退出到桌面
  const dismissSearch = useCallback(() => {
    searchInputRef.current?.blur();
    setIsSearchFocused(false);
  }, []);
  useSearchBackClear({
    enabled: isPageActive,
    focused: isSearchFocused,
    value: searchQuery,
    onClear: () => setSearchQuery(""),
    onDismiss: dismissSearch,
  });

  // 喜欢页没有子类别：任意横滑直接联动根级滑动链（右滑 → 发现最后一个分类，左滑 → 歌单第一个 type）
  usePagerSwipe(
    { viewportRef: rootRef, stageRef: rootRef },
    {
      count: 1,
      index: 0,
      onChange: () => {},
      onEdge: useRootTabSwipe("favorites"),
      rootTab: "favorites",
      isPageActive,
    }
  );

  // 再次点击底部「喜欢」tab：回到顶部
  useTabReclick("favorites", () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  });

  const filteredTracks = useMemo(
    () => filterTracks(tracks, searchQuery),
    [tracks, searchQuery]
  );

  const handleDeduplicate = () => {
    const downloadStore = useDownloadStore.getState();

    const result = deduplicateTracks(
      tracks,
      () => true, // 在喜欢列表中，所有歌曲默认都是喜欢的
      (track) =>
        downloadStore.hasRecord(buildDownloadKey(track.source, track.id))
    );

    if (result.removedCount === 0) {
      toastUtils.info("没有发现重复歌曲");
      return;
    }

    setDedupeSelectedIds(new Set(result.trackIdsToDelete));
    toast.success(`发现 ${result.removedCount} 首重复歌曲，已自动选中`);
  };

  const handleAddByUrl = (title: string, url: string, artist?: string) => {
    const track = createTrackFromUrl(title, url, artist);
    const error = useMusicStore.getState().addToFavorites(track);
    if (error) {
      toast.error(error);
    } else {
      toast.success("添加成功");
    }
  };

  const handleRemove = (track: MusicTrack, silent?: boolean) => {
    useMusicStore.getState().removeFromFavorites(track.id);
    if (!silent) toast.success("已取消喜欢");
  };

  const handleBatchRemove = (tracks: MusicTrack[]) => {
    useMusicStore.getState().removeBatchFromFavorites(tracks.map((t) => t.id));
  };

  return (
    <div ref={rootRef} className="h-full overflow-hidden">
      <div
        ref={scrollRef}
        data-page-scroll=""
        className="flex flex-col h-full overflow-y-auto scrollbar-hide pb-bottom-stack"
      >
        {/* Header：与侧滑预览一致——一行「小图标 + 标题」，下面一条整宽圆角搜索框 */}
        <div className="flex shrink-0 items-center gap-2 px-5 pt-4 pb-3">
          <Heart className="h-5 w-5 shrink-0 fill-current text-primary" />
          <h2 className="text-base font-bold tracking-wide line-clamp-1">
            我的喜欢
          </h2>
          <span className="shrink-0 text-xs text-muted-foreground">
            {tracks.length} 首
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              onClick={() => onPlay(null)}
              className="h-8 w-8 rounded-full p-0"
              size="icon"
              aria-label="播放全部"
            >
              <Play className="size-3.5 fill-current" />
            </Button>

            <PlaylistOperations
              onDeduplicate={handleDeduplicate}
              onExport={() => exportPlaylist("我喜欢的音乐", tracks)}
              onAddByUrl={() => setIsAddByUrlOpen(true)}
            />
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
            {/* 有内容时显示清除按钮，一键清空搜索词 */}
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

        {/* List */}
        <div className="flex-1 min-h-0">
          <MusicTrackList
            tracks={filteredTracks}
            scrollContainerRef={scrollRef}
            onPlay={(track) =>
              onPlay(
                track,
                tracks.findIndex((t) => t.id === track.id)
              )
            }
            currentTrackId={currentTrackId}
            isPlaying={isPlaying}
            playlistId="favorites"
            onReorder={!searchQuery.trim() ? onReorder : undefined}
            onRemove={handleRemove}
            onBatchRemove={handleBatchRemove}
            showInlineCover
            showItemRemove={false}
            preselectedIds={dedupeSelectedIds}
            onSelectionModeChange={(active) => {
              if (!active) setDedupeSelectedIds(undefined);
            }}
          />
        </div>
      </div>

      <AddByUrlDrawer
        isOpen={isAddByUrlOpen}
        onClose={() => setIsAddByUrlOpen(false)}
        onConfirm={handleAddByUrl}
      />
    </div>
  );
}
