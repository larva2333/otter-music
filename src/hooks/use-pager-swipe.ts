import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import {
  isDragSelecting,
  isInsideHorizontalScroller,
  isInsideNowPlayingSwipeGuard,
  isTextInputTarget,
  lockAxis,
} from "./gesture-axis";
import { useRootPager, type RootTabId } from "./use-root-pager";

/** 触发翻页的最小水平位移（px） */
const SWIPE_THRESHOLD = 56;
/** 快速轻扫的最小位移（px） */
const FLING_DISTANCE = 40;
/** 快速轻扫的时长上限（ms） */
const FLING_DURATION = 260;
/** 无根级容器兜底时，边缘拖拽的阻尼 */
const EDGE_DAMPING = 0.6;
/** 内容轨道归位 / 翻页过渡（ms） */
const TRACK_SETTLE = 280;
/** 整页边缘滑出的过渡（ms） */
const EDGE_SETTLE = 260;

const TRACK_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

interface UsePagerSwipeOptions {
  /** 页数（单页可传 1，此时所有横向滑动均视为边缘滑动） */
  count: number;
  /** 当前页索引 */
  index: number;
  /** 翻到目标页 */
  onChange: (index: number) => void;
  /** 到达第一页再右滑 / 最后一页再左滑时的兜底回调（无 RootPagerContext 时使用） */
  onEdge?: (dir: "next" | "prev") => void;
  /** 手势锁定方向后，提前挂载即将露出的相邻页 */
  onNeighborIntent?: (index: number) => void;
  /** 页内横向跟手拖动进度：ratio ∈ [-1, 1]，负值为向左（上一页），正值为向右（下一页） */
  onTrackDrag?: (index: number, ratio: number) => void;
  /** 松手滑行归位/翻页或退出内部拖动时触发，供顶部指示器同步同曲线动画 */
  onTrackSettle?: (targetIndex: number, animate: boolean) => void;
  /** 当前所属根 Tab；传入且在 RootPagerContext 内时，边缘滑动直接联动根级轨道 */
  rootTab?: RootTabId;
  /**
   * 本页当前是否处于激活可见态（默认 true）。
   * 为 false 时，来自外部的对齐切页瞬时落位、不播轨道过渡动画。
   */
  isPageActive?: boolean;
  /** 置 false 时完全禁用手势 */
  enabled?: boolean;
}

interface PagerRefs {
  /** 裁剪/手势接收窗口：overflow-hidden，宽度即一页的宽度 */
  viewportRef: RefObject<HTMLElement | null>;
  /** 内容轨道：多页横向排列，translateX 翻页；单页可不传 */
  trackRef?: RefObject<HTMLElement | null>;
  /** 整页舞台（无 RootPagerContext 时的边缘滑出兜底） */
  stageRef?: RefObject<HTMLElement | null>;
}

/** 读取元素当前的 translateX（computed transform 的 m41） */
export function readTranslateX(el: HTMLElement): number {
  const value = window.getComputedStyle(el).transform;
  if (!value || value === "none") return 0;
  const matrix = value.match(/matrix\(([^)]+)\)/);
  if (matrix) {
    const parts = matrix[1].split(",").map(Number);
    return Number.isFinite(parts[4]) ? parts[4] : 0;
  }
  const matrix3d = value.match(/matrix3d\(([^)]+)\)/);
  if (matrix3d) {
    const parts = matrix3d[1].split(",").map(Number);
    return Number.isFinite(parts[12]) ? parts[12] : 0;
  }
  return 0;
}

/**
 * 统一的「页面内横向真分页 + 边缘整页联动」手势 hook。
 *
 * 性能设计：
 * - 松手翻页时先由 GPU 合成线程跑完 280ms 滑行过渡，动画结束后再回调 onChange，
 *   避免滑行前 100ms 被 React 重渲染与布局测量抢占主线程导致掉帧；
 * - 若动画途中用户再次触摸，立即 flush 待提交的页索引并从当前位置平滑接续；
 * - 缓存视口宽度，仅在锁定横向时检测内部横向滚动容器，避免触碰和纵滑时的同步重排。
 */
