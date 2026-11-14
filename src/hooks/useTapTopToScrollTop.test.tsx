import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scrollPageToTop = vi.fn(() => true);
const installSystemScrollToTopBridge = vi.fn(() => vi.fn());

vi.mock("@/lib/scroll-to-top", () => ({
  scrollPageToTop,
  installSystemScrollToTopBridge,
}));

const { useTapTopToScrollTop } = await import("./useTapTopToScrollTop");

function Probe({ enabled = true }: { enabled?: boolean }) {
  useTapTopToScrollTop(enabled);
  return null;
}

/** 派发一次带 isPrimary 的指针事件（jsdom 的 PointerEvent 不一定存在） */
function firePointer(type: "pointerdown" | "pointerup", x: number, y: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, "isPrimary", { value: true });
  window.dispatchEvent(event);
}

function tap(x: number, y: number) {
  firePointer("pointerdown", x, y);
  firePointer("pointerup", x, y);
}

describe("useTapTopToScrollTop", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let header: HTMLDivElement;

  beforeEach(() => {
    scrollPageToTop.mockClear();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    header = document.createElement("div");
    header.setAttribute("data-tap-top", "");
    const button = document.createElement("button");
    header.appendChild(button);
    document.body.appendChild(header);

    // jsdom 没有 elementFromPoint，按落点是否落在顶栏返回对应元素
    document.elementFromPoint = ((x: number, y: number) => {
      if (y > 200) return document.body;
      return x < 40 ? (header.firstElementChild as Element) : header;
    }) as typeof document.elementFromPoint;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    header.remove();
    root = undefined;
    container = undefined;
    document.body.innerHTML = "";
  });

  const render = (props: { enabled?: boolean } = {}) => {
    act(() => {
      root!.render(<Probe {...props} />);
    });
  };

  it("点击顶栏触发回到顶部", () => {
    render();
    act(() => tap(200, 120));
    expect(scrollPageToTop).toHaveBeenCalledTimes(1);
  });

  it("点击顶栏上的按钮不触发", () => {
    render();
    act(() => tap(10, 120));
    expect(scrollPageToTop).not.toHaveBeenCalled();
  });

  it("滑动不触发", () => {
    render();
    act(() => {
      firePointer("pointerdown", 200, 120);
      firePointer("pointerup", 200, 300);
    });
    expect(scrollPageToTop).not.toHaveBeenCalled();
  });

  it("点击列表区域不触发", () => {
    render();
    act(() => tap(200, 400));
    expect(scrollPageToTop).not.toHaveBeenCalled();
  });

  it("enabled 为 false 时不监听", () => {
    render({ enabled: false });
    act(() => tap(200, 120));
    expect(scrollPageToTop).not.toHaveBeenCalled();
  });
});
