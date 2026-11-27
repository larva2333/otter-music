import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { useMusicStore } from "@/store/music-store";
import { MinePage } from "./MinePage";

vi.mock("@/lib/storage-adapter", () => ({
  idbStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock("@/hooks/use-root-pager", () => ({
  useIsRootTabActive: () => true,
  useRootPager: () => null,
}));

vi.mock("@/hooks/use-root-tab-swipe", () => ({
  MINE_TYPE_IDS: ["mine", "queue", "history", "local"],
  useRootTabSwipe: () => undefined,
}));

vi.mock("@/hooks/use-pager-swipe", () => ({
  usePagerSwipe: vi.fn(),
}));

vi.mock("@/hooks/use-tab-indicator-sync", () => ({
  useTabIndicatorSync: () => ({
    indicatorRef: { current: null },
    mirrorRef: { current: null },
    barWidth: 0,
    hasIndicator: false,
    initialRect: null,
    handleTrackDrag: vi.fn(),
    handleTrackSettle: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-load-more-on-visible", () => ({
  useLoadMoreOnVisible: vi.fn(),
}));

vi.mock("@/hooks/use-tab-reclick", () => ({
  useTabReclick: vi.fn(),
}));

vi.mock("@/hooks/useSearchBackClear", () => ({
  useSearchBackClear: vi.fn(),
}));

vi.mock("./PlaylistCover", () => ({
  PlaylistCover: ({ playlist }: { playlist: { name: string } }) => (
    <div data-testid="playlist-cover">{playlist.name}</div>
  ),
}));

vi.mock("./PlaylistImportDrawer", () => ({
  PlaylistImportDrawer: () => null,
}));

vi.mock("./QueuePage", () => ({
  QueuePage: () => null,
}));

vi.mock("./LocalMusicPage", () => ({
  LocalMusicPage: () => null,
}));

vi.mock("./MusicPlaylistView", () => ({
  MusicPlaylistView: () => null,
}));

describe("MinePage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    useMusicStore.setState({
      playlists: [
        {
          id: "p1",
          name: "周杰伦",
          tracks: [],
          createdAt: 1700000000000,
          update_time: 1700000000000,
          is_deleted: false,
        },
        {
          id: "p2",
          name: "陈奕迅",
          tracks: [],
          createdAt: 1700000000000,
          update_time: 1700000000000,
          is_deleted: false,
        },
      ],
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("places 导入/新建 buttons below title with search input and filters playlists by name", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <MinePage onSelectPlaylist={vi.fn()} />
        </MemoryRouter>
      );
    });

    const heading = container.querySelector('[data-mine-pane="mine"] h2');
    expect(heading?.textContent).toBe("我的歌单");

    const searchInput = container.querySelector(
      '[data-mine-pane="mine"] input[placeholder="搜索..."]'
    ) as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();

    // 验证「导入」「新建」图标按钮在标题行右上角，搜索框横铺在下方
    const titleRow = heading?.parentElement;
    expect(
      titleRow?.querySelector('button[aria-label="导入歌单"]')
    ).not.toBeNull();
    expect(
      titleRow?.querySelector('button[aria-label="新建歌单"]')
    ).not.toBeNull();
    expect(container.textContent).toContain("2 个歌单");

    // 输入搜索词过滤歌单
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    await act(async () => {
      setter?.call(searchInput, "周杰伦");
      searchInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("1 个歌单");
    expect(container.textContent).toContain("周杰伦");
    expect(container.textContent).not.toContain("陈奕迅");

    // 点清除按钮恢复全部歌单
    const clearBtn = container.querySelector(
      'button[aria-label="清除搜索"]'
    ) as HTMLButtonElement | null;
    expect(clearBtn).not.toBeNull();
    await act(async () => {
      clearBtn?.click();
    });

    expect(container.textContent).toContain("2 个歌单");
    expect(container.textContent).toContain("陈奕迅");
  });

  it("renders index in first column, cover + name in second column, and enters selection mode on long press", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => {
        root.render(
          <MemoryRouter>
            <MinePage onSelectPlaylist={vi.fn()} />
          </MemoryRouter>
        );
      });

      const firstRow = container.querySelector(
        '[data-playlist-id="p1"]'
      ) as HTMLElement | null;
      expect(firstRow).not.toBeNull();
      expect(firstRow?.textContent).toContain("1");
      expect(
        firstRow?.querySelector('[data-testid="playlist-cover"]')
      ).not.toBeNull();

      // 第二列表头显示排序按钮
      const sortBtn = container.querySelector(
        'button[aria-label="切换歌单排序"]'
      ) as HTMLButtonElement | null;
      expect(sortBtn?.textContent).toContain("默认排序");

      // 长按触发多选
      const touchArea = firstRow?.firstElementChild as HTMLElement | null;
      await act(async () => {
        touchArea?.dispatchEvent(
          new TouchEvent("touchstart", {
            bubbles: true,
            touches: [{ clientX: 50, clientY: 50 } as Touch],
          })
        );
        vi.advanceTimersByTime(500);
      });

      expect(container.textContent).toContain("已选 1 个");
      // 多选模式下每行后面的操作菜单依然保留
      expect(
        firstRow?.querySelector('button[aria-label="歌单操作"]')
      ).not.toBeNull();
      const exitBtn = container.querySelector(
        'button[aria-label="退出多选"]'
      ) as HTMLButtonElement | null;
      expect(exitBtn).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
