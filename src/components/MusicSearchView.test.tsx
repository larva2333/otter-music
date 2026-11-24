import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";

import { MusicSearchView } from "./MusicSearchView";
import { useMusicStore } from "@/store/music-store";
import { useExitLayerStore } from "@/hooks/useExitLayer";
import type { MusicTrack, SearchSuggestionItem } from "@/types/music";

vi.mock("@/lib/storage-adapter", () => ({
  idbStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock("@/hooks/use-debounce", () => ({
  useDebounce: <T,>(value: T) => value,
}));

vi.mock("react-hot-toast", () => ({
  default: {
    error: vi.fn(),
  },
}));

vi.mock("@/lib/utils/toast", () => ({
  toastUtils: {
    notFound: vi.fn(),
  },
}));

vi.mock("./PlaylistMarket/PlaylistMarket", () => ({
  PlaylistMarket: () => (
    <div data-testid="playlist-market">playlist-market</div>
  ),
}));

vi.mock("./MusicTrackList", () => ({
  MusicTrackList: () => (
    <div data-testid="music-track-list">music-track-list</div>
  ),
}));

vi.mock("./ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <div data-testid="search-source-select" data-value={value}>
      <button type="button" onClick={() => onValueChange(value)}>
        select
      </button>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectValue: () => <span>value</span>,
  SelectContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <div data-testid={`select-item-${value}`}>{children}</div>
  ),
}));

vi.mock("./SearchSuggestions", () => ({
  SearchSuggestions: ({
    suggestions,
    onSelect,
    activeIndex,
    onClose,
  }: {
    suggestions: SearchSuggestionItem[];
    onSelect: (item: SearchSuggestionItem) => void;
    activeIndex: number;
    onClose: () => void;
  }) => (
    <div data-testid="search-suggestions">
      <button type="button" data-testid="close-suggestions" onClick={onClose}>
        close
      </button>
      {suggestions.map((item, index) => (
        <button
          key={`${item.type}-${item.id ?? item.text}`}
          type="button"
          data-testid={`suggestion-${index}`}
          data-active={index === activeIndex}
          onClick={() => onSelect(item)}
        >
          {item.text}
        </button>
      ))}
    </div>
  ),
}));

const musicApiMocks = vi.hoisted(() => ({
  getSearchSuggestions: vi.fn(),
  searchAll: vi.fn(),
  search: vi.fn(),
  searchCategories: vi.fn(),
  searchCategoryPage: vi.fn(),
}));

vi.mock("@/lib/music-api", () => ({
  musicApi: musicApiMocks,
}));

const track: MusicTrack = {
  id: "track-1",
  name: "Song",
  artist: ["Artist"],
  album: "Album",
  pic_id: "pic-1",
  url_id: "url-1",
  lyric_id: "lyric-1",
  source: "netease",
};

const suggestions: SearchSuggestionItem[] = [
  { text: "Alpha", type: "song", source: "_netease", id: "1" },
  { text: "Beta", type: "artist", source: "_netease", id: "2" },
  { text: "Gamma", type: "album", source: "_netease", id: "3" },
];

/** 测试用路由探针：模拟从搜索结果点进专辑详情、再侧滑返回 */
function RouteProbe() {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        data-testid="go-album"
        onClick={() => navigate("/netease-album/1")}
      >
        go album
      </button>
      <button
        type="button"
        data-testid="back-search"
        onClick={() => navigate("/search")}
      >
        back search
      </button>
    </>
  );
}

