import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePagerSwipe } from "./use-pager-swipe";

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

    expect(onChange).toHaveBeenCalledWith(1);
    expect(track.style.transform).toContain("-400px");
  });

  it("右滑超过阈值回上一页", () => {
    const onChange = vi.fn();
    const { viewport } = mount(2, onChange);

    gesture(viewport, [100, 300], [200, 301]);

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
});
