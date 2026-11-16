import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { usePlayerActions } from "./usePlayerActions";

vi.mock("@/lib/storage-adapter", () => ({
  idbStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

describe("usePlayerActions 封面长按", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderActions = (onCoverLongPress?: () => void) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    let handlers: ReturnType<typeof usePlayerActions> | undefined;

    function TestHarness() {
      const actions = usePlayerActions(null, null, onCoverLongPress);

      useEffect(() => {
        handlers = actions;
      }, [actions]);

      return null;
    }

    act(() => {
      root.render(<TestHarness />);
    });

    const get = () => handlers!.coverPressHandlers;

    return {
      touchStart: () => act(() => get().onTouchStart()),
      touchEnd: () => act(() => get().onTouchEnd()),
      mouseDown: () => act(() => get().onMouseDown()),
      mouseUp: () => act(() => get().onMouseUp()),
      click: () => {
        const stopPropagation = vi.fn();
        act(() =>
          get().onClick({
            stopPropagation,
          } as unknown as React.MouseEvent)
        );
        return stopPropagation;
      },
      consumeLongPressClick: () =>
        (
          handlers as ReturnType<typeof usePlayerActions>
        ).consumeLongPressClick(),
      advance: (ms: number) =>
        act(() => {
          vi.advanceTimersByTime(ms);
        }),
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  };

  it("长按触发回调并拦截随后的 click", () => {
    const onCoverLongPress = vi.fn();
    const actions = renderActions(onCoverLongPress);

    actions.touchStart();
    actions.advance(500);

    expect(onCoverLongPress).toHaveBeenCalledTimes(1);

    actions.touchEnd();
    expect(actions.click()).toHaveBeenCalled();

    actions.cleanup();
  });

  it("忽略触摸后浏览器补发的模拟鼠标事件，仍拦截 click", () => {
    const onCoverLongPress = vi.fn();
    const actions = renderActions(onCoverLongPress);

    actions.touchStart();
    actions.advance(500);
    actions.touchEnd();

    // 浏览器补发：mousedown → mouseup → click
    actions.mouseDown();
    actions.mouseUp();
    actions.advance(500);

    expect(onCoverLongPress).toHaveBeenCalledTimes(1);
    expect(actions.click()).toHaveBeenCalled();

    actions.cleanup();
  });

  it("短按不触发长按回调，也不拦截 click", () => {
    const onCoverLongPress = vi.fn();
    const actions = renderActions(onCoverLongPress);

    actions.touchStart();
    actions.advance(200);
    actions.touchEnd();

    expect(onCoverLongPress).not.toHaveBeenCalled();
    expect(actions.click()).not.toHaveBeenCalled();

    actions.cleanup();
  });

  it("长按后浏览器未补发 click（原生长按菜单接管手势）时，后续点击不再被拦截", () => {
    const onCoverLongPress = vi.fn();
    const actions = renderActions(onCoverLongPress);

    actions.touchStart();
    actions.advance(500);
    actions.touchEnd();
    // WebView 原生长按菜单吞掉此次 click：拦截窗口过期后必须放行，否则封面点不动
    actions.advance(800);

    expect(onCoverLongPress).toHaveBeenCalledTimes(1);
    expect(actions.click()).not.toHaveBeenCalled();

    actions.cleanup();
  });

  it("新手势开始后，上一次长按不再拦截本次 click", () => {
    const onCoverLongPress = vi.fn();
    const actions = renderActions(onCoverLongPress);

    actions.touchStart();
    actions.advance(500);
    actions.touchEnd();

    // 立即再次按下（模拟长按后马上点一次）
    actions.touchStart();
    actions.touchEnd();

    expect(actions.click()).not.toHaveBeenCalled();

    actions.cleanup();
  });

  it("内容区长按弹菜单后，消费型标记只吞掉一次补发 click", () => {
    const onCoverLongPress = vi.fn();
    const actions = renderActions(onCoverLongPress);

    actions.touchStart();
    actions.advance(500);
    actions.touchEnd();

    // 补发的那一次 click 被吞掉
    expect(actions.consumeLongPressClick()).toBe(true);
    // 用户随后点菜单外的地方关菜单：这一次 click 必须放行，不再被吞
    expect(actions.consumeLongPressClick()).toBe(false);

    actions.cleanup();
  });

  it("鼠标长按（无触摸）同样触发回调并拦截 click", () => {
    const onCoverLongPress = vi.fn();
    const actions = renderActions(onCoverLongPress);

    actions.mouseDown();
    actions.advance(500);
    actions.mouseUp();

    expect(onCoverLongPress).toHaveBeenCalledTimes(1);
    expect(actions.click()).toHaveBeenCalled();

    actions.cleanup();
  });
});
