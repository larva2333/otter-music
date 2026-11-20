import { useEffect, useRef, useState } from "react";
import { isDragSelecting, lockAxis, type GestureAxis } from "./gesture-axis";

export type PullStatus = "idle" | "pulling" | "release" | "refreshing";

const DEFAULT_THRESHOLD = 56;
const MAX_PULL = 96;
const DAMPING = 0.5;

interface UsePullToRefreshOptions {
  /** 下拉到阈值松手时触发；可为异步，期间保持「刷新中」状态 */
  onRefresh: () => void | Promise<void>;
  /** 置 false 时手势完全不响应 */
  enabled?: boolean;
  /** 触发刷新的高度阈值（px） */
  threshold?: number;
}

interface PullTargetRef {
  current: HTMLElement | null;
}

/**
 * 纵向列表下拉刷新。
 *
 * 与 useSwipeCategories 共存：两者用同一个 lockAxis() 判定并锁定主轴——
 * 只有「从顶部向下拉」（scrollTop≈0、dy 为正且纵向占优）才接管。
 * 一旦锁定横向，本次手势彻底放手，后续再往下拉也不会冒出刷新指示器。
 * 长按多选的笔刷手势期间同样完全不响应。
 *
 * 指示器高度通过 ref 直接写 DOM，不随 touchmove 触发 React 重渲染；
 * 只有「下拉中/释放/刷新中」这几个低频状态切换才 setState。
 * 页面需把返回的 indicatorRef 挂到滚动容器内的第一个子元素上。
 */
export function usePullToRefresh(
  targetRef: PullTargetRef,
  {
    onRefresh,
    enabled = true,
    threshold = DEFAULT_THRESHOLD,
  }: UsePullToRefreshOptions
) {
  const [status, setStatus] = useState<PullStatus>("idle");
  const statusRef = useRef<PullStatus>("idle");
  const indicatorRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ onRefresh, enabled, threshold });

  useEffect(() => {
    latest.current = { onRefresh, enabled, threshold };
  });

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    let tracking = false;
    let startX = 0;
    let startY = 0;
    let axis: GestureAxis = "none";
    let distance = 0;

    const setIndicatorHeight = (height: number, animate: boolean) => {
      const indicator = indicatorRef.current;
      if (!indicator) return;
      indicator.style.transition = animate ? "height 200ms ease" : "none";
      indicator.style.height = `${height}px`;
    };

    const updateStatus = (next: PullStatus) => {
      if (statusRef.current === next) return;
      statusRef.current = next;
      setStatus(next);
    };

    const reset = (animate = true) => {
      distance = 0;
      setIndicatorHeight(0, animate);
      updateStatus("idle");
    };

    const handleStart = (event: TouchEvent) => {
      if (!latest.current.enabled || statusRef.current === "refreshing") return;
      if (isDragSelecting()) return;
      if (event.touches.length !== 1 || el.scrollTop > 1) return;
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      axis = "none";
      tracking = true;
      distance = 0;
    };

    const handleMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) return;
      // 长按在手势中途触发多选：指示器收起，整段手势交给多选笔刷
      if (isDragSelecting()) {
        tracking = false;
        if (distance > 0) reset(false);
        return;
      }
      const touch = event.touches[0];
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;

      // 和横滑用同一个主轴判定，且一旦锁定就不再改判：
      // 横向为主 → 交给 useSwipeCategories；上滑/斜滑 → 交给列表滚动。
      if (axis === "none") axis = lockAxis(dx, dy);
      if (axis === "none") return;
      if (axis !== "y" || dy <= 0) {
        tracking = false;
        if (distance > 0) reset(false);
        return;
      }
      if (el.scrollTop > 1) {
        tracking = false;
        reset(false);
        return;
      }

      distance = Math.min(MAX_PULL, dy * DAMPING);
      setIndicatorHeight(distance, false);
      updateStatus(
        distance >= latest.current.threshold ? "release" : "pulling"
      );
      // 阻止原生 overscroll 橡皮筋
      if (event.cancelable) event.preventDefault();
    };

    const handleEnd = async () => {
      if (!tracking) return;
      tracking = false;
      if (isDragSelecting()) {
        reset(true);
        return;
      }
      const shouldRefresh =
        distance >= latest.current.threshold && latest.current.enabled;
      if (!shouldRefresh) {
        reset(true);
        return;
      }

      updateStatus("refreshing");
      setIndicatorHeight(latest.current.threshold, true);
      try {
        await latest.current.onRefresh();
      } catch {
        // 刷新失败由调用方 toast 提示；这里只负责收起指示器
      } finally {
        reset(true);
      }
    };

    const handleCancel = () => {
      tracking = false;
      reset(true);
    };

    el.addEventListener("touchstart", handleStart, { passive: true });
    el.addEventListener("touchmove", handleMove, { passive: false });
    el.addEventListener("touchend", handleEnd, { passive: true });
    el.addEventListener("touchcancel", handleCancel, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleStart);
      el.removeEventListener("touchmove", handleMove);
      el.removeEventListener("touchend", handleEnd);
      el.removeEventListener("touchcancel", handleCancel);
    };
  }, [targetRef]);

  return { status, indicatorRef };
}
