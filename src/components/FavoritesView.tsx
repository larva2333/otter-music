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
import { sortTracks, TrackSortKey } from "@/lib/utils/sort-tracks";
import { toastUtils } from "@/lib/utils/toast";
import { exportPlaylist } from "@/lib/utils/playlist-backup";
import { AddByUrlDrawer } from "./AddByUrlDrawer";
import { useSwipeCategories } from "@/hooks/use-swipe-categories";
import { useRootTabSwipe } from "@/hooks/use-root-tab-swipe";
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

  // 搜索框聚焦时，返回键＝清空内容并收起键盘（一步到位），不退出到桌面
  const dismissSearch = useCallback(() => {
    searchInputRef.current?.blur();
    setIsSearchFocused(false);
  }, []);
  useSearchBackClear({
    focused: isSearchFocused,
    value: searchQuery,
    onClear: () => setSearchQuery(""),
    onDismiss: dismissSearch,
  });

  // 喜欢页没有子类别：任意横滑都走链边界，由 useRootTabSwipe 决定落点
  // （右滑 → 发现最后一个分类，左滑 → 歌单第一个 type）
  useSwipeCategories(rootRef, {
    ids: ["favorites"],
    activeId: "favorites",
    onChange: () => {},
    onEdge: useRootTabSwipe("favorites"),
  });

  // 再次点击底部「喜欢」tab：回到顶部
  // 注意不能滚 rootRef —— 它只是 flex 容器，真正滚动的是 MusicLayout 的
  // [data-page-scroll]（rootRef 的祖先），scrollTo 打在上面才有反应
  useTabReclick("favorites", () => {
    const scroller =
      rootRef.current?.closest<HTMLElement>("[data-page-scroll]");
    scroller?.scrollTo({ top: 0, behavior: "smooth" });
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

  const handleSort = (key: TrackSortKey) => {
    const sorted = sortTracks(tracks, key);
    useMusicStore.getState().reorderFavorites(sorted);
  };

  return (
    <div ref={rootRef} className="flex flex-col h-full">
      {/* Header */}
      <div
        className={cn("p-4 border-b flex items-end gap-4 bg-muted/10 relative")}
      >
        <div className="h-20 w-20 bg-primary/10 rounded-lg flex items-center justify-center shadow-sm border overflow-hidden shrink-0 flex-[0_0_80px] min-w-20 min-h-20">
          <div className="h-8 w-8 shrink-0 flex-[0_0_32px] min-w-8 min-h-8">
            <Heart
              size={32}
              className="h-full w-full text-primary/80 fill-current"
            />
          </div>
        </div>
        <div className="flex-1 self-stretch flex flex-col justify-center gap-1">
          <h2 className="text-base font-bold tracking-tight line-clamp-1">
            我的喜欢
          </h2>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span>{tracks.length} 首歌曲</span>
          </div>
          <div className="pt-1 flex gap-2 items-center">
            <Button
              onClick={() => onPlay(null)}
              className="rounded-full px-3 h-7"
              size="sm"
            >
              <Play className="size-3 fill-current" />
            </Button>

            <PlaylistOperations
              onDeduplicate={handleDeduplicate}
              onExport={() => exportPlaylist("我喜欢的音乐", tracks)}
              onAddByUrl={() => setIsAddByUrlOpen(true)}
              onSort={handleSort}
            />

            <div className="relative ml-auto flex-1 min-w-0">
              <Search className="absolute left-2 top-2.5 h-3 w-3 text-muted-foreground md:h-4 md:w-4 md:top-2" />
              <Input
                ref={searchInputRef}
                placeholder="搜索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                className={cn(
                  "pl-8 h-8 text-xs md:h-9 md:text-sm w-full",
                  searchQuery && "pr-8"
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-muted-foreground/20 text-muted-foreground hover:bg-muted-foreground/30 hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 bg-background/50">
        <MusicTrackList
          tracks={filteredTracks}
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
          showItemRemove={false}
          preselectedIds={dedupeSelectedIds}
          onSelectionModeChange={(active) => {
            if (!active) setDedupeSelectedIds(undefined);
          }}
        />
      </div>

      <AddByUrlDrawer
        isOpen={isAddByUrlOpen}
        onClose={() => setIsAddByUrlOpen(false)}
        onConfirm={handleAddByUrl}
      />
    </div>
  );
}
