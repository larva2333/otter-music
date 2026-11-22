import { useEffect, useRef } from "react";
import {
  DIRECTION_RATIO,
  isDragSelecting,
  isInsideHorizontalScroller,
  isTextInputTarget,
  lockAxis,
} from "./gesture-axis";

/** 触发切换的最小水平位移（px） */
const SWIPE_THRESHOLD = 56;
/** 手势最长时长（ms），超过视为慢速拖动而不是「甩」 */
const MAX_DURATION = 700;

/** 跟手时页面位移相对手指位移的比例（阻尼，让页面略微滞后于手指） */
const FOLLOW_RATIO = 0.55;
/** 跟手最大位移占视口宽度的比例，避免露出过多空白 */
const FOLLOW_MAX_VIEWPORT = 0.42;
/** 松手后归位动画时长（ms） */
const SETTLE_DURATION = 260;

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
  /**
   * 滑到边界外时触发（第一个再右滑 → prev / 最后一个再左滑 → next）。
   * 用于把内部分类滑动「落到」底部导航 tab 级的切换。
   */
  onEdge?: (dir: "next" | "prev") => void;
  /**
   * 跟手时实际平移的元素。默认平移 target 元素本身。
   * 发现页传内容 wrapper（而不是滚动容器），避免跟手位移带动下拉刷新指示器。
   */
  followRef?: { current: HTMLElement | null };
  /**
   * 该方向是否允许跟手位移。用于链头/链尾这种「滑出去也没有下一页」的边界：
   * 返回 false 时该方向页面不跟手（松手判定与 onEdge 照旧），
   * 避免整页拖出去再弹回来。
   */
  canFollow?: (dir: "next" | "prev") => boolean;
  /** 关闭跟手位移（只保留松手切换判定），默认开启 */
  disableFollow?: boolean;
}

/**
 * 内容区左右滑动切换分类，滑动过程「跟手」。
 *
 * 跟手：锁定横向后，把 followRef 元素实时平移 dx * FOLLOW_RATIO（带阻尼），
 * 手指拖动时页面跟着走；松手未达阈值则平滑归位，达阈值则清除位移并触发切换，
 * 切换后的进入动画由调用方（根 tab 的 page-enter-* / 发现页的 Web Animations）接管。
 *
 * 与纵向滚动的共存方式：先锁定主轴——横向命中才 preventDefault 阻断纵向滚动，
 * 纵向命中后本次手势不再参与切换、也不平移页面。上下滚列表不会误切分类。
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
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    /** 当前跟手元素：显式 followRef 优先，否则用 target 本身 */
    const followEl = () => latest.current.followRef?.current ?? el;

    const clearSettleTimer = () => {
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
    };

    /**
     * 松手归位。animated=true 走 CSS 过渡平滑弹回；false 立即清除位移
     * （用于马上要切换的场景，避免旧页位移和新页进入动画叠加）。
     */
    const settle = (animated: boolean) => {
      clearSettleTimer();
      const node = followEl();
      if (!node) return;
      if (animated && !latest.current.disableFollow) {
        node.style.transition = `transform ${SETTLE_DURATION}ms cubic-bezier(0.32, 0.72, 0, 1)`;
        node.style.transform = "translateX(0px)";
        settleTimer = setTimeout(() => {
          node.style.transition = "";
          node.style.transform = "";
          settleTimer = null;
        }, SETTLE_DURATION + 20);
      } else {
        node.style.transition = "";
        node.style.transform = "";
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      // enabled 省略时视为开启
      if (latest.current.enabled === false) {
        tracking = false;
        return;
      }
      // 长按多选笔刷期间整段手势都归多选，不切分类
      if (isDragSelecting()) {
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
      // 新手势开始：取消上一次的归位动画，从当前 transform 继续跟手
      clearSettleTimer();
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
      // 长按在手势中途触发多选：之前可能已经跟手了一小段，先弹回再把手势交出去
      if (isDragSelecting()) {
        tracking = false;
        if (axis === "x") settle(true);
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      lastDx = dx;
      lastDy = dy;

      if (axis === "none") {
        // 与下拉刷新共用同一套判定：锁定后整段手势不再改主轴。
        // 横向占优才接管，纵向/上滑/斜滑一律放过，不跟手也不 preventDefault。
        axis = lockAxis(dx, dy);
        if (axis === "none") return;
      }
      if (axis !== "x") return;

      // 锁定横向后阻止纵向滚动，否则斜着划会把列表带着上下跑
      if (axis === "x" && event.cancelable) {
        event.preventDefault();
        if (!latest.current.disableFollow) {
          const node = followEl();
          if (node) {
            // 该方向没有下一页（链头/链尾）时保持不动：
            // 否则整页会被拖出去再弹回来，看着像页面自己抖了一下
            const dir: "next" | "prev" = dx < 0 ? "next" : "prev";
            const allowed = latest.current.canFollow?.(dir) ?? true;
            node.style.transition = "none";
            if (allowed) {
              const max = window.innerWidth * FOLLOW_MAX_VIEWPORT;
              const offset = Math.max(-max, Math.min(max, dx * FOLLOW_RATIO));
              node.style.transform = `translateX(${offset}px)`;
            } else {
              // 手势中途反向（先右后左）时把之前的位移一并撤回
              node.style.transform = "";
            }
          }
        }
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      if (axis !== "x") return;
      if (isDragSelecting()) {
        settle(true);
        return;
      }

      const touch = event.changedTouches[0];
      const dx = touch ? touch.clientX - startX : lastDx;
      const dy = touch ? touch.clientY - startY : lastDy;

      const threshold = latest.current.threshold ?? SWIPE_THRESHOLD;
      if (Date.now() - startAt > MAX_DURATION) {
        settle(true);
        return;
      }
      if (Math.abs(dx) < threshold) {
        settle(true);
        return;
      }
      if (Math.abs(dy) > Math.abs(dx) * DIRECTION_RATIO) {
        settle(true);
        return;
      }

      const { ids, activeId, onChange } = latest.current;
      const index = ids.indexOf(activeId);
      if (index === -1) {
        settle(true);
        return;
      }

      // 左滑（dx < 0）→ 下一个分类；右滑 → 上一个
      const nextIndex = dx < 0 ? index + 1 : index - 1;
      if (nextIndex < 0 || nextIndex >= ids.length) {
        // 边界外：归位后交给 tab 级滑动处理
        settle(true);
        latest.current.onEdge?.(dx < 0 ? "next" : "prev");
        return;
      }
      // 有效切换：立即清除跟手位移，让调用方的进入动画接管
      settle(false);
      onChange(ids[nextIndex]);
    };

    const handleTouchCancel = () => {
      if (!tracking) return;
      tracking = false;
      if (axis === "x") settle(true);
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      clearSettleTimer();
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [targetRef]);
}
