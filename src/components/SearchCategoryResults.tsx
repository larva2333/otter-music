import { useEffect, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutoLoadMore } from "@/hooks/use-auto-load-more";
import {
  EMPTY_SEARCH_CATEGORIES,
  SEARCH_RESULT_TABS,
  type SearchCategoryGroups,
  type SearchResultTab,
} from "@/lib/search-categories";
import type { MusicTrack } from "@/types/music";
import { MusicTrackList } from "./MusicTrackList";

interface SearchCategoryResultsProps {
  tab: SearchResultTab;
  onTabChange: (tab: SearchResultTab) => void;
  categories: SearchCategoryGroups | null;
  tracks: MusicTrack[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onPlay: (track: MusicTrack) => void;
  onOpenArtist: (id: string) => void;
  onOpenAlbum: (id: string) => void;
  onOpenPlaylist: (id: string) => void;
  currentTrackId?: string;
  isPlaying?: boolean;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  categoryHasMore?: boolean;
  categoryLoading?: boolean;
  onLoadMoreCategories?: () => void;
}

const EMPTY_LABEL: Record<SearchResultTab, string> = {
  artist: "暂无歌手",
  song: "未找到相关歌曲",
  album: "暂无专辑",
  playlist: "暂无歌单",
};

export function SearchCategoryResults({
  tab,
  onTabChange,
  categories,
  tracks,
  scrollContainerRef,
  onPlay,
  onOpenArtist,
  onOpenAlbum,
  onOpenPlaylist,
  currentTrackId,
  isPlaying,
  loading,
  hasMore,
  onLoadMore,
  categoryHasMore,
  categoryLoading,
  onLoadMoreCategories,
}: SearchCategoryResultsProps) {
  const groups = categories ?? EMPTY_SEARCH_CATEGORIES;
  const categoryCount =
    tab === "artist"
      ? groups.artists.length
      : tab === "album"
        ? groups.albums.length
        : tab === "playlist"
          ? groups.playlists.length
          : 0;

  useAutoLoadMore({
    containerRef: scrollContainerRef,
    enabled: tab !== "song",
    hasMore: categoryHasMore,
    loading: categoryLoading,
    onLoadMore: onLoadMoreCategories,
    contentKey: categoryCount,
  });

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = 0;
  }, [tab, scrollContainerRef]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-border/40" role="tablist">
        {SEARCH_RESULT_TABS.map((item) => {
          const active = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(item.id)}
              className={cn(
                "flex-1 border-b-2 py-2.5 text-[13px]",
                active
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground"
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div
        ref={scrollContainerRef}
        data-page-scroll=""
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {tab === "song" ? (
          <MusicTrackList
            tracks={tracks}
            scrollContainerRef={scrollContainerRef}
            onPlay={onPlay}
            currentTrackId={currentTrackId}
            isPlaying={isPlaying}
            loading={loading}
            hasMore={hasMore}
            autoLoadMore
            onLoadMore={onLoadMore}
            emptyMessage={loading ? "搜索中..." : EMPTY_LABEL.song}
            showSourceBadge
          />
        ) : (
          <CategoryPanel
            tab={tab}
            categories={groups}
            loading={loading && categories === null}
            loadingMore={categoryLoading}
            hasMore={categoryHasMore}
            onOpenArtist={onOpenArtist}
            onOpenAlbum={onOpenAlbum}
            onOpenPlaylist={onOpenPlaylist}
          />
        )}
      </div>
    </div>
  );
}

function CategoryPanel({
  tab,
  categories,
  loading,
  loadingMore,
  hasMore,
  onOpenArtist,
  onOpenAlbum,
  onOpenPlaylist,
}: {
  tab: Exclude<SearchResultTab, "song">;
  categories: SearchCategoryGroups;
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onOpenArtist: (id: string) => void;
  onOpenAlbum: (id: string) => void;
  onOpenPlaylist: (id: string) => void;
}) {
  const rows =
    tab === "artist"
      ? categories.artists.map((item) => ({
          id: item.id,
          title: item.name,
          subtitle: "",
          onClick: () => onOpenArtist(item.id),
        }))
      : tab === "album"
        ? categories.albums.map((item) => ({
            id: item.id,
            title: item.name,
            subtitle: item.artistName,
            onClick: () => onOpenAlbum(item.id),
          }))
        : categories.playlists.map((item) => ({
            id: item.id,
            title: item.name,
            subtitle: "",
            onClick: () => onOpenPlaylist(item.id),
          }));

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground/60">
        {loading ? "搜索中..." : EMPTY_LABEL[tab]}
      </div>
    );
  }

  return (
    <div>
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          onClick={row.onClick}
          className="flex w-full items-center px-4 py-3 text-left active:bg-muted/60"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{row.title}</span>
            {row.subtitle ? (
              <span className="block truncate text-xs text-muted-foreground">
                {row.subtitle}
              </span>
            ) : null}
          </span>
        </button>
      ))}
      <div className="flex h-8 items-center justify-center gap-2 pb-20 text-xs text-muted-foreground">
        {loadingMore ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>加载中...</span>
          </>
        ) : hasMore ? (
          <span className="tracking-wide">上滑加载更多</span>
        ) : (
          <span className="tracking-wide uppercase opacity-70">没有更多了</span>
        )}
      </div>
    </div>
  );
}
