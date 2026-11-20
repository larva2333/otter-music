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
/** 横滑跟手系数：横向翻页要跟得紧，太松会显得迟钝 */
const HORIZONTAL_RESISTANCE = 0.95;
/**
 * 唱臂的抬臂幅度。
 *
 * svg 上同时有两层旋转：React 写的 `transform: rotate(播放角)` 决定基准位
 * （播放 -4°，暂停 -40°，见 VinylCover 的 TONEARM_ANGLE），这里写的 `rotate`
 * 是叠加在上面的增量。所以「抬到跟暂停一样大」= 增量 36°，视觉总角 -40°。
 */
const ARM_LIFT_DELTA = 36;
/**
 * 抬臂的目标总角度：与 VinylCover 里「暂停」位的 -40° 一致。
 * 播放位是 -4°，需要补 36°；暂停时唱臂已经抬到这儿了，就不该再往上堆。
 */
const ARM_LIFT_TARGET = -40;
/** 位移到增量的换算：拖过约 45% 屏宽就抬到满幅，滑一小段也能看出唱臂在动 */
const ARM_FOLLOW_RATIO = ARM_LIFT_DELTA / 0.45;
/** 唱臂跟手阶段的过渡：只留位移过渡，旋转必须一帧到位才跟手 */
const ARM_FOLLOW_TRANSITION = "transform 350ms ease-out";
/**
 * 确认切歌时把唱臂推到切割位的过渡。
 * 比跟手用的短，松手那一刻要有「甩到位置」的干脆感。
 */
const ARM_CUT_TRANSITION = "rotate 200ms ease-out";
/**
 * 唱臂停在切割位的时长：新封面从侧边滑进来大约 300ms，
 * 等唱片落位再转回播放位，视觉上是「换好唱片再落针」。
 */
const ARM_READY_DELAY = 360;
/** 松手归位：旋转单独给 320ms 缓出，和唱片回弹一起收住 */
const ARM_SETTLE_TRANSITION =
  "transform 350ms ease-out, rotate 320ms cubic-bezier(0.22, 1, 0.36, 1)";
/** 切歌入场动画的起始偏移，取屏宽的比例：整屏太重，太小又看不出是“滑进来”的 */
const SLIDE_IN_RATIO = 0.5;

type Axis = "none" | "horizontal" | "vertical" | "ignored";

/**
 * 触摸落在按钮/链接这类可交互元素上时不参与轻点判定。
 * 轻点是在容器的 touchend 里处理的，子元素的 click.stopPropagation 拦不住它，
 * 不排除的话点歌词页的「从此句播放」会顺带切回封面。
 */
/** 写单个元素的位移；抽成独立函数，避免把 hook 参数里的 ref 当成被修改的对象 */
function writeTranslate(el: HTMLElement | null, x: number) {
  if (el) el.style.translate = x ? `${x}px` : "";
}

/**
 * 读唱臂当前的基础角（VinylCover 用 transform 写的播放 -4° / 暂停 -40°）。
 * 横滑时要把「再抬多少才等于暂停位」算出来，否则暂停状态下再叠 36° 就冲过头了。
 */
function readArmBaseAngle(el: SVGSVGElement | null): number {
  if (!el || typeof getComputedStyle !== "function") return -4;
  const value = getComputedStyle(el).transform;
  const matrix = value.match(/matrix\(([^)]+)\)/);
  if (matrix) {
    const [a, b] = matrix[1].split(",").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b) && (a !== 0 || b !== 0)) {
      return (Math.atan2(b, a) * 180) / Math.PI;
    }
    return -4;
  }
  // 有些环境（jsdom）不做矩阵展开，直接把 rotate(-40deg) 原样返回
  const rotated = value.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
  return rotated ? Number(rotated[1]) : -4;
}

