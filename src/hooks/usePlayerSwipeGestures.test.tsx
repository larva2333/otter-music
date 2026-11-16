import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { usePlayerSwipeGestures } from "./usePlayerSwipeGestures";

describe("usePlayerSwipeGestures 播放页手势", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const touch = (clientX: number, clientY: number) =>
    ({ touches: [{ clientX, clientY }] }) as unknown as React.TouchEvent;

  const renderGestures = (enabled = true) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onClose = vi.fn();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onTap = vi.fn();

    let latest: ReturnType<typeof usePlayerSwipeGestures> | undefined;

    function TestHarness() {
      const gestures = usePlayerSwipeGestures({
        enabled,
        onClose,
        onPrev,
        onNext,
        onTap,
      });

      useEffect(() => {
        latest = gestures;
      }, [gestures]);

      return null;
    }

    act(() => {
      root.render(<TestHarness />);
    });

    const gesture = (
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      /** 手势耗时：> FLING_DURATION 表示慢速拖动，不再按“甩”判定 */
      duration = 0
    ) =>
      act(() => {
        latest!.handlers.onTouchStart(touch(startX, startY));
        vi.advanceTimersByTime(duration);
        latest!.handlers.onTouchMove(touch(endX, endY));
        latest!.handlers.onTouchEnd();
      });

    return {
      gesture,
      onClose,
      onPrev,
      onNext,
      onTap,
      /** 模拟一次轻点：按下后原地抬起，不产生位移 */
      tap: () =>
        act(() => {
          latest!.handlers.onTouchStart(touch(300, 300));
          latest!.handlers.onTouchEnd();
        }),
      getLatest: () => latest!,
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  };

  it("左滑看下一首", () => {
    const h = renderGestures();
    h.gesture(200, 300, 100, 305);

    expect(h.onNext).toHaveBeenCalledTimes(1);
    expect(h.onPrev).not.toHaveBeenCalled();
    expect(h.onClose).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("右滑回上一首", () => {
    const h = renderGestures();
    h.gesture(100, 300, 200, 295);

    expect(h.onPrev).toHaveBeenCalledTimes(1);
    expect(h.onNext).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("下滑超过阈值收起播放页", () => {
    const h = renderGestures();
    h.gesture(200, 200, 205, 320);

    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(h.onPrev).not.toHaveBeenCalled();
    expect(h.onNext).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("下滑距离不足时回弹，不关闭", () => {
    const h = renderGestures();
    h.gesture(200, 200, 202, 240, 400);

    expect(h.onClose).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("上滑不触发任何操作", () => {
    const h = renderGestures();
    h.gesture(200, 400, 202, 200);

    expect(h.onClose).not.toHaveBeenCalled();
    expect(h.onPrev).not.toHaveBeenCalled();
    expect(h.onNext).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("斜向滑动不会同时命中收起和切歌", () => {
    const h = renderGestures();
    h.gesture(200, 200, 260, 280);

    expect(h.onClose).not.toHaveBeenCalled();
    expect(h.onNext).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("歌词页（enabled=false）不响应滑动", () => {
    const h = renderGestures(false);
    h.gesture(200, 300, 100, 320);

    expect(h.onPrev).not.toHaveBeenCalled();
    expect(h.onNext).not.toHaveBeenCalled();
    expect(h.onClose).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("触发动作的滑动只拦一次 click，窗口过后放行", () => {
    const h = renderGestures();
    h.gesture(200, 300, 100, 305);

    expect(h.getLatest().shouldSuppressClick()).toBe(true);
    // 只拦一次，避免连带吞掉后续正常点击
    expect(h.getLatest().shouldSuppressClick()).toBe(false);

    h.gesture(200, 300, 100, 300);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(h.getLatest().shouldSuppressClick()).toBe(false);
    h.cleanup();
  });

  it("上滑不会吞掉随后的点击", () => {
    const h = renderGestures();
    h.gesture(200, 400, 202, 200);

    expect(h.getLatest().shouldSuppressClick()).toBe(false);
    h.cleanup();
  });

  it("滑动距离不足时不会吞掉随后的点击", () => {
    const h = renderGestures();
    h.gesture(200, 300, 220, 306);

    expect(h.getLatest().shouldSuppressClick()).toBe(false);
    h.cleanup();
  });

  it("新的一次触摸会清掉上一次残留的抑制标记", () => {
    const h = renderGestures();

    // 第一次切歌设下抑制，但模拟浏览器没有补发 click，标记残留
    h.gesture(200, 300, 100, 305);
    // 用户下一次按下手指，说明上一条手势已经结束，不该再被吞
    act(() => {
      h.getLatest().handlers.onTouchStart(touch(300, 300));
    });

    expect(h.getLatest().shouldSuppressClick()).toBe(false);
    h.cleanup();
  });

  it("拖拽过程中跟手位移不超过上限，松手后归零", () => {
    const h = renderGestures();

    act(() => {
      h.getLatest().handlers.onTouchStart(touch(200, 200));
      h.getLatest().handlers.onTouchMove(touch(200, 600));
    });

    expect(h.getLatest().dragY).toBeGreaterThan(0);
    expect(h.getLatest().dragY).toBeLessThanOrEqual(160);
    expect(h.getLatest().isDragging).toBe(true);

    act(() => {
      h.getLatest().handlers.onTouchEnd();
    });

    expect(h.getLatest().dragY).toBe(0);
    expect(h.getLatest().isDragging).toBe(false);
    h.cleanup();
  });

  it("轻点在 touchend 直接触发，不依赖 click", () => {
    const h = renderGestures();
    h.tap();

    expect(h.onTap).toHaveBeenCalledTimes(1);
    expect(h.onClose).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("轻点回调带上 target，用于区分黑胶与周围空白", () => {
    const h = renderGestures();
    const target = document.createElement("div");

    act(() => {
      h.getLatest().handlers.onTouchStart(touch(300, 300));
      h.getLatest().handlers.onTouchEnd({
        target,
      } as unknown as React.TouchEvent);
    });

    expect(h.onTap).toHaveBeenCalledWith(target);
    h.cleanup();
  });

  it("轻点后浏览器补发的 click 会被拦一次", () => {
    const h = renderGestures();
    h.tap();

    expect(h.getLatest().shouldSuppressClick()).toBe(true);
    expect(h.getLatest().shouldSuppressClick()).toBe(false);
    h.cleanup();
  });

  it("滑动不会误触发轻点", () => {
    const h = renderGestures();
    h.gesture(200, 300, 100, 305);

    expect(h.onTap).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("歌词页（enabled=false）轻点仍能切回封面", () => {
    const h = renderGestures(false);
    h.tap();

    expect(h.onTap).toHaveBeenCalledTimes(1);
    expect(h.onPrev).not.toHaveBeenCalled();
    expect(h.onNext).not.toHaveBeenCalled();
    h.cleanup();
  });
});
