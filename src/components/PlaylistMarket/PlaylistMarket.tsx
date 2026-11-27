import {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ComponentType,
} from "react";
import { Button } from "@/components/ui/button";
import {
  resolveBarCategories,
  NON_BROWSE_CATEGORIES,
} from "@/lib/netease/netease-cats";
import { getPlaylists, getToplist } from "@/lib/netease/netease-api";
import type { MarketPlaylist } from "@/lib/netease/netease-types";
import { cachedFetch } from "@/lib/utils/cache";
import { Loader2, LayoutGrid } from "lucide-react";
import { PlaylistCategorySelector } from "./PlaylistCategorySelector";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useMusicStore } from "@/store/music-store";
import { useScrollSave } from "@/hooks/use-scroll-save";
import { usePagination } from "@/hooks/use-pagination";
import { usePagerSwipe } from "@/hooks/use-pager-swipe";
import { useRootTabSwipe } from "@/hooks/use-root-tab-swipe";
import { useIsRootTabActive, useRootPager } from "@/hooks/use-root-pager";
import { useTabIndicatorSync } from "@/hooks/use-tab-indicator-sync";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { useTabReclick } from "@/hooks/use-tab-reclick";
import {
  saveScrollPositions,
  restoreScrollPositions,
} from "@/lib/scroll-snapshot";
import { PullRefreshIndicator } from "@/components/PullRefreshIndicator";
import { useMarketSession } from "@/store/session/market-session";
import { PlaylistGrid, PlaylistGridSkeleton } from "./PlaylistGrid";
import { PodcastSection } from "./PodcastSection";
import { AlistSection } from "./AlistSection";
import { BillboardSection } from "./BillboardSection";
import { MineSection } from "./MineSection";
import { RecommendSection } from "./RecommendSection";
import { RadarSection } from "./RadarSection";
import { ArtistSection } from "./ArtistSection";
import { logger } from "@/lib/logger";

/** 歌单广场每页条数：手机 4 列 = 3 行 */
const PAGE_SIZE = 12;
/** 同时保留挂载在 DOM 里的分类面板上限（含当前与左右直接邻居） */
const MAX_KEPT_CATEGORIES = 6;

const getSnapshotKey = (category: string) => `market-snapshot:${category}`;

/** 特殊分类 → 独立 Section 组件；未命中则走下方网易云歌单浏览分支。 */
const MARKET_SECTIONS: Record<string, ComponentType> = {
  mine: MineSection,
  recommend: RecommendSection,
  radar: RadarSection,
  artist: ArtistSection,
  播客: PodcastSection,
  Alist: AlistSection,
  Billboard: BillboardSection,
};

/** 还没挂载过的分类页用轻量骨架占位：手指滑出来时直接有结构、不是一块空白 */
function MarketPaneSkeleton({ title }: { title: string }) {
  return (
    <div className="flex-1 min-h-0 overflow-hidden px-4 pb-bottom-stack">
      <div className="flex items-center -mx-4 px-5 h-[52px] pt-1 border-b mb-4">
        <h2 className="text-base font-bold text-foreground tracking-wide truncate">
          {title}
        </h2>
      </div>
      <PlaylistGridSkeleton count={12} />
    </div>
  );
}

interface CategoryPaneProps {
  barId: string;
  barName: string;
  isActive: boolean;
  marketFilter: string | null;
  onFilterSelect: (id: string) => void;
  onOpenPlaylist: (id: string) => void;
  registerScrollRef: (barId: string, node: HTMLElement | null) => void;
}

