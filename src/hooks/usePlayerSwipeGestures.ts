import { useCallback, useEffect, useRef, useState } from "react";
import {
  ARM_FOLLOW_TRANSITION,
  ARM_PAUSE_ANGLE,
  ARM_PLAY_ANGLE,
  beginArmCut,
  buildArmTransition,
  cancelArmCut,
  isArmCutPending,
  markGestureArmControl,
  readArmAngle,
  writeArmAngle,
} from "@/lib/vinyl-arm";

/** 下滑收起的手势阈值（px） */
const CLOSE_THRESHOLD = 80;
/** 上滑唤出评论的手势阈值（px） */
const OPEN_COMMENTS_THRESHOLD = 80;
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
/** 横滑跟手系数：横向翻页要跟得紧，太松会显得迟钝 */
const HORIZONTAL_RESISTANCE = 0.95;
/**
 * 唱臂的抬臂幅度：播放位 -4° 到暂停位 -40° 之间是 36°。
 * 唱臂只有一个绝对角度通道（见 lib/vinyl-arm），这里算的是「还能抬多少」。
 */
const ARM_LIFT_DELTA = ARM_PLAY_ANGLE - ARM_PAUSE_ANGLE;
/** 位移到抬臂量的换算：拖过约 45% 屏宽就抬到满幅 */
const ARM_FOLLOW_RATIO = ARM_LIFT_DELTA / 0.45;
/** 切歌入场动画的起始偏移，取屏宽的比例：整屏太重，太小又看不出是“滑进来”的 */
const SLIDE_IN_RATIO = 0.5;

type Axis = "none" | "horizontal" | "vertical" | "up" | "ignored";

/**
 * 触摸落在按钮/链接这类可交互元素上时不参与轻点判定。
 * 轻点是在容器的 touchend 里处理的，子元素的 click.stopPropagation 拦不住它，
 * 不排除的话点歌词页的「从此句播放」会顺带切回封面。
 */
/** 写单个元素的位移；抽成独立函数，避免把 hook 参数里的 ref 当成被修改的对象 */
function writeTranslate(el: HTMLElement | null, x: number) {
  if (el) el.style.translate = x ? `${x}px` : "";
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== "function") return false;
  return Boolean(
    element.closest("button, a, input, textarea, select, [data-no-tap]")
  );
}

/**
 * 横滑切歌时唱臂已经自己演完了「抬臂 → 回落」。
 *
 * 播放页还有一套「曲目 id 变化就把唱臂荡到 away 再落回」的补间动画（按钮、
 * 队列点选、自动续播都靠它）。如果横滑也走那条路，唱臂就会先被我们抬起来、
 * 紧接着又被荡开一次再落回 —— 看起来像动画重播了一遍。
 *
 * 所以横滑切歌时留一个很短的有效期标记，播放页的切歌 effect 见到就跳过自己的
 * 补间，让唱臂顺着横滑的动势自然落回。带过期时间是为了「滑了但没切成歌」
 * （例如接口失败）时不会误吞掉下一次正常切歌的动画。
 */
const SWIPE_ARM_CUT_TTL = 1200;
let swipeArmCutAt = 0;

function markSwipeArmCut(): void {
  swipeArmCutAt = Date.now();
}

/** 消费「本次切歌来自横滑」的标记；非横滑切歌返回 false */
export function consumeSwipeArmCut(): boolean {
  if (Date.now() - swipeArmCutAt > SWIPE_ARM_CUT_TTL) return false;
  swipeArmCutAt = 0;
  return true;
}

interface GestureState {
  startX: number;
  startY: number;
  startAt: number;
  axis: Axis;
  dx: number;
  dy: number;
}

/**
 * 横滑跟手的直接 DOM 写入目标。
 *
 * 不传时走原来的 state 驱动（单测用）；传了之后跟手位移直接写这两个元素的
 * `translate`，不再每帧 setState —— 否则每次 touchmove 都会重渲染整个播放页
 * （歌词、按钮、图标全在树里），在 Android WebView 上就是肉眼可见的卡顿。
 */
export interface SwipeDragRefs {
  /** 封面容器：写横滑位移 */
  cover?: React.RefObject<HTMLElement | null>;
  /** 唱臂容器：写反向位移，抵消封面平移让唱臂固定在屏幕原位 */
  tonearm?: React.RefObject<HTMLElement | null>;
  /**
   * 唱臂 svg：除了固定在原位，还要跟着唱片滑动的方向摆头。
   * 写在 `rotate` 属性上，与容器的 `translate` 分工，互不覆盖。
   */
  tonearmArm?: React.RefObject<SVGSVGElement | null>;
}

