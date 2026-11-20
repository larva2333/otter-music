import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import {
  isDragSelecting,
  isInsideHorizontalScroller,
  isTextInputTarget,
  lockAxis,
} from "./gesture-axis";

/** 触发翻页的最小水平位移（px） */
const SWIPE_THRESHOLD = 56;
/** 快速轻扫的最小位移（px） */
const FLING_DISTANCE = 40;
/** 快速轻扫的时长上限（ms） */
const FLING_DURATION = 260;
/** 边缘拖拽的阻尼：整页跟手，但比页内翻页略「重」，有到头的感觉 */
const EDGE_DAMPING = 0.6;
/** 内容轨道归位 / 翻页过渡（ms） */
const TRACK_SETTLE = 320;
/** 整页边缘滑出的过渡（ms） */
const EDGE_SETTLE = 260;
/** 边缘滑出动画结束后再跳转，让用户先看清下一屏 */
const EDGE_NAV_DELAY = EDGE_SETTLE;

const TRACK_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

interface UsePagerSwipeOptions {
  /** 页数 */
  count: number;
  /** 当前页索引 */
  index: number;
  /** 翻到目标页 */
  onChange: (index: number) => void;
  /** 到达第一页再右滑 / 最后一页再左滑：整页滑出后切根 tab */
  onEdge: (dir: "next" | "prev") => void;
  /** 手势锁定方向后，提前挂载即将露出的相邻页 */
  onNeighborIntent?: (index: number) => void;
}

interface PagerRefs {
  /** 裁剪窗口：overflow-hidden，宽度即一页的宽度 */
  viewportRef: RefObject<HTMLElement | null>;
  /** 内容轨道：所有页横向排列，translateX 翻页 */
  trackRef: RefObject<HTMLElement | null>;
  /** 整页舞台：到边缘时平移它（连同顶部 tab 一起滑） */
  stageRef: RefObject<HTMLElement | null>;
}

