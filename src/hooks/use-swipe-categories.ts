import { useEffect, useRef } from "react";

/** 触发切换的最小水平位移（px） */
const SWIPE_THRESHOLD = 56;
/** 手势最长时长（ms），超过视为慢速拖动而不是「甩」 */
const MAX_DURATION = 700;
/** 判定主轴方向前需要越过的最小位移（px） */
const AXIS_LOCK_DISTANCE = 10;
/** 主轴相对副轴的最小倍数：斜着上下滚列表时不误触切换 */
const DIRECTION_RATIO = 1.2;
/** 横向可滚动容器的判定余量（px） */
const SCROLLER_SLACK = 4;

type Axis = "none" | "x" | "y";

interface UseSwipeCategoriesOptions {
  /** 可切换的分类 id 序列（顺序即切换顺序） */
  ids: string[];
  /** 当前分类 id */
  activeId: string;
  /** 切换到目标分类 */
  onChange: (id: string) => void;
  /** 置 false 时手势完全不响应 */
  enabled?: boolean;
  /** 自定义触发阈值（px） */
  threshold?: number;
}

/**
 * 触摸点是否落在「内部可横向滚动」的元素里。
 * 例如横向滚动的卡片行、分类子 tab：这些地方的横滑应交给元素自己，
 * 不能拿来切分类。
 */
function isInsideHorizontalScroller(
  target: Element | null,
  root: HTMLElement
): boolean {
  let node: Element | null = target;
  while (node && node !== root) {
    const overflowX = window.getComputedStyle(node).overflowX;
    const scrollable = overflowX === "auto" || overflowX === "scroll";
    if (scrollable && node.scrollWidth > node.clientWidth + SCROLLER_SLACK) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/** 输入控件上的滑动留给系统（移动光标 / 选中文本），不参与切分类 */
function isTextInputTarget(target: Element | null): boolean {
  if (!target || typeof target.closest !== "function") return false;
  return Boolean(target.closest("input, textarea, select"));
}

/**
 * 内容区左右滑动切换分类。
 *
 * 与纵向滚动的共存方式：先锁定主轴——横向命中才 preventDefault 阻断纵向滚动，
 * 纵向命中后本次手势不再参与切换。因此上下滚列表不会误切分类。
 */
export function useSwipeCategories(
  targetRef: { current: HTMLElement | null },
  options: UseSwipeCategoriesOptions
) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    let tracking = false;
    let axis: Axis = "none";
    let startX = 0;
    let startY = 0;
    let startAt = 0;
    let lastDx = 0;
    let lastDy = 0;

    const handleTouchStart = (event: TouchEvent) => {
      // enabled 省略时视为开启
      if (latest.current.enabled === false) {
        tracking = false;
        return;
      }
      // 多指手势（缩放等）不参与
      if (event.touches.length !== 1) {
        tracking = false;
        return;
      }
      const touch = event.touches[0];
      const target = touch.target as Element | null;
      if (isTextInputTarget(target)) {
        tracking = false;
        return;
      }
      if (isInsideHorizontalScroller(target, el)) {
        tracking = false;
        return;
      }
      tracking = true;
      axis = "none";
      startX = touch.clientX;
      startY = touch.clientY;
      startAt = Date.now();
      lastDx = 0;
      lastDy = 0;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      lastDx = dx;
      lastDy = dy;

      if (axis === "none") {
        if (
          Math.abs(dx) < AXIS_LOCK_DISTANCE &&
          Math.abs(dy) < AXIS_LOCK_DISTANCE
        ) {
          return;
        }
        axis = Math.abs(dx) > Math.abs(dy) * DIRECTION_RATIO ? "x" : "y";
      }

      // 锁定横向后阻止纵向滚动，否则斜着划会把列表带着上下跑
      if (axis === "x" && event.cancelable) {
        event.preventDefault();
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      if (axis !== "x") return;

      const touch = event.changedTouches[0];
      const dx = touch ? touch.clientX - startX : lastDx;
      const dy = touch ? touch.clientY - startY : lastDy;

      const threshold = latest.current.threshold ?? SWIPE_THRESHOLD;
      if (Date.now() - startAt > MAX_DURATION) return;
      if (Math.abs(dx) < threshold) return;
      if (Math.abs(dy) > Math.abs(dx) * DIRECTION_RATIO) return;

      const { ids, activeId, onChange } = latest.current;
      const index = ids.indexOf(activeId);
      if (index === -1) return;

      // 左滑（dx < 0）→ 下一个分类；右滑 → 上一个
      const nextIndex = dx < 0 ? index + 1 : index - 1;
      if (nextIndex < 0 || nextIndex >= ids.length) return;
      onChange(ids[nextIndex]);
    };

    const handleTouchCancel = () => {
      tracking = false;
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [targetRef]);
}