interface UsePlayerSwipeGesturesOptions {
  /** 歌词页等需要原生滚动的手势场景，置 false 后所有手势都不响应 */
  enabled: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  /** 上滑唤出评论 */
  onSwipeUp?: () => void;
  /** 提供后横滑跟手走 DOM 直写（无每帧重渲染）；不提供则回退到 state */
  dragRefs?: SwipeDragRefs;
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
  /** 横滑跟手位移，松手回弹或切歌后归零 */
  dragX: number;
  /** 是否正在横滑：为 true 时要关掉过渡，跟手才不拖影 */
  isHorizDragging: boolean;
  /**
   * 切歌入场：新封面当前要偏移的像素（非 0 表示正在从侧边滑入）。
   * 配合 {@link slideSnap} 使用：snap 为 true 的那一帧不要过渡，先瞬移到起点。
   */
  dragEntryX: number;
  /** 入场动画的第一帧：瞬移到位，不能有过渡 */
  slideSnap: boolean;
  /** 是否正在拖拽：为 true 时要关掉 transition，否则跟手会有一帧延迟 */
  isDragging: boolean; /** 消费一次 click 抑制标记；返回 true 表示这次 click 是滑动尾巴，应忽略 */
  shouldSuppressClick: () => boolean;
}

/**
 * 全屏播放页的滑动手势：
 * - 下滑收起播放页
 * - 上滑唤出评论（封面页；歌词页由 enabled=false 交给列表滚动）
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
  onSwipeUp,
  onTap,
  containerRef,
  dragRefs,
}: UsePlayerSwipeGesturesOptions): UsePlayerSwipeGesturesResult {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  // 横滑：跟手位移 + 切歌入场偏移（新封面从侧边滑进来）
  const [dragX, setDragX] = useState(0);
  const [isHorizDragging, setIsHorizDragging] = useState(false);
  const [dragEntryX, setDragEntryX] = useState(0);
  const [slideSnap, setSlideSnap] = useState(false);
  const gestureRef = useRef<GestureState | null>(null);
  const suppressClickUntilRef = useRef(0);
  const tapHandledAtRef = useRef(0);

  /**
   * DOM 直写通道：跟手期间把位移直接写到封面/唱臂元素上，一帧最多写一次。
   * dragRefs 由调用方用 useMemo 稳定，闭包捕获即可始终指向同一组节点。
   */
  const dragXDomRef = useRef(0);
  const dragRafRef = useRef<number | null>(null);
  const horizFlagRef = useRef(false);
  const entryAnimsRef = useRef<Animation[]>([]);

  const cancelEntryAnims = useCallback(() => {
    entryAnimsRef.current.forEach((anim) => anim.cancel());
    entryAnimsRef.current = [];
  }, []);

  const writeDragX = useCallback(
    (x: number) => {
      dragXDomRef.current = x;
      if (!dragRefs) return;
      writeTranslate(dragRefs.cover?.current ?? null, x);
      // 唱臂反向平移同样的距离，抵消封面的位移 —— 唱臂固定在屏幕原位
      writeTranslate(dragRefs.tonearm?.current ?? null, -x);
    },
    [dragRefs]
  );

  /** 帧节流：一帧内多次 touchmove 只写一次 DOM，避免多余样式计算 */
  const scheduleDragX = useCallback(
    (x: number) => {
      dragXDomRef.current = x;
      if (dragRafRef.current !== null) return;
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null;
        writeDragX(dragXDomRef.current);
      });
    },
    [writeDragX]
  );

  const cancelDragFrame = useCallback(() => {
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
  }, []);

  /**
   * 本次手势里唱臂的起始绝对角，以及还能抬多少（到暂停位为止）。
   * 播放态起手 -4° 可抬 36°，暂停态起手 -40° 则没有余量，不会往上堆。
   */
  const armStartRef = useRef(ARM_PLAY_ANGLE);
  const armRoomRef = useRef(ARM_LIFT_DELTA);

  /**
   * 唱臂角度：从起手角度按位移抬臂，左右滑都是逆时针（负方向）。
   * 写的是绝对角度（与 VinylCover 同一条通道），容器负责反向 translate 让轴心不动。
   */
  const followArm = useCallback(
    (x: number, resetTransition = false) => {
      if (!dragRefs) return;
      const width = window.innerWidth || 360;
      const lift = Math.min(
        armRoomRef.current,
        (Math.abs(x) / width) * ARM_FOLLOW_RATIO
      );
      writeArmAngle(
        dragRefs.tonearmArm?.current ?? null,
        armStartRef.current - lift,
        resetTransition ? ARM_FOLLOW_TRANSITION : undefined
      );
    },
    [dragRefs]
  );

  /** 松手归位：按当前角到起手角距离匀速返回（0.12°/ms），避免近距离还拖慢 300ms */
  const settleArm = useCallback(() => {
    if (!dragRefs) return;
    const el = dragRefs.tonearmArm?.current ?? null;
    const current = readArmAngle(el);
    writeArmAngle(
      el,
      armStartRef.current,
      buildArmTransition(current, armStartRef.current)
    );
  }, [dragRefs]);

  /**
   * 确认切歌：从当前跟手角度按恒定角速度连续演完「抬臂 → 落针」，
   * 播放页见到横滑标记会跳过自己的切歌命令，避免重播。
   */
  const cutArm = useCallback(() => {
    if (!dragRefs) return;
    markSwipeArmCut();
    beginArmCut();
  }, [dragRefs]);

  /** 收手（没切成歌/下一次触摸）：取消未完成的切歌动画，把唱臂按恒定速度放回起手角 */
  const restArm = useCallback(() => {
    cancelArmCut();
    settleArm();
  }, [settleArm]);

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
    setIsHorizDragging(false);
    setDragX(0);
    if (dragRefs) {
      const wasHoriz = horizFlagRef.current || dragXDomRef.current !== 0;
      horizFlagRef.current = false;
      cancelDragFrame();
      cancelEntryAnims();
      writeDragX(0);
      // 未进入横滑的普通轻点不打断正在进行的切歌唱臂动画
      if (wasHoriz) restArm();
    }
  }, [cancelDragFrame, cancelEntryAnims, writeDragX, restArm, dragRefs]);

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
        setDragX(0);
        setIsHorizDragging(false);
        if (dragRefs) {
          const hadPendingCut = isArmCutPending();
          horizFlagRef.current = false;
          cancelDragFrame();
          cancelEntryAnims();
          writeDragX(0);
          if (!hadPendingCut) {
            // 读唱臂当前绝对角作为本次起手角：播放 -4°、暂停 -40°。
            // 暂停位没有抬臂余量，横滑就直接移动封面、不再把唱臂往上堆。
            const base = readArmAngle(dragRefs.tonearmArm?.current ?? null);
            armStartRef.current = base;
            armRoomRef.current = Math.max(
              0,
              Math.min(ARM_LIFT_DELTA, base - ARM_PAUSE_ANGLE)
            );
            restArm();
          }
        }
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
    [
      enabled,
      onTap,
      cancelDragFrame,
      cancelEntryAnims,
      writeDragX,
      restArm,
      dragRefs,
    ]
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
        } else if (dy < 0 && -dy > Math.abs(dx) * DIRECTION_RATIO) {
          // 上滑：留给唤出评论，跟手阶段不做位移，松手达标才触发
          gesture.axis = "up";
          return;
        } else {
          // 斜向滑动：既不收起也不切歌
          gesture.axis = "ignored";
          return;
        }
      }

      if (gesture.axis === "vertical") {
        setIsDragging(true);
        setDragY(Math.min(dy * DRAG_RESISTANCE, MAX_DRAG));
      } else if (gesture.axis === "horizontal") {
        // 跟手：封面随手指横移，松手后才决定回弹还是切歌。
        // 有 DOM 直写目标时只写样式、不 setState —— 这是横滑丝滑的关键：
        // 每个 touchmove 都 setState 会让整个播放页每帧重渲染，肉眼可见地卡。
        const x = dx * HORIZONTAL_RESISTANCE;
        if (dragRefs) {
          // 方向刚判定的第一帧切一次 transition（关掉过渡才跟手），只此一次
          const isFirstMove = !horizFlagRef.current;
          if (isFirstMove) {
            horizFlagRef.current = true;
            setIsHorizDragging(true);
            // 若正好接管了进行中的切歌动画：定格当前视觉角度作为起手，取消剩余切歌动画，
            // 并把松手未切歌的归位目标设为播放位 -4°。
            if (isArmCutPending()) {
              cancelArmCut();
              const live = readArmAngle(dragRefs.tonearmArm?.current ?? null);
              armStartRef.current = ARM_PLAY_ANGLE;
              armRoomRef.current = Math.max(
                0,
                Math.min(ARM_LIFT_DELTA, live - ARM_PAUSE_ANGLE)
              );
            }
            // 横滑期间唱臂由手势独占：播放页的播放/暂停 effect 在这段时间让开，
            // 否则切歌时 isPlaying 翻转会打断动作。
            markGestureArmControl(1000);
          }
          scheduleDragX(x);
          followArm(x, isFirstMove);
        } else {
          setIsHorizDragging(true);
          setDragX(x);
        }
      }
    },
    [enabled, scheduleDragX, followArm, dragRefs]
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
       * 斜向滑动、距离不足这些没有产生动作的手势一律不拦，
       * 不然用户滑完再点一下会发现点击「被吃掉」。
       */
      const markClickSuppression = () => {
        suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESS_WINDOW;
      };

      if (axis === "up") {
        const shouldOpen =
          -dy >= OPEN_COMMENTS_THRESHOLD || (isFling && -dy >= FLING_DISTANCE);
        if (shouldOpen && onSwipeUp) {
          markClickSuppression();
          onSwipeUp();
        }
        reset();
        return;
      }

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
        setIsHorizDragging(false);
        horizFlagRef.current = false;

        // DOM 直写路径：位移不经过 state，松手时只需要一帧写回即可
        if (dragRefs) {
          if (!shouldSwitch) {
            // 距离不够：唱臂立刻归位，刚恢复的 CSS 过渡会把封面吸回原位
            restArm();
            scheduleDragX(0);
            return;
          }

          // 确认切歌：唱臂甩到切割位停住，等新唱片落位后自己转回来
          cutArm();

          markClickSuppression();
          // 自然方向：左滑看到下一首，右滑回到上一首。
          // 新封面从「滑走的那一侧的反方向」进场：左滑时从右侧进来，右滑时从左侧进来。
          const direction = dx < 0 ? 1 : -1;
          const entryOffset =
            Math.round((window.innerWidth || 360) * SLIDE_IN_RATIO) * direction;

          // 丢掉跟手阶段还没落盘的写入，避免和入场首帧打架
          cancelDragFrame();
          const cover = dragRefs.cover?.current ?? null;
          const tonearm = dragRefs.tonearm?.current ?? null;
          // 优先走 WAAPI 一步完成新唱片滑入，避免 3 帧 rAF + slideSnap 重渲染导致首帧滞留与卡顿
          if (cover && typeof cover.animate === "function") {
            cancelEntryAnims();
            writeDragX(0);
            const entryOptions: KeyframeAnimationOptions = {
              duration: 320,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            };
            const coverAnim = cover.animate(
              [{ translate: `${entryOffset}px` }, { translate: "0px" }],
              entryOptions
            );
            entryAnimsRef.current.push(coverAnim);
            coverAnim.finished
              .then(() => {
                entryAnimsRef.current = entryAnimsRef.current.filter(
                  (a) => a !== coverAnim
                );
              })
              .catch(() => {});
            if (tonearm && typeof tonearm.animate === "function") {
              const armAnim = tonearm.animate(
                [{ translate: `${-entryOffset}px` }, { translate: "0px" }],
                entryOptions
              );
              entryAnimsRef.current.push(armAnim);
              armAnim.finished
                .then(() => {
                  entryAnimsRef.current = entryAnimsRef.current.filter(
                    (a) => a !== armAnim
                  );
                })
                .catch(() => {});
            }
            if (dx < 0) onNext();
            else onPrev();
            return;
          }

          setSlideSnap(true);
          if (dx < 0) onNext();
          else onPrev();

          // jsdom 兜底：三帧时序
          requestAnimationFrame(() => {
            writeDragX(entryOffset);
            requestAnimationFrame(() => {
              setSlideSnap(false);
              requestAnimationFrame(() => writeDragX(0));
            });
          });
          return;
        }

        // 未传 DOM 目标（单测场景）：保持原来的 state 驱动
        setDragX(0);

        if (!shouldSwitch) {
          // 距离不够：跟手位移归零，CSS 过渡会把封面吸回原位
          return;
        }

        markClickSuppression();
        const direction = dx < 0 ? 1 : -1;
        const entryOffset =
          Math.round((window.innerWidth || 360) * SLIDE_IN_RATIO) * direction;

        setDragEntryX(entryOffset);
        setSlideSnap(true);
        if (dx < 0) onNext();
        else onPrev();

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setSlideSnap(false);
            setDragEntryX(0);
          });
        });
        return;
      }

      reset();
    },
    [
      enabled,
      onClose,
      onNext,
      onPrev,
      onSwipeUp,
      onTap,
      reset,
      cancelDragFrame,
      cancelEntryAnims,
      scheduleDragX,
      writeDragX,
      restArm,
      cutArm,
      dragRefs,
    ]
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
    dragX: enabled ? dragX : 0,
    isHorizDragging: enabled && isHorizDragging,
    dragEntryX: enabled ? dragEntryX : 0,
    slideSnap: enabled && slideSnap,
    isDragging: enabled && isDragging,
    shouldSuppressClick,
  };
}