/** 读取元素当前的 translateX（computed transform 的 m41） */
function readTranslateX(el: HTMLElement): number {
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
 * 「顶部 tab 固定、内容横向分页」的歌单页手势。
 *
 * - 页内滑动：只平移内容轨道，露出相邻页的真实内容（tab 栏不动）。
 * - 到第一页/最后一页再往外滑：平移整个舞台（含顶部 tab），并在两侧
 *   预置好的相邻根 tab 骨架屏上滑出，不出现白色空白；松手后跳转。
 * - 所有位移直接写 DOM（不 setState），避免每帧重渲染重列表。
 */
export function usePagerSwipe(
  { viewportRef, trackRef, stageRef }: PagerRefs,
  options: UsePagerSwipeOptions
) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const indexRef = useRef(options.index);
  useEffect(() => {
    indexRef.current = options.index;
  }, [options.index]);

  const draggingRef = useRef(false);
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
    node: HTMLElement | null,
    offset: number,
    animate: boolean
  ) => {
    if (!node) return;
    node.style.transition = animate
      ? `transform ${TRACK_SETTLE}ms ${TRACK_EASING}`
      : "none";
    node.style.transform = `translate3d(${offset}px, 0, 0)`;
  };

  const applyStage = (
    node: HTMLElement | null,
    offset: number,
    animate: boolean
  ) => {
    if (!node) return;
    node.style.transition = animate
      ? `transform ${EDGE_SETTLE}ms ${TRACK_EASING}`
      : "none";
    node.style.transform = `translate3d(${offset}px, 0, 0)`;
  };

  // 首次定位 + 尺寸变化时重新对齐（手机旋转、分屏）。
  // 用 layout effect 在绘制前落位，避免首帧先闪一下第 1 页。
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    const align = () => {
      const width = viewport.clientWidth || window.innerWidth;
      if (!width) return;
      if (draggingRef.current) return;
      const animate = !firstPositionRef.current;
      firstPositionRef.current = false;
      applyTrack(track, trackBase(indexRef.current, width), animate);
      applyStage(stageRef.current, 0, false);
    };

    align();
    // 测试环境（jsdom）没有 ResizeObserver，跳过监听即可
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(align);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [stageRef, trackRef, viewportRef]);

  // 点 tab / 再次点击底部 tab / 跨页落点：平滑翻到新的一页
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track || draggingRef.current) return;
    const width = viewport.clientWidth || window.innerWidth;
    if (!width) return;
    applyTrack(
      track,
      trackBase(options.index, width),
      !firstPositionRef.current
    );
  }, [options.index, trackRef, viewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let tracking = false;
    let axis: "none" | "x" | "y" = "none";
    let startX = 0;
    let startY = 0;
    let startAt = 0;
    let width = 0;
    let trackStart = 0;
    let stageStart = 0;
    let edgeActive = false;
    let edgeDir: 1 | -1 = 1;
    let wasEdge = false;
    let lastIntent = -1;

    const resetVisual = (animate: boolean) => {
      const w = width || viewport.clientWidth || window.innerWidth;
      applyTrack(trackRef.current, trackBase(indexRef.current, w), animate);
      applyStage(stageRef.current, 0, animate);
      draggingRef.current = false;
    };

    const handleStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || isDragSelecting()) {
        tracking = false;
        return;
      }
      const touch = event.touches[0];
      const target = touch.target as Element | null;
      if (isTextInputTarget(target)) {
        tracking = false;
        return;
      }
      if (isInsideHorizontalScroller(target, viewport)) {
        tracking = false;
        return;
      }

      // 边缘滑出后的跳转计时器不在这里取消：160ms 内的再次触摸视为继续甩出，
      // 取消它会让舞台停在屏幕外、页面回不来
      tracking = true;
      axis = "none";
      startX = touch.clientX;
      startY = touch.clientY;
      startAt = Date.now();
      width = viewport.clientWidth || window.innerWidth;
      trackStart = trackRef.current
        ? readTranslateX(trackRef.current)
        : trackBase(indexRef.current, width);
      stageStart = stageRef.current ? readTranslateX(stageRef.current) : 0;
      edgeActive = false;
      wasEdge = false;
      lastIntent = -1;
    };

    const handleMove = (event: TouchEvent) => {
      if (!tracking) return;
      if (isDragSelecting()) {
        tracking = false;
        resetVisual(true);
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
          // 纵向滚动：整段手势交给列表，不再参与翻页
          tracking = false;
          return;
        }
        // 锁定横向：停掉可能还在跑的过渡，直接从当前位置跟手
        draggingRef.current = true;
        if (trackRef.current) trackRef.current.style.transition = "none";
        if (stageRef.current) stageRef.current.style.transition = "none";
      }

      if (event.cancelable) event.preventDefault();

      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      const targetIndex = indexRef.current + dir;
      const isEdge = targetIndex < 0 || targetIndex >= latest.current.count;
      edgeActive = isEdge;
      edgeDir = dir;

      if (isEdge) {
        wasEdge = true;
        applyStage(stageRef.current, stageStart + dx * EDGE_DAMPING, false);
        return;
      }

      if (wasEdge) applyStage(stageRef.current, 0, false);
      wasEdge = false;
      if (lastIntent !== targetIndex) {
        lastIntent = targetIndex;
        latest.current.onNeighborIntent?.(targetIndex);
      }
      applyTrack(trackRef.current, trackStart + dx, false);
    };

    const handleEnd = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      // 没进入横向（轻点 / 纵向滚动）：保持现状，别把正在跑的翻页动画打断
      if (axis !== "x") return;

      const touch = event.changedTouches[0];
      const dx = touch ? touch.clientX - startX : 0;
      const duration = Date.now() - startAt;
      const passed =
        Math.abs(dx) >= SWIPE_THRESHOLD ||
        (duration < FLING_DURATION && Math.abs(dx) >= FLING_DISTANCE);

      draggingRef.current = false;

      if (edgeActive) {
        if (passed) {
          // 整页滑出，露出相邻根 tab 的骨架屏；稍后真正跳转
          const target = edgeDir === 1 ? -width : width;
          applyStage(stageRef.current, target, true);
          const dir = edgeDir;
          clearNavTimer();
          navTimerRef.current = setTimeout(() => {
            navTimerRef.current = null;
            latest.current.onEdge(dir === 1 ? "next" : "prev");
          }, EDGE_NAV_DELAY);
        } else {
          applyStage(stageRef.current, 0, true);
        }
        return;
      }

      const current = indexRef.current;
      const target = passed ? current + (dx < 0 ? 1 : -1) : current;
      const currentWidth = width || viewport.clientWidth || window.innerWidth;
      applyTrack(trackRef.current, trackBase(target, currentWidth), true);
      if (target !== current) latest.current.onChange(target);
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
      viewport.removeEventListener("touchstart", handleStart);
      viewport.removeEventListener("touchmove", handleMove);
      viewport.removeEventListener("touchend", handleEnd);
      viewport.removeEventListener("touchcancel", handleCancel);
    };
  }, [stageRef, trackRef, viewportRef]);
}