/** 单个分类面板：独立拥有纵向滚动容器、分页状态与下拉刷新 */
function MarketCategoryPane({
  barId,
  barName,
  isActive,
  marketFilter,
  onFilterSelect,
  onOpenPlaylist,
  registerScrollRef,
}: CategoryPaneProps) {
  const effectiveCategory =
    barId === "全部" && marketFilter ? marketFilter : barId;
  const ActiveSection = MARKET_SECTIONS[effectiveCategory];
  const isBrowseEnabled = !NON_BROWSE_CATEGORIES.has(effectiveCategory);
  const billboardGroup = useMusicStore((s) => s.lastBillboardGroup);

  const snapshotKey = useMemo(
    () => getSnapshotKey(effectiveCategory),
    [effectiveCategory]
  );

  // 当前 browse 列表对应的 snapshotKey，避免切换 filter 时拿新 adapter 写旧 key
  const listKeyRef = useRef(snapshotKey);
  const isKeySwitching = listKeyRef.current !== snapshotKey;
  const forceRefreshRef = useRef(false);

  const saveListSnapshot = useMarketSession((s) => s.saveListSnapshot);

  const browseAdapter = useMemo(
    () => ({
      fetch: async (offset: number) => {
        const category = effectiveCategory;
        if (NON_BROWSE_CATEGORIES.has(category)) return null;
        const isToplist = category === "toplist";
        const cacheKey = `market-playlist:v3:${category || "all"}:${isToplist ? 0 : offset}`;

        const force = forceRefreshRef.current && offset === 0;
        const res = await cachedFetch<MarketPlaylist[]>(
          cacheKey,
          () =>
            isToplist
              ? getToplist("")
              : getPlaylists(category || "全部", "hot", PAGE_SIZE, offset, ""),
          1 * 24 * 60 * 60 * 1000,
          force
        );

        if (!res) return null;
        return {
          items: res,
          hasMore: isToplist ? false : res.length >= PAGE_SIZE,
        };
      },
    }),
    [effectiveCategory]
  );

  const browse = usePagination<MarketPlaylist>({
    adapter: browseAdapter,
    getId: (p) => p.id,
    pageSize: PAGE_SIZE,
    enabled: isBrowseEnabled && !isKeySwitching,
    onError: (err, offset) =>
      logger.error("PlaylistMarket", "Market load failed", err, {
        category: barId,
        offset,
      }),
  });

  useEffect(() => {
    if (!isBrowseEnabled || isKeySwitching || browse.items.length === 0) return;
    saveListSnapshot(snapshotKey, {
      items: browse.items,
      offset: browse.offset,
      hasMore: browse.hasMore,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browse.items, browse.offset, browse.hasMore]);

  useLayoutEffect(() => {
    listKeyRef.current = snapshotKey;

    if (!isBrowseEnabled) {
      forceRefreshRef.current = false;
      return;
    }

    const snapshot = useMarketSession.getState().listSnapshots[snapshotKey];
    if (snapshot) {
      browse.restore({
        items: snapshot.items,
        offset: snapshot.offset,
        hasMore: snapshot.hasMore,
      });
      forceRefreshRef.current = false;
      return;
    }

    browse.reset();
    forceRefreshRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCategory, snapshotKey, isBrowseEnabled]);

  const { scrollRef: paneScrollRef } = useScrollSave(
    `scroll-${snapshotKey}${effectiveCategory === "Billboard" ? `:${billboardGroup}` : ""}`,
    browse.items.length > 0 || !isBrowseEnabled
  );

  const setScrollNode = useCallback(
    (node: HTMLDivElement | null) => {
      paneScrollRef.current = node;
      registerScrollRef(barId, node);
    },
    [barId, paneScrollRef, registerScrollRef]
  );

  // 触发当前 browse 列表强制刷新（下拉刷新 / 筛选重选）
  const forceReloadBrowse = useCallback(async () => {
    forceRefreshRef.current = true;
    try {
      if (isBrowseEnabled) await browse.reset();
    } finally {
      forceRefreshRef.current = false;
    }
  }, [isBrowseEnabled, browse]);

  const { status: pullStatus, indicatorRef } = usePullToRefresh(paneScrollRef, {
    onRefresh: forceReloadBrowse,
    enabled: isActive && isBrowseEnabled && !isKeySwitching && !ActiveSection,
  });

  // 在「歌单广场」tab 内选择筛选（或重复点当前筛选强制刷新）
  const handleFilterPick = useCallback(
    (id: string) => {
      onFilterSelect(id);
      if (id === effectiveCategory) {
        void forceReloadBrowse();
      } else {
        forceRefreshRef.current = true;
      }
    },
    [effectiveCategory, forceReloadBrowse, onFilterSelect]
  );

  const lastCountRef = useRef(0);
  useEffect(() => {
    if (browse.items.length > 0) lastCountRef.current = browse.items.length;
  }, [browse.items.length]);
  const skeletonCount = Math.max(12, lastCountRef.current);

  const showGridSkeleton =
    isBrowseEnabled &&
    browse.items.length === 0 &&
    (browse.loading || isKeySwitching);

  const pageTitle = effectiveCategory === "全部" ? "全部" : effectiveCategory;

  return (
    <div
      ref={setScrollNode}
      data-market-pane={barId}
      data-page-scroll={isActive ? "" : undefined}
      data-page-active={isActive ? "true" : "false"}
      aria-hidden={!isActive || undefined}
      className="flex-1 min-h-0 overflow-y-auto custom-scrollbar"
    >
      {isBrowseEnabled && (
        <PullRefreshIndicator indicatorRef={indicatorRef} status={pullStatus} />
      )}

      {/* 页内标题行：只在「歌单广场」tab 显示 */}
      {barId === "全部" && (
        <div className="flex items-center gap-2 px-5 h-[52px] pt-1 border-b">
          <PlaylistCategorySelector
            activeCategory={effectiveCategory}
            onSelect={handleFilterPick}
            trigger={
              <div className="flex items-center gap-2 cursor-pointer select-none">
                <span className="text-base font-bold text-foreground tracking-wide shrink-0">
                  {effectiveCategory === "全部" ? barName : pageTitle}
                </span>
                <span className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center bg-secondary/50 hover:bg-secondary transition-colors">
                  <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                </span>
              </div>
            }
          />
        </div>
      )}

      {ActiveSection ? (
        effectiveCategory === "mine" ? (
          <MineSection scrollRef={paneScrollRef} isActive={isActive} />
        ) : effectiveCategory === "recommend" ? (
          <RecommendSection scrollRef={paneScrollRef} isActive={isActive} />
        ) : effectiveCategory === "Billboard" ? (
          <BillboardSection scrollRef={paneScrollRef} isActive={isActive} />
        ) : (
          <ActiveSection />
        )
      ) : (
        <div className="px-4 pb-bottom-stack">
          {barId === "toplist" ? (
            <div className="flex items-center -mx-4 px-5 h-[52px] pt-1 border-b mb-4">
              <h2 className="text-base font-bold text-foreground tracking-wide truncate">
                排行榜
              </h2>
            </div>
          ) : (
            <div className="pt-4" />
          )}

          {showGridSkeleton ? (
            <PlaylistGridSkeleton count={skeletonCount} />
          ) : (
            <PlaylistGrid list={browse.items} onClick={onOpenPlaylist} />
          )}

          <div
            ref={browse.observerTargetRef}
            className="h-12 w-full mt-6 flex items-center justify-center opacity-80"
          >
            {browse.fetching && !browse.loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>加载中...</span>
              </div>
            )}
            {!browse.hasMore && browse.items.length > 0 && (
              <span className="text-xs text-muted-foreground/50 tracking-wide uppercase">
                没有更多了-_-
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PlaylistMarket() {
  const navigate = useNavigate();
  const rawLastCategory = useMusicStore((s) => s.lastPlaylistCategory);
  // 历史版本 Alist 分类 id 为小写，归一化为大写；
  // 「精选」已删除，旧持久值回落到「歌单广场」
  const lastCategory =
    rawLastCategory === "alist"
      ? "Alist"
      : rawLastCategory === "featured"
        ? "全部"
        : rawLastCategory;
  const setActiveCategory = useMusicStore((s) => s.setLastPlaylistCategory);
  const playlistCategoryOrder = useMusicStore((s) => s.playlistCategoryOrder);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const paneScrollRefs = useRef<Map<string, HTMLElement>>(new Map());

  const registerScrollRef = useCallback(
    (barId: string, node: HTMLElement | null) => {
      if (node) paneScrollRefs.current.set(barId, node);
      else paneScrollRefs.current.delete(barId);
    },
    []
  );

  // 歌单广场页内筛选（不切换顶栏 tab、不往顶栏加标签）
  const marketFilter = useMarketSession((s) => s.marketFilter);
  const setMarketFilter = useMarketSession((s) => s.setMarketFilter);

  // 顶栏分类（固定 6 项 + 用户自定义常驻）
  const barCategories = useMemo(
    () => resolveBarCategories(playlistCategoryOrder),
    [playlistCategoryOrder]
  );
  const displayFilters = useMemo(
    () => [...barCategories.fixed, ...barCategories.residents],
    [barCategories]
  );
  const barIds = useMemo(
    () => new Set(displayFilters.map((f) => f.id)),
    [displayFilters]
  );

  // 持久值不在顶栏分类里 → 回落「歌单广场」
  const activeCategory = barIds.has(lastCategory) ? lastCategory : "全部";
  const activeIndex = Math.max(
    0,
    displayFilters.findIndex((f) => f.id === activeCategory)
  );

  // 按需挂载的分类面板（LRU 保留最近 MAX_KEPT_CATEGORIES 个，当前及直接邻居必保留）
  const [visitedList, setVisitedList] = useState<string[]>(() => [
    activeCategory,
  ]);

  const markVisited = useCallback(
    (id: string) => {
      setVisitedList((prev) => {
        if (
          prev[prev.length - 1] === id &&
          prev.length <= MAX_KEPT_CATEGORIES
        ) {
          return prev;
        }
        const filtered = prev.filter((item) => item !== id);
        const next = [...filtered, id];
        if (next.length <= MAX_KEPT_CATEGORIES) return next;
        // 淘汰最久未用的，但保护当前分类与左右相邻分类不被回收
        const curIdx = displayFilters.findIndex((f) => f.id === activeCategory);
        const protectedIds = new Set(
          [
            activeCategory,
            displayFilters[curIdx - 1]?.id,
            displayFilters[curIdx + 1]?.id,
          ].filter((x): x is string => Boolean(x))
        );
        const trimmed: string[] = [];
        let dropBudget = next.length - MAX_KEPT_CATEGORIES;
        for (const item of next) {
          if (dropBudget > 0 && !protectedIds.has(item)) {
            dropBudget--;
            continue;
          }
          trimmed.push(item);
        }
        return trimmed;
      });
    },
    [activeCategory, displayFilters]
  );

  // 确保当前激活分类已加入渲染集合
  useEffect(() => {
    markVisited(activeCategory);
  }, [activeCategory, markVisited]);

  const visitedSet = useMemo(() => {
    const set = new Set(visitedList);
    set.add(activeCategory);
    return set;
  }, [visitedList, activeCategory]);

  const ensureIndexVisited = useCallback(
    (index: number) => {
      const item = displayFilters[index];
      if (item) markVisited(item.id);
    },
    [displayFilters, markVisited]
  );

  const rootPager = useRootPager();
  const isPageActive = useIsRootTabActive("search");

  // 空闲时自动预挂载左右直接相邻分类，确保滑动第一帧无需临时建节点
  useEffect(() => {
    if (!isPageActive) return;
    const neighborIds = [
      displayFilters[activeIndex - 1]?.id,
      displayFilters[activeIndex + 1]?.id,
    ].filter((id): id is string => Boolean(id));
    if (neighborIds.every((id) => visitedSet.has(id))) return;
    const timer = setTimeout(() => {
      neighborIds.forEach((id) => markVisited(id));
    }, 180);
    return () => clearTimeout(timer);
  }, [isPageActive, activeIndex, displayFilters, visitedSet, markVisited]);

  // 非邻近分类用 hidden 移出渲染/绘制树，切离前保存 scrollTop、回到近邻时同步还原；
  // 跨多格点击跳转时短暂保留出发页 300ms，避免飞出动画期间页面瞬间变白。
  const [prevActiveIdx, setPrevActiveIdx] = useState(activeIndex);
  const [leavingIdx, setLeavingIdx] = useState<number | null>(null);
  if (prevActiveIdx !== activeIndex) {
    if (Math.abs(prevActiveIdx - activeIndex) > 1) {
      setLeavingIdx(prevActiveIdx);
    }
    setPrevActiveIdx(activeIndex);
  }
  useEffect(() => {
    if (leavingIdx === null) return;
    const t = setTimeout(() => setLeavingIdx(null), 300);
    return () => clearTimeout(t);
  }, [leavingIdx]);

  const prevMarketIdxRef = useRef(activeIndex);
  useLayoutEffect(() => {
    const prevIdx = prevMarketIdxRef.current;
    prevMarketIdxRef.current = activeIndex;
    const track = trackRef.current;
    if (!track || prevIdx === activeIndex) return;
    Array.from(track.children).forEach((shell, idx) => {
      const inner = shell.firstElementChild as HTMLElement | null;
      if (!inner) return;
      const wasVisible = Math.abs(idx - prevIdx) <= 1;
      const isVisible = Math.abs(idx - activeIndex) <= 1 || idx === leavingIdx;
      if (wasVisible && !isVisible) saveScrollPositions(inner);
      else if (!wasVisible && isVisible) restoreScrollPositions(inner);
    });
  }, [activeIndex, leavingIdx]);

  const displayFiltersRef = useRef(displayFilters);
  const activeCategoryRef = useRef(activeCategory);
  useEffect(() => {
    displayFiltersRef.current = displayFilters;
    activeCategoryRef.current = activeCategory;
  }, [displayFilters, activeCategory]);
  const savedCatBeforeAlignRef = useRef<string | null>(null);

  // 跨页滑动对齐协议：从「喜欢」页右滑露出「发现」时，瞬时切到最后一个分类
  useEffect(() => {
    if (!rootPager) return;
    return rootPager.registerAligner("/search", {
      previewAlign: (edge) => {
        const filters = displayFiltersRef.current;
        const target =
          edge === "start" ? filters[0]?.id : filters[filters.length - 1]?.id;
        if (!target) return;
        if (
          savedCatBeforeAlignRef.current === null &&
          activeCategoryRef.current !== target
        ) {
          savedCatBeforeAlignRef.current = activeCategoryRef.current;
        }
        if (activeCategoryRef.current !== target) {
          setActiveCategory(target);
        }
      },
      cancelAlign: () => {
        const prev = savedCatBeforeAlignRef.current;
        savedCatBeforeAlignRef.current = null;
        if (prev && prev !== activeCategoryRef.current) {
          setActiveCategory(prev);
        }
      },
      commitAlign: () => {
        savedCatBeforeAlignRef.current = null;
      },
    });
  }, [rootPager, setActiveCategory]);

  const filterIds = useMemo(
    () => displayFilters.map((f) => f.id),
    [displayFilters]
  );

  const {
    indicatorRef,
    mirrorRef,
    barWidth,
    hasIndicator,
    initialRect,
    handleTrackDrag,
    handleTrackSettle,
  } = useTabIndicatorSync({
    barRef: scrollContainerRef,
    activeIndex,
    ids: filterIds,
    attrName: "data-category-id",
    autoScrollBar: true,
  });

  const onRootEdge = useRootTabSwipe("search");
  usePagerSwipe(
    { viewportRef, trackRef },
    {
      count: displayFilters.length,
      index: activeIndex,
      onChange: (idx) => {
        const target = displayFilters[idx];
        if (target) setActiveCategory(target.id);
      },
      onEdge: onRootEdge,
      onNeighborIntent: ensureIndexVisited,
      onTrackDrag: handleTrackDrag,
      onTrackSettle: handleTrackSettle,
      rootTab: "search",
      isPageActive,
    }
  );

  // 再次点击底部「发现」tab：不再切换顶栏分类；
  // 有子 tab 的分类由对应 Section 切换页内子 tab，其余分类滚回顶部
  useTabReclick("search", () => {
    const effective =
      activeCategory === "全部" && marketFilter ? marketFilter : activeCategory;
    if (
      effective === "mine" ||
      effective === "recommend" ||
      effective === "Billboard"
    ) {
      return;
    }
    paneScrollRefs.current
      .get(activeCategory)
      ?.scrollTo({ top: 0, behavior: "smooth" });
  });

  const handleOpenPlaylist = useCallback(
    (id: string) => navigate(`/netease-playlist/${id}`),
    [navigate]
  );

  const handleFilterSelect = useCallback(
    (id: string) => {
      const key = getSnapshotKey(id);
      useMarketSession.setState((s) => {
        if (!(key in s.listSnapshots)) return s;
        const { [key]: _removed, ...rest } = s.listSnapshots;
        return { listSnapshots: rest };
      });
      const currentEffective =
        activeCategory === "全部" && marketFilter
          ? marketFilter
          : activeCategory;
      if (id === currentEffective) return;
      setMarketFilter(id === "全部" ? null : id);
    },
    [activeCategory, marketFilter, setMarketFilter]
  );

  return (
    <div className="flex flex-col h-full bg-background/50 animate-in fade-in duration-500">
      <header
        data-tap-top=""
        className="sticky top-0 z-20 shrink-0 bg-background border-b border-border/20 shadow-sm [contain:layout_style]"
      >
        <div className="flex items-center px-3 py-1.5 gap-2">
          <div className="flex-1 min-w-0 overflow-hidden relative">
            <div
              ref={scrollContainerRef}
              className="relative flex flex-nowrap items-center gap-[clamp(2px,1vw,6px)] overflow-x-auto scrollbar-hide"
            >
              {displayFilters.map((f) => (
                <Button
                  key={f.id}
                  data-category-id={f.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveCategory(f.id)}
                  className="relative h-8 px-3 rounded-full text-sm font-medium whitespace-nowrap shrink-0 text-muted-foreground bg-secondary/30 hover:bg-secondary/30 hover:text-muted-foreground"
                >
                  {f.name}
                </Button>
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
                    className="flex flex-nowrap items-center gap-[clamp(2px,1vw,6px)]"
                    style={{
                      width: barWidth || "max-content",
                      transform: `translate3d(${-initialRect.left}px, ${-initialRect.top}px, 0)`,
                    }}
                  >
                    {displayFilters.map((f) => (
                      <span
                        key={f.id}
                        className="inline-flex h-8 items-center justify-center px-3 text-sm font-medium whitespace-nowrap shrink-0 text-primary-foreground"
                      >
                        {f.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* 内容分页：顶栏分类固定，下面所有分类横向排成一条跟手轨道 */}
      <div
        ref={viewportRef}
        data-market-viewport
        className="relative flex-1 min-h-0 overflow-hidden"
      >
        <div
          ref={trackRef}
          data-market-track
          className="flex h-full will-change-transform"
        >
          {displayFilters.map((filter, idx) => {
            const isCatActive = filter.id === activeCategory;
            const visited = visitedSet.has(filter.id);
            const isNear =
              Math.abs(idx - activeIndex) <= 1 || idx === leavingIdx;
            return (
              <div key={filter.id} className="h-full w-full shrink-0">
                <div
                  className={cn(
                    "flex h-full w-full flex-col [contain:layout_style_paint]",
                    !isNear && "hidden"
                  )}
                >
                  {visited ? (
                    <MarketCategoryPane
                      barId={filter.id}
                      barName={filter.name}
                      isActive={isCatActive}
                      marketFilter={marketFilter}
                      onFilterSelect={handleFilterSelect}
                      onOpenPlaylist={handleOpenPlaylist}
                      registerScrollRef={registerScrollRef}
                    />
                  ) : (
                    <MarketPaneSkeleton title={filter.name} />
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
