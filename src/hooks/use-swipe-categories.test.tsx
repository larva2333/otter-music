import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSwipeCategories } from "./use-swipe-categories";

interface TouchPoint {
  clientX: number;
  clientY: number;
  target?: Element | null;
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

describe("useSwipeCategories 首页分类左右滑动", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  /** 挂载一个带手势的滑动区域，返回该元素 */
  const mountSurface = (
    ids: string[],
    activeId: string,
    onChange: (id: string) => void
  ) => {
    function Harness() {
      const ref = useRef<HTMLDivElement>(null);
      useSwipeCategories(ref, { ids, activeId, onChange });
      return <div ref={ref} data-testid="surface" />;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Harness />));

    return container.querySelector('[data-testid="surface"]') as HTMLDivElement;
  };

  const swipe = (
    surface: HTMLElement,
    from: [number, number],
    to: [number, number]
  ) => {
    act(() => {
      surface.dispatchEvent(
        makeTouchEvent("touchstart", [
          { clientX: from[0], clientY: from[1], target: surface },
        ])
      );
      surface.dispatchEvent(
        makeTouchEvent("touchmove", [{ clientX: to[0], clientY: to[1] }])
      );
      surface.dispatchEvent(
        makeTouchEvent("touchend", [], [{ clientX: to[0], clientY: to[1] }])
      );
    });
  };

  const ids = ["全部", "精选", "华语", "欧美"];

  it("左滑切到下一个分类", () => {
    const onChange = vi.fn();
    const surface = mountSurface(ids, "精选", onChange);

    swipe(surface, [300, 200], [160, 205]);

    expect(onChange).toHaveBeenCalledWith("华语");
  });

  it("右滑切到上一个分类", () => {
    const onChange = vi.fn();
    const surface = mountSurface(ids, "精选", onChange);

    swipe(surface, [120, 200], [260, 202]);

    expect(onChange).toHaveBeenCalledWith("全部");
  });

  it("位移不足阈值不切换", () => {
    const onChange = vi.fn();
    const surface = mountSurface(ids, "精选", onChange);

    swipe(surface, [200, 200], [170, 200]);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("纵向滚动不误触切换", () => {
    const onChange = vi.fn();
    const surface = mountSurface(ids, "精选", onChange);

    swipe(surface, [200, 400], [170, 120]);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("首个分类右滑不越界", () => {
    const onChange = vi.fn();
    const surface = mountSurface(ids, "全部", onChange);

    swipe(surface, [120, 200], [280, 200]);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("最后一个分类左滑不越界", () => {
    const onChange = vi.fn();
    const surface = mountSurface(ids, "欧美", onChange);

    swipe(surface, [300, 200], [140, 200]);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("内部横向滚动区域上的横滑交给该元素处理", () => {
    const onChange = vi.fn();
    const surface = mountSurface(ids, "精选", onChange);

    const scroller = document.createElement("div");
    surface.appendChild(scroller);
    Object.defineProperty(scroller, "scrollWidth", { value: 600 });
    Object.defineProperty(scroller, "clientWidth", { value: 300 });
    scroller.style.overflowX = "auto";

    act(() => {
      scroller.dispatchEvent(
        makeTouchEvent("touchstart", [
          { clientX: 300, clientY: 200, target: scroller },
        ])
      );
      scroller.dispatchEvent(
        makeTouchEvent("touchmove", [{ clientX: 150, clientY: 200 }])
      );
      scroller.dispatchEvent(
        makeTouchEvent("touchend", [], [{ clientX: 150, clientY: 200 }])
      );
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