/** 写唱臂的旋转角；同样抽成独立函数，理由同上 */
function writeArmRotate(
  el: SVGSVGElement | null,
  deg: number,
  transition: string
) {
  if (!el) return;
  el.style.transition = transition;
  el.style.rotate = deg ? `${deg.toFixed(2)}deg` : "0deg";
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

  /** 本次手势里唱臂还能抬多少（到暂停位为止） */
  const armRoomRef = useRef(ARM_LIFT_DELTA);

  /**
   * 唱臂角度：只跟「滑了多远」有关，跟方向无关。
   * 切割动作永远是抬臂（逆时针 = 负角度），所以左右滑都往同一个方向转，
   * 幅度按位移线性增长，最多抬到与暂停相同的 -40°（播放位 -4° 起补 36°）。
   * 只写 `rotate`（容器负责反向 translate 让轴心不动）。
   */
  const writeArmAngle = useCallback(
    (x: number) => {
      if (!dragRefs) return;
      const width = window.innerWidth || 360;
      const angle = -Math.min(
        armRoomRef.current,
        (Math.abs(x) / width) * ARM_FOLLOW_RATIO
      );
      writeArmRotate(
        dragRefs.tonearmArm?.current ?? null,
        angle,
        ARM_FOLLOW_TRANSITION
      );
    },
    [dragRefs]
  );

  const settleArm = useCallback(() => {
    if (!dragRefs) return;
    writeArmRotate(
      dragRefs.tonearmArm?.current ?? null,
      0,
      ARM_SETTLE_TRANSITION
    );
  }, [dragRefs]);

  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearArmTimer = useCallback(() => {
    if (armTimerRef.current !== null) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
  }, []);

  /**
   * 确认切歌：唱臂先甩到切割位停住，等新唱片滑进来落位后再转回播放位。
   * 不再像以前那样松手就立刻归零 —— 那看起来像「还没换片针就落下了」。
   */
  const cutArm = useCallback(() => {
    if (!dragRefs) return;
    markSwipeArmCut();
    writeArmRotate(
      dragRefs.tonearmArm?.current ?? null,
      -armRoomRef.current,
      ARM_CUT_TRANSITION
    );
    clearArmTimer();
    armTimerRef.current = setTimeout(() => {
      armTimerRef.current = null;
      settleArm();
    }, ARM_READY_DELAY);
  }, [dragRefs, clearArmTimer, settleArm]);

  /** 收手：清掉延迟归位的定时器，把唱臂立刻放回播放位 */
  const restArm = useCallback(() => {
    clearArmTimer();
    settleArm();
  }, [clearArmTimer, settleArm]);

  useEffect(() => clearArmTimer, [clearArmTimer]);

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
      horizFlagRef.current = false;
      cancelDragFrame();
      writeDragX(0);
      restArm();
    }
  }, [cancelDragFrame, writeDragX, restArm, dragRefs]);

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
          horizFlagRef.current = false;
          // 记下这次手势里唱臂还能抬多少：暂停时唱臂已经在 -40°，
          // 再叠 36° 就会冲过头，所以只补「到暂停位为止」的差值
          const base = readArmBaseAngle(dragRefs.tonearmArm?.current ?? null);
          armRoomRef.current = Math.max(
            0,
            Math.min(ARM_LIFT_DELTA, base - ARM_LIFT_TARGET)
          );
          cancelDragFrame();
          writeDragX(0);
          restArm();
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
    [enabled, onTap, cancelDragFrame, writeDragX, restArm, dragRefs]
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
      } else if (gesture.axis === "horizontal") {
        // 跟手：封面随手指横移，松手后才决定回弹还是切歌。
        // 有 DOM 直写目标时只写样式、不 setState —— 这是横滑丝滑的关键：
        // 每个 touchmove 都 setState 会让整个播放页每帧重渲染，肉眼可见地卡。
        const x = dx * HORIZONTAL_RESISTANCE;
        if (dragRefs) {
          // 方向刚判定的第一帧切一次 transition（关掉过渡才跟手），只此一次
          if (!horizFlagRef.current) {
            horizFlagRef.current = true;
            setIsHorizDragging(true);
          }
          scheduleDragX(x);
          writeArmAngle(x);
        } else {
          setIsHorizDragging(true);
          setDragX(x);
        }
      }
    },
    [enabled, scheduleDragX, writeArmAngle, dragRefs]
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
          setSlideSnap(true);
          if (dx < 0) onNext();
          else onPrev();

          // 三帧时序，保证每一帧的 transition 状态都已由 React 落到 DOM：
          // 第 1 帧关掉过渡后瞬移到进场起点；
          // 第 2 帧让 React 把过渡写回去；
          // 第 3 帧归零，由 CSS 过渡把新封面滑到位。
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
      onTap,
      reset,
      cancelDragFrame,
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
