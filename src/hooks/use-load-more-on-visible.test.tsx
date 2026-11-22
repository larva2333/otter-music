import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLoadMoreOnVisible } from "./use-load-more-on-visible";

function Harness({
  enabled,
  onLoadMore,
}: {
  enabled: boolean;
  onLoadMore: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useLoadMoreOnVisible({ sentinelRef, rootRef, enabled, onLoadMore });
  return (
    <div ref={rootRef}>
      <div ref={sentinelRef} data-testid="sentinel">
        加载更多
      </div>
    </div>
  );
}

/** 让 jsdom 里的 rect 可控：默认全 0，测试里再覆盖哨兵 */
function stubRect(el: Element, rect: Partial<DOMRect>) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
}

describe("useLoadMoreOnVisible", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("哨兵在可视区内就触发加载（不等 scroll 事件）", () => {
    const onLoadMore = vi.fn();
    act(() => root.render(<Harness enabled onLoadMore={onLoadMore} />));
    const sentinel = container.querySelector('[data-testid="sentinel"]')!;
    stubRect(sentinel, {
      top: 100,
      bottom: 140,
      left: 10,
      right: 300,
      width: 290,
      height: 40,
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onLoadMore).toHaveBeenCalled();
  });

  it("哨兵在可视区外不触发", () => {
    const onLoadMore = vi.fn();
    act(() => root.render(<Harness enabled onLoadMore={onLoadMore} />));
    const sentinel = container.querySelector('[data-testid="sentinel"]')!;
    // 视口按 jsdom 默认 innerHeight=768，此处放到 5000
    stubRect(sentinel, {
      top: 5000,
      bottom: 5040,
      left: 10,
      right: 300,
      width: 290,
      height: 40,
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("enabled=false 时完全不轮询", () => {
    const onLoadMore = vi.fn();
    act(() => root.render(<Harness enabled={false} onLoadMore={onLoadMore} />));
    const sentinel = container.querySelector('[data-testid="sentinel"]')!;
    stubRect(sentinel, {
      top: 100,
      bottom: 140,
      left: 10,
      right: 300,
      width: 290,
      height: 40,
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
