import { useEffect, useRef, type RefObject } from "react";

/** 提前多少像素算「快到底了」 */
const PRELOAD_MARGIN = 240;
/** 轮询间隔：只读一次 rect，开销可忽略 */
const CHECK_INTERVAL = 400;

function findScrollParent(el: Element | null): Element | null {
  let node = el?.parentElement ?? null;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    const oy = style.overflowY;
    if (
      (oy === "auto" || oy === "scroll" || oy === "overlay") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * 「哨兵进入可视区就加载下一批」。
 *
 * 这里刻意不用 scroll 事件、也不用 IntersectionObserver：
 * - Capacitor WebView 里列表常常是「分页 pane 里再套 overflow 容器」，scroll
 *   事件不冒泡，挂在祖先上永远收不到；root 传错元素时 IntersectionObserver 也
 *   同样一直不回调（真机上实测就是「看得到『上滑加载更多』但怎么滑都不动」）。
 * - 改成定时读哨兵 rect 自己判可见，不依赖任何事件，嵌套多深都成立。
 *
 * @param sentinelRef 哨兵元素（「上滑加载更多」那一行）
 * @param rootRef 视口参照容器；传 null 时自动向上找最近的滚动祖先
 * @param enabled 是否启用（还有更多 && 不在加载中）
 * @param onLoadMore 加载下一批
 */
export function useLoadMoreOnVisible({
  sentinelRef,
  rootRef,
  enabled,
  onLoadMore,
}: {
  sentinelRef: RefObject<Element | null>;
  rootRef: RefObject<Element | null>;
  enabled: boolean;
  onLoadMore: () => void;
}) {
  const callbackRef = useRef(onLoadMore);
  useEffect(() => {
    callbackRef.current = onLoadMore;
  });

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;

    const check = () => {
      if (stopped) return;
      const el = sentinelRef.current;
      if (!el || !el.isConnected) return;

      const box = el.getBoundingClientRect();
      // 未挂载 / display:none 的面板 rect 全是 0，跳过
      if (box.width === 0 && box.height === 0) return;
      // 横向完全在屏幕外（分页 pane 还在隔壁页），不预加载
      if (box.right <= 0 || box.left >= window.innerWidth) return;

      const rootEl = rootRef.current ?? findScrollParent(el);
      const top = rootEl ? rootEl.getBoundingClientRect().top : 0;
      const bottom = rootEl
        ? rootEl.getBoundingClientRect().bottom
        : window.innerHeight;

      if (
        box.bottom >= top - PRELOAD_MARGIN &&
        box.top <= bottom + PRELOAD_MARGIN
      ) {
        callbackRef.current();
      }
    };

    // 挂载后立刻查一次：首屏不足一屏时哨兵本来就在可视区
    const raf = requestAnimationFrame(check);
    const timer = window.setInterval(check, CHECK_INTERVAL);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
    };
  }, [enabled, sentinelRef, rootRef]);
}
