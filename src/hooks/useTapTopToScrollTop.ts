import { useEffect } from "react";
import {
  installSystemScrollToTopBridge,
  scrollPageToTop,
} from "@/lib/scroll-to-top";

/**
 * 「点顶部回到顶部」的手势层。
 *
 * 触发条件（同时满足）：
 * 1. 是一次「点击」而不是滑动：位移 ≤ {@link TAP_MAX_MOVE}px、时长 ≤
 *    {@link TAP_MAX_DURATION}ms；
 * 2. 手指落点属于顶栏（带 `data-tap-top` 的容器）或屏幕最上方的系统栏条带；
 * 3. 没有落在按钮/输入框等可交互元素上，否则会和返回键、扫描按钮冲突。
 *
 * 关于「点手机顶部状态栏」：状态栏那一条带属于 SystemUI 的窗口，触摸会被系统
 * 直接消费掉，应用（包括 Activity 的 dispatchTouchEvent）收不到。HyperOS 的处理是
 * 系统自己给应用发「回顶」信号：ViewRootImplStubImpl 会用反射在顶层可滚动 View 上
 * 查找 `smoothScrollToPosition` / `scrollToPosition` 等方法（参数 int，传 0）。
 * 标准 WebView 没有这些方法，所以失效；OtterWebView 补上了它们，收到后派发
 * {@link NATIVE_SCROLL_TO_TOP_EVENT} 事件给这里。
 *
 * 因此真正生效的是三条路：
 * - 应用自己的顶栏（`data-tap-top` 标记的那一条）；
 * - 原生 OtterWebView 转发过来的 {@link NATIVE_SCROLL_TO_TOP_EVENT} 事件；
 * - 系统注入的 `window.scrollTo(0,0)`，由 {@link installSystemScrollToTopBridge} 接住。
 * {@link STATUS_BAR_SLOP} 分支只在浏览器或触摸恰好传进来时兜底。
 */

/** 判定为点击的最大位移（px），超过视为滑动 */
const TAP_MAX_MOVE = 12;
/** 判定为点击的最大时长（ms），超过视为长按 */
const TAP_MAX_DURATION = 600;
/** 系统状态栏条带的额外容差（px） */
const STATUS_BAR_SLOP = 8;

/** 命中这些元素时不触发，避免抢走按钮/输入框的点击 */
const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [role="switch"], [role="slider"], [data-tap-top-ignore]';

/** 弹层内的点击不触发，避免滚动底下的列表 */
const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [data-vaul-drawer]';

/** 原生 OtterWebView 收到 HyperOS「回顶」信号后派发的事件名 */
export const NATIVE_SCROLL_TO_TOP_EVENT = "otter:scroll-to-top";

/** 读取状态栏高度（safe-area.ts 已把 `--safe-area-top` 折算成像素值） */
function readStatusBarHeight(): number {
  if (typeof window === "undefined") return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(
    "--safe-area-top"
  );
  const px = Number.parseFloat(raw);
  return Number.isFinite(px) ? px : 0;
}

/**
 * 挂载全局顶部点击手势。在 RootLayout 里调用一次即可覆盖所有路由。
 */
export function useTapTopToScrollTop(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let start: { x: number; y: number; time: number } | null = null;

    const handlePointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) {
        start = null;
        return;
      }
      start = { x: e.clientX, y: e.clientY, time: Date.now() };
    };

    const handlePointerUp = (e: PointerEvent) => {
      const origin = start;
      start = null;
      if (!origin || !e.isPrimary) return;

      const moved = Math.hypot(e.clientX - origin.x, e.clientY - origin.y);
      if (moved > TAP_MAX_MOVE) return;
      if (Date.now() - origin.time > TAP_MAX_DURATION) return;

      const target = document.elementFromPoint(origin.x, origin.y);
      if (!target) return;
      if (target.closest(INTERACTIVE_SELECTOR)) return;
      if (target.closest(OVERLAY_SELECTOR)) return;

      const onTopBar = Boolean(target.closest("[data-tap-top]"));
      const onStatusBarStrip =
        origin.y <= readStatusBarHeight() + STATUS_BAR_SLOP;

      if (!onTopBar && !onStatusBarStrip) return;

      scrollPageToTop();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointerup", handlePointerUp, true);

    // 原生 OtterWebView 收到 HyperOS 的「点状态栏回顶」信号后转发过来的事件：
    // 状态栏那一条带的触摸到不了 WebView，只能由系统回调里代为触发。
    const handleNativeScrollToTop = () => {
      scrollPageToTop();
    };
    window.addEventListener(
      NATIVE_SCROLL_TO_TOP_EVENT,
      handleNativeScrollToTop
    );

    // 系统在 WebView 自身偏移为 0 时走 loadUrl 注入 `window.scrollTo(0,0)`，
    // 包一层把它转成「内层列表也归零」。
    const removeSystemBridge = installSystemScrollToTopBridge();

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener(
        NATIVE_SCROLL_TO_TOP_EVENT,
        handleNativeScrollToTop
      );
      removeSystemBridge();
    };
  }, [enabled]);
}
