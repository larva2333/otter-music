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
import { useSwipeCategories } from "@/hooks/use-swipe-categories";
import { useRootTabSwipe } from "@/hooks/use-root-tab-swipe";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { useTabReclick } from "@/hooks/use-tab-reclick";
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

const PAGE_SIZE = 30;
/**
 * 首页同时保留在 DOM 里的分类网格数量（含当前）。
 *
 * 以前是 4：切到第 5 个分类就会把最早的网格整块卸载，网格里的 <img> 节点
 * 跟着被销毁。再切回去时节点要重建，封面就得重新读缓存/重新解码，
 * 表现出来就是「来回切分类，封面又一张张加载一遍」。
 * 顶部常驻栏总共十来个分类，干脆全部留着（上限仍留一点余量），
 * 非当前网格是 display:none，不参与布局也不影响滚动。
 */
const MAX_KEPT_GRIDS = 16;

const getSnapshotKey = (category: string) => `market-snapshot:${category}`;

/** 特殊分类 → 独立 Section 组件；未命中则走下方网易云歌单浏览分支。
 *  播客/Alist/Billboard 不在默认常驻栏，但可通过筛选按钮添加回来。 */
const MARKET_SECTIONS: Record<string, ComponentType> = {
  mine: MineSection,
  recommend: RecommendSection,
  radar: RadarSection,
  artist: ArtistSection,
  播客: PodcastSection,
  Alist: AlistSection,
  Billboard: BillboardSection,
};

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
  // 仅用于 Billboard 子 tab 的滚动位置 key
  const billboardGroup = useMusicStore((s) => s.lastBillboardGroup);
  const playlistCategoryOrder = useMusicStore((s) => s.playlistCategoryOrder);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 歌单广场页内筛选（不切换顶栏 tab、不往顶栏加标签）
  const marketFilter = useMarketSession((s) => s.marketFilter);
  const setMarketFilter = useMarketSession((s) => s.setMarketFilter);

  const saveListSnapshot = useMarketSession((s) => s.saveListSnapshot);
  const listSnapshots = useMarketSession((s) => s.listSnapshots);

  // 顶栏分类（固定 5 项 + 用户自定义常驻）
  const barCategories = useMemo(
    () => resolveBarCategories(playlistCategoryOrder),
    [playlistCategoryOrder]
  );
  const barIds = useMemo(
    () =>
      new Set(
        [...barCategories.fixed, ...barCategories.residents].map((f) => f.id)
      ),
    [barCategories]
  );

  // 持久值不在顶栏分类里（如旧版本筛选残留的「华语」）→ 回落「歌单广场」
  const activeCategory = barIds.has(lastCategory) ? lastCategory : "全部";

  // 页内实际浏览分类：仅「歌单广场」tab 应用筛选
  const effectiveCategory =
    activeCategory === "全部" && marketFilter ? marketFilter : activeCategory;

  const [indicator, setIndicator] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  const snapshotKey = useMemo(
    () => getSnapshotKey(effectiveCategory),
    [effectiveCategory]
  );

  const isBrowseEnabled = !NON_BROWSE_CATEGORIES.has(effectiveCategory);

  // 当前 browse 里的 items 属于哪个快照 key。分类刚切换、effect 还没跑时两者不等，
  // 此时禁用分页观察器，避免拿新分类的 adapter 去请求旧分类的 offset。
  const listKeyRef = useRef(snapshotKey);
  const isKeySwitching = listKeyRef.current !== snapshotKey;

  // 下拉刷新时让 browseAdapter 的首次请求绕过磁盘缓存；仅影响当前这一次 fetch(0)
  const forceRefreshRef = useRef(false);

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
        const category = effectiveCategory;
        if (NON_BROWSE_CATEGORIES.has(category)) return null;
        const isToplist = category === "toplist";
        const cacheKey = `market-playlist:v2:${category || "all"}:${isToplist ? 0 : offset}`;

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
        category: activeCategory,
        offset,
      }),
  });

  // Save browse snapshots
  useEffect(() => {
    // 分类刚切换、列表还是上一个分类的旧数据时不要写快照，否则会污染新 key
    if (!isBrowseEnabled || isKeySwitching || browse.items.length === 0) return;
    const key = getSnapshotKey(effectiveCategory);
    saveListSnapshot(key, {
      items: browse.items,
      offset: browse.offset,
      hasMore: browse.hasMore,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browse.items, browse.offset, browse.hasMore]);

  // Category switch
  // 用 useLayoutEffect：分类切换必须在浏览器绘制前把列表换成新分类的数据，
  // 否则会先画一帧「上一个分类的歌单」，看起来就是闪一下。
  useLayoutEffect(() => {
    listKeyRef.current = snapshotKey;

    if (NON_BROWSE_CATEGORIES.has(effectiveCategory)) {
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

    // browse.reset() 内部会同步调用 adapter.fetch 并读取 forceRefreshRef，
    // 因此这里读完立即复位，不影响后续正常切换
    browse.reset();
    forceRefreshRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCategory, snapshotKey]);

  // Billboard 子 tab 记忆滚动位置，故 scroll key 附加子 tab 标识
  const { scrollRef } = useScrollSave(
    `scroll-${snapshotKey}${effectiveCategory === "Billboard" ? `:${billboardGroup}` : ""}`,
    browse.items.length > 0 || NON_BROWSE_CATEGORIES.has(effectiveCategory)
  );

  const displayFilters = useMemo(
    () => [...barCategories.fixed, ...barCategories.residents],
    [barCategories]
  );

  // 内容 wrapper：横滑跟手平移它（而不是滚动容器），避免带动下拉刷新指示器；
  // 同时是切分类进入动画的载体，两者都在 transform 上、由 hook 先清位移再播动画
  const contentRef = useRef<HTMLDivElement>(null);

  // 内容区左右滑动切换顶栏分类（页内筛选不影响滑动顺序）
  // 滑到最后一个分类再左滑 → 落到「喜欢」tab；第一个分类右滑不动（链头）
  const onRootEdge = useRootTabSwipe("search");
  useSwipeCategories(scrollRef, {
    ids: displayFilters.map((f) => f.id),
    activeId: activeCategory,
    onChange: setActiveCategory,
    onEdge: onRootEdge,
    followRef: contentRef,
  });

  /* 切分类的内容动效：以前点顶栏按钮或用横滑切分类时，内容是一帧硬切，
     没有任何过渡，看着像闪了一下。这里用 Web Animations API 播一次方向感知的
     进入动画（与根 tab 的 page-enter-* 同参数），方向按分类在顶栏里的位置判断。
     不能给容器加 key 或切 className 来触发：每个分类的网格要留在 DOM 里
     （保留 <img> 节点和滚动状态），重挂载就白留了。 */
  const categoryIndexRef = useRef(-1);
  useLayoutEffect(() => {
    const index = displayFilters.findIndex((f) => f.id === activeCategory);
    const prev = categoryIndexRef.current;
    categoryIndexRef.current = index;
    const el = contentRef.current;
    if (!el || prev < 0 || index < 0 || prev === index) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const dir = index > prev ? 1 : -1;
    el.animate(
      [
        { opacity: 0.4, transform: `translateX(${dir * 28}px)` },
        { opacity: 1, transform: "translateX(0)" },
      ],
      { duration: 220, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }
    );
  }, [activeCategory, displayFilters]);

  const ActiveSection = MARKET_SECTIONS[effectiveCategory];

  // 再次点击底部「发现」tab：在当前页内循环切换分类（不跳去下一个菜单）
  useTabReclick("search", () => {
    const ids = displayFilters.map((f) => f.id);
    const index = ids.indexOf(activeCategory);
    const nextId = ids[(index + 1) % ids.length];
    if (nextId && nextId !== activeCategory) setActiveCategory(nextId);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  });

  // 下拉刷新：回到第一页重新加载，并绕过磁盘缓存拿最新数据
  const { status: pullStatus, indicatorRef } = usePullToRefresh(scrollRef, {
    onRefresh: async () => {
      forceRefreshRef.current = true;
      try {
        if (isBrowseEnabled) await browse.reset();
      } finally {
        forceRefreshRef.current = false;
      }
    },
    enabled: isBrowseEnabled && !isKeySwitching && !ActiveSection,
  });

  // 选中滑块位置：按按钮在栏内的 offsetLeft/offsetTop 定位（rAF 里测量，
  // 避免同步 setState 级联渲染）。胶囊本身尺寸不变、只让间距随视口收缩；
  // 极窄屏仍放不下时靠横滑兜底，并把选中项滚到可视区。
  const measureIndicator = useCallback(() => {
    const bar = scrollContainerRef.current;
    const btn = bar?.querySelector<HTMLElement>(
      `[data-category-id="${activeCategory}"]`
    );
    if (!bar || !btn) {
      setIndicator(null);
      return;
    }
    setIndicator({
      left: btn.offsetLeft,
      top: btn.offsetTop,
      width: btn.offsetWidth,
    });
    // 只滚胶囊容器本身；不能用 scrollIntoView，否则会把外层页面一起带跑
    const target = btn.offsetLeft - (bar.clientWidth - btn.offsetWidth) / 2;
    bar.scrollLeft = Math.max(0, target);
  }, [activeCategory]);

  useEffect(() => {
    const raf = requestAnimationFrame(measureIndicator);
    window.addEventListener("resize", measureIndicator);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measureIndicator);
    };
  }, [measureIndicator, displayFilters]);

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

  const active = browse;

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

  // 页内标题：默认显示「全部」，筛选选中具体分类后跟随变为筛选标签
  const pageTitle = useMemo(() => {
    if (effectiveCategory === "全部") return "全部";
    return (
      displayFilters.find((f) => f.id === effectiveCategory)?.name ??
      effectiveCategory
    );
  }, [effectiveCategory, displayFilters]);

  // 筛选抽屉选择：页内切换筛选（不动顶栏 tab、不往顶栏加标签），
  // 清掉目标分类的会话快照并绕过磁盘缓存，选择完即刷新下方歌单
  const handleFilterSelect = useCallback(
    (id: string) => {
      const key = getSnapshotKey(id);
      useMarketSession.setState((s) => {
        if (!(key in s.listSnapshots)) return s;
        const { [key]: _removed, ...rest } = s.listSnapshots;
        return { listSnapshots: rest };
      });

      if (id === effectiveCategory) {
        // 重复选中当前筛选：直接强制刷新当前列表
        forceRefreshRef.current = true;
        void browse.reset().finally(() => {
          forceRefreshRef.current = false;
        });
        return;
      }

      forceRefreshRef.current = true;
      setMarketFilter(id === "全部" ? null : id);
    },
    [effectiveCategory, setMarketFilter, browse]
  );

  return (
    <div className="flex flex-col h-full bg-background/50 animate-in fade-in duration-500">
      <header
        data-tap-top=""
        className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-border/20 shadow-sm"
      >
        <div className="flex items-center px-3 py-1.5 gap-2">
          <div className="flex-1 min-w-0 overflow-hidden relative">
            <div
              ref={scrollContainerRef}
              className="relative flex flex-nowrap items-center gap-[clamp(2px,1vw,6px)] overflow-x-auto scrollbar-hide"
            >
              {indicator && (
                <div
                  aria-hidden
                  className="absolute left-0 top-0 h-8 rounded-full bg-primary pointer-events-none"
                  style={{
                    transform: `translate(${indicator.left}px, ${indicator.top}px)`,
                    width: indicator.width,
                    transition: "transform 250ms ease, width 250ms ease",
                  }}
                />
              )}
              {displayFilters.map((f) => (
                <Button
                  key={f.id}
                  data-category-id={f.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveCategory(f.id)}
                  className={cn(
                    "relative h-8 px-3 rounded-full transition-colors text-sm font-medium whitespace-nowrap shrink-0",
                    activeCategory === f.id
                      ? "text-primary-foreground hover:bg-transparent hover:text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground bg-secondary/30"
                  )}
                >
                  {f.name}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main
        ref={scrollRef}
        data-page-scroll=""
        className="flex-1 overflow-y-auto custom-scrollbar"
      >
        <PullRefreshIndicator indicatorRef={indicatorRef} status={pullStatus} />
        <div ref={contentRef}>
          {/* 页内标题行：只在「歌单广场」tab 显示；标题与筛选按钮都可点击打开筛选抽屉 */}
          {activeCategory === "全部" && (
            <div className="flex items-center gap-2 px-5 pt-4 h-12">
              <PlaylistCategorySelector
                activeCategory={effectiveCategory}
                onSelect={handleFilterSelect}
                trigger={
                  <div className="flex items-center gap-2 cursor-pointer select-none">
                    <span className="text-base font-bold text-foreground tracking-wide shrink-0">
                      {pageTitle}
                    </span>
                    <span className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center bg-secondary/50 hover:bg-secondary transition-colors">
                      <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                    </span>
                  </div>
                }
              />
            </div>
          )}
          {/* 播客 / Billboard / Alist 这类独立区块与歌单网格同时挂载：
            以前是二选一，去一趟播客再回来，所有已加载的分类网格都会被卸载，
            封面 <img> 全部重建 → 又「重新加载」一遍。现在只切显示状态。 */}
          {/* 「我的」「推荐」传外层滚动容器，启用下拉刷新；其余 Section 无此需求 */}
          {ActiveSection &&
            (effectiveCategory === "mine" ? (
              <MineSection scrollRef={scrollRef} />
            ) : effectiveCategory === "recommend" ? (
              <RecommendSection scrollRef={scrollRef} />
            ) : (
              <ActiveSection />
            ))}
          <div className={cn("p-4 pb-bottom-stack", ActiveSection && "hidden")}>
            {/* 「排行榜」（网易云 toplist）独立区块，和歌手/雷达一样给个标题 */}
            {!ActiveSection && effectiveCategory === "toplist" && (
              <div className="flex items-center h-8 mb-4 px-1">
                <h2 className="text-base font-bold text-foreground tracking-wide truncate">
                  排行榜
                </h2>
              </div>
            )}
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
            {showGridSkeleton && <PlaylistGridSkeleton count={skeletonCount} />}

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
          </div>
        </div>
      </main>
    </div>
  );
}
