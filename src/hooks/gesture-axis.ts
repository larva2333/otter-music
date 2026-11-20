/**
 * 手势主轴仲裁 + 多选笔刷互斥。
 *
 * 同一个 touch 序列上，内容区横滑（useSwipeCategories）和下拉刷新
 * （usePullToRefresh）各自监听 touchmove。以前两边用不同的判定比例，
 * 斜着滑时会出现「一边横滑切页、一边露出下拉指示器」；
 * 长按多选的笔刷手势也会带着页面下拉刷新。
 *
 * 这里把判定收敛成一份：两边都调用 lockAxis() 并锁定结果，
 * 整段手势只读第一次越过死区时的判定；多选笔刷期间两个 hook 都直接放行。
 */

/** 判定主轴前必须越过的位移（px），手指刚落下时的轻微抖动不算 */
export const AXIS_LOCK_DISTANCE = 10;
/** 主轴相对副轴的最小倍数：斜划不误触 */
export const DIRECTION_RATIO = 1.2;
/** 横向可滚动容器的判定余量（px） */
const SCROLLER_SLACK = 4;

export type GestureAxis = "none" | "x" | "y";

/**
 * 用与横滑 hook 完全相同的规则判定主轴：
 * 横向占优（|dx| > |dy| * 1.2）才是 x，其余（纵滑、上滑、斜滑）都是 y。
 * 两个 hook 从同一次 touchstart 记起点、用同一个函数判定，
 * 就不会出现各判各的灰色地带。
 */
export function lockAxis(dx: number, dy: number): GestureAxis {
  if (Math.abs(dx) < AXIS_LOCK_DISTANCE && Math.abs(dy) < AXIS_LOCK_DISTANCE) {
    return "none";
  }
  return Math.abs(dx) > Math.abs(dy) * DIRECTION_RATIO ? "x" : "y";
}

/** 长按后的滑动多选笔刷正在进行（其 document touchmove 会 preventDefault 并连续勾选） */
let dragSelecting = false;

export function setDragSelecting(active: boolean) {
  dragSelecting = active;
}

export function isDragSelecting() {
  return dragSelecting;
}

/**
 * 触摸点是否落在「内部可横向滚动」的元素里。
 * 横向滚动的卡片行、分类子 tab 该由元素自己处理，不能拿来切页。
 */
export function isInsideHorizontalScroller(
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

/** 输入控件上的滑动留给系统（移动光标 / 选中文本） */
export function isTextInputTarget(target: Element | null): boolean {
  if (!target || typeof target.closest !== "function") return false;
  return Boolean(target.closest("input, textarea, select"));
}
