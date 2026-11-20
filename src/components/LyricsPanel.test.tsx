import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LyricsPanel } from "./LyricsPanel";
import { handleLyricsBlankTap } from "@/lib/lyrics-tap";
import { musicApi } from "@/lib/music-api";
import type { MusicTrack } from "@/types/music";
import { scrollPageToTop } from "@/lib/scroll-to-top";

vi.mock("@/lib/music-api", () => ({
  musicApi: {
    getLyric: vi.fn(),
  },
}));

const { mockSeek, mockSetLyricAlign, mockSetLyricFontSize } = vi.hoisted(
  () => ({
    mockSeek: vi.fn(),
    mockSetLyricAlign: vi.fn(),
    mockSetLyricFontSize: vi.fn(),
  })
);

vi.mock("@/store/music-store", () => ({
  useMusicStore: vi.fn(() => ({
    currentAudioTime: 0,
    seek: mockSeek,
    seekTimestamp: 0,
    lyricAlign: "center",
    lyricFontSize: 18,
    lyricOffset: -0.5,
    setLyricAlign: mockSetLyricAlign,
    setLyricFontSize: mockSetLyricFontSize,
  })),
}));

const bilibiliTrack: MusicTrack = {
  id: "bilibili_BV1xx411c7mD",
  name: "Test Bilibili Video",
  artist: [""],
  album: "",
  pic_id: "https://example.com/pic.jpg",
  url_id: "bilibili_BV1xx411c7mD",
  lyric_id: "bilibili_BV1xx411c7mD",
  source: "bilibili",
};

const bilibiliTrackNoLyric: MusicTrack = {
  ...bilibiliTrack,
  lyric_id: "",
};

const neteaseTrack: MusicTrack = {
  id: "netease_123456",
  name: "Test Song",
  artist: ["Artist"],
  album: "Album",
  pic_id: "pic-1",
  url_id: "url-1",
  lyric_id: "lyric-1",
  source: "netease",
};

