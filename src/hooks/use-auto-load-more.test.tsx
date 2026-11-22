import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAutoLoadMore } from "./use-auto-load-more";

interface HarnessProps {
  hasMore: boolean;
  loading: boolean;
  contentKey: number;
  onLoadMore: () => void;
}

function Harness({ hasMore, loading, contentKey, onLoadMore }: HarnessProps) {
  const ref = useRef<HTMLDivElement>(null);
  useAutoLoadMore({
    containerRef: ref,
    hasMore,
    loading,
    onLoadMore,
    contentKey,
    prefetch: 320,
    throttle: 500,
  });
  return <div ref={ref} data-testid="scroll" />;
}

describe("useAutoLoadMore 上滑自动加载", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let scrollTop = 0;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    scrollTop = 0;
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.useRealTimers();
  });

  const render = (
    props: HarnessProps,
    size: { scrollHeight?: number; clientHeight?: number } = {}
  ) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Harness {...props} />));

    const el = container.querySelector(
      '[data-testid="scroll"]'
    ) as HTMLDivElement | null;
    if (!el) throw new Error("scroll container not found");

    Object.defineProperty(el, "scrollHeight", {
      value: size.scrollHeight ?? 1000,
      configurable: true,
    });
    Object.defineProperty(el, "clientHeight", {
      value: size.clientHeight ?? 600,
      configurable: true,
    });
    Object.defineProperty(el, "scrollTop", {
      get: () => scrollTop,
      configurable: true,
    });
    return el;
  };

  const scroll = (el: HTMLElement) => {
    act(() => {
      el.dispatchEvent(new Event("scroll"));
    });
  };

  it("滚动到接近底部触发加载", () => {
    const onLoadMore = vi.fn();
    const el = render({
      hasMore: true,
      loading: false,
      contentKey: 20,
      onLoadMore,
    });

    scrollTop = 300; // 距底部 100px
    scroll(el);

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("离底部还很远不触发", () => {
    const onLoadMore = vi.fn();
    const el = render({
      hasMore: true,
      loading: false,
      contentKey: 20,
      onLoadMore,
    });

    scrollTop = 0; // 距底部 400px
    scroll(el);

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("没有更多数据时不触发", () => {
    const onLoadMore = vi.fn();
    const el = render({
      hasMore: false,
      loading: false,
      contentKey: 20,
      onLoadMore,
    });

    scrollTop = 400;
    scroll(el);

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("加载中不重复触发", () => {
    const onLoadMore = vi.fn();
    const el = render({
      hasMore: true,
      loading: true,
      contentKey: 20,
      onLoadMore,
    });

    scrollTop = 400;
    scroll(el);

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("节流窗口内连续滚动只触发一次", () => {
    const onLoadMore = vi.fn();
    const el = render({
      hasMore: true,
      loading: false,
      contentKey: 20,
      onLoadMore,
    });

    // 先让挂载时那次贴底检测跑完（当前位置不贴底，不会触发）
    act(() => {
      vi.advanceTimersByTime(50);
    });

    scrollTop = 400;
    scroll(el);
    scroll(el);
    scroll(el);

    expect(onLoadMore).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(600);
    });
    scroll(el);

    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("内容不足一屏（根本没有 scroll 事件）时按 contentKey 补一次检测", () => {
    const onLoadMore = vi.fn();
    // 内容 700px、视口 600px：贴底但没有可滚动距离
    render(
      { hasMore: true, loading: false, contentKey: 0, onLoadMore },
      { scrollHeight: 700, clientHeight: 600 }
    );

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // 同一 contentKey 不再重复补（避免失败后无限重试）
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});

describe("useAutoLoadMore 容器延迟挂载", () => {
  let container: HTMLDivElement;
  let root: Root;

  /** 首帧渲染骨架屏（无滚动容器），ready 翻转后才挂真实容器 */
  function DelayedHarness({
    ready,
    onLoadMore,
  }: {
    ready: boolean;
    onLoadMore: () => void;
  }) {
    const ref = useRef<HTMLDivElement>(null);
    useAutoLoadMore({
      containerRef: ref,
      ready,
      hasMore: true,
      loading: false,
      contentKey: 10,
      onLoadMore,
    });
    return ready ? <div ref={ref} data-testid="scroll" /> : <div>骨架屏</div>;
  }

  beforeEach(() => {
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
  });

  it("容器从骨架屏挂载后，滚动监听重新绑定，上滑能触发加载", () => {
    const onLoadMore = vi.fn();

    // 首帧：容器不存在
    act(() =>
      root.render(<DelayedHarness ready={false} onLoadMore={onLoadMore} />)
    );
    expect(container.querySelector('[data-testid="scroll"]')).toBeNull();

    // ready 翻转：真实容器挂载
    act(() =>
      root.render(<DelayedHarness ready={true} onLoadMore={onLoadMore} />)
    );
    const el = container.querySelector(
      '[data-testid="scroll"]'
    ) as HTMLDivElement;
    expect(el).not.toBeNull();
    Object.defineProperty(el, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(el, "clientHeight", {
      value: 600,
      configurable: true,
    });
    Object.defineProperty(el, "scrollTop", {
      get: () => 300,
      configurable: true,
    });

    act(() => el.dispatchEvent(new Event("scroll")));

    expect(onLoadMore).toHaveBeenCalled();
  });
});
