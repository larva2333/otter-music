import { useEffect, useRef, type TouchEvent } from "react";
import { lockAxis } from "./gesture-axis";

/** 切换 Tab 的最小水平位移 */
const SWIPE_THRESHOLD = 56;

/**
 * 双 Tab 的左右滑动切换手势。
 * 用项目统一的 lockAxis() 判主轴：横向占优才切 Tab，纵向滚动/抽屉下拉
 * 一律放行给子元素，避免和评论列表滚动、vaul 抽屉关闭手势冲突。
 */
export function useTabSwipe<T extends string>(options: {
  tabs: readonly T[];
  value: T;
  onChange: (tab: T) => void;
}) {
  const { tabs, value, onChange } = options;
  const stateRef = useRef<{
    startX: number;
    startY: number;
    axis: "none" | "x" | "y";
  } | null>(null);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      stateRef.current = null;
      return;
    }
    const t = e.touches[0];
    stateRef.current = { startX: t.clientX, startY: t.clientY, axis: "none" };
  };

  const onTouchMove = (e: TouchEvent) => {
    const state = stateRef.current;
    if (!state || state.axis === "y") return;
    const t = e.touches[0];
    if (!t) return;
    if (state.axis === "none") {
      const axis = lockAxis(t.clientX - state.startX, t.clientY - state.startY);
      state.axis = axis;
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    const state = stateRef.current;
    stateRef.current = null;
    if (!state || state.axis !== "x") return;

    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - state.startX;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;

    const idx = tabs.indexOf(valueRef.current);
    // 左滑 → 下一个 Tab；右滑 → 上一个 Tab
    const next = idx + (dx < 0 ? 1 : -1);
    if (next >= 0 && next < tabs.length) onChange(tabs[next]);
  };

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: () => {
      stateRef.current = null;
    },
  };
}
