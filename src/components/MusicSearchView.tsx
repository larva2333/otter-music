import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import toast from "react-hot-toast";
import { Search, X, Loader2 } from "lucide-react";

import { getExactKey } from "@/lib/utils/music-key";
import { useDebounce } from "@/hooks/use-debounce";
import { useExitLayer } from "@/hooks/useExitLayer";
import { musicApi } from "@/lib/music-api";
import { useMusicStore } from "@/store/music-store";
import {
  applySearchIntentSort,
  mergeAndSortTracks,
} from "@/lib/utils/search-helper";
import { toastUtils } from "@/lib/utils/toast";
import { enrichBilibiliSearchResults } from "@/lib/bilibili/bilibili-api";
import {
  EMPTY_SEARCH_CATEGORIES,
  EMPTY_SEARCH_CATEGORY_PAGING,
  hasSearchCategoryHits,
  SEARCH_CATEGORY_PAGE_SIZE,
  type SearchResultTab,
} from "@/lib/search-categories";

import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { SearchSuggestions } from "./SearchSuggestions";
import { SearchHistory } from "./SearchHistory";
import { PageHeader } from "./PageHeader";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { MusicTrackList } from "./MusicTrackList";
import { SearchCategoryResults } from "./SearchCategoryResults";
import { PlaylistMarket } from "./PlaylistMarket/PlaylistMarket";
import {
  type MusicTrack,
  type MusicSource,
  type SearchSuggestionItem,
  searchOptions,
} from "@/types/music";
import { logger } from "@/lib/logger";

interface MusicSearchViewProps {
  onPlay: (track: MusicTrack, list: MusicTrack[], contextId?: string) => void;
  currentTrackId?: string;
  isPlaying?: boolean;
}

