import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePullToRefresh } from "./use-pull-to-refresh";
import { setDragSelecting } from "./gesture-axis";

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

describe("usePullToRefresh 与横滑 / 多选手势互斥", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    setDragSelecting(false);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    setDragSelecting(false);
  });

  const mount = (onRefresh: () => void) => {
    function Harness() {
      const scrollRef = useRef<HTMLDivElement>(null);
      const { indicatorRef } = usePullToRefresh(scrollRef, { onRefresh });
      return (
        <div ref={scrollRef} data-testid="scroll">
          <div ref={indicatorRef} data-testid="indicator" />
        </div>
      );
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Harness />));
    return {
      scroll: container!.querySelector('[data-testid="scroll"]') as HTMLElement,
      indicator: container!.querySelector(
        '[data-testid="indicator"]'
      ) as HTMLElement,
    };
  };

  const gesture = async (
    scroll: HTMLElement,
    from: [number, number],
    ...moves: [number, number][]
  ) => {
    await act(async () => {
      scroll.dispatchEvent(
        makeTouchEvent("touchstart", [{ clientX: from[0], clientY: from[1] }])
      );
      moves.forEach(([x, y]) => {
        scroll.dispatchEvent(
          makeTouchEvent("touchmove", [{ clientX: x, clientY: y }])
        );
      });
      const last = moves[moves.length - 1] ?? from;
      scroll.dispatchEvent(
        makeTouchEvent("touchend", [], [{ clientX: last[0], clientY: last[1] }])
      );
      // 等 handleEnd 的 async finally 把状态收尾，避免 act 警告
      await Promise.resolve();
    });
  };

  it("纵向从顶部下拉仍会刷新", async () => {
    const onRefresh = vi.fn();
    const { scroll } = mount(onRefresh);

    await gesture(scroll, [200, 200], [198, 260], [196, 320]);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("横向为主的滑动不显示指示器也不刷新", async () => {
    const onRefresh = vi.fn();
    const { scroll, indicator } = mount(onRefresh);

    await gesture(scroll, [200, 200], [140, 215], [80, 220]);

    expect(onRefresh).not.toHaveBeenCalled();
    expect(parseFloat(indicator.style.height || "0")).toBe(0);
  });

  it("先横滑再转成下拉，整段手势都不刷新", async () => {
    const onRefresh = vi.fn();
    const { scroll } = mount(onRefresh);

    // 第一步判为横向后即使再往下拉，也不能半路冒出刷新
    await gesture(scroll, [200, 200], [130, 205], [130, 260], [130, 320]);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("长按多选笔刷期间的下滑不刷新", async () => {
    const onRefresh = vi.fn();
    const { scroll } = mount(onRefresh);
    setDragSelecting(true);

    await gesture(scroll, [200, 200], [198, 260], [196, 320]);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("手势中途进入多选笔刷时立即收起指示器，不刷新", () => {
    const onRefresh = vi.fn();
    const { scroll } = mount(onRefresh);

    act(() => {
      scroll.dispatchEvent(
        makeTouchEvent("touchstart", [{ clientX: 200, clientY: 200 }])
      );
      scroll.dispatchEvent(
        makeTouchEvent("touchmove", [{ clientX: 198, clientY: 280 }])
      );
    });
    setDragSelecting(true);
    act(() => {
      scroll.dispatchEvent(
        makeTouchEvent("touchmove", [{ clientX: 196, clientY: 320 }])
      );
      scroll.dispatchEvent(
        makeTouchEvent("touchend", [], [{ clientX: 196, clientY: 320 }])
      );
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
