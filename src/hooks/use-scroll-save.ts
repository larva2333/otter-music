// src/hooks/use-scroll-save.ts
import { useEffect, useLayoutEffect, useRef, useCallback } from "react";

export function useScrollSave(key: string, isDataReady: boolean) {
  const scrollRef = useRef<HTMLElement>(null);
  const retryCount = useRef(0);

  // 恢复位置逻辑
  const restore = useCallback(() => {
    const el = scrollRef.current;
    const saved = sessionStorage.getItem(key);
    if (!el || !saved || !isDataReady) return;

    const targetTop = Number(saved);

    // 核心：使用 requestAnimationFrame 并在高度不足时重试
    const attemptScroll = () => {
      // 如果当前可滚动高度小于保存的高度，说明 DOM 还没完全撑开
      if (
        el.scrollHeight < targetTop + el.clientHeight &&
        retryCount.current < 10
      ) {
        retryCount.current++;
        requestAnimationFrame(attemptScroll);
        return;
      }

      el.scrollTo({ top: targetTop, behavior: "instant" });
      retryCount.current = 0; // 重置
    };

    requestAnimationFrame(attemptScroll);
  }, [key, isDataReady]);

  // 监听滚动保存
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      // 只有在数据加载完毕后才保存，避免记录到 0
      if (isDataReady) {
        sessionStorage.setItem(key, String(el.scrollTop));
      }
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [key, isDataReady]);

  // 列表切换（key 变化）时同步定位滚动位置：
  // 有记录就直接落到原位置，没有就归零。不能先归零再靠 rAF 跳回去，否则切换瞬间会看到「闪一下」。
  useLayoutEffect(() => {
    const el = scrollRef.current;
    retryCount.current = 0;
    if (!el) return;
    const saved = sessionStorage.getItem(key);
    el.scrollTop = saved ? Number(saved) : 0;
  }, [key]);

  // 当数据就绪时触发恢复
  useEffect(() => {
    restore();
  }, [restore]);

  return { scrollRef };
}
