import { useEffect, useRef, type RefObject } from "react";

/** 距底部多少像素开始预取下一页 */
const DEFAULT_PREFETCH = 320;
/** 两次自动加载之间的最小间隔（ms），防止连续 scroll 事件打出重复请求 */
const DEFAULT_THROTTLE = 500;

interface UseAutoLoadMoreOptions {
  /** 滚动容器 */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * 容器是否已挂载到 DOM。骨架屏占位时 ref.current 为 null，effect 首帧读不到
   * 容器；之后容器出现但依赖里没有任何变化，监听就永远绑不上。传一个随容器
   * 挂载而翻转的值（如 tab 是否 visited），让 effect 在容器出现后重跑。
   */
  ready?: boolean;
  enabled?: boolean;
  hasMore?: boolean;
  loading?: boolean;
  onLoadMore?: () => void;
  /** 内容标识（如列表长度）：变化后补一次贴底检测，内容不足一屏时也能继续加载 */
  contentKey?: string | number;
  prefetch?: number;
  throttle?: number;
}

/**
 * 滚动到接近底部时自动加载下一页（移动端「上滑加载」）。
 *
 * 两路触发：
 * 1. scroll 事件：用户上滑到底部附近时立即触发，按 throttle 节流；
 * 2. contentKey 变化：数据回来后补一次贴底检测。内容不足一屏时不会有 scroll 事件，
 *    只靠 1 会永远停在第一页。同一个 contentKey 只补一次，避免请求失败后无限重试。
 */
export function useAutoLoadMore({
  containerRef,
  ready = true,
  enabled = true,
  hasMore,
  loading,
  onLoadMore,
  contentKey,
  prefetch = DEFAULT_PREFETCH,
  throttle = DEFAULT_THROTTLE,
}: UseAutoLoadMoreOptions) {
  const stateRef = useRef({ hasMore, loading, onLoadMore });
  useEffect(() => {
    stateRef.current = { hasMore, loading, onLoadMore };
  });

  const lastTriggerAtRef = useRef(0);
  const lastContentKeyRef = useRef<string | number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    const maybeLoad = () => {
      const {
        hasMore: more,
        loading: busy,
        onLoadMore: load,
      } = stateRef.current;
      if (!more || busy || !load) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight > prefetch) return;

      const now = Date.now();
      if (
        lastTriggerAtRef.current !== 0 &&
        now - lastTriggerAtRef.current < throttle
      ) {
        return;
      }
      lastTriggerAtRef.current = now;
      load();
    };

    el.addEventListener("scroll", maybeLoad, { passive: true });
    return () => el.removeEventListener("scroll", maybeLoad);
  }, [enabled, ready, containerRef, prefetch, throttle]);

  useEffect(() => {
    if (!enabled || !hasMore || loading) return;
    const el = containerRef.current;
    if (!el || lastContentKeyRef.current === contentKey) return;
    lastContentKeyRef.current = contentKey;

    const raf = requestAnimationFrame(() => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= prefetch) {
        stateRef.current.onLoadMore?.();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [enabled, ready, hasMore, loading, contentKey, containerRef, prefetch]);
}
