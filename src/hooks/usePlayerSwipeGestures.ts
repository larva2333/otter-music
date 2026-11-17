import { useCallback, useEffect, useRef, useState } from "react";

/** 下滑收起的手势阈值（px） */
const CLOSE_THRESHOLD = 80;
/** 横滑切歌的手势阈值（px） */
const SWIPE_THRESHOLD = 56;
/** 主轴相对副轴的最小倍数：斜向滑动不误触，避免边下拉边横移时同时命中两种操作 */
const DIRECTION_RATIO = 1.4;
/** 快速轻扫的最小位移，配合时长判定“甩”这个动作 */
const FLING_DISTANCE = 40;
/** 快速轻扫的时长上限（ms） */
const FLING_DURATION = 260;
/**
 * click 抑制窗口（ms）。只在手势真正触发了动作（收起/切歌）时才开启：
 * 上滑、斜滑、距离不足这些没有动作的手势不该吞掉用户的下一次点击。
 * 浏览器补发的 click 紧跟在 touchend 之后，250ms 足够覆盖。
 */
const CLICK_SUPPRESS_WINDOW = 250;
/** 判定为「轻点」的最大位移（px），超过就算滑动 */
const TAP_MAX_MOVE = 10;
/** 判定为「轻点」的最大按下时长（ms），超过算长按 */
const TAP_MAX_DURATION = 500;
/** touchend 已经处理过轻点后，拦掉浏览器补发 click 的窗口（ms） */
const TAP_CLICK_WINDOW = 400;
/** 下拉跟手的最大位移，拖得再远也不会把整页拖到屏幕外 */
const MAX_DRAG = 160;
/** 下拉跟手的阻尼系数，越拖越“重”，与原生下拉手感接近 */
const DRAG_RESISTANCE = 0.9;

type Axis = "none" | "horizontal" | "vertical" | "ignored";

/**
 * 触摸落在按钮/链接这类可交互元素上时不参与轻点判定。
 * 轻点是在容器的 touchend 里处理的，子元素的 click.stopPropagation 拦不住它，
 * 不排除的话点歌词页的「从此句播放」会顺带切回封面。
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== "function") return false;
  return Boolean(
    element.closest("button, a, input, textarea, select, [data-no-tap]")
  );
}

interface GestureState {
  startX: number;
  startY: number;
  startAt: number;
  axis: Axis;
  dx: number;
  dy: number;
}

interface UsePlayerSwipeGesturesOptions {
  /** 歌词页等需要原生滚动的手势场景，置 false 后所有手势都不响应 */
  enabled: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  /**
   * 轻点回调。放在 touchend 里执行而不是等浏览器的 click：
   * 上滑/滚动之后的惯性期内，WebView 会把紧跟的 tap 用于「停止滚动」，
   * click 根本不会派发，只监听 click 就会表现为「点一下没反应」。
   * 带上 target：区分点在唱臂骨架（播放/暂停）还是盘面/空白（切歌词）。
   */
  onTap?: (target: EventTarget | null) => void;
  /** 手势区域容器：用于注册非 passive 的 touchmove 监听，阻止 WebView 滚动 */
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

interface UsePlayerSwipeGesturesResult {
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    /** 不使用事件参数：抬手时只关心累计位移，且便于单测直接调用 */
    onTouchEnd: (e?: React.TouchEvent) => void;
    onTouchCancel: () => void;
  };
  /** 下拉跟手位移，0 表示没有拖拽 */
  dragY: number;
  /** 是否正在拖拽：为 true 时要关掉 transition，否则跟手会有一帧延迟 */
  isDragging: boolean;
  /** 消费一次 click 抑制标记；返回 true 表示这次 click 是滑动尾巴，应忽略 */
  shouldSuppressClick: () => boolean;
}

/**
 * 全屏播放页的滑动手势：
 * - 下滑收起播放页
 * - 上滑不响应（交给内容区自己处理）
 * - 左滑看下一首、右滑回上一首（自然方向，与翻页一致）
 *
 * 只在主内容区（封面）绑定，进度条、按钮、抽屉都不在手势区域内。
 * 歌词页由 `enabled=false` 整体关闭，保证歌词列表能正常滚动。
 */