export function MusicSearchView({
  onPlay,
  currentTrackId,
  isPlaying,
}: MusicSearchViewProps) {
  const resultsScrollRef = useRef<HTMLDivElement>(null);
  const categoryVersionRef = useRef(0);
  const {
    source,
    setSource,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    searchCategories,
    setSearchCategories,
    searchCategoryPaging,
    setSearchCategoryPaging,
    searchCategoryLoading,
    setSearchCategoryLoading,
    searchTab,
    setSearchTab,
    searchLoading,
    setSearchLoading,
    searchHasMore,
    setSearchHasMore,
    searchPage,
    setSearchPage,
    searchIntent,
    setSearchIntent,
    sourceConfigs,
  } = useMusicStore(
    useShallow((s) => ({
      source: s.searchSource,
      setSource: s.setSearchSource,
      searchQuery: s.searchQuery,
      setSearchQuery: s.setSearchQuery,
      searchResults: s.searchResults,
      setSearchResults: s.setSearchResults,
      searchCategories: s.searchCategories,
      setSearchCategories: s.setSearchCategories,
      searchCategoryPaging: s.searchCategoryPaging,
      setSearchCategoryPaging: s.setSearchCategoryPaging,
      searchCategoryLoading: s.searchCategoryLoading,
      setSearchCategoryLoading: s.setSearchCategoryLoading,
      searchTab: s.searchTab,
      setSearchTab: s.setSearchTab,
      searchLoading: s.searchLoading,
      setSearchLoading: s.setSearchLoading,
      searchHasMore: s.searchHasMore,
      setSearchHasMore: s.setSearchHasMore,
      searchPage: s.searchPage,
      setSearchPage: s.setSearchPage,
      searchIntent: s.searchIntent,
      setSearchIntent: s.setSearchIntent,
      sourceConfigs: s.sourceConfigs,
    }))
  );

  const abortRef = useRef<AbortController | null>(null);
  const versionRef = useRef(0);
  const seenRef = useRef(new Set<string>());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isSearchingRef = useRef(false);
  const isInputFocusedRef = useRef(false);
  const suggestionContextRef = useRef<{
    query: string;
    suggestions: SearchSuggestionItem[];
  } | null>(null);
  const navigate = useNavigate();

  const visibleSourceOptions = useMemo(() => {
    const visible = sourceConfigs.filter((c) => c.visible);
    return [
      { value: "all", label: "聚合搜索" },
      ...visible.map((c) => {
        const opt = searchOptions[c.source];
        return { value: c.source, label: opt || c.source };
      }),
    ];
  }, [sourceConfigs]);

  /* ---------------- 搜索建议 ---------------- */
  const [suggestions, setSuggestions] = useState<SearchSuggestionItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  /* ---------------- 搜索历史 ---------------- */
  const { history, addHistory, removeHistory, clearHistory } =
    useSearchHistory();
  const [showHistory, setShowHistory] = useState(false);
  const [drilledFromSuggestions, setDrilledFromSuggestions] = useState(false);
  const hasHistory = history.length > 0;

  useEffect(() => {
    let cancelled = false;
    const fetchSuggestions = async () => {
      // 空查询或正在搜索歌曲 → 清空并隐藏
      if (!debouncedSearchQuery.trim() || isSearchingRef.current) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }
      try {
        const results =
          await musicApi.getSearchSuggestions(debouncedSearchQuery);
        if (cancelled) return;
        // 还没提交歌曲搜索时（刚输入，或从歌单页返回），即使输入框已失焦也要展示建议。
        // 否则返回后只剩空的歌曲列表，会显示「未找到相关结果」。
        const { searchPage, searchResults, searchLoading } =
          useMusicStore.getState();
        const browsingSuggestions =
          searchPage === 0 && searchResults.length === 0 && !searchLoading;
        if (
          !isSearchingRef.current &&
          (document.activeElement === searchInputRef.current ||
            browsingSuggestions)
        ) {
          setSuggestions(results);
          setShowSuggestions(results.length > 0);
          setActiveSuggestionIndex(-1);
        }
      } catch (e) {
        logger.error("MusicSearchView", "Failed to fetch suggestions", e);
      }
    };
    fetchSuggestions();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearchQuery]);

  useEffect(() => {
    // 键盘动画会让 WebView 补发一次落在页面外的 mousedown，历史面板会跟着被收掉。
    let ignoreOutsideUntil = 0;
    const viewport = window.visualViewport;
    const onViewportChange = () => {
      ignoreOutsideUntil = Date.now() + 400;
      if (document.activeElement !== searchInputRef.current) return;
      const scroller = wrapperRef.current?.closest("[data-page-scroll]");
      if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
    };
    viewport?.addEventListener("resize", onViewportChange);
    viewport?.addEventListener("scroll", onViewportChange);

    const handleClickOutside = (event: MouseEvent) => {
      if (Date.now() < ignoreOutsideUntil) return;
      const target = event.target;
      if (target === document.documentElement || target === document.body)
        return;
      if (wrapperRef.current && !wrapperRef.current.contains(target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      viewport?.removeEventListener("resize", onViewportChange);
      viewport?.removeEventListener("scroll", onViewportChange);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleSelectSuggestion = (suggestion: SearchSuggestionItem) => {
    // 点聚合结果里的某一类，进入对应 tab；返回先回到这组建议。
    suggestionContextRef.current = {
      query: searchQuery,
      suggestions: [...suggestions],
    };
    setDrilledFromSuggestions(true);
    setSearchQuery(suggestion.text);
    setShowSuggestions(false);
    performSearch(suggestion.text, suggestion.type);
  };

  /** 点历史词：直接用它搜索 */
  const handleSelectHistory = (keyword: string) => {
    setShowHistory(false);
    setSearchQuery(keyword);
    performSearch(keyword);
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    suggestionContextRef.current = null;
    setDrilledFromSuggestions(false);
    setSearchQuery(value);
    isSearchingRef.current = false;
    setActiveSuggestionIndex(-1);
    // 输入框空了就回到搜索历史，有内容则交给搜索建议
    setShowHistory(!value.trim() && hasHistory);
  };

  const openHistory = () => {
    if (!searchQuery.trim() && hasHistory) setShowHistory(true);
  };

  const closeHistory = () => {
    setShowHistory(false);
    // 返回发现页后若仍保持聚焦，再点搜索框不会重新触发 focus，历史页就进不去。
    searchInputRef.current?.blur();
  };

  const handleInputFocus = () => {
    isInputFocusedRef.current = true;
    if (!searchQuery.trim()) {
      openHistory();
      return;
    }
    if (suggestions.length > 0) setShowSuggestions(true);
  };

  const handleInputBlur = () => {
    isInputFocusedRef.current = false;
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const hasSuggest = suggestions.length > 0;

    // 收起搜索历史
    if (e.key === "Escape") {
      setShowHistory(false);
      return;
    }

    // 上下方向键逻辑
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      if (!hasSuggest) return;

      setShowSuggestions(true);
      setActiveSuggestionIndex((prev) => {
        const len = suggestions.length;
        return e.key === "ArrowDown"
          ? (prev + 1) % len
          : (prev - 1 + len) % len;
      });
      return;
    }

    // 回车确认
    if (e.key === "Enter") {
      e.preventDefault();
      const activeItem = suggestions[activeSuggestionIndex];
      if (showSuggestions && activeItem) {
        handleSelectSuggestion(activeItem);
      } else {
        setShowSuggestions(false);
        performSearch();
      }
    }
  };

  /**
   * 清空搜索、回到首页歌单广场。
   * focus=true 用于点输入框的 X（继续输入）；系统返回键触发时不聚焦，避免弹键盘。
   */
  const resetSearch = useCallback(
    (focus = false) => {
      // 让在途请求的结果失效：abort 后 finally 里的版本判断不会再关 loading，
      // 所以这里必须自己把 loading 关掉，否则列表底部会一直显示加载中。
      versionRef.current++;
      abortRef.current?.abort();
      abortRef.current = null;
      seenRef.current.clear();

      isSearchingRef.current = true;
      suggestionContextRef.current = null;
      categoryVersionRef.current++;
      setDrilledFromSuggestions(false);
      setSearchQuery("");
      setSearchResults([]);
      setSearchCategories(null);
      setSearchCategoryPaging(EMPTY_SEARCH_CATEGORY_PAGING);
      setSearchCategoryLoading(false);
      setSearchTab("song");
      setSearchHasMore(false);
      setSearchPage(0);
      setSearchIntent(null);
      setSearchLoading(false);
      setSuggestions([]);
      setShowSuggestions(false);
      setShowHistory(focus && hasHistory);
      if (focus) searchInputRef.current?.focus();
      else searchInputRef.current?.blur();
      isSearchingRef.current = false;
    },
    [
      setSearchQuery,
      setSearchResults,
      setSearchCategories,
      setSearchCategoryPaging,
      setSearchCategoryLoading,
      setSearchTab,
      setSearchHasMore,
      setSearchPage,
      setSearchIntent,
      setSearchLoading,
      hasHistory,
    ]
  );

  const restoreSuggestions = useCallback(() => {
    const ctx = suggestionContextRef.current;
    suggestionContextRef.current = null;
    setDrilledFromSuggestions(false);
    if (!ctx?.query.trim()) {
      resetSearch();
      return;
    }
    versionRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    seenRef.current.clear();
    categoryVersionRef.current++;
    isSearchingRef.current = false;
    setSearchResults([]);
    setSearchCategories(null);
    setSearchCategoryPaging(EMPTY_SEARCH_CATEGORY_PAGING);
    setSearchCategoryLoading(false);
    setSearchTab("song");
    setSearchHasMore(false);
    setSearchPage(0);
    setSearchIntent(null);
    setSearchLoading(false);
    setSearchQuery(ctx.query);
    setSuggestions(ctx.suggestions);
    setShowSuggestions(ctx.suggestions.length > 0);
    setShowHistory(false);
    searchInputRef.current?.blur();
  }, [
    resetSearch,
    setSearchQuery,
    setSearchResults,
    setSearchCategories,
    setSearchCategoryPaging,
    setSearchCategoryLoading,
    setSearchTab,
    setSearchHasMore,
    setSearchPage,
    setSearchIntent,
    setSearchLoading,
  ]);

  // 有搜索内容时挂一层退出栈：侧边返回 / 返回键先清空搜索回到首页，
  // 清空后栈为空，再按返回才走 RootLayout 的默认行为（最小化 App）。
  // 从聚合建议点进歌曲后再返回，先回到那组建议，再返回才清空。
  // 搜索历史是单独一页，返回先离开历史页，再回到发现。
  const hasSearchContent = Boolean(searchQuery.trim());
  const { push: pushExitLayer, pop: popExitLayer } = useExitLayer();
  useEffect(() => {
    if (!hasSearchContent) return;
    const baseId = pushExitLayer({ close: () => resetSearch() });
    const drillId = drilledFromSuggestions
      ? pushExitLayer({ close: () => restoreSuggestions() })
      : null;
    return () => {
      if (drillId) popExitLayer(drillId);
      popExitLayer(baseId);
    };
  }, [
    hasSearchContent,
    drilledFromSuggestions,
    pushExitLayer,
    popExitLayer,
    resetSearch,
    restoreSuggestions,
  ]);

  useEffect(() => {
    if (!showHistory || searchQuery.trim()) return;
    const id = pushExitLayer({ close: closeHistory });
    return () => popExitLayer(id);
  }, [showHistory, searchQuery, pushExitLayer, popExitLayer]);

  /* ---------------- 请求核心 ---------------- */
  useEffect(() => {
    if (searchResults.length === 0 && searchIntent && searchQuery.trim()) {
      fetchPage(1, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchIntent, searchResults.length]);

  /** 用户确认搜索后统一调用（回车／点击搜索建议／点历史词），锁定建议弹窗并执行搜索 */
  const performSearch = (queryText?: string, tab: SearchResultTab = "song") => {
    isSearchingRef.current = true;
    setShowSuggestions(false);
    setShowHistory(false);
    setSearchTab(tab);
    const q = queryText ?? searchQuery;
    if (q.trim()) addHistory(q);
    if (searchIntent?.type !== "album") setSearchIntent(null);
    fetchPage(1, true, q);
  };

  const fetchPage = async (
    nextPage: number,
    reset = false,
    queryOverride?: string
  ) => {
    const query = queryOverride ?? searchQuery;
    if (!query.trim() || searchLoading) return;

    const version = ++versionRef.current;

    const categorize = reset && !searchIntent;

    if (reset) {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      seenRef.current.clear();
      categoryVersionRef.current++;
      setSearchResults([]);
      setSearchCategories(null);
      setSearchCategoryPaging(EMPTY_SEARCH_CATEGORY_PAGING);
      setSearchCategoryLoading(false);
      setSearchPage(0);
    }

    setSearchLoading(true);

    try {
      const signal = abortRef.current?.signal;
      const categoriesPromise = categorize
        ? musicApi.searchCategories(query)
        : Promise.resolve(null);
      const res =
        source === "all"
          ? await musicApi.searchAll(query, nextPage, 20, signal, searchIntent)
          : await musicApi.search(
              query,
              source,
              nextPage,
              20,
              signal,
              searchIntent
            );
      const categories = await categoriesPromise;

      if (version !== versionRef.current) return;
      if (reset) {
        setSearchCategories(
          categories
            ? {
                artists: categories.artists,
                albums: categories.albums,
                playlists: categories.playlists,
              }
            : null
        );
        setSearchCategoryPaging(
          categories
            ? {
                artist: {
                  offset: SEARCH_CATEGORY_PAGE_SIZE,
                  hasMore: categories.hasMore?.artist ?? false,
                },
                album: {
                  offset: SEARCH_CATEGORY_PAGE_SIZE,
                  hasMore: categories.hasMore?.album ?? false,
                },
                playlist: {
                  offset: SEARCH_CATEGORY_PAGE_SIZE,
                  hasMore: categories.hasMore?.playlist ?? false,
                },
              }
            : EMPTY_SEARCH_CATEGORY_PAGING
        );
      }

      let items =
        source === "all" ? res.items : mergeAndSortTracks(res.items, query);
      items = applySearchIntentSort(items, searchIntent, query);

      const currentLength = reset ? 0 : searchResults.length;
      const filtered = items.filter((t) => {
        const key = getExactKey(t);
        if (seenRef.current.has(key)) return false;
        seenRef.current.add(key);
        return true;
      });

      setSearchResults(reset ? filtered : [...searchResults, ...filtered]);
      setSearchHasMore(
        res.hasMore && currentLength + filtered.length > currentLength
      );
      setSearchPage(nextPage);

      if (
        reset &&
        filtered.length === 0 &&
        !hasSearchCategoryHits(categories)
      ) {
        toastUtils.notFound(categorize ? "未找到相关结果" : "未找到相关歌曲");
      }

      if (reset && filtered.some((t) => t.source === "bilibili")) {
        enrichBilibiliSearchResults(
          reset ? filtered : [...searchResults, ...filtered]
        ).then((enriched) => {
          if (version === versionRef.current) {
            setSearchResults(enriched);
          }
        });
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError")
        toast.error("搜索失败，请稍后重试");
    } finally {
      if (reset) isSearchingRef.current = false;
      if (version === versionRef.current) setSearchLoading(false);
    }
  };

  /* ---------------- 切换音源自动搜索 ---------------- */
  const isFirstSourceRef = useRef(true);

  useEffect(() => {
    if (isFirstSourceRef.current) {
      isFirstSourceRef.current = false;
      return;
    }
    if (searchQuery.trim().length >= 2) {
      isSearchingRef.current = true;
      setShowSuggestions(false);
      setSearchIntent(null);
      fetchPage(1, true);
      searchInputRef.current?.focus();
      isSearchingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const loadMoreCategories = () => {
    const snap = useMusicStore.getState();
    const kind = snap.searchTab;
    if (kind === "song" || snap.searchCategoryLoading) return;
    const paging = snap.searchCategoryPaging[kind];
    if (!paging.hasMore) return;
    const query = snap.searchQuery.trim();
    if (!query) return;

    const version = categoryVersionRef.current;
    setSearchCategoryLoading(true);
    void musicApi
      .searchCategoryPage(query, kind, paging.offset)
      .then((page) => {
        if (version !== categoryVersionRef.current) return;
        const key =
          kind === "artist"
            ? "artists"
            : kind === "album"
              ? "albums"
              : "playlists";
        const current =
          useMusicStore.getState().searchCategories ?? EMPTY_SEARCH_CATEGORIES;
        const seen = new Set(current[key].map((item) => item.id));
        const incoming = page[key].filter((item) => !seen.has(item.id));
        setSearchCategories({
          ...current,
          [key]: [...current[key], ...incoming],
        });
        setSearchCategoryPaging({
          ...useMusicStore.getState().searchCategoryPaging,
          [kind]: {
            offset: paging.offset + SEARCH_CATEGORY_PAGE_SIZE,
            hasMore: page.hasMore,
          },
        });
      })
      .catch((e) => {
        logger.warn("MusicSearchView", "分类搜索翻页失败", e);
      })
      .finally(() => {
        if (version === categoryVersionRef.current)
          setSearchCategoryLoading(false);
      });
  };

  const historyOpen = showHistory && !searchQuery.trim();
  // 只输入了关键词、还没回车或点建议时，不要提前铺出空的歌曲页。
  const hasCommittedSearch =
    searchLoading ||
    searchPage > 0 ||
    searchResults.length > 0 ||
    searchCategories !== null;

  /* ---------------- UI ---------------- */
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {historyOpen && (
        <PageHeader
          title="搜索历史"
          onBack={closeHistory}
          action={
            history.length > 0 ? (
              <button
                type="button"
                onClick={clearHistory}
                className="text-xs text-muted-foreground"
              >
                清空
              </button>
            ) : null
          }
        />
      )}
      <div data-tap-top="" className="shrink-0 border-b border-border/40 p-3">
        <div ref={wrapperRef} className="relative w-full">
          {/* 搜索框主体 */}
          <div className="relative flex h-11 items-center rounded-xl bg-muted/40 px-3 transition-colors focus-within:bg-background focus-within:ring-1 focus-within:ring-ring focus-within:shadow-sm hover:bg-muted/60">
            {searchLoading ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            ) : (
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}

            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={handleSearchChange}
              onKeyDown={handleKeyDown}
              onFocus={handleInputFocus}
              onClick={openHistory}
              onBlur={handleInputBlur}
              placeholder="搜索音乐、歌手或专辑..."
              className="h-full flex-1 border-0 bg-transparent! px-3 text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60"
            />

            {/* 清空按钮 */}
            <button
              type="button"
              className={`flex h-6 w-6 items-center justify-center rounded-full transition-all duration-200 ${
                searchQuery
                  ? "opacity-100 scale-100"
                  : "pointer-events-none opacity-0 scale-90"
              } text-muted-foreground hover:bg-muted hover:text-foreground`}
              onClick={() => resetSearch(true)}
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <div className="mx-2 h-4 w-px shrink-0 bg-border/60" />

            {/* 音源选择 */}
            <Select
              value={source}
              onValueChange={(v) => setSource(v as MusicSource)}
            >
              <SelectTrigger
                onPointerDown={() => {
                  searchInputRef.current?.blur();
                  setShowHistory(false);
                }}
                className="-mr-1.5 h-7 w-auto min-w-[108px] shrink-0 border-0 bg-transparent! px-2 text-[13px] text-muted-foreground shadow-none hover:text-foreground focus:ring-0"
              >
                <SelectValue />
              </SelectTrigger>
              {/* 面板与按钮等宽：右边对齐后不会再往左探出，菜单项文字也与按钮文字同一左边缘 */}
              <SelectContent
                align="end"
                className="w-[var(--radix-popover-trigger-width)]"
              >
                {visibleSourceOptions.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="pl-1 whitespace-nowrap text-[13px]"
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 搜索建议弹窗 */}
          {showSuggestions && suggestions.length > 0 && (
            <SearchSuggestions
              suggestions={suggestions}
              onSelect={handleSelectSuggestion}
              activeIndex={activeSuggestionIndex}
              onClose={() => setShowSuggestions(false)}
            />
          )}
        </div>
      </div>

      {/* 列表区域。历史是整页内容，不再盖在发现页上。 */}
      <div className="flex-1 min-h-0">
        {historyOpen ? (
          <SearchHistory
            items={history}
            onSelect={handleSelectHistory}
            onRemove={removeHistory}
          />
        ) : !searchQuery.trim() ? (
          <PlaylistMarket />
        ) : !hasCommittedSearch ? null : !searchIntent ? (
          <SearchCategoryResults
            tab={searchTab}
            onTabChange={setSearchTab}
            categories={searchCategories}
            tracks={searchResults}
            scrollContainerRef={resultsScrollRef}
            onPlay={(track) => onPlay(track, searchResults, "search")}
            onOpenArtist={(id) => navigate(`/netease-artist/${id}`)}
            onOpenAlbum={(id) => navigate(`/netease-album/${id}`)}
            onOpenPlaylist={(id) => navigate(`/netease-playlist/${id}`)}
            currentTrackId={currentTrackId}
            isPlaying={isPlaying}
            loading={searchLoading}
            hasMore={searchHasMore}
            onLoadMore={() => fetchPage(searchPage + 1)}
            categoryHasMore={
              searchTab !== "song" && searchCategoryPaging[searchTab].hasMore
            }
            categoryLoading={searchCategoryLoading}
            onLoadMoreCategories={loadMoreCategories}
          />
        ) : (
          <div
            ref={resultsScrollRef}
            data-page-scroll=""
            className="flex h-full min-h-0 flex-col overflow-y-auto"
          >
            <MusicTrackList
              tracks={searchResults}
              scrollContainerRef={resultsScrollRef}
              onPlay={(track) => onPlay(track, searchResults, "search")}
              currentTrackId={currentTrackId}
              isPlaying={isPlaying}
              loading={searchLoading}
              hasMore={searchHasMore}
              autoLoadMore
              onLoadMore={() => fetchPage(searchPage + 1)}
              emptyMessage={searchLoading ? "搜索中..." : "未找到相关结果"}
              showSourceBadge={true}
            />
          </div>
        )}
      </div>
    </div>
  );
}
