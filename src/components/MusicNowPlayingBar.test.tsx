import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import { useMusicStore } from "@/store/music-store";
import type { MusicTrack } from "@/types/music";
import { MusicNowPlayingBar } from "./MusicNowPlayingBar";

const coverColorMocks = vi.hoisted(() => ({
  colors: null as {
    dominant: [number, number, number];
    top: [number, number, number];
    bottom: [number, number, number];
  } | null,
}));

vi.mock("@/hooks/useCoverColors", () => ({
  useCoverColors: () => ({ colors: coverColorMocks.colors }),
}));

const musicApiMocks = vi.hoisted(() => ({
  getLyric: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/music-api", () => ({
  musicApi: {
    getLyric: musicApiMocks.getLyric,
  },
}));

vi.mock("@/hooks/useIsDarkTheme", () => ({
  useIsDarkTheme: () => false,
}));

const sampleTrack: MusicTrack = {
  id: "track-1",
  name: "晴天",
  artist: ["周杰伦"],
  album: "叶惠美",
  pic_id: "",
  url_id: "track-1",
  lyric_id: "track-1",
  source: "netease",
};

describe("MusicNowPlayingBar", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let togglePlaySpy: ReturnType<typeof vi.fn>;
  let seekSpy: ReturnType<typeof vi.fn>;
  let skipToNextSpy: ReturnType<typeof vi.fn>;
  let skipToPreviousSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    togglePlaySpy = vi.fn();
    seekSpy = vi.fn();
    skipToNextSpy = vi.fn();
    skipToPreviousSpy = vi.fn();
    coverColorMocks.colors = null;

    useMusicStore.setState({
      queue: [sampleTrack],
      currentIndex: 0,
      isPlaying: false,
      currentAudioTime: 10,
      duration: 100,
      coverStyle: "vinyl",
      showBarBackground: false,
      currentAudioOrigin: { via: "official", source: "netease" },
      togglePlay: togglePlaySpy as () => void,
      seek: seekSpy as (time: number) => void,
      skipToNext: skipToNextSpy as () => void,
      skipToPrevious: skipToPreviousSpy as () => void,
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    document.body.innerHTML = "";
    root = undefined;
    container = undefined;
    vi.restoreAllMocks();
  });

  function renderBar(onOpenFullScreen = vi.fn()) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <MemoryRouter>
          <MusicNowPlayingBar onOpenFullScreen={onOpenFullScreen} />
        </MemoryRouter>
      );
    });
    return { onOpenFullScreen, container };
  }

  const expectControlsVisible = (visible: boolean) => {
    const info = document.querySelector<HTMLElement>(
      '[data-testid="now-playing-info"]'
    )!;
    const controls = document.querySelector<HTMLElement>(
      '[data-testid="now-playing-controls"]'
    )!;
    const prevBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label="上一首"]'
    )!;
    const playBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label="播放"]'
    )!;
    const nextBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label="下一首"]'
    )!;

    expect(info.getAttribute("aria-hidden")).toBe(String(visible));
    expect(info.className).toContain(visible ? "opacity-0" : "opacity-100");
    expect(controls.getAttribute("aria-hidden")).toBe(String(!visible));
    expect(controls.className).toContain(visible ? "opacity-100" : "opacity-0");
    expect(prevBtn.disabled).toBe(!visible);
    expect(playBtn.disabled).toBe(!visible);
    expect(nextBtn.disabled).toBe(!visible);
  };

  it("默认淡出切歌与播放暂停按钮，展示歌曲信息、音源后时间及整个播放条进度比例", () => {
    renderBar();

    expect(document.body.textContent).toContain("晴天");
    expect(document.body.textContent).toContain("周杰伦");
    expect(
      document.querySelector('[data-testid="now-playing-time"]')?.textContent
    ).toBe("0:10/1:40");
    // 歌名/歌手跑马灯容器占满剩余空间，使音源与时间始终固定在右侧
    const marqueeContainer = document.querySelector<HTMLElement>(
      '[data-testid="marquee-track"]'
    )?.parentElement;
    expect(marqueeContainer?.className).toContain("flex-1");
    expect(marqueeContainer?.className).toContain("min-w-0");
    expect(
      document.querySelector<HTMLElement>(
        '[data-testid="now-playing-progress"]'
      )?.style.transform
    ).toBe("scaleX(0.1)");
    expect(
      document.querySelector('button[aria-label="打开播放页"]')
    ).not.toBeNull();
    expect(
      document.querySelector('button[aria-label="播放列表"]')
    ).not.toBeNull();

    expectControlsVisible(false);
  });

  it("单击左侧唱片进入播放页，且不展开控制按钮", () => {
    const onOpenFullScreen = vi.fn();
    renderBar(onOpenFullScreen);

    const discBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label="打开播放页"]'
    );
    expect(discBtn).not.toBeNull();

    act(() => {
      discBtn!.click();
    });

    expect(onOpenFullScreen).toHaveBeenCalledTimes(1);
    expectControlsVisible(false);
  });

  it("单击播放条后淡出标题与歌手信息并淡入三个播放控制按钮", () => {
    const onOpenFullScreen = vi.fn();
    const { container: rootEl } = renderBar(onOpenFullScreen);

    const infoText = Array.from(rootEl.querySelectorAll("span")).find((el) =>
      el.textContent?.includes("晴天")
    );
    expect(infoText).toBeTruthy();

    act(() => {
      infoText!.click();
    });

    expect(onOpenFullScreen).not.toHaveBeenCalled();
    expectControlsVisible(true);
  });

  it("控制按钮显示期间点击切歌与播放暂停不会收起按钮，点击外部或再次点击空白区会恢复信息展示", () => {
    const onOpenFullScreen = vi.fn();
    const { container: rootEl } = renderBar(onOpenFullScreen);

    const infoText = Array.from(rootEl.querySelectorAll("span")).find((el) =>
      el.textContent?.includes("晴天")
    );
    act(() => {
      infoText!.click();
    });

    const prevBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label="上一首"]'
    )!;
    const playBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label="播放"]'
    )!;
    const nextBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label="下一首"]'
    )!;

    act(() => {
      prevBtn.click();
      playBtn.click();
      nextBtn.click();
    });

    expect(skipToPreviousSpy).toHaveBeenCalledTimes(1);
    expect(togglePlaySpy).toHaveBeenCalledTimes(1);
    expect(skipToNextSpy).toHaveBeenCalledTimes(1);
    expect(onOpenFullScreen).not.toHaveBeenCalled();
    // 连续操作后按钮仍然保持可见
    expectControlsVisible(true);

    // 点击播放条外部自动收起，恢复显示歌名
    act(() => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true })
      );
    });

    expectControlsVisible(false);
  });

  it("展开控制按钮后若 3 秒内无操作则自动恢复原状，有切歌/暂停操作时重置 3 秒计时", () => {
    vi.useFakeTimers();
    try {
      const { container: rootEl } = renderBar();

      const infoText = Array.from(rootEl.querySelectorAll("span")).find((el) =>
        el.textContent?.includes("晴天")
      );
      act(() => {
        infoText!.click();
      });
      expectControlsVisible(true);

      // 2 秒后点击下一首：重置 3 秒无操作倒计时
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      const nextBtn = document.querySelector<HTMLButtonElement>(
        'button[aria-label="下一首"]'
      )!;
      act(() => {
        nextBtn.click();
      });

      // 再过 2 秒（距初始展开已 4 秒，但距上次操作仅 2 秒）：按钮应仍保留
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expectControlsVisible(true);

      // 再过 1 秒（距上次操作满 3 秒）：自动恢复显示标题与信息
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expectControlsVisible(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("底部进度条压在底边正中、平常隐藏头部圆球，配色随底色高反差自适应", () => {
    // 1. 未开背景（浅色主题白底）使用深墨高反差前景色
    const { container: lightEl } = renderBar();
    const defaultFill = lightEl.querySelector<HTMLElement>(
      '[data-testid="now-playing-progress"]'
    )!;
    expect(defaultFill.style.backgroundColor).toBe("rgb(23, 34, 43)");

    act(() => root?.unmount());
    lightEl.remove();

    // 2. 浅色封面背景（lightTint=true）应呈现出鲜明而不发黑的封面色调（例：蓝色封面呈蓝调而非黑色）
    coverColorMocks.colors = {
      dominant: [40, 120, 210],
      top: [205, 222, 238],
      bottom: [190, 208, 226],
    };
    useMusicStore.setState({ showBarBackground: true });

    const { container: lightTintedEl } = renderBar();
    const lightTintFill = lightTintedEl.querySelector<HTMLElement>(
      '[data-testid="now-playing-progress"]'
    )!;
    const lightRgb = lightTintFill.style.backgroundColor
      .match(/\d+/g)
      ?.map(Number);
    expect(lightRgb).toBeTruthy();
    expect(lightRgb![2]).toBeGreaterThan(150);
    expect(lightRgb![2]).toBeGreaterThan(lightRgb![0] + 80);

    act(() => root?.unmount());
    lightTintedEl.remove();

    // 3. 开启暗色封面背景时提取封面色相并抬高明度，保持高反差且不突兀
    coverColorMocks.colors = {
      dominant: [180, 40, 60],
      top: [80, 22, 32],
      bottom: [45, 12, 18],
    };
    useMusicStore.setState({ showBarBackground: true });

    renderBar();

    const barEl = document.querySelector<HTMLElement>(
      "[data-now-playing-bar]"
    )!;
    expect(barEl.style.backgroundOrigin).toBe("border-box");

    const fillEl = document.querySelector<HTMLElement>(
      '[data-testid="now-playing-progress"]'
    )!;
    const slider = document.querySelector<HTMLElement>(
      '[data-testid="now-playing-progress-slider"]'
    )!;
    const thumb = document.querySelector<HTMLElement>(
      '[data-testid="now-playing-progress-thumb"]'
    )!;

    expect(slider.className).toContain("-bottom-[0.5px]");
    expect(slider.className).toContain("translate-y-1/2");
    expect(slider.className).toContain("pointer-events-none");
    expect(thumb.className).toContain("opacity-100");
    expect(thumb.className).toContain("pointer-events-none");
    // 红调封面派生出的高亮珊瑚色（而非固定亮金色）
    expect(fillEl.style.backgroundColor).not.toBe("rgb(251, 191, 36)");
    const rgbMatch = fillEl.style.backgroundColor.match(/\d+/g)?.map(Number);
    expect(rgbMatch).toBeTruthy();
    expect(rgbMatch![0]).toBeGreaterThan(200);
    expect(rgbMatch![0]).toBeGreaterThan(rgbMatch![1]);
  });

  it("支持在播放条任意位置左右滑动调节进度且不误触发按钮展开，展开或滑动时进度条变粗并显示头部圆球，进度条本身不响应单击", () => {
    renderBar();

    const barEl = document.querySelector<HTMLElement>(
      "[data-now-playing-bar]"
    )!;
    const slider = document.querySelector<HTMLElement>(
      '[data-testid="now-playing-progress-slider"]'
    )!;
    const track = document.querySelector<HTMLElement>(
      '[data-testid="now-playing-progress-track"]'
    )!;
    const thumb = document.querySelector<HTMLElement>(
      '[data-testid="now-playing-progress-thumb"]'
    )!;
    const playBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label="播放"]'
    )!;

    // 进度条避开左右圆弧且跨骑底边正中，整个播放条禁用浏览器侧滑/平移接管
    expect(barEl.className).toContain("touch-none");
    expect(slider.className).toContain("inset-x-6");
    expect(slider.className).toContain("-bottom-[0.5px]");
    expect(slider.className).toContain("translate-y-1/2");
    expect(slider.className).toContain("pointer-events-none");
    expect(thumb.className).toContain("opacity-100");
    expect(playBtn.querySelector("svg circle")).toBeNull();
    expect(playBtn.className).toContain("player-play-btn-light");
    expect(track.className).toContain("h-[1px]");

    vi.spyOn(barEl, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 200,
      top: 0,
      right: 200,
      bottom: 48,
      height: 48,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // 1. 默认态下直接在播放条任意位置向右滑动 100px（宽度 200 → +50 秒，10s + 50s = 60s）
    const infoText = Array.from(barEl.querySelectorAll("span")).find((el) =>
      el.textContent?.includes("晴天")
    )!;
    act(() => {
      infoText.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 40, clientY: 20 })
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 140,
          clientY: 20,
        })
      );
    });

    // 滑动过程中进度条变粗、显示圆球且时间实时预览为 1:00/1:40
    expect(track.className).toContain("h-[2px]");
    expect(thumb.className).toContain("opacity-100");
    expect(
      document.querySelector('[data-testid="now-playing-time"]')?.textContent
    ).toBe("1:00/1:40");

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      infoText.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(seekSpy).toHaveBeenCalledTimes(1);
    expect(seekSpy).toHaveBeenCalledWith(60);
    // 横向滑动抬手后吞掉本次 click，不误展开控制按钮，圆球隐藏
    expectControlsVisible(false);
    expect(track.className).toContain("h-[1px]");
    expect(thumb.className).toContain("opacity-100");

    // 2. 单击播放条展开控制按钮后，进度条变粗且显现可拖拽圆球；点击进度条轨道仍不触发 seek
    act(() => {
      infoText.click();
    });
    expectControlsVisible(true);
    expect(track.className).toContain("h-[2px]");
    expect(thumb.className).toContain("opacity-100");
    expect(thumb.className).toContain("pointer-events-auto");
    expect(slider.className).toContain("pointer-events-none");

    act(() => {
      slider.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 160 })
      );
    });
    expect(seekSpy).toHaveBeenCalledTimes(1);
  });

  it("展开控制按钮后按住头部圆球拖拽不触发单击隐藏，并暂停 3 秒自动收起计时", () => {
    vi.useFakeTimers();
    try {
      const { container: rootEl } = renderBar();
      const infoText = Array.from(rootEl.querySelectorAll("span")).find((el) =>
        el.textContent?.includes("晴天")
      )!;
      const track = document.querySelector<HTMLElement>(
        '[data-testid="now-playing-progress-track"]'
      )!;
      const thumb = document.querySelector<HTMLElement>(
        '[data-testid="now-playing-progress-thumb"]'
      )!;

      vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
        left: 24,
        width: 150,
        top: 46,
        right: 174,
        bottom: 50,
        height: 4,
        x: 24,
        y: 46,
        toJSON: () => ({}),
      });

      act(() => {
        infoText.click();
      });
      expectControlsVisible(true);

      // 1. 单纯按住头部圆球再松手（哪怕随后派发 click），不应收起控制按钮或误 seek
      act(() => {
        thumb.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            clientX: 39,
            clientY: 48,
          })
        );
        window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        thumb.dispatchEvent(
          new MouseEvent("click", { bubbles: true, clientX: 39, clientY: 48 })
        );
      });
      expectControlsVisible(true);
      expect(seekSpy).not.toHaveBeenCalled();

      // 2. 按住小球经过 2.5 秒不抬手，随后横向拖动 +60px（轨道宽 150 → +40s，10s + 40s = 50s）
      act(() => {
        const touchDown = new Event("touchstart", {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(touchDown, "touches", {
          value: [{ clientX: 39, clientY: 48 }],
        });
        thumb.dispatchEvent(touchDown);
      });

      // 按住期间超过原 3 秒阈值，控制按钮也不应被自动隐藏
      act(() => {
        vi.advanceTimersByTime(3500);
      });
      expectControlsVisible(true);

      act(() => {
        const touchMove = new Event("touchmove", {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(touchMove, "touches", {
          value: [{ clientX: 99, clientY: 60 }],
        });
        window.dispatchEvent(touchMove);
      });

      expect(
        document.querySelector('[data-testid="now-playing-time"]')?.textContent
      ).toBe("0:50/1:40");

      act(() => {
        window.dispatchEvent(new Event("touchend", { bubbles: true }));
      });

      expect(seekSpy).toHaveBeenCalledTimes(1);
      expect(seekSpy).toHaveBeenCalledWith(50);
      expectControlsVisible(true);

      // 拖拽刚结束若紧接着真实点击（例如触摸后未派发旧 click），新触摸应清除抑制，不吃掉点击
      const playBtn = document.querySelector<HTMLButtonElement>(
        'button[aria-label="播放"]'
      )!;
      act(() => {
        vi.advanceTimersByTime(20);
        const nextTouch = new Event("touchstart", {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(nextTouch, "touches", {
          value: [{ clientX: 120, clientY: 20 }],
        });
        playBtn.dispatchEvent(nextTouch);
        window.dispatchEvent(new Event("touchend", { bubbles: true }));
        playBtn.click();
      });
      expect(togglePlaySpy).toHaveBeenCalledTimes(1);

      // 松手后 3 秒无操作自动收起
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expectControlsVisible(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("歌曲名与歌手超出可见宽度时自动启用跑马灯滚动，展开控制按钮时暂停动画", () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.className.includes("whitespace-nowrap select-none")) {
          return {
            left: 0,
            right: 120,
            top: 0,
            bottom: 20,
            width: 120,
            height: 20,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          };
        }
        if (
          this.className.includes(
            "inline-flex items-baseline whitespace-nowrap"
          )
        ) {
          return {
            left: 0,
            right: 260,
            top: 0,
            bottom: 20,
            width: 260,
            height: 20,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          };
        }
        return originalRect.call(this);
      }
    );

    useMusicStore.setState({
      queue: [
        {
          ...sampleTrack,
          name: "这是一首非常非常长会在播放条中截断的歌曲标题",
          artist: ["很长很长的歌手名称一", "歌手二"],
        },
      ],
    });

    renderBar();

    const marqueeTrack = document.querySelector<HTMLElement>(
      '[data-testid="marquee-track"]'
    )!;
    expect(marqueeTrack.className).toContain("animate-marquee");
    // 溢出滚动时自动渲染无缝循环副本
    expect(marqueeTrack.children.length).toBe(2);

    // 展开控制按钮期间信息层淡出，跑马灯暂停
    const infoText = Array.from(marqueeTrack.querySelectorAll("span")).find(
      (el) => el.textContent?.includes("这是一首非常非常长")
    )!;
    act(() => {
      infoText.click();
    });
    expect(marqueeTrack.className).not.toContain("animate-marquee");
    expect(marqueeTrack.children.length).toBe(1);
  });

  it("在播放条上滑时直接进入全屏播放页且不展开控制按钮", () => {
    const onOpenFullScreen = vi.fn();
    renderBar(onOpenFullScreen);

    const barEl = document.querySelector<HTMLElement>(
      "[data-now-playing-bar]"
    )!;
    act(() => {
      barEl.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          touches: [{ clientX: 150, clientY: 600 } as Touch],
        })
      );
      window.dispatchEvent(
        new TouchEvent("touchmove", {
          bubbles: true,
          cancelable: true,
          touches: [{ clientX: 152, clientY: 560 } as Touch],
        })
      );
      window.dispatchEvent(new TouchEvent("touchend", { bubbles: true }));
    });

    expect(onOpenFullScreen).toHaveBeenCalledTimes(1);
    expectControlsVisible(false);
  });

  it("从播放列表按钮/抽屉子树上滑不会误触发全屏播放页", () => {
    const onOpenFullScreen = vi.fn();
    renderBar(onOpenFullScreen);

    const queueButton = document.querySelector<HTMLElement>(
      'button[aria-label="播放列表"]'
    )!;
    act(() => {
      queueButton.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          touches: [{ clientX: 150, clientY: 600 } as Touch],
        })
      );
      window.dispatchEvent(
        new TouchEvent("touchmove", {
          bubbles: true,
          cancelable: true,
          touches: [{ clientX: 152, clientY: 560 } as Touch],
        })
      );
      window.dispatchEvent(new TouchEvent("touchend", { bubbles: true }));
    });

    expect(onOpenFullScreen).not.toHaveBeenCalled();
  });

  it("从抽屉内容子树上滑不会误触发全屏播放页", () => {
    const onOpenFullScreen = vi.fn();
    renderBar(onOpenFullScreen);

    // 抽屉内容 Portal 到 body，但 React 树里仍是 bar 的后代，
    // 触摸会合成冒泡到 bar 的 onTouchStart —— 用标记模拟这一路径
    const drawerPane = document.createElement("div");
    drawerPane.setAttribute("data-player-queue-drawer", "");
    const listItem = document.createElement("div");
    drawerPane.appendChild(listItem);
    document.body.appendChild(drawerPane);
    const barEl = document.querySelector<HTMLElement>(
      "[data-now-playing-bar]"
    )!;
    barEl.appendChild(drawerPane);

    act(() => {
      listItem.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          touches: [{ clientX: 150, clientY: 600 } as Touch],
        })
      );
      window.dispatchEvent(
        new TouchEvent("touchmove", {
          bubbles: true,
          cancelable: true,
          touches: [{ clientX: 152, clientY: 560 } as Touch],
        })
      );
      window.dispatchEvent(new TouchEvent("touchend", { bubbles: true }));
    });

    expect(onOpenFullScreen).not.toHaveBeenCalled();
    drawerPane.remove();
  });

  it("播放时显示歌词（支持逐字歌词）并隐藏歌名歌手与音源时长，超长歌词单遍跟唱滚动，暂停后恢复", async () => {
    musicApiMocks.getLyric.mockResolvedValue({
      lyric:
        "[00:01.00]<0,1000>故<1000,1000>事<2000,1000>的<3000,1000>小<4000,1000>黄<5000,1000>花",
      tlyric: "",
    });
    useMusicStore.setState({
      isPlaying: true,
      currentAudioTime: 5,
      duration: 100,
    });

    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.testid === "now-playing-lyric-track") {
          return {
            width: 300,
            height: 20,
            top: 0,
            left: 0,
            right: 300,
            bottom: 20,
            x: 0,
            y: 0,
            toJSON: () => {},
          } as DOMRect;
        }
        return {
          width: 140,
          height: 36,
          top: 0,
          left: 0,
          right: 140,
          bottom: 36,
          x: 0,
          y: 0,
          toJSON: () => {},
        } as DOMRect;
      });

    renderBar();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const infoEl = document.querySelector<HTMLElement>(
      '[data-testid="now-playing-info"]'
    )!;
    expect(infoEl.textContent).toContain("故事的小黄花");
    expect(infoEl.textContent).not.toContain("晴天");
    expect(infoEl.textContent).not.toContain("周杰伦");
    expect(
      document.querySelector('[data-testid="now-playing-time"]')
    ).toBeNull();

    // 一句歌词只展示一遍（不复制循环副本），且随进度向后滚出
    const lyricTrack = document.querySelector<HTMLElement>(
      '[data-testid="now-playing-lyric-track"]'
    )!;
    expect(lyricTrack.children.length).toBe(1);
    expect(lyricTrack.style.transform).toMatch(
      /translate3d\(-[0-9.]+px, 0, 0\)/
    );

    // 暂停后恢复显示歌名、歌手与时长
    await act(async () => {
      useMusicStore.setState({ isPlaying: false });
    });
    expect(infoEl.textContent).toContain("晴天");
    expect(infoEl.textContent).toContain("周杰伦");
    expect(
      document.querySelector('[data-testid="now-playing-time"]')
    ).not.toBeNull();

    rectSpy.mockRestore();
  });
});
