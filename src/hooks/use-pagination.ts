import { useState, useRef, useCallback, useEffect } from "react";

interface FetchResult<T> {
  items: T[];
  hasMore: boolean;
}

interface PaginationAdapter<T> {
  fetch: (offset: number) => Promise<FetchResult<T> | null>;
}

interface UsePaginationOptions<T> {
  adapter: PaginationAdapter<T>;
  getId: (item: T) => string | number;
  pageSize: number;
  enabled: boolean;
  onError?: (err: unknown, offset: number) => void;
}

export interface UsePaginationResult<T> {
  items: T[];
  loading: boolean;
  fetching: boolean;
  hasMore: boolean;
  offset: number;
  observerTargetRef: React.RefObject<HTMLDivElement | null>;
  /** 回到第一页重新加载；返回的 Promise 在数据请求结束后 resolve */
  reset: () => Promise<void>;
  restore: (data: { items: T[]; offset: number; hasMore: boolean }) => void;
}

export function usePagination<T>({
  adapter,
  getId,
  pageSize,
  enabled,
  onError,
}: UsePaginationOptions<T>): UsePaginationResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const observerTargetRef = useRef<HTMLDivElement>(null);
  const fetchingRef = useRef(false);
  /** 递增的请求序号：reset(force) 抢占后，旧请求的结果直接丢弃 */
  const fetchIdRef = useRef(0);

  const fetchPage = useCallback(
    async (currentOffset: number, force = false) => {
      // 并发保护仅用于无限滚动（loadNext 不会并发，由 observer 的 fetching 状态保证）；
      // force=true 时抢占进行中的请求，旧结果按序号失效丢弃
      if (fetchingRef.current && !force) return;
      const fetchId = ++fetchIdRef.current;
      fetchingRef.current = true;

      if (currentOffset === 0) {
        setLoading(true);
        setItems([]);
      }
      setFetching(true);

      try {
        const result = await adapter.fetch(currentOffset);
        if (fetchId !== fetchIdRef.current) return;
        if (result) {
          setItems((prev) => {
            const existingIds = new Set(prev.map(getId));
            const uniqueItems = result.items.filter(
              (item) => !existingIds.has(getId(item))
            );
            return currentOffset === 0
              ? result.items
              : [...prev, ...uniqueItems];
          });
          setHasMore(result.hasMore);
        } else {
          setHasMore(false);
        }
      } catch (err) {
        if (fetchId !== fetchIdRef.current) return;
        onError?.(err, currentOffset);
        setHasMore(false);
      } finally {
        if (fetchId === fetchIdRef.current) {
          setLoading(false);
          setFetching(false);
          fetchingRef.current = false;
        }
      }
    },
    [adapter, getId, onError]
  );

  const reset = useCallback(() => {
    setOffset(0);
    setHasMore(true);
    return fetchPage(0, true);
  }, [fetchPage]);

  const loadNext = useCallback(() => {
    const nextOffset = offset + pageSize;
    setOffset(nextOffset);
    fetchPage(nextOffset);
  }, [offset, pageSize, fetchPage]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const element = observerTargetRef.current;
    if (!enabled || !element || loading || fetching || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadNext();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, loading, fetching, hasMore, loadNext]);

  const restore = useCallback(
    (data: { items: T[]; offset: number; hasMore: boolean }) => {
      // 切分类时若还有上一类的请求在飞，抢先后其结果不再覆盖恢复的列表
      fetchIdRef.current++;
      fetchingRef.current = false;
      setItems(data.items);
      setOffset(data.offset);
      setHasMore(data.hasMore);
      setLoading(false);
      setFetching(false);
    },
    []
  );

  return {
    items,
    loading,
    fetching,
    hasMore,
    offset,
    observerTargetRef,
    reset,
    restore,
  };
}