export function usePlayerSwipeGestures({
  enabled,
  onClose,
  onPrev,
  onNext,
  onTap,
  containerRef,
}: UsePlayerSwipeGesturesOptions): UsePlayerSwipeGesturesResult {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const gestureRef = useRef<GestureState | null>(null);
  const suppressClickUntilRef = useRef(0);
  const tapHandledAtRef = useRef(0);

  /**
   * 只靠 CSS `touch-action: none` 在部分 WebView 上并不够：
   * 上滑仍可能被识别成页面滚动手势，手指抬起后的惯性期内，
   * 紧接着的 tap 只会被用来「停止滚动」，click 根本不会派发，
   * 表现就是「上滑之后再点一下没反应」。
   * React 的 onTouchMove 是 passive 监听器，preventDefault 无效，
   * 所以这里用原生非 passive 监听把这个区域的手势彻底截断。
   */
  useEffect(() => {
    const node = containerRef?.current;
    if (!node || !enabled) return;

    const stopScrollGesture = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };

    node.addEventListener("touchmove", stopScrollGesture, { passive: false });
    return () => {
      node.removeEventListener("touchmove", stopScrollGesture);
    };
  }, [enabled, containerRef]);

  const reset = useCallback(() => {
    gestureRef.current = null;
    setIsDragging(false);
    setDragY(0);
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // 手势关闭时仍要记录起点，歌词页要靠它识别轻点（切回封面）
      if (!enabled && !onTap) return;

      /**
       * 新的一次触摸开始，说明上一次手势的尾巴已经过去了。
       * 浏览器补发的 click 紧跟在 touchend 之后，不可能晚于下一次 touchstart，
       * 所以这里清掉残留的抑制标记：哪怕上一条手势设过抑制却没有真的补发 click，
       * 也不会把用户这次点击吞掉。
       */
      suppressClickUntilRef.current = 0;
      tapHandledAtRef.current = 0;

      if (enabled) {
        // 手势可能被系统中断（来电、通知下拉），留下没归零的位移。
        // 新一次触摸先复位，避免整页停在半空
        setDragY(0);
        setIsDragging(false);
      }

      // 多指（缩放、双指下滑）不参与手势，避免识别成切歌
      if (e.touches.length !== 1) {
        gestureRef.current = null;
        return;
      }

      // 落在按钮上的触摸交给按钮自己处理，不当成「轻点切歌词」
      if (isInteractiveTarget(e.target)) {
        gestureRef.current = null;
        return;
      }

      const touch = e.touches[0];
      gestureRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startAt: Date.now(),
        axis: "none",
        dx: 0,
        dy: 0,
      };
    },
    [enabled, onTap]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;

      const touch = e.touches[0];
      if (!touch) return;

      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;
      gesture.dx = dx;
      gesture.dy = dy;

      // 手势关闭时只记录位移（用于区分轻点和滑动），不影响歌词的原生滚动
      if (!enabled) return;

      // 位移太小还判断不出方向，先不动，避免手指刚落下就抖动
      if (gesture.axis === "none") {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < TAP_MAX_MOVE) return;

        if (Math.abs(dx) > Math.abs(dy) * DIRECTION_RATIO) {
          gesture.axis = "horizontal";
        } else if (dy > 0 && dy > Math.abs(dx) * DIRECTION_RATIO) {
          gesture.axis = "vertical";
        } else {
          // 上滑 / 斜向滑动：既不收起也不切歌
          gesture.axis = "ignored";
          return;
        }
      }

      if (gesture.axis === "vertical") {
        setIsDragging(true);
        setDragY(Math.min(dy * DRAG_RESISTANCE, MAX_DRAG));
      }
    },
    [enabled]
  );

  const handleTouchEnd = useCallback(
    (e?: React.TouchEvent) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (!gesture) {
        reset();
        return;
      }

      const { dx, dy, axis } = gesture;
      const duration = Date.now() - gesture.startAt;
      const distance = Math.hypot(dx, dy);

      /**
       * 轻点判定放在最前面，并且不依赖 click 事件：
       * 上滑或滚动之后的惯性期内，浏览器会把紧跟的 tap 当成「停止滚动」，
       * click 不会派发。在 touchend 里直接处理，点击才不会被吞。
       */
      if (onTap && distance <= TAP_MAX_MOVE && duration < TAP_MAX_DURATION) {
        tapHandledAtRef.current = Date.now();
        onTap(e?.target ?? null);
        reset();
        return;
      }

      if (!enabled) {
        reset();
        return;
      }

      const isFling = duration < FLING_DURATION;

      /**
       * 只有手势真正触发了动作，才拦一次紧随其后的 click（否则会误切到歌词页）。
       * 上滑、斜向滑动、距离不足这些没有产生动作的手势一律不拦，
       * 不然用户滑完再点一下会发现点击「被吃掉」。
       */
      const markClickSuppression = () => {
        suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESS_WINDOW;
      };

      if (axis === "vertical") {
        const shouldClose =
          dy >= CLOSE_THRESHOLD || (isFling && dy >= FLING_DISTANCE);
        setIsDragging(false);
        if (shouldClose) {
          markClickSuppression();
          onClose();
        }
        setDragY(0);
        return;
      }

      if (axis === "horizontal") {
        const shouldSwitch =
          Math.abs(dx) >= SWIPE_THRESHOLD ||
          (isFling && Math.abs(dx) >= FLING_DISTANCE);
        if (shouldSwitch) {
          markClickSuppression();
          // 自然方向：左滑看到下一首，右滑回到上一首
          if (dx < 0) onNext();
          else onPrev();
        }
      }

      reset();
    },
    [enabled, onClose, onNext, onPrev, onTap, reset]
  );

  const shouldSuppressClick = useCallback(() => {
    const now = Date.now();

    // touchend 里已经处理过这次轻点，浏览器随后补发的 click 必须跳过，
    // 否则一次点击会执行两次（切过去又切回来）
    if (now - tapHandledAtRef.current < TAP_CLICK_WINDOW) {
      tapHandledAtRef.current = 0;
      return true;
    }

    if (now < suppressClickUntilRef.current) {
      suppressClickUntilRef.current = 0;
      return true;
    }
    return false;
  }, []);

  return {
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: reset,
    },
    // enabled 为 false（歌词页、封面预览、横屏）时不暴露任何位移，
    // 这样即使 state 里还留着上一次拖拽的值，界面也不会偏移
    dragY: enabled ? dragY : 0,
    isDragging: enabled && isDragging,
    shouldSuppressClick,
  };
}