describe("LyricsPanel", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom 未实现 Element.scrollTo，歌词自动滚动依赖该 API
    Element.prototype.scrollTo = () => {};
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  const renderPanel = (track: MusicTrack | null) => {
    act(() => {
      root!.render(<LyricsPanel track={track} />);
    });
  };

  const cleanup = () => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    root = undefined;
    container = undefined;
  };

  it("当 track 为 null 时显示提示", () => {
    renderPanel(null);
    expect(container?.textContent).toContain("选择歌曲查看歌词");
    cleanup();
  });

  it("B 站音源 lyric_id 为空时显示暂无歌词", async () => {
    renderPanel(bilibiliTrackNoLyric);

    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container?.textContent).toContain("暂无歌词");
    cleanup();
  });

  it("B 站音源 lyric_id 非空时渲染歌词", async () => {
    vi.mocked(musicApi.getLyric).mockResolvedValue({
      lyric: "[00:00.00]第一句歌词",
      tlyric: "",
    });

    renderPanel(bilibiliTrack);

    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(musicApi.getLyric).toHaveBeenCalledWith(
      "bilibili_BV1xx411c7mD",
      "bilibili",
      expect.objectContaining({ name: "Test Bilibili Video" })
    );
    expect(container?.textContent).toContain("第一句歌词");
    expect(container?.textContent).not.toContain("加载歌词中...");
    cleanup();
  });

  it("B 站音源歌词加载失败时提示暂无歌词", async () => {
    vi.mocked(musicApi.getLyric).mockResolvedValue(null);

    renderPanel(bilibiliTrack);

    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container?.textContent).toContain("暂无歌词");
    cleanup();
  });

  it("正常音源加载歌词时显示加载中", () => {
    renderPanel(neteaseTrack);
    expect(container?.textContent).toContain("加载歌词中...");
    cleanup();
  });

  it("滚动后基准线所在歌词行显示背景高亮", async () => {
    vi.mocked(musicApi.getLyric).mockResolvedValue({
      lyric: "[00:00.00]第一句歌词\n[00:10.00]第二句歌词",
      tlyric: "",
    });

    renderPanel(neteaseTrack);

    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const viewport = container!.querySelector(
      '[data-slot="scroll-area-viewport"]'
    )!;

    await act(async () => {
      viewport.dispatchEvent(new Event("scroll"));
      // 基准线在滚动停稳（静默 200ms）后才吸附，这里等过这个去抖窗口
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    const baselineLine = container!.querySelector('[class*="bg-white/10"]');
    expect(baselineLine).not.toBeNull();
    expect(baselineLine!.textContent).toContain("第一句歌词");
    cleanup();
  });

  it("滚动后点击基准线浮层可跳转到该句", async () => {
    vi.mocked(musicApi.getLyric).mockResolvedValue({
      lyric: "[00:00.00]第一句歌词\n[00:10.00]第二句歌词",
      tlyric: "",
    });

    renderPanel(neteaseTrack);

    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const viewport = container!.querySelector(
      '[data-slot="scroll-area-viewport"]'
    )!;

    await act(async () => {
      viewport.dispatchEvent(new Event("scroll"));
      // 基准线在滚动停稳（静默 200ms）后才吸附，这里等过这个去抖窗口
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    const baseline = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="从此句开始播放"]'
    );
    expect(baseline).not.toBeNull();

    await act(async () => {
      baseline!.click();
    });

    expect(mockSeek).toHaveBeenCalledWith(0);
    cleanup();
  });

  it("点击基准线不会冒泡触发外层容器点击", async () => {
    vi.mocked(musicApi.getLyric).mockResolvedValue({
      lyric: "[00:00.00]第一句歌词\n[00:10.00]第二句歌词",
      tlyric: "",
    });

    const onOuterClick = vi.fn();

    act(() => {
      root!.render(
        <div onClick={onOuterClick}>
          <LyricsPanel track={neteaseTrack} />
        </div>
      );
    });

    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const viewport = container!.querySelector(
      '[data-slot="scroll-area-viewport"]'
    )!;

    await act(async () => {
      viewport.dispatchEvent(new Event("scroll"));
      // 基准线在滚动停稳（静默 200ms）后才吸附，这里等过这个去抖窗口
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    const baseline = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="从此句开始播放"]'
    )!;

    await act(async () => {
      baseline.click();
    });

    expect(mockSeek).toHaveBeenCalledWith(0);
    expect(onOuterClick).not.toHaveBeenCalled();
    cleanup();
  });

  it("长按歌词弹出样式面板，可切换对齐与字号", async () => {
    vi.mocked(musicApi.getLyric).mockResolvedValue({
      lyric: "[00:00.00]第一句歌词\n[00:10.00]第二句歌词",
      tlyric: "",
    });

    renderPanel(neteaseTrack);

    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const line = container!.querySelector(
      'p[class*="tracking-wide"]'
    ) as HTMLElement;

    expect(line.textContent).toContain("第一句歌词");

    await act(async () => {
      line.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          clientX: 10,
          clientY: 10,
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 560));
    });

    // 样式面板 portal 到 body、全屏遮罩（和播放风格弹窗一致）：
    // 遮罩不在歌词容器内，点它关面板时不会冒泡到手势层切回封面
    const panel = Array.from(document.body.querySelectorAll("div")).find(
      (el) =>
        el.className.includes("fixed inset-0 z-500") &&
        el.textContent?.includes("歌词样式")
    ) as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.querySelector(".bg-black\\/60")).toBeTruthy();
    expect(panel.querySelector(".mb-6")).toBeTruthy();

    const alignLeft = Array.from(panel.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("居左")
    )!;

    act(() => {
      alignLeft.click();
    });

    expect(mockSetLyricAlign).toHaveBeenCalledWith("left");

    const bigger = panel.querySelector<HTMLButtonElement>(
      'button[aria-label="增大字号"]'
    )!;

    act(() => {
      bigger.click();
    });

    expect(mockSetLyricFontSize).toHaveBeenCalledWith(19);

    cleanup();
  });

  it("点状态栏回顶会把歌词列表滚回顶部", async () => {
    vi.mocked(musicApi.getLyric).mockResolvedValue({
      lyric: "[00:00.00]第一句歌词\n[00:10.00]第二句歌词",
      tlyric: "",
    });

    renderPanel(neteaseTrack);

    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const viewport = container!.querySelector(
      '[data-slot="scroll-area-viewport"]'
    ) as HTMLElement;

    // 歌词列表已注册成主滚动容器，系统的「点状态栏回顶」才认得它
    expect(viewport.hasAttribute("data-page-scroll")).toBe(true);

    // jsdom 不做布局，scrollTop 靠手写模拟
    viewport.scrollTop = 800;

    const scrollToSpy = vi.fn();
    Element.prototype.scrollTo = scrollToSpy;

    const moved = scrollPageToTop();

    expect(moved).toBe(true);
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 0 })
    );

    // 已经在顶部时不再重复滚动
    viewport.scrollTop = 0;
    expect(scrollPageToTop()).toBe(false);

    cleanup();
  });

  it("回顶后停手几秒会自动回到正在播放的歌词", async () => {
    vi.mocked(musicApi.getLyric).mockResolvedValue({
      lyric: "[00:00.00]第一句歌词\n[00:10.00]第二句歌词",
      tlyric: "",
    });

    renderPanel(neteaseTrack);

    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const viewport = container!.querySelector(
      '[data-slot="scroll-area-viewport"]'
    ) as HTMLElement;

    const scrollToSpy = vi.fn();
    Element.prototype.scrollTo = scrollToSpy;

    viewport.scrollTop = 800;

    vi.useFakeTimers();

    act(() => {
      scrollPageToTop();
    });

    // 回顶把列表归零，此时暂停跟随（否则下一句一到又被拽回中间）
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 0 })
    );

    const afterTop = scrollToSpy.mock.calls.length;

    // 停手几秒：自动恢复跟随，重新把当前句滚到视口中间
    act(() => {
      vi.advanceTimersByTime(4200);
    });

    expect(scrollToSpy.mock.calls.length).toBeGreaterThan(afterTop);

    vi.useRealTimers();
    cleanup();
  });
});

