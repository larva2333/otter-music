import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutoLoadMore } from "@/hooks/use-auto-load-more";
import { usePagerSwipe } from "@/hooks/use-pager-swipe";
import {
  saveScrollPositions,
  restoreScrollPositions,
} from "@/lib/scroll-snapshot";
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

const INDICATOR_SETTLE_MS = 280;
const INDICATOR_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

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
  const indicatorRef = useRef<HTMLDivElement>(null);
  const indicatorSettlingUntilRef = useRef(0);
  const settledIndexRef = useRef<number | null>(null);
  const firstIndicatorRef = useRef(true);
  const songScrollRef = useRef<HTMLDivElement>(null);
  const paneRefs = useRef<
    Partial<Record<SearchResultTab, HTMLDivElement | null>>
  >({});

  // 已访问过的 Tab 保持挂载（不卸载），避免来回切换时反复重建/闪骨架屏
  const [visitedTabs, setVisitedTabs] = useState<Set<SearchResultTab>>(
    () => new Set([tab])
  );
  if (!visitedTabs.has(tab)) {
    setVisitedTabs((prev) => new Set(prev).add(tab));
  }

  const activeIndex = Math.max(
    0,
    SEARCH_RESULT_TABS.findIndex((t) => t.id === tab)
  );

  // 空闲时预挂载左右直接相邻的 Tab，滑动瞬间 0 挂载卡顿
  useEffect(() => {
    const neighbors = [
      SEARCH_RESULT_TABS[activeIndex - 1]?.id,
      SEARCH_RESULT_TABS[activeIndex + 1]?.id,
    ].filter((id): id is SearchResultTab => Boolean(id));
    if (neighbors.every((id) => visitedTabs.has(id))) return;

    const timer = window.setTimeout(() => {
      setVisitedTabs((prev) => {
        if (neighbors.every((id) => prev.has(id))) return prev;
        const next = new Set(prev);
        neighbors.forEach((id) => next.add(id));
        return next;
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeIndex, visitedTabs]);

  const handleNeighborIntent = useCallback((index: number) => {
    const target = SEARCH_RESULT_TABS[index]?.id;
    if (!target) return;
    setVisitedTabs((prev) =>
      prev.has(target) ? prev : new Set(prev).add(target)
    );
  }, []);

  const applyIndicator = useCallback((posIndex: number, animate: boolean) => {
    const node = indicatorRef.current;
    if (!node) return;
    indicatorSettlingUntilRef.current = animate
      ? Date.now() + INDICATOR_SETTLE_MS
      : 0;
    settledIndexRef.current = posIndex;
    node.style.transition = animate
      ? `transform ${INDICATOR_SETTLE_MS}ms ${INDICATOR_EASING}`
      : "none";
    node.style.transform = `translate3d(${posIndex * 100}%, 0, 0)`;
  }, []);

  const handleTrackDrag = useCallback((index: number, ratio: number) => {
    const node = indicatorRef.current;
    if (!node) return;
    indicatorSettlingUntilRef.current = 0;
    settledIndexRef.current = null;
    node.style.transition = "none";
    node.style.transform = `translate3d(${(index + ratio) * 100}%, 0, 0)`;
  }, []);

  const handleTrackSettle = useCallback(
    (targetIndex: number, animate: boolean) => {
      applyIndicator(targetIndex, animate);
    },
    [applyIndicator]
  );

  // 点击顶部 Tab 切换时同步滑行下划线；若松手滑行已到位则不重复触发过渡
  useLayoutEffect(() => {
    if (firstIndicatorRef.current) {
      firstIndicatorRef.current = false;
      applyIndicator(activeIndex, false);
      return;
    }
    if (
      settledIndexRef.current === activeIndex &&
      Date.now() <= indicatorSettlingUntilRef.current + 50
    ) {
      return;
    }
    applyIndicator(activeIndex, true);
  }, [activeIndex, applyIndicator]);

  // 非邻近面板用 hidden 移出绘制树，切出前保存 scrollTop、切近时同步还原
  const prevIndexRef = useRef(activeIndex);
  useLayoutEffect(() => {
    const prevIdx = prevIndexRef.current;
    prevIndexRef.current = activeIndex;
    if (prevIdx === activeIndex) return;
    SEARCH_RESULT_TABS.forEach((item, idx) => {
      const el = paneRefs.current[item.id];
      if (!el) return;
      const wasNear = Math.abs(idx - prevIdx) <= 1;
      const isNear = Math.abs(idx - activeIndex) <= 1;
      if (wasNear && !isNear) saveScrollPositions(el);
      else if (!wasNear && isNear) restoreScrollPositions(el);
    });
  }, [activeIndex]);

  usePagerSwipe(
    { viewportRef, trackRef },
    {
      count: SEARCH_RESULT_TABS.length,
      index: activeIndex,
      onChange: (idx) => {
        const next = SEARCH_RESULT_TABS[idx]?.id;
        if (next) onTabChange(next);
      },
      onNeighborIntent: handleNeighborIntent,
      onTrackDrag: handleTrackDrag,
      onTrackSettle: handleTrackSettle,
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

  // 仅在新搜索结果到来/重置时将各面板滚回顶部，切换 Tab 保留各自滚动位置
  useEffect(() => {
    SEARCH_RESULT_TABS.forEach((item) => {
      const el = paneRefs.current[item.id];
      if (el) el.scrollTop = 0;
    });
  }, [categories]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="relative mx-4 flex shrink-0 border-b border-border/40"
        role="tablist"
      >
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
                "flex-1 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
            </button>
          );
        })}
        <div
          ref={indicatorRef}
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-primary will-change-transform"
          style={{ width: `${100 / SEARCH_RESULT_TABS.length}%` }}
        />
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
          {SEARCH_RESULT_TABS.map((item, idx) => {
            const active = item.id === tab;
            const shouldMount = visitedTabs.has(item.id);
            const isFar = Math.abs(idx - activeIndex) > 1;

            return (
              <div key={item.id} className="h-full w-full shrink-0">
                <div
                  ref={(node) => {
                    paneRefs.current[item.id] = node;
                    if (item.id === "song") songScrollRef.current = node;
                    if (active) scrollContainerRef.current = node;
                  }}
                  data-page-scroll={active ? "" : undefined}
                  data-page-active={active ? "true" : "false"}
                  aria-hidden={!active || undefined}
                  className={cn(
                    "h-full w-full overflow-y-auto [contain:layout_style_paint]",
                    isFar && "hidden"
                  )}
                >
                  {!shouldMount ? (
                    <SearchPaneSkeleton />
                  ) : item.id === "song" ? (
                    <MusicTrackList
                      tracks={tracks}
                      scrollContainerRef={songScrollRef}
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
