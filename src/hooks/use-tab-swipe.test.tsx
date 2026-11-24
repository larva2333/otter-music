import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useTabSwipe } from "./use-tab-swipe";

describe("useTabSwipe 评论 Tab 横滑", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  const touch = (x: number, y: number) =>
    ({
      touches: [{ clientX: x, clientY: y }],
      changedTouches: [{ clientX: x, clientY: y }],
    }) as unknown as React.TouchEvent;

  const render = (onChange: (t: string) => void) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let handlers: ReturnType<typeof useTabSwipe<string>> | null = null;

    function Harness() {
      const h = useTabSwipe({
        tabs: ["hot", "new"] as const,
        value: "hot",
        onChange,
      });
      useEffect(() => {
        handlers = h;
      });
      return null;
    }
    act(() => root.render(<Harness />));

    const gesture = (x1: number, y1: number, x2: number, y2: number) =>
      act(() => {
        handlers!.onTouchStart(touch(x1, y1));
        handlers!.onTouchMove(touch(x2, y2));
        handlers!.onTouchEnd(touch(x2, y2));
      });

    return {
      gesture,
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  };

  it("左滑切到下一个 Tab", () => {
    const onChange = vi.fn();
    const h = render(onChange);
    h.gesture(300, 300, 200, 305);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("new");
    h.cleanup();
  });

  it("右滑在上一个 Tab 不越界", () => {
    const onChange = vi.fn();
    const h = render(onChange);
    h.gesture(200, 300, 300, 305);
    expect(onChange).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("纵向滚动不切 Tab", () => {
    const onChange = vi.fn();
    const h = render(onChange);
    h.gesture(200, 200, 205, 400);
    expect(onChange).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("横向距离不足不切 Tab", () => {
    const onChange = vi.fn();
    const h = render(onChange);
    h.gesture(300, 300, 270, 302);
    expect(onChange).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("斜滑不误触", () => {
    const onChange = vi.fn();
    const h = render(onChange);
    h.gesture(300, 300, 240, 380);
    expect(onChange).not.toHaveBeenCalled();
    h.cleanup();
  });
});