export function usePagerSwipe(
  { viewportRef, trackRef, stageRef }: PagerRefs,
  options: UsePagerSwipeOptions
) {
  const rootPager = useRootPager();
  const rootPagerRef = useRef(rootPager);
  useEffect(() => {
    rootPagerRef.current = rootPager;
  }, [rootPager]);

  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const indexRef = useRef(options.index);
  useEffect(() => {
    indexRef.current = options.index;
  }, [options.index]);

  const draggingRef = useRef(false);
  const widthRef = useRef(0);
  const trackAnimatingUntilRef = useRef(0);
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingChangeIndexRef = useRef<number | null>(null);
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPositionRef = useRef(true);

  const clearNavTimer = () => {
    if (navTimerRef.current !== null) {
      clearTimeout(navTimerRef.current);
      navTimerRef.current = null;
    }
  };

  /** 轨道停在第 index 页的位置 */
  const trackBase = (index: number, width: number) => -index * width;

  const applyTrack = (
    node: HTMLElement | null | undefined,
    offset: number,
    animate: boolean
  ) => {
    if (!node) return;
    trackAnimatingUntilRef.current = animate ? Date.now() + TRACK_SETTLE : 0;
    node.style.transition = animate
      ? `transform ${TRACK_SETTLE}ms ${TRACK_EASING}`
      : "none";
    node.style.transform = `translate3d(${offset}px, 0, 0)`;
  };

  const applyStage = (
    node: HTMLElement | null | undefined,
    offset: number,
    animate: boolean
  ) => {
    if (!node) return;
    node.style.transition = animate
      ? `transform ${EDGE_SETTLE}ms ${TRACK_EASING}`
      : "none";
    node.style.transform = `translate3d(${offset}px, 0, 0)`;
  };

  // 首次定位 + 尺寸变化时重新对齐（手机旋转、分屏、延迟挂载）。
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef?.current;
    if (!viewport || options.enabled === false) {
      firstPositionRef.current = true;
      return;
    }

    const align = () => {
      const measured = viewport.clientWidth;
      if (measured > 0) widthRef.current = measured;
      const width = measured || window.innerWidth;
      if (!width) return;
      if (draggingRef.current) return;
      const animate =
        !firstPositionRef.current && latest.current.isPageActive !== false;
      firstPositionRef.current = false;
      applyTrack(track, trackBase(indexRef.current, width), animate);
      applyStage(stageRef?.current, 0, false);
    };

    align();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(align);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [stageRef, trackRef, viewportRef, options.enabled]);

  // 点 tab / 再次点击底部 tab / 外部对齐：翻到新的一页
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef?.current;
    if (!viewport || !track || draggingRef.current || options.enabled === false)
      return;
    const measured = viewport.clientWidth;
    if (measured > 0) widthRef.current = measured;
    const width = widthRef.current || measured || window.innerWidth;
    if (!width) return;
    const targetX = trackBase(options.index, width);
    // 如果松手滑行动画已经把轨道滑到位（延迟后触发 onChange），不再重设 transition 造成二次抖动
    if (
      Math.abs(readTranslateX(track) - targetX) < 1 &&
      Date.now() >= trackAnimatingUntilRef.current
    ) {
      applyTrack(track, targetX, false);
      firstPositionRef.current = false;
      return;
    }
    const animate =
      !firstPositionRef.current && latest.current.isPageActive !== false;
    applyTrack(track, targetX, animate);
  }, [options.index, options.count, trackRef, viewportRef, options.enabled]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || options.enabled === false) return;

    let tracking = false;
    let axis: "none" | "x" | "y" = "none";
    let startX = 0;
    let startY = 0;
    let startAt = 0;
    let width = 0;
    let trackStart = 0;
    let stageStart = 0;
    let rootDragStart = 0;
    let touchTarget: Element | null = null;
    let edgeActive = false;
    let edgeDir: 1 | -1 = 1;
    let wasEdge = false;
    let usedRootEdge = false;
    let preparedRootDir: "next" | "prev" | null = null;
    let lastIntent = -1;

    const clearChangeTimer = () => {
      if (changeTimerRef.current !== null) {
        clearTimeout(changeTimerRef.current);
        changeTimerRef.current = null;
      }
    };

    const flushPendingChange = () => {
      clearChangeTimer();
      const pending = pendingChangeIndexRef.current;
      if (pending !== null) {
        pendingChangeIndexRef.current = null;
        if (pending !== indexRef.current) {
          indexRef.current = pending;
          latest.current.onChange(pending);
        }
      }
    };

    const resetVisual = (animate: boolean) => {
      const w =
        width || widthRef.current || viewport.clientWidth || window.innerWidth;
      applyTrack(trackRef?.current, trackBase(indexRef.current, w), animate);
      applyStage(stageRef?.current, 0, animate);
      latest.current.onTrackSettle?.(indexRef.current, animate);
      if (usedRootEdge) {
        rootPagerRef.current?.cancelRootDrag(animate);
        usedRootEdge = false;
      }
      preparedRootDir = null;
      draggingRef.current = false;
    };

    const handleStart = (event: TouchEvent) => {
      if (latest.current.enabled === false) {
        tracking = false;
        return;
      }
      if (event.touches.length !== 1 || isDragSelecting()) {
        tracking = false;
        return;
      }
      const touch = event.touches[0];
      const target = (touch.target ?? event.target) as Element | null;
      if (
        isTextInputTarget(target) ||
        isInsideNowPlayingSwipeGuard(touch.clientY, target)
      ) {
        tracking = false;
        return;
      }

      // 如果上一轮翻页滑行动画还在收尾，先落定待提交的新索引再接续拖动
      flushPendingChange();

      tracking = true;
      axis = "none";
      startX = touch.clientX;
      startY = touch.clientY;
      startAt = Date.now();
      touchTarget = target;
      width =
        widthRef.current || viewport.clientWidth || window.innerWidth || 0;
      if (viewport.clientWidth > 0) widthRef.current = viewport.clientWidth;
      const track = trackRef?.current;
      const animating = Date.now() < trackAnimatingUntilRef.current;
      trackStart =
        track && animating
          ? readTranslateX(track)
          : trackBase(indexRef.current, width);
      stageStart = stageRef?.current ? readTranslateX(stageRef.current) : 0;
      const rp = rootPagerRef.current;
      rootDragStart = rp && latest.current.rootTab ? rp.getRootDragOffset() : 0;
      edgeActive = false;
      wasEdge = false;
      usedRootEdge = false;
      preparedRootDir = null;
      lastIntent = -1;
    };

    const handleMove = (event: TouchEvent) => {
      if (!tracking) return;
      if (isDragSelecting() || latest.current.enabled === false) {
        tracking = false;
        if (axis === "x") resetVisual(true);
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (axis === "none") {
        axis = lockAxis(dx, dy);
        if (axis === "none") return;
        if (axis === "y") {
          tracking = false;
          return;
        }
        // 只在横向锁定时查一次内部横向滚动容器，避免点击和纵滑时触发强制布局
        if (isInsideHorizontalScroller(touchTarget, viewport)) {
          tracking = false;
          axis = "none";
          return;
        }
        draggingRef.current = true;
        trackAnimatingUntilRef.current = 0;
        if (trackRef?.current) trackRef.current.style.transition = "none";
        if (stageRef?.current) stageRef.current.style.transition = "none";
      }

      if (event.cancelable) event.preventDefault();

      const effectiveDx = dx;
      const dir: 1 | -1 = effectiveDx < 0 ? 1 : -1;
      const dirStr: "next" | "prev" = dir === 1 ? "next" : "prev";
      const targetIndex = indexRef.current + dir;
      const isEdge = targetIndex < 0 || targetIndex >= latest.current.count;
      edgeActive = isEdge;
      edgeDir = dir;

      if (isEdge) {
        if (!wasEdge && trackRef?.current) {
          applyTrack(
            trackRef.current,
            trackBase(indexRef.current, width),
            false
          );
          latest.current.onTrackSettle?.(indexRef.current, false);
        }
        wasEdge = true;

        const rp = rootPagerRef.current;
        const rootTab = latest.current.rootTab;

        if (rp && rootTab) {
          if (rp.canSlideEdge(rootTab, dirStr)) {
            if (preparedRootDir !== dirStr) {
              preparedRootDir = dirStr;
              rp.prepareEdgeNeighbor(rootTab, dirStr);
            }
            usedRootEdge = true;
            const rawOffset = rootDragStart + effectiveDx;
            const canPrev = rp.canSlideEdge(rootTab, "prev");
            const canNext = rp.canSlideEdge(rootTab, "next");
            const clampedOffset =
              !canPrev && rawOffset > 0
                ? 0
                : !canNext && rawOffset < 0
                  ? 0
                  : rawOffset;
            rp.dragRootBy(clampedOffset);
          } else if (usedRootEdge) {
            rp.dragRootBy(0);
          }
          return;
        }

        if (latest.current.onEdge) {
          applyStage(
            stageRef?.current,
            stageStart + effectiveDx * EDGE_DAMPING,
            false
          );
        }
        return;
      }

      if (wasEdge) {
        applyStage(stageRef?.current, 0, false);
        if (usedRootEdge) {
          rootPagerRef.current?.cancelRootDrag(false);
          usedRootEdge = false;
        }
        preparedRootDir = null;
        trackStart = trackBase(indexRef.current, width);
      }
      wasEdge = false;
      if (lastIntent !== targetIndex) {
        lastIntent = targetIndex;
        latest.current.onNeighborIntent?.(targetIndex);
      }
      const nextTrackOffset = trackStart + effectiveDx;
      applyTrack(trackRef?.current, nextTrackOffset, false);
      if (width > 0 && latest.current.onTrackDrag) {
        const base = trackBase(indexRef.current, width);
        const ratio = Math.max(
          -1,
          Math.min(1, (base - nextTrackOffset) / width)
        );
        latest.current.onTrackDrag(indexRef.current, ratio);
      }
    };

    const handleEnd = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      if (axis !== "x") return;

      const touch = event.changedTouches[0];
      const dx = touch ? touch.clientX - startX : 0;
      const duration = Date.now() - startAt;
      const passed =
        Math.abs(dx) >= SWIPE_THRESHOLD ||
        (duration < FLING_DURATION && Math.abs(dx) >= FLING_DISTANCE);

      draggingRef.current = false;

      if (edgeActive) {
        const dirStr: "next" | "prev" = edgeDir === 1 ? "next" : "prev";
        const rp = rootPagerRef.current;
        const rootTab = latest.current.rootTab;

        if (rp && rootTab) {
          const canSlide = rp.canSlideEdge(rootTab, dirStr);
          if (canSlide && passed) {
            if (preparedRootDir !== dirStr) {
              rp.prepareEdgeNeighbor(rootTab, dirStr);
            }
            rp.commitRootEdge(rootTab, dirStr);
          } else if (usedRootEdge) {
            rp.cancelRootDrag(true);
          }
          usedRootEdge = false;
          preparedRootDir = null;
          return;
        }

        if (latest.current.onEdge && passed) {
          const target = edgeDir === 1 ? -width : width;
          applyStage(stageRef?.current, target, true);
          const dir = edgeDir;
          clearNavTimer();
          navTimerRef.current = setTimeout(() => {
            navTimerRef.current = null;
            latest.current.onEdge?.(dir === 1 ? "next" : "prev");
          }, EDGE_SETTLE);
        } else {
          applyStage(stageRef?.current, 0, true);
        }
        return;
      }

      const current = indexRef.current;
      const target = passed ? current + (dx < 0 ? 1 : -1) : current;
      const currentWidth =
        width || widthRef.current || viewport.clientWidth || window.innerWidth;
      applyTrack(trackRef?.current, trackBase(target, currentWidth), true);
      latest.current.onTrackSettle?.(target, true);
      if (target !== current) {
        clearChangeTimer();
        pendingChangeIndexRef.current = target;
        // 先让 GPU 跑完 280ms 滑行过渡，再回调 React 更新状态，避免起跑期掉帧
        changeTimerRef.current = setTimeout(() => {
          changeTimerRef.current = null;
          const next = pendingChangeIndexRef.current;
          pendingChangeIndexRef.current = null;
          if (next !== null && next !== indexRef.current) {
            indexRef.current = next;
            latest.current.onChange(next);
          }
        }, TRACK_SETTLE);
      }
    };

    const handleCancel = () => {
      if (!tracking) return;
      tracking = false;
      if (axis === "x") resetVisual(true);
    };

    viewport.addEventListener("touchstart", handleStart, { passive: true });
    viewport.addEventListener("touchmove", handleMove, { passive: false });
    viewport.addEventListener("touchend", handleEnd, { passive: true });
    viewport.addEventListener("touchcancel", handleCancel, { passive: true });

    return () => {
      clearNavTimer();
      clearChangeTimer();
      viewport.removeEventListener("touchstart", handleStart);
      viewport.removeEventListener("touchmove", handleMove);
      viewport.removeEventListener("touchend", handleEnd);
      viewport.removeEventListener("touchcancel", handleCancel);
    };
  }, [stageRef, trackRef, viewportRef, options.enabled]);
}