describe("handleLyricsBlankTap", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /** 造一个「滚动容器 > 歌词面板（空白 / 歌词行 / 按钮）」的最小结构 */
  function setup() {
    const scroller = document.createElement("div");
    scroller.setAttribute("data-page-scroll", "");
    let top = 600;
    Object.defineProperty(scroller, "scrollTop", {
      get: () => top,
      set: (v: number) => {
        top = v;
      },
      configurable: true,
    });
    const scrollTo = vi.fn((opts: ScrollToOptions) => {
      top = opts.top ?? 0;
    });
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;

    const panel = document.createElement("div");
    panel.setAttribute("data-lyrics-panel", "");

    const blank = document.createElement("div");
    const lineRow = document.createElement("div");
    lineRow.className = "lyric-line";
    const lineText = document.createElement("p");
    lineText.className = "lyric-main";
    lineRow.appendChild(lineText);
    const button = document.createElement("button");

    panel.append(blank, lineRow, button);
    scroller.appendChild(panel);
    document.body.appendChild(scroller);

    return { blank, lineText, button, scrollTo, getTop: () => top };
  }

  it("点第一句上方的空白就回顶", () => {
    const { blank, scrollTo, getTop } = setup();

    expect(handleLyricsBlankTap(blank)).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    expect(getTop()).toBe(0);
  });

  it("点歌词行和按钮不消费，交给播放页原来的分流", () => {
    const { lineText, button, scrollTo } = setup();

    expect(handleLyricsBlankTap(lineText)).toBe(false);
    expect(handleLyricsBlankTap(button)).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("不在歌词面板里的空白不消费", () => {
    const { scrollTo } = setup();
    const outside = document.createElement("div");
    document.body.appendChild(outside);

    expect(handleLyricsBlankTap(outside)).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
