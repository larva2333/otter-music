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
import { Input } from "@/components/ui/input";
import {
  SPECIAL_CATS,
  resolveBarCategories,
  NON_BROWSE_CATEGORIES,
} from "@/lib/netease/netease-cats";
import {
  getPlaylists,
  getToplist,
  searchPlaylists,
} from "@/lib/netease/netease-api";
import type { MarketPlaylist } from "@/lib/netease/netease-types";
import { cachedFetch } from "@/lib/utils/cache";
import { Loader2, LayoutGrid, X } from "lucide-react";
import { PlaylistCategorySelector } from "./PlaylistCategorySelector";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useMusicStore } from "@/store/music-store";
import { useScrollSave } from "@/hooks/use-scroll-save";
import { usePagination } from "@/hooks/use-pagination";
import { useMarketSession } from "@/store/session/market-session";
import { PlaylistGrid, PlaylistGridSkeleton } from "./PlaylistGrid";
import { PodcastSection } from "./PodcastSection";
import { AlistSection } from "./AlistSection";
import { BillboardSection } from "./BillboardSection";
import { AwardsSection } from "./AwardsSection";
import { logger } from "@/lib/logger";

const PAGE_SIZE = 30;
const SUB_TAB_HEIGHT = "h-8";
/** 首页同时保留在 DOM 里的分类网格数量（含当前），用于避免切回时图片重新解码 */
const MAX_KEPT_GRIDS = 4;

const getSnapshotKey = (category: string, tab: string) =>
  `market-snapshot:${category}:${category === "featured" ? tab : "default"}`;

/** 特殊分类 → 独立 Section 组件；未命中则走下方网易云歌单浏览分支 */
const MARKET_SECTIONS: Record<string, ComponentType> = {
  播客: PodcastSection,
  Alist: AlistSection,
  Billboard: BillboardSection,
};

