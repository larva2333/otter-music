import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "@capacitor/keyboard";
import { useSearchBackClear } from "./useSearchBackClear";
import { useExitLayerStore } from "./useExitLayer";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })),
  },
}));

function Probe({
  focused,
  onClear,
  onDismiss,
}: {
  focused: boolean;
  onClear: () => void;
  onDismiss: () => void;
}) {
  useSearchBackClear({
    focused,
    value: "周杰伦",
    onClear,
    onDismiss,
  });
  return null;
}

describe("useSearchBackClear", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useExitLayerStore.setState({ stack: [] });
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("不监听 keyboardWillHide，收起键盘不会清空搜索", () => {
    act(() => {
      root.render(
        createElement(Probe, {
          focused: true,
          onClear: vi.fn(),
          onDismiss: vi.fn(),
        })
      );
    });

    // 点输入法收起按钮只派发 keyboardWillHide；hook 不应注册该监听，
    // 否则会把「收键盘看结果」误判成返回并清空搜索。
    expect(Keyboard.addListener).not.toHaveBeenCalled();
  });

  it("真正的返回键仍会清空内容并失焦", () => {
    vi.useFakeTimers();
    const onClear = vi.fn();
    const onDismiss = vi.fn();

    act(() => {
      root.render(createElement(Probe, { focused: true, onClear, onDismiss }));
    });
    // 等键盘弹出动画结束、退出层挂载
    act(() => vi.advanceTimersByTime(400));
    act(() => {
      useExitLayerStore.getState().handleExit();
    });

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
