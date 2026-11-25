import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutoLoadMore } from "@/hooks/use-auto-load-more";
import { usePagerSwipe } from "@/hooks/use-pager-swipe";
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

function SearchPaneSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-lg bg-muted/60" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-3/5 rounded-full bg-muted/70" />
            <div className="h-2.5 w-2/5 rounded-full bg-muted/50" />
          </div>
        </div>
      ))}
    </div>
  );
}

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
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const paneRefs = useRef<
    Partial<Record<SearchResultTab, HTMLDivElement | null>>
  >({});

  // 手势拖动时临时挂载相邻页以露出真实内容，静止时仅保留当前激活 Tab
  const [revealedTabs, setRevealedTabs] = useState<Set<SearchResultTab>>(
    () => new Set()
  );
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleCleanup = useCallback(() => {
    if (clearTimerRef.current !== null) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      clearTimerRef.current = null;
      setRevealedTabs((prev) => (prev.size === 0 ? prev : new Set()));
    }, 360);
  }, []);

  useEffect(
    () => () => {
      if (clearTimerRef.current !== null) clearTimeout(clearTimerRef.current);
    },
    []
  );

  const handleNeighborIntent = useCallback(
    (index: number) => {
      const target = SEARCH_RESULT_TABS[index]?.id;
      if (!target) return;
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      setRevealedTabs((prev) =>
        prev.has(target) ? prev : new Set(prev).add(target)
      );
      scheduleCleanup();
    },
    [scheduleCleanup]
  );

  const activeIndex = Math.max(
    0,
    SEARCH_RESULT_TABS.findIndex((t) => t.id === tab)
  );

  usePagerSwipe(
    { viewportRef, trackRef },
    {
      count: SEARCH_RESULT_TABS.length,
      index: activeIndex,
      onChange: (idx) => {
        const next = SEARCH_RESULT_TABS[idx]?.id;
        if (next) {
          onTabChange(next);
          scheduleCleanup();
        }
      },
      onNeighborIntent: handleNeighborIntent,
    }
  );

  // 让外部传入的 scrollContainerRef 始终指向当前激活 tab 的滚动容器
  useEffect(() => {
    scrollContainerRef.current = paneRefs.current[tab] ?? null;
  }, [tab, scrollContainerRef]);

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

  // 搜索结果重新加载完成/重置时回到顶部
  useEffect(() => {
    const el = paneRefs.current[tab];
    if (el) el.scrollTop = 0;
  }, [tab, categories]);

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
                "flex-1 border-b-2 py-2.5 text-sm transition-colors",
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
        ref={viewportRef}
        data-search-viewport
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        <div
          ref={trackRef}
          data-search-track
          className="flex h-full will-change-transform"
        >
          {SEARCH_RESULT_TABS.map((item) => {
            const active = item.id === tab;
            const shouldMount = active || revealedTabs.has(item.id);

            return (
              <div
                key={item.id}
                ref={(node) => {
                  paneRefs.current[item.id] = node;
                  if (active) scrollContainerRef.current = node;
                }}
                data-page-scroll={active ? "" : undefined}
                data-page-active={active ? "true" : "false"}
                aria-hidden={!active || undefined}
                className="h-full w-full shrink-0 overflow-y-auto"
              >
                {!shouldMount ? (
                  <SearchPaneSkeleton />
                ) : item.id === "song" ? (
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
                    tab={item.id}
                    categories={groups}
                    loading={loading && categories === null}
                    loadingMore={active ? categoryLoading : false}
                    hasMore={active ? categoryHasMore : false}
                    onOpenArtist={onOpenArtist}
                    onOpenAlbum={onOpenAlbum}
                    onOpenPlaylist={onOpenPlaylist}
                  />
                )}
              </div>
            );
          })}
        </div>
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
