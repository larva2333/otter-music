import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSwipeCategories } from "./use-swipe-categories";
import { setDragSelecting } from "./gesture-axis";

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
    setDragSelecting(false);
  });

  afterEach(() => {
    setDragSelecting(false);
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  /** 挂载一个带手势的滑动区域，返回该元素 */
  const mountSurface = (
    ids: string[],
    activeId: string,
    onChange: (id: string) => void,
    onEdge?: (dir: "next" | "prev") => void,
    extra?: {
      canFollow?: (dir: "next" | "prev") => boolean;
      keepOffsetOnEdge?: boolean;
    }
  ) => {
    function Harness() {
      const ref = useRef<HTMLDivElement>(null);
      useSwipeCategories(ref, { ids, activeId, onChange, onEdge, ...extra });
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

  it("最后一个分类左滑触发 onEdge(next)", () => {
    const onChange = vi.fn();
    const onEdge = vi.fn();
    const surface = mountSurface(ids, "欧美", onChange, onEdge);

    swipe(surface, [300, 200], [140, 200]);

    expect(onChange).not.toHaveBeenCalled();
    expect(onEdge).toHaveBeenCalledWith("next");
  });

  it("第一个分类右滑触发 onEdge(prev)", () => {
    const onChange = vi.fn();
    const onEdge = vi.fn();
    const surface = mountSurface(ids, "全部", onChange, onEdge);

    swipe(surface, [120, 200], [280, 200]);

    expect(onChange).not.toHaveBeenCalled();
    expect(onEdge).toHaveBeenCalledWith("prev");
  });

  it("未到边界的切换不触发 onEdge", () => {
    const onChange = vi.fn();
    const onEdge = vi.fn();
    const surface = mountSurface(ids, "精选", onChange, onEdge);

    swipe(surface, [300, 200], [160, 205]);

    expect(onChange).toHaveBeenCalledWith("华语");
    expect(onEdge).not.toHaveBeenCalled();
  });

  it("先锁定纵向再横滑不切分类", () => {
    const onChange = vi.fn();
    const surface = mountSurface(ids, "精选", onChange);

    act(() => {
      surface.dispatchEvent(
        makeTouchEvent("touchstart", [
          { clientX: 200, clientY: 200, target: surface },
        ])
      );
      // 第一帧纵向占优 → 锁定为 y
      surface.dispatchEvent(
        makeTouchEvent("touchmove", [{ clientX: 196, clientY: 260 }])
      );
      // 后半段转成横滑也不能再切
      surface.dispatchEvent(
        makeTouchEvent("touchmove", [{ clientX: 60, clientY: 270 }])
      );
      surface.dispatchEvent(
        makeTouchEvent("touchend", [], [{ clientX: 60, clientY: 270 }])
      );
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("长按多选笔刷期间的横滑不切分类", () => {
    const onChange = vi.fn();
    const surface = mountSurface(ids, "精选", onChange);
    setDragSelecting(true);

    swipe(surface, [300, 200], [160, 205]);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("canFollow 为 false 的方向不跟手（链尾左滑不拖动整页）", () => {
    const onChange = vi.fn();
    const onEdge = vi.fn();
    const surface = mountSurface(["设置"], "设置", onChange, onEdge, {
      canFollow: (dir) => dir === "prev",
    });

    act(() => {
      surface.dispatchEvent(
        makeTouchEvent("touchstart", [
          { clientX: 300, clientY: 200, target: surface },
        ])
      );
      // 左滑：链尾没有下一页 → 不产生位移
      surface.dispatchEvent(
        makeTouchEvent("touchmove", [{ clientX: 160, clientY: 200 }])
      );
    });
    expect(surface.style.transform).toBe("");

    act(() => {
      // 同一手势中途反向右滑 → 恢复跟手（dx = +120 → 120 * 0.55 = 66px）
      surface.dispatchEvent(
        makeTouchEvent("touchmove", [{ clientX: 420, clientY: 200 }])
      );
    });
    expect(surface.style.transform).toBe("translateX(66px)");

    act(() => {
      surface.dispatchEvent(
        makeTouchEvent("touchend", [], [{ clientX: 420, clientY: 200 }])
      );
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(onEdge).toHaveBeenCalledWith("prev");
  });

  it("keepOffsetOnEdge 时越界右滑不回弹，但切页后清除位移（tab 保活）", () => {
    const onChange = vi.fn();
    const onEdge = vi.fn();
    const surface = mountSurface(["设置"], "设置", onChange, onEdge, {
      canFollow: (dir) => dir === "prev",
      keepOffsetOnEdge: true,
    });

    act(() => {
      surface.dispatchEvent(
        makeTouchEvent("touchstart", [
          { clientX: 120, clientY: 200, target: surface },
        ])
      );
      surface.dispatchEvent(
        makeTouchEvent("touchmove", [{ clientX: 280, clientY: 200 }])
      );
    });
    expect(surface.style.transform).toBe("translateX(88px)");

    act(() => {
      surface.dispatchEvent(
        makeTouchEvent("touchend", [], [{ clientX: 280, clientY: 200 }])
      );
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(onEdge).toHaveBeenCalledWith("prev");
    // 根 tab 保活，旧页不会卸载：位移必须立即清掉，否则切回来整页还偏着
    expect(surface.style.transform).toBe("");
    expect(surface.style.transition).toBe("");
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