export function PlaylistMarket() {
  const navigate = useNavigate();
  const rawLastCategory = useMusicStore((s) => s.lastPlaylistCategory);
  // 历史版本 Alist 分类 id 为小写，归一化为大写；
  // 「我的」已迁到「我的」页，旧持久值回落到「全部」
  const activeCategory =
    rawLastCategory === "alist"
      ? "Alist"
      : rawLastCategory === "mine"
        ? "全部"
        : rawLastCategory;
  const setActiveCategory = useMusicStore((s) => s.setLastPlaylistCategory);
  const featuredTab = useMusicStore(
    (s) => s.lastFeaturedTab || SPECIAL_CATS[0].id
  );
  const setFeaturedTab = useMusicStore((s) => s.setLastFeaturedTab);
  // 仅用于 Billboard 子 tab 的滚动位置 key
  const billboardGroup = useMusicStore((s) => s.lastBillboardGroup);
  const playlistCategoryOrder = useMusicStore((s) => s.playlistCategoryOrder);
  const [searchInputValue, setSearchInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const saveListSnapshot = useMarketSession((s) => s.saveListSnapshot);
  const listSnapshots = useMarketSession((s) => s.listSnapshots);
  const searchCache = useMarketSession((s) => s.searchCache);
  const saveSearchCache = useMarketSession((s) => s.saveSearchCache);

  const searchKeywordRef = useRef<string>("");

  const snapshotKey = useMemo(
    () => getSnapshotKey(activeCategory, featuredTab),
    [activeCategory, featuredTab]
  );

  const isBrowseEnabled =
    !NON_BROWSE_CATEGORIES.has(activeCategory) &&
    !(activeCategory === "全部" && !!searchQuery);

  const isSearchEnabled = activeCategory === "全部" && !!searchQuery;

  // 当前 browse 里的 items 属于哪个快照 key。分类刚切换、effect 还没跑时两者不等，
  // 此时禁用分页观察器，避免拿新分类的 adapter 去请求旧分类的 offset。
  const listKeyRef = useRef(snapshotKey);
  const isKeySwitching = listKeyRef.current !== snapshotKey;

  // 访问过的分类网格保留在 DOM 里（最多 4 个），切换时只切显示状态。
  // 这样切回去时 <img> 节点不会重新挂载，也就不会重新解码、不会再闪。
  const [keptKeys, setKeptKeys] = useState<string[]>(() => [snapshotKey]);

  const renderKeys = useMemo(
    () =>
      keptKeys.includes(snapshotKey) ? keptKeys : [...keptKeys, snapshotKey],
    [keptKeys, snapshotKey]
  );

  useEffect(() => {
    setKeptKeys((prev) => {
      if (prev.includes(snapshotKey)) return prev;
      const next = [...prev, snapshotKey];
      return next.length > MAX_KEPT_GRIDS
        ? next.slice(next.length - MAX_KEPT_GRIDS)
        : next;
    });
  }, [snapshotKey]);

  const browseAdapter = useMemo(
    () => ({
      fetch: async (offset: number) => {
        const category =
          activeCategory === "featured" ? featuredTab : activeCategory;
        if (NON_BROWSE_CATEGORIES.has(category)) return null;
        const isToplist = category === "toplist";
        const cacheKey = `market-playlist:v2:${category || "all"}:${isToplist ? 0 : offset}`;

        const res = await cachedFetch<MarketPlaylist[]>(
          cacheKey,
          () =>
            isToplist
              ? getToplist("")
              : getPlaylists(category || "全部", "hot", PAGE_SIZE, offset, ""),
          1 * 24 * 60 * 60 * 1000
        );

        if (!res) return null;
        return {
          items: res,
          hasMore: isToplist ? false : res.length >= PAGE_SIZE,
        };
      },
    }),
    [activeCategory, featuredTab]
  );

  const browse = usePagination<MarketPlaylist>({
    adapter: browseAdapter,
    getId: (p) => p.id,
    pageSize: PAGE_SIZE,
    enabled: isBrowseEnabled && !isKeySwitching,
    onError: (err, offset) =>
      logger.error("PlaylistMarket", "Market load failed", err, {
        category: activeCategory,
        featuredTab,
        offset,
      }),
  });

  const searchAdapter = useMemo(
    () => ({
      fetch: async (offset: number) => {
        const keyword = searchKeywordRef.current;
        if (!keyword) return null;
        const page = offset / PAGE_SIZE + 1;
        const res = await searchPlaylists(keyword, page, PAGE_SIZE);
        if (!res) return null;
        return { items: res, hasMore: res.length >= PAGE_SIZE };
      },
    }),
    []
  );

  const search = usePagination<MarketPlaylist>({
    adapter: searchAdapter,
    getId: (p) => p.id,
    pageSize: PAGE_SIZE,
    enabled: isSearchEnabled,
    onError: (err, offset) =>
      logger.error("PlaylistMarket", "Playlist search failed", err, {
        keyword: searchKeywordRef.current,
        offset,
      }),
  });

  // Save browse snapshots
  useEffect(() => {
    // 分类刚切换、列表还是上一个分类的旧数据时不要写快照，否则会污染新 key
    if (!isBrowseEnabled || isKeySwitching || browse.items.length === 0) return;
    const key = getSnapshotKey(activeCategory, featuredTab);
    saveListSnapshot(key, {
      items: browse.items,
      offset: browse.offset,
      hasMore: browse.hasMore,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browse.items, browse.offset, browse.hasMore]);

  // Save search cache
  useEffect(() => {
    if (searchQuery && search.items.length >= 0) {
      saveSearchCache({
        query: searchQuery,
        items: search.items,
        offset: search.offset,
        hasMore: search.hasMore,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, search.items, search.offset, search.hasMore]);

  // Category switch
  // 用 useLayoutEffect：分类切换必须在浏览器绘制前把列表换成新分类的数据，
  // 否则会先画一帧「上一个分类的歌单」，看起来就是闪一下。
  useLayoutEffect(() => {
    listKeyRef.current = snapshotKey;

    if (activeCategory === "全部") {
      if (searchCache) {
        setSearchInputValue(searchCache.query);
        setSearchQuery(searchCache.query);
        searchKeywordRef.current = searchCache.query;
        search.restore({
          items: searchCache.items,
          offset: searchCache.offset,
          hasMore: searchCache.hasMore,
        });
      } else {
        setSearchInputValue("");
        setSearchQuery(null);
        searchKeywordRef.current = "";
      }
    } else {
      setSearchInputValue("");
      setSearchQuery(null);
    }

    if (NON_BROWSE_CATEGORIES.has(activeCategory)) return;

    const snapshot = useMarketSession.getState().listSnapshots[snapshotKey];
    if (snapshot) {
      browse.restore({
        items: snapshot.items,
        offset: snapshot.offset,
        hasMore: snapshot.hasMore,
      });
      return;
    }

    browse.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, featuredTab, snapshotKey]);

  const handleSearchSubmit = useCallback(
    (keyword: string) => {
      const trimmed = keyword.trim();
      if (!trimmed) {
        if (searchQuery) {
          setSearchQuery(null);
          searchKeywordRef.current = "";
          saveSearchCache(null);
        }
        return;
      }
      searchKeywordRef.current = trimmed;
      setSearchQuery(trimmed);
      search.reset();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchQuery, saveSearchCache]
  );

  const clearSearch = useCallback(() => {
    setSearchInputValue("");
    setSearchQuery(null);
    searchKeywordRef.current = "";
    saveSearchCache(null);
  }, [saveSearchCache]);

  // Billboard 子 tab 记忆滚动位置，故 scroll key 附加子 tab 标识
  const { scrollRef } = useScrollSave(
    `scroll-${snapshotKey}${activeCategory === "Billboard" ? `:${billboardGroup}` : ""}`,
    !searchQuery &&
      (browse.items.length > 0 || NON_BROWSE_CATEGORIES.has(activeCategory))
  );

  const displayFilters = useMemo(() => {
    const base = resolveBarCategories(playlistCategoryOrder);
    const all = [...base.fixed, ...base.residents];
    if (!activeCategory || all.some((f) => f.id === activeCategory)) return all;
    return [...all, { id: activeCategory, name: activeCategory }];
  }, [activeCategory, playlistCategoryOrder]);

  // Scroll active category into view
  useEffect(() => {
    const activeBtn = scrollContainerRef.current?.querySelector(
      `[data-category-id="${activeCategory}"]`
    );
    if (activeBtn) {
      activeBtn.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [activeCategory]);

  const isSearchActive = activeCategory === "全部" && !!searchQuery;
  const active = isSearchActive ? search : browse;
  const ActiveSection = MARKET_SECTIONS[activeCategory];

  // 每个保留在 DOM 里的网格对应哪份数据：
  // 当前分类用分页状态（切 key 的那一帧还没 restore，就先看快照，保证 key 不变、DOM 不重建），
  // 其余分类用各自的快照。
  const gridLists = useMemo(() => {
    const map = new Map<string, MarketPlaylist[]>();
    for (const key of renderKeys) {
      const snapshotItems = listSnapshots[key]?.items ?? [];
      if (key === snapshotKey && !isKeySwitching) {
        map.set(key, browse.items);
      } else {
        map.set(key, snapshotItems);
      }
    }
    return map;
  }, [renderKeys, snapshotKey, isKeySwitching, listSnapshots, browse.items]);

  const currentGridList = gridLists.get(snapshotKey) ?? [];
  const showGridSkeleton =
    currentGridList.length === 0 && (browse.loading || isKeySwitching);

  // 骨架卡片数量对齐上一屏的条数：切换分类时页面高度不塌，观感上不会「跳一下」
  const lastCountRef = useRef(0);
  useEffect(() => {
    if (browse.items.length > 0) lastCountRef.current = browse.items.length;
  }, [browse.items.length]);
  const skeletonCount = Math.max(12, lastCountRef.current);

  const handleOpenPlaylist = useCallback(
    (id: string) => navigate(`/netease-playlist/${id}`),
    [navigate]
  );

  return (
    <div className="flex flex-col h-full bg-background/50 animate-in fade-in duration-500">
      <header
        data-tap-top=""
        className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-border/20 shadow-sm"
      >
        <div className="flex items-center justify-between px-3 py-1.5 gap-2">
          <div className="flex-1 overflow-hidden relative">
            <div
              ref={scrollContainerRef}
              className="flex items-center gap-1.5 overflow-x-auto no-scrollbar mask-[linear-gradient(to_right,black_calc(100%-32px),transparent_100%)]"
            >
              {displayFilters.map((f) => (
                <Button
                  key={f.id}
                  data-category-id={f.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveCategory(f.id)}
                  className={cn(
                    "h-8 px-3 rounded-full transition-all text-xs font-medium whitespace-nowrap shrink-0",
                    activeCategory === f.id
                      ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                      : "text-muted-foreground hover:text-foreground bg-secondary/30"
                  )}
                >
                  {f.name}
                </Button>
              ))}
              <div className="w-4 shrink-0" />
            </div>
          </div>
          <PlaylistCategorySelector
            activeCategory={activeCategory}
            onSelect={setActiveCategory}
            trigger={
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 rounded-full shrink-0 bg-secondary/50 hover:bg-secondary"
              >
                <LayoutGrid className="h-4 w-4 text-muted-foreground" />
              </Button>
            }
          />
        </div>
      </header>

      <main
        ref={scrollRef}
        data-page-scroll=""
        className="flex-1 overflow-y-auto custom-scrollbar"
      >
        {ActiveSection ? (
          <ActiveSection />
        ) : (
          <div className="p-4 pb-bottom-stack">
            {activeCategory === "全部" && (
              <div
                className={cn(
                  "flex items-center justify-between mb-4 px-1 gap-4 transition-all duration-300",
                  SUB_TAB_HEIGHT
                )}
              >
                <div className="relative flex-1 group max-w-32">
                  <Input
                    value={searchInputValue}
                    onChange={(e) => setSearchInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleSearchSubmit(searchInputValue);
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    placeholder="歌单广场"
                    className={cn(
                      "h-8 px-0 bg-transparent! shadow-none rounded-none transition-all duration-300",
                      "border-0 border-b border-dashed border-muted-foreground/20 focus-visible:border-solid",
                      "text-base font-semibold text-foreground",
                      "placeholder:text-foreground placeholder:font-semibold placeholder:text-base",
                      "focus-visible:ring-0 focus-visible:border-primary",
                      "focus-visible:placeholder:text-muted-foreground/40 focus-visible:placeholder:font-normal focus-visible:placeholder:text-xs"
                    )}
                  />

                  {searchInputValue && (
                    <button
                      type="button"
                      onClick={clearSearch}
                      className="absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                      aria-label="清除"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <span className="text-xs text-muted-foreground/40 whitespace-nowrap shrink-0">
                  共 {active.items.length} 个歌单
                </span>
              </div>
            )}

            {activeCategory === "featured" && !isSearchActive && (
              <div
                className={cn(
                  "flex items-center gap-6 mb-4 px-1",
                  SUB_TAB_HEIGHT
                )}
              >
                {SPECIAL_CATS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setFeaturedTab(tab.id)}
                    className={cn(
                      "text-[15px] transition-all",
                      featuredTab === tab.id
                        ? "font-bold text-foreground tracking-wide"
                        : "font-medium text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tab.name}
                  </button>
                ))}
              </div>
            )}

            {activeCategory === "featured" && featuredTab === "Awards" ? (
              <AwardsSection />
            ) : (
              <>
                {isSearchActive ? (
                  active.loading && active.items.length === 0 ? (
                    <PlaylistGridSkeleton />
                  ) : (
                    <PlaylistGrid
                      list={active.items}
                      onClick={handleOpenPlaylist}
                    />
                  )
                ) : (
                  <>
                    {/* 访问过的分类网格都留在 DOM 里（保留 <img> 节点和滚动状态），
                        非当前分类用 display:none 移出渲染树。
                        不能改成 absolute + visibility:hidden 叠放：定位元素会画在
                        正常流的网格之上，visibility 的那一帧还没生效时，
                        上一屏的标题会直接盖在新标题上（实测会持续 2~3 帧）。 */}
                    <div className="relative">
                      {renderKeys.map((key) => (
                        <div
                          key={key}
                          aria-hidden={key !== snapshotKey}
                          className={key === snapshotKey ? undefined : "hidden"}
                        >
                          <PlaylistGrid
                            list={gridLists.get(key) ?? []}
                            onClick={handleOpenPlaylist}
                          />
                        </div>
                      ))}
                    </div>
                    {showGridSkeleton && (
                      <PlaylistGridSkeleton count={skeletonCount} />
                    )}
                  </>
                )}

                <div
                  ref={active.observerTargetRef}
                  className="h-12 w-full mt-6 flex items-center justify-center opacity-80"
                >
                  {active.fetching && !active.loading && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>加载中...</span>
                    </div>
                  )}
                  {!active.hasMore && active.items.length > 0 && (
                    <span className="text-xs text-muted-foreground/50 tracking-wide uppercase">
                      没有更多了-_-
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
