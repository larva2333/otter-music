import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePagerSwipe } from "./use-pager-swipe";
import {
  RootPagerContext,
  type RootPagerContextValue,
  type RootTabId,
} from "./use-root-pager";

interface TouchPoint {
  clientX: number;
  clientY: number;
}

const makeTouchEvent = (
  type: string,
  points: TouchPoint[],
  changed: TouchPoint[] = points
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: points });
  Object.defineProperty(event, "changedTouches", { value: changed });
  return event;
};

const WIDTH = 400;

describe("usePagerSwipe 歌单页横向分页", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.useRealTimers();
  });

  const mount = (
    index: number,
    onChange = vi.fn(),
    onEdge = vi.fn(),
    onNeighborIntent = vi.fn()
  ) => {
    function Harness() {
      const stageRef = useRef<HTMLDivElement>(null);
      const viewportRef = useRef<HTMLDivElement>(null);
      const trackRef = useRef<HTMLDivElement>(null);
      usePagerSwipe(
        { stageRef, viewportRef, trackRef },
        {
          count: 4,
          index,
          onChange,
          onEdge,
          onNeighborIntent,
        }
      );
      return (
        <div ref={stageRef} data-testid="stage">
          <div ref={viewportRef} data-testid="viewport">
            <div ref={trackRef} data-testid="track">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} data-testid={`page-${i}`} />
              ))}
            </div>
          </div>
        </div>
      );
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Harness />));

    const viewport = container.querySelector(
      '[data-testid="viewport"]'
    ) as HTMLElement;
    const track = container.querySelector(
      '[data-testid="track"]'
    ) as HTMLElement;
    const stage = container.querySelector(
      '[data-testid="stage"]'
    ) as HTMLElement;
    // jsdom 不做布局，手动给一个视口宽度
    Object.defineProperty(viewport, "clientWidth", {
      configurable: true,
      value: WIDTH,
    });

    return { viewport, track, stage };
  };

  const gesture = (
    viewport: HTMLElement,
    from: [number, number],
    to: [number, number]
  ) => {
    act(() => {
      viewport.dispatchEvent(
        makeTouchEvent("touchstart", [{ clientX: from[0], clientY: from[1] }])
      );
      viewport.dispatchEvent(
        makeTouchEvent("touchmove", [{ clientX: to[0], clientY: to[1] }])
      );
      viewport.dispatchEvent(
        makeTouchEvent("touchend", [], [{ clientX: to[0], clientY: to[1] }])
      );
    });
  };

  it("左滑超过阈值切到下一页，轨道对齐 -400px", () => {
    const onChange = vi.fn();
    const { viewport, track } = mount(0, onChange);

    gesture(viewport, [300, 300], [220, 302]);

    expect(track.style.transform).toContain("-400px");
    act(() => vi.advanceTimersByTime(300));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("右滑超过阈值回上一页", () => {
    const onChange = vi.fn();
    const { viewport } = mount(2, onChange);

    gesture(viewport, [100, 300], [200, 301]);

    act(() => vi.advanceTimersByTime(300));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("位移不足阈值回弹，不切页", () => {
    const onChange = vi.fn();
    const { viewport, track } = mount(1, onChange);

    gesture(viewport, [300, 300], [270, 300]);

    expect(onChange).not.toHaveBeenCalled();
    expect(track.style.transform).toContain("-400px");
  });

  it("第一页右滑：整页滑出并跳转上一个根 tab", () => {
    const onChange = vi.fn();
    const onEdge = vi.fn();
    const { viewport, stage } = mount(0, onChange, onEdge);

    gesture(viewport, [100, 300], [200, 302]);

    expect(onChange).not.toHaveBeenCalled();
    expect(stage.style.transform).toContain("400px");

    act(() => vi.advanceTimersByTime(300));
    expect(onEdge).toHaveBeenCalledWith("prev");
  });

  it("最后一页左滑：整页滑出并跳转下一个根 tab", () => {
    const onEdge = vi.fn();
    const { viewport, stage } = mount(3, vi.fn(), onEdge);

    gesture(viewport, [300, 300], [180, 302]);

    expect(stage.style.transform).toContain("-400px");

    act(() => vi.advanceTimersByTime(300));
    expect(onEdge).toHaveBeenCalledWith("next");
  });

  it("纵向滑动不翻页，也不触发边缘跳转", () => {
    const onChange = vi.fn();
    const onEdge = vi.fn();
    const { viewport } = mount(0, onChange, onEdge);

    gesture(viewport, [300, 300], [296, 380]);
    act(() => vi.advanceTimersByTime(200));

    expect(onChange).not.toHaveBeenCalled();
    expect(onEdge).not.toHaveBeenCalled();
  });

  it("横向锁定后提前挂载相邻页", () => {
    const onNeighborIntent = vi.fn();
    const { viewport } = mount(1, vi.fn(), vi.fn(), onNeighborIntent);

    gesture(viewport, [300, 300], [250, 301]);

    expect(onNeighborIntent).toHaveBeenCalledWith(2);
  });

  describe("与 RootPagerContext 联动", () => {
    const createMockRootPager = (
      overrides?: Partial<RootPagerContextValue>
    ): RootPagerContextValue => ({
      activePath: "/mine",
      canSlideEdge: vi.fn(() => true),
      getViewportWidth: vi.fn(() => WIDTH),
      prepareEdgeNeighbor: vi.fn<RootPagerContextValue["prepareEdgeNeighbor"]>(
        () => "/settings"
      ),
      dragRootBy: vi.fn(),
      getRootDragOffset: vi.fn(() => 0),
      cancelRootDrag: vi.fn(),
      commitRootEdge: vi.fn(),
      registerAligner: vi.fn(() => () => {}),
      ...overrides,
    });

    const mountWithRoot = (
      opts: {
        count?: number;
        index: number;
        rootTab: RootTabId;
        isPageActive?: boolean;
      },
      rootPager: RootPagerContextValue
    ) => {
      const onChange = vi.fn();
      const onEdge = vi.fn();
      const count = opts.count ?? 4;

      function Harness({
        index,
        isPageActive = true,
      }: {
        index: number;
        isPageActive?: boolean;
      }) {
        const viewportRef = useRef<HTMLDivElement>(null);
        const trackRef = useRef<HTMLDivElement>(null);
        usePagerSwipe(
          { viewportRef, trackRef },
          {
            count,
            index,
            onChange,
            onEdge,
            rootTab: opts.rootTab,
            isPageActive,
          }
        );
        return (
          <div ref={viewportRef} data-testid="viewport">
            {count > 1 && (
              <div ref={trackRef} data-testid="track">
                {Array.from({ length: count }).map((_, i) => (
                  <div key={i} />
                ))}
              </div>
            )}
          </div>
        );
      }

      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() =>
        root!.render(
          <RootPagerContext.Provider value={rootPager}>
            <Harness index={opts.index} isPageActive={opts.isPageActive} />
          </RootPagerContext.Provider>
        )
      );

      const viewport = container.querySelector(
        '[data-testid="viewport"]'
      ) as HTMLElement;
      Object.defineProperty(viewport, "clientWidth", {
        configurable: true,
        value: WIDTH,
      });

      const rerender = (index: number, isPageActive = true) => {
        act(() =>
          root!.render(
            <RootPagerContext.Provider value={rootPager}>
              <Harness index={index} isPageActive={isPageActive} />
            </RootPagerContext.Provider>
          )
        );
      };

      return {
        viewport,
        track: container.querySelector(
          '[data-testid="track"]'
        ) as HTMLElement | null,
        onChange,
        onEdge,
        rerender,
      };
    };

    it("最后一页左滑时联动根轨道并提交切换，不走 stageRef 兜底", () => {
      const rootPager = createMockRootPager();
      const { viewport, onEdge } = mountWithRoot(
        { index: 3, rootTab: "mine" },
        rootPager
      );

      gesture(viewport, [300, 200], [180, 202]);

      expect(rootPager.prepareEdgeNeighbor).toHaveBeenCalledWith(
        "mine",
        "next"
      );
      expect(rootPager.dragRootBy).toHaveBeenCalledWith(-120);
      expect(rootPager.commitRootEdge).toHaveBeenCalledWith("mine", "next");
      expect(onEdge).not.toHaveBeenCalled();
    });

    it("边缘拖拽未达阈值时调用 cancelRootDrag(true) 回弹", () => {
      const rootPager = createMockRootPager();
      const { viewport } = mountWithRoot(
        { count: 1, index: 0, rootTab: "favorites" },
        rootPager
      );

      act(() => {
        viewport.dispatchEvent(
          makeTouchEvent("touchstart", [{ clientX: 200, clientY: 200 }])
        );
        viewport.dispatchEvent(
          makeTouchEvent("touchmove", [{ clientX: 180, clientY: 200 }])
        );
        vi.advanceTimersByTime(400);
        viewport.dispatchEvent(
          makeTouchEvent("touchend", [], [{ clientX: 180, clientY: 200 }])
        );
      });

      expect(rootPager.dragRootBy).toHaveBeenCalledWith(-20);
      expect(rootPager.cancelRootDrag).toHaveBeenCalledWith(true);
      expect(rootPager.commitRootEdge).not.toHaveBeenCalled();
    });

    it("链尾（settings 左滑）不可滑方向不跟手也不提交", () => {
      const rootPager = createMockRootPager({
        canSlideEdge: vi.fn((_tab, dir) => dir === "prev"),
      });
      const { viewport } = mountWithRoot(
        { count: 1, index: 0, rootTab: "settings" },
        rootPager
      );

      gesture(viewport, [300, 200], [150, 200]);

      expect(rootPager.prepareEdgeNeighbor).not.toHaveBeenCalled();
      expect(rootPager.dragRootBy).not.toHaveBeenCalled();
      expect(rootPager.commitRootEdge).not.toHaveBeenCalled();
    });

    it("手势从边缘反向划回内部子 Tab 时复位根轨道并平移内部轨道", () => {
      const rootPager = createMockRootPager();
      const { viewport, track, onChange } = mountWithRoot(
        { count: 4, index: 3, rootTab: "mine" },
        rootPager
      );

      act(() => {
        viewport.dispatchEvent(
          makeTouchEvent("touchstart", [{ clientX: 200, clientY: 200 }])
        );
        // 先左滑进入边缘
        viewport.dispatchEvent(
          makeTouchEvent("touchmove", [{ clientX: 140, clientY: 200 }])
        );
        // 再反向右滑超过起点，切回第 2 页方向
        viewport.dispatchEvent(
          makeTouchEvent("touchmove", [{ clientX: 280, clientY: 200 }])
        );
        viewport.dispatchEvent(
          makeTouchEvent("touchend", [], [{ clientX: 280, clientY: 200 }])
        );
      });

      expect(rootPager.cancelRootDrag).toHaveBeenCalledWith(false);
      expect(track?.style.transform).toContain("-800px");
      act(() => vi.advanceTimersByTime(300));
      expect(onChange).toHaveBeenCalledWith(2);
    });

    it("连续快速甩动（280ms 动画未结束即再次触摸）时立即提交上次切页", () => {
      const rootPager = createMockRootPager();
      const { viewport, onChange } = mountWithRoot(
        { count: 4, index: 0, rootTab: "mine" },
        rootPager
      );

      gesture(viewport, [300, 200], [180, 200]);
      // 未等 280ms 动画结束直接再次发起第二次滑屏
      gesture(viewport, [300, 200], [180, 200]);

      expect(onChange).toHaveBeenNthCalledWith(1, 1);
      act(() => vi.advanceTimersByTime(300));
      expect(onChange).toHaveBeenNthCalledWith(2, 2);
    });

    it("后台非激活页（isPageActive=false）对齐时瞬时落位不播过渡动画", () => {
      const rootPager = createMockRootPager();
      const { track, rerender } = mountWithRoot(
        { count: 4, index: 0, rootTab: "mine", isPageActive: false },
        rootPager
      );

      rerender(3, false);
      expect(track?.style.transition).toBe("none");
      expect(track?.style.transform).toContain("-1200px");
    });
  });
});
