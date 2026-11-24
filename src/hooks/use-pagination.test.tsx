import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { usePagination } from "./use-pagination";

type Item = { id: number };

describe("usePagination 触底追加", () => {
  let observerCb: IntersectionObserverCallback | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    observerCb = null;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IntersectionObserverCallback) {
          observerCb = cb;
        }
        observe() {}
        disconnect() {}
      }
    );
  });

  const containers: Array<{
    root: ReturnType<typeof createRoot>;
    el: HTMLElement;
  }> = [];
  afterEach(() => {
    containers.splice(0).forEach(({ root, el }) => {
      act(() => root.unmount());
      el.remove();
    });
    vi.unstubAllGlobals();
  });

  const render = (
    fetchImpl: (
      offset: number
    ) => Promise<{ items: Item[]; hasMore: boolean } | null>
  ) => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    let api: ReturnType<typeof usePagination<Item>> | null = null;
    const fetch = vi.fn(fetchImpl);

    function Harness() {
      const pagination = usePagination<Item>({
        adapter: { fetch },
        getId: (item) => item.id,
        pageSize: 12,
        enabled: true,
      });
      useEffect(() => {
        api = pagination;
      });
      useEffect(() => {
        void pagination.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div ref={pagination.observerTargetRef} />;
    }
    act(() => root.render(<Harness />));
    containers.push({ root, el });

    return {
      fetch,
      get: () => api!,
      reachBottom: async () => {
        await act(async () => {
          observerCb!(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver
          );
          await Promise.resolve();
        });
      },
      reset: async () => {
        await act(async () => {
          await api!.reset();
        });
      },
    };
  };

  const page = (from: number, count = 12, hasMore = true) => ({
    items: Array.from({ length: count }, (_, i) => ({ id: from + i })),
    hasMore,
  });

  it("触底追加下一页并按 id 去重", async () => {
    const h = render(async (offset) => page(offset));
    await act(async () => {});
    expect(h.get().items).toHaveLength(12);

    await h.reachBottom();
    expect(h.fetch).toHaveBeenLastCalledWith(12);
    expect(h.get().items).toHaveLength(24);
    expect(h.get().items[0].id).toBe(0);
    expect(h.get().offset).toBe(12);
  });

  it("重复 id 不会重复渲染", async () => {
    const h = render(async (offset) =>
      offset === 0
        ? page(0)
        : { items: [{ id: 0 }, ...page(12).items.slice(1)], hasMore: true }
    );
    await act(async () => {});
    await h.reachBottom();
    // 第二页第一条与第一页重复，追加后应是 23 条
    expect(h.get().items).toHaveLength(23);
  });

  it("reset 回到第一页并清空旧数据", async () => {
    const h = render(async (offset) => page(offset));
    await act(async () => {});
    await h.reachBottom();
    expect(h.get().items).toHaveLength(24);

    await h.reset();
    expect(h.fetch).toHaveBeenLastCalledWith(0);
    expect(h.get().items).toHaveLength(12);
    expect(h.get().offset).toBe(0);
  });

  it("restore 按快照恢复并丢弃在途请求", async () => {
    let resolveFirst!: (value: { items: Item[]; hasMore: boolean }) => void;
    const h = render((offset) =>
      offset === 0
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve(page(offset))
    );
    await act(async () => {});

    act(() => {
      h.get().restore({ items: [{ id: 99 }], offset: 24, hasMore: true });
    });
    expect(h.get().offset).toBe(24);
    expect(h.get().items[0].id).toBe(99);

    await act(async () => {
      resolveFirst(page(0));
      await Promise.resolve();
    });
    expect(h.get().items[0].id).toBe(99);
  });
});
