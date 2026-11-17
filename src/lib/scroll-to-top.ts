/**
 * 「点顶部回到顶部」的滚动执行层。
 *
 * 页面里同时存在两层滚动：
 * - MusicLayout 的 `h-full overflow-auto`（tab 页的主滚动区）
 * - PageLayout 页面内 MusicPlaylistView 自己的 `overflow-y-auto`（详情页的列表）
 *
 * 因此不能只滚 `window`，也不能靠「向上找最近的滚动祖先」——点击的顶栏和滚动容器
 * 是兄弟节点，不是祖孙关系。这里统一给主滚动容器打上 `data-page-scroll` 标记，
 * 点击时把它们全部归零；本就在 0 的容器会被跳过，重复调用无副作用。
 */

/** 主滚动容器标记属性名 */
export const PAGE_SCROLL_SELECTOR = "[data-page-scroll]";

/**
 * 把当前页面所有主滚动容器滚回顶部。
 *
 * 默认用 `auto`（瞬时归零）而不是 `smooth`：浏览器自带的平滑滚动跑完一次要
 * 600~700ms，点完顶部后要等半秒多才看到列表动，手感就是「点了没反应」。
 * 系统「点状态栏回顶」本身还有一次 loadUrl 注入的固定延迟，再叠加动画就更慢。
 *
 * @param behavior 滚动行为，默认 `auto`；需要动画时显式传 `smooth`
 * @returns 是否真的发生了滚动（已经在顶部时返回 false）
 */
export function scrollPageToTop(behavior: ScrollBehavior = "auto"): boolean {
  if (typeof document === "undefined") return false;

  const targets: HTMLElement[] = [];
  document.querySelectorAll<HTMLElement>(PAGE_SCROLL_SELECTOR).forEach((el) => {
    if (el.scrollTop > 0) targets.push(el);
  });

  const windowMoved = typeof window !== "undefined" && window.scrollY > 0;

  if (targets.length === 0 && !windowMoved) return false;

  targets.forEach((el) => el.scrollTo({ top: 0, behavior }));

  // 浏览器（非 Capacitor WebView）里 document 自身也可能滚动，兜底一次
  if (windowMoved) {
    window.scrollTo({ top: 0, behavior });
  }

  /**
   * 惯性滑动的页面点「回顶」时会失效：手势虽然结束了，滚动还在按惯性继续推进，
   * 我们这一帧设成 0 之后，下一帧又被 fling 顶回去，看起来就是「点了没反应」。
   *
   * 一次 fling 在 WebView 里能滑 1s 以上，按固定帧数按住 0 根本压不住（8 帧只有
   * ~130ms，剩下的惯性照样把列表带下去）。这里改成「陪跑」：每帧都按回 0，
   * 直到连续若干帧都没再被顶走（惯性耗尽）才收手，另有 1.2s 的兜底上限。
   *
   * 平滑滚动时不这么做，会和动画抢位置。
   */
  if (behavior !== "smooth" && targets.length > 0) {
    let frames = 0;
    let idleFrames = 0;
    const MAX_FRAMES = 72; // ≈1.2s，正常 fling 早就结束了
    const IDLE_FRAMES = 8; // 连续静止 ~130ms 视为惯性已停

    const hold = () => {
      let moved = false;
      targets.forEach((el) => {
        if (el.scrollTop !== 0) {
          el.scrollTop = 0;
          moved = true;
        }
      });

      idleFrames = moved ? 0 : idleFrames + 1;
      frames += 1;

      if (idleFrames < IDLE_FRAMES && frames < MAX_FRAMES) {
        requestAnimationFrame(hold);
      }
    };

    requestAnimationFrame(hold);
  }

  return true;
}

/**
 * 接住 HyperOS「点状态栏回到顶部」的系统调用。
 *
 * 系统（ViewRootImplStubImpl）发现顶层 View 是 WebView 且自身偏移为 0 时，会执行
 * `loadUrl("javascript:window.scrollTo(0,0);")`。我们的列表是在内层 div 里滚动的，
 * WebView 自身偏移永远是 0，所以系统每次都只调这一个方法，页面看起来毫无反应。
 *
 * 这里包一层 `window.scrollTo`：一旦收到精确的 `(0, 0)` 调用，就把带
 * `data-page-scroll` 的容器一并归零。只认数值形式的 `(0,0)`——我们自己兜底用的是
 * 对象形式 `{ top: 0 }`，不会互相递归。
 *
 * @returns 卸载函数，恢复原始的 `window.scrollTo`
 */
export function installSystemScrollToTopBridge(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const original = window.scrollTo;
  let inner = false;

  const patched = function (...args: unknown[]) {
    (original as (...rest: unknown[]) => void).apply(window, args);

    if (inner || args.length !== 2 || args[0] !== 0 || args[1] !== 0) return;

    inner = true;
    try {
      scrollPageToTop();
    } finally {
      inner = false;
    }
  } as unknown as typeof window.scrollTo;

  window.scrollTo = patched;

  return () => {
    if (window.scrollTo === patched) window.scrollTo = original;
  };
}