describe("MusicSearchView", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();

    useMusicStore.setState({
      searchSource: "kuwo",
      searchQuery: "",
      searchIntent: null,
      searchResults: [],
      searchLoading: false,
      searchHasMore: false,
      searchPage: 0,
    });
    useExitLayerStore.setState({ stack: [] });
    localStorage.removeItem("otter_search_history");

    musicApiMocks.getSearchSuggestions.mockResolvedValue(suggestions);
    musicApiMocks.searchAll.mockResolvedValue({
      items: [track],
      hasMore: false,
    });
    musicApiMocks.search.mockResolvedValue({
      items: [track],
      hasMore: false,
    });
    musicApiMocks.searchCategories.mockResolvedValue({
      artists: [],
      albums: [],
      playlists: [],
      hasMore: { artist: false, album: false, playlist: false },
    });
    musicApiMocks.searchCategoryPage.mockResolvedValue({
      artists: [],
      albums: [],
      playlists: [],
      hasMore: false,
    });
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    root = undefined;
    container = undefined;
  });

  const renderView = () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <MemoryRouter initialEntries={["/search"]}>
          <MusicSearchView onPlay={vi.fn()} />
          <RouteProbe />
        </MemoryRouter>
      );
    });
  };

  const flushEffects = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const getInput = () => {
    const input = container?.querySelector(
      'input[placeholder="搜索音乐、歌手或专辑..."]'
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    return input!;
  };

  const getSuggestion = (index: number) => {
    const suggestion = container?.querySelector(
      `[data-testid="suggestion-${index}"]`
    ) as HTMLButtonElement | null;
    expect(suggestion).not.toBeNull();
    return suggestion!;
  };

  const setInputValue = async (value: string) => {
    const input = getInput();
    await act(async () => {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushEffects();
    expect(musicApiMocks.getSearchSuggestions).toHaveBeenLastCalledWith(value);
    return input;
  };

  const keyDown = async (key: string) => {
    const input = getInput();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    await flushEffects();
  };

  const click = async (element: Element) => {
    await act(async () => {
      (element as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    await flushEffects();
  };

  it("opens suggestions and updates the active item with arrow keys", async () => {
    renderView();
    const input = await setInputValue("a");

    const closeButton = container?.querySelector(
      '[data-testid="close-suggestions"]'
    ) as HTMLButtonElement | null;
    expect(closeButton).not.toBeNull();
    await click(closeButton!);
    expect(
      container?.querySelector('[data-testid="search-suggestions"]')
    ).toBeNull();

    await act(async () => {
      input.focus();
    });
    await keyDown("ArrowDown");
    expect(
      container?.querySelector('[data-testid="search-suggestions"]')
    ).not.toBeNull();
    expect(getSuggestion(0).getAttribute("data-active")).toBe("true");

    await keyDown("ArrowDown");
    expect(getSuggestion(1).getAttribute("data-active")).toBe("true");

    await keyDown("ArrowUp");
    expect(getSuggestion(0).getAttribute("data-active")).toBe("true");
  });

  it("selects the active suggestion on Enter", async () => {
    renderView();
    const input = await setInputValue("a");

    await keyDown("ArrowDown");
    await keyDown("ArrowDown");
    await keyDown("Enter");

    expect(musicApiMocks.search).toHaveBeenLastCalledWith(
      "Beta",
      "kuwo",
      1,
      20,
      expect.any(AbortSignal),
      null
    );
    expect(input.value).toBe("Beta");
  });

  it("submits a direct search on Enter when no suggestion is active", async () => {
    renderView();
    const input = await setInputValue("keyword");

    await keyDown("Enter");

    expect(musicApiMocks.search).toHaveBeenLastCalledWith(
      "keyword",
      "kuwo",
      1,
      20,
      expect.any(AbortSignal),
      null
    );
    expect(
      container?.querySelector('[data-testid="search-suggestions"]')
    ).toBeNull();
    expect(input.value).toBe("keyword");
  });

  it("clears the query, hides suggestions, and refocuses the input", async () => {
    renderView();
    const input = await setInputValue("clear me");

    const clearButton = Array.from(
      container?.querySelectorAll("button") ?? []
    ).find((button) => button.className.includes("rounded-full")) as
      | HTMLButtonElement
      | undefined;

    expect(clearButton).toBeDefined();
    await click(clearButton!);

    expect(input.value).toBe("");
    expect(
      container?.querySelector('[data-testid="search-suggestions"]')
    ).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("系统返回时先清空搜索回到首页，且不重新聚焦输入框", async () => {
    renderView();
    const input = await setInputValue("keyword");

    // 输入了内容就有一层退出栈
    expect(useExitLayerStore.getState().stack).toHaveLength(1);

    await act(async () => {
      input.blur();
    });
    expect(document.activeElement).not.toBe(input);

    await act(async () => {
      useExitLayerStore.getState().handleExit();
    });
    await flushEffects();

    expect(useMusicStore.getState().searchQuery).toBe("");
    expect(useMusicStore.getState().searchResults).toEqual([]);
    expect(useMusicStore.getState().searchPage).toBe(0);
    expect(input.value).toBe("");
    expect(document.activeElement).not.toBe(input);
    expect(useExitLayerStore.getState().stack).toHaveLength(0);
  });

  it("从搜索结果进专辑详情时撤掉清空搜索的退出层，返回后结果还在", async () => {
    renderView();
    const input = await setInputValue("keyword");
    await keyDown("Enter");
    await flushEffects();

    expect(useMusicStore.getState().searchQuery).toBe("keyword");
    expect(useMusicStore.getState().searchResults).toHaveLength(1);
    expect(useExitLayerStore.getState().stack).toHaveLength(1);

    // 进入二级页：清空搜索的层必须撤掉，否则侧滑返回会先清空结果
    await click(
      container!.querySelector('[data-testid="go-album"]') as Element
    );
    expect(useExitLayerStore.getState().stack).toHaveLength(0);
    expect(useMusicStore.getState().searchQuery).toBe("keyword");
    expect(useMusicStore.getState().searchResults).toHaveLength(1);

    // 返回发现页后搜索态恢复，下一次返回仍按原规则清空搜索
    await click(
      container!.querySelector('[data-testid="back-search"]') as Element
    );
    expect(input.value).toBe("keyword");
    expect(useExitLayerStore.getState().stack).toHaveLength(1);
  });

  it("聚焦空搜索框时用整页展示搜索历史，返回后回到发现", async () => {
    localStorage.setItem(
      "otter_search_history",
      JSON.stringify(["周杰伦", "晴天"])
    );
    renderView();
    await flushEffects();

    await act(async () => {
      getInput().focus();
    });
    await flushEffects();

    expect(container?.textContent).toContain("搜索历史");
    expect(container?.textContent).toContain("周杰伦");
    expect(
      container?.querySelector('[data-testid="playlist-market"]')
    ).toBeNull();
    expect(useExitLayerStore.getState().stack).toHaveLength(1);

    const back = container
      ?.querySelector("h1")
      ?.closest("[data-tap-top]")
      ?.querySelector("button");
    expect(back).toBeTruthy();
    await click(back!);

    expect(container?.textContent).not.toContain("周杰伦");
    expect(
      container?.querySelector('[data-testid="playlist-market"]')
    ).not.toBeNull();
    expect(useExitLayerStore.getState().stack).toHaveLength(0);
  });

  it("从搜索结果返回后搜索框失焦，再次聚焦能进入历史", async () => {
    localStorage.setItem("otter_search_history", JSON.stringify(["周杰伦"]));
    renderView();
    const input = await setInputValue("keyword");
    expect(document.activeElement).toBe(input);

    await act(async () => {
      useExitLayerStore.getState().handleExit();
    });
    await flushEffects();

    expect(useMusicStore.getState().searchQuery).toBe("");
    expect(document.activeElement).not.toBe(input);
    expect(container?.textContent).not.toContain("搜索历史");

    await act(async () => {
      input.focus();
    });
    await flushEffects();

    expect(container?.textContent).toContain("搜索历史");
    expect(container?.textContent).toContain("周杰伦");
  });

  it("返回发现页后点击空搜索框进入历史", async () => {
    localStorage.setItem("otter_search_history", JSON.stringify(["周杰伦"]));
    renderView();
    await flushEffects();
    const input = getInput();

    await act(async () => {
      input.focus();
    });
    await flushEffects();
    await act(async () => {
      useExitLayerStore.getState().handleExit();
    });
    await flushEffects();
    expect(
      container?.querySelector('[data-testid="playlist-market"]')
    ).not.toBeNull();
    expect(document.activeElement).not.toBe(input);

    // 只派发 click，不派发 focus：焦点还在输入框上时再点一次就是这条路径
    await click(input);
    expect(container?.textContent).toContain("搜索历史");
    expect(container?.textContent).toContain("周杰伦");
  });

  it("从歌单返回后仍展示搜索建议，而不是空的歌曲列表", async () => {
    useMusicStore.setState({
      searchQuery: "周杰伦",
      searchResults: [],
      searchPage: 0,
      searchLoading: false,
    });
    musicApiMocks.getSearchSuggestions.mockResolvedValue([
      { text: "周杰伦", type: "artist", source: "_netease", id: "a" },
      {
        text: "周杰伦的床边故事",
        type: "playlist",
        source: "_netease",
        id: "p",
      },
      { text: "晴天 - 周杰伦", type: "song", source: "_netease", id: "s" },
    ]);

    renderView();
    await flushEffects();

    expect(
      container?.querySelector('[data-testid="search-suggestions"]')
    ).not.toBeNull();
    expect(container?.textContent).toContain("周杰伦的床边故事");
    expect(container?.textContent).toContain("晴天 - 周杰伦");
    expect(
      container?.querySelector('[data-testid="music-track-list"]')
    ).toBeNull();
  });

  it("已提交的聚合搜索返回后仍展示歌曲结果", async () => {
    useMusicStore.setState({
      searchQuery: "周杰伦",
      searchResults: [track],
      searchPage: 1,
      searchLoading: false,
    });

    renderView();
    await flushEffects();

    expect(
      container?.querySelector('[data-testid="music-track-list"]')
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="search-suggestions"]')
    ).toBeNull();
  });

  it("从聚合结果点进歌曲后返回，先回到聚合建议", async () => {
    renderView();
    const input = await setInputValue("周杰伦");
    expect(useExitLayerStore.getState().stack).toHaveLength(1);

    await click(getSuggestion(0));
    await flushEffects();

    expect(input.value).toBe("Alpha");
    expect(
      container?.querySelector('[data-testid="music-track-list"]')
    ).not.toBeNull();
    expect(useExitLayerStore.getState().stack).toHaveLength(2);

    await act(async () => {
      useExitLayerStore.getState().handleExit();
    });
    await flushEffects();

    expect(input.value).toBe("周杰伦");
    expect(container?.textContent).toContain("Alpha");
    expect(container?.textContent).toContain("Beta");
    expect(
      container?.querySelector('[data-testid="search-suggestions"]')
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="music-track-list"]')
    ).toBeNull();
    expect(useExitLayerStore.getState().stack).toHaveLength(1);

    await act(async () => {
      useExitLayerStore.getState().handleExit();
    });
    await flushEffects();

    expect(useMusicStore.getState().searchQuery).toBe("");
    expect(
      container?.querySelector('[data-testid="playlist-market"]')
    ).not.toBeNull();
    expect(useExitLayerStore.getState().stack).toHaveLength(0);
  });

  it("提交聚合搜索后按歌手、专辑、歌单和歌曲分类展示", async () => {
    musicApiMocks.searchCategories.mockResolvedValue({
      artists: [{ id: "6452", name: "周杰伦" }],
      albums: [{ id: "18915", name: "叶惠美", artistName: "周杰伦" }],
      playlists: [{ id: "123", name: "周杰伦热门" }],
    });
    renderView();
    await setInputValue("周杰伦");
    await keyDown("Enter");
    await flushEffects();

    expect(musicApiMocks.searchCategories).toHaveBeenCalledWith("周杰伦");
    const songTab = container?.querySelector(
      '[role="tab"][aria-selected="true"]'
    );
    expect(songTab?.textContent).toBe("歌曲");
    expect(
      container?.querySelector('[data-testid="music-track-list"]')
    ).not.toBeNull();

    const tab = (label: string) =>
      Array.from(container?.querySelectorAll('[role="tab"]') ?? []).find(
        (el) => el.textContent === label
      ) as HTMLButtonElement;

    await click(tab("专辑"));
    expect(tab("专辑").getAttribute("aria-selected")).toBe("true");
    expect(container?.textContent).toContain("叶惠美");
    expect(
      container?.querySelector('[data-testid="music-track-list"]')
    ).toBeNull();

    await click(tab("歌单"));
    expect(container?.textContent).toContain("周杰伦热门");

    await click(tab("歌手"));
    expect(container?.textContent).toContain("周杰伦");
  });

  it("点聚合结果里的歌手进入歌手页", async () => {
    musicApiMocks.searchCategories.mockResolvedValue({
      artists: [{ id: "6452", name: "周杰伦" }],
      albums: [],
      playlists: [],
    });
    renderView();
    await setInputValue("周杰伦");
    await click(getSuggestion(1));
    await flushEffects();

    const selected = container?.querySelector(
      '[role="tab"][aria-selected="true"]'
    );
    expect(selected?.textContent).toBe("歌手");
    expect(container?.textContent).toContain("周杰伦");
    expect(
      container?.querySelector('[data-testid="music-track-list"]')
    ).toBeNull();
  });

  it("歌手页滑到底继续加载下一页", async () => {
    musicApiMocks.searchCategories.mockResolvedValue({
      artists: [{ id: "1", name: "周杰伦" }],
      albums: [],
      playlists: [],
      hasMore: { artist: true, album: false, playlist: false },
    });
    musicApiMocks.searchCategoryPage.mockResolvedValue({
      artists: [{ id: "2", name: "周杰伦." }],
      albums: [],
      playlists: [],
      hasMore: false,
    });
    renderView();
    await setInputValue("周杰伦");
    await keyDown("Enter");
    await flushEffects();

    const artistTab = Array.from(
      container?.querySelectorAll('[role="tab"]') ?? []
    ).find((el) => el.textContent === "歌手") as HTMLButtonElement;
    await click(artistTab);
    await flushEffects();
    container
      ?.querySelector("[data-page-scroll]")
      ?.dispatchEvent(new Event("scroll"));
    await flushEffects();

    expect(musicApiMocks.searchCategoryPage).toHaveBeenCalledWith(
      "周杰伦",
      "artist",
      20
    );
    expect(container?.textContent).toContain("周杰伦.");
  });
});
