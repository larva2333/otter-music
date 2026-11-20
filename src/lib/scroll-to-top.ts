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
 * 「回顶」发生前的通知钩子。
 *
 * 歌词页有自己的跟随逻辑：被回顶到开头的瞬间必须知道「这是用户主动回顶」，
 * 才能暂停自动跟随，否则下一句歌词一到又会被拽回中间，回顶等于白按。
 * 回调在真正滚动之前触发，此时还能读到旧的 scrollTop。
 */
const scrollToTopListeners = new Set<() => void>();

/** 订阅「回顶」动作，返回取消订阅函数 */
export function onPageScrollToTop(listener: () => void): () => void {
  scrollToTopListeners.add(listener);
  return () => {
    scrollToTopListeners.delete(listener);
  };
}

/** 取消惯性后锁住滚动的时间（ms），到点或用户按下时恢复 */
const FLING_LOCK_MS = 1000;

interface FlingLock {
  restore: () => void;
  timer: number;
}

const flingLocks = new WeakMap<HTMLElement, FlingLock>();

function releaseFlingLock(el: HTMLElement): void {
  const lock = flingLocks.get(el);
  if (!lock) return;
  window.clearTimeout(lock.timer);
  lock.restore();
  flingLocks.delete(el);
}

/**
 * 取消滚动惯性（fling）。
 *
 * WebView 的惯性滑动跑在合成线程上：手势已经结束，它仍在推进 `scrollTop`。
 * 主线程把 `scrollTop` 写成 0 根本不会被理会，下一帧又被惯性推走——这就是
 * 「点回顶后列表抽搐/抖动」的来源（实测写入 0 之后位移仍按 0→25→51→76… 递增）。
 *
 * 唯一可靠的办法是让滚动节点重建：临时把 `overflow-y` 改成 `hidden` 并强制提交
 * 一次样式，容器被销毁重建，挂在旧节点上的惯性随之消失。锁定只是暂时的，
 * 到点或用户一碰容器就恢复，避免列表被锁住。
 */
function cancelFling(el: HTMLElement): void {
  const existing = flingLocks.get(el);
  if (existing) {
    // 已在锁定中：只延长计时，不要重复记录 overflowY（否则原值会变成 hidden）
    window.clearTimeout(existing.timer);
    existing.timer = window.setTimeout(
      () => releaseFlingLock(el),
      FLING_LOCK_MS
    );
    el.scrollTop = 0;
    return;
  }

  const previousOverflowY = el.style.overflowY;
  el.style.overflowY = "hidden";
  // 不读一次布局的话，hidden 会和后面的恢复合并掉，节点根本不会重建
  void el.offsetHeight;
  el.scrollTop = 0;

  const onPointerDown = (event: Event) => {
    if (el.contains(event.target as Node)) releaseFlingLock(el);
  };
  // 捕获阶段监听：用户一碰列表就立刻解锁
  window.addEventListener("pointerdown", onPointerDown, true);

  const restore = () => {
    window.removeEventListener("pointerdown", onPointerDown, true);
    el.style.overflowY = previousOverflowY;
  };

  const timer = window.setTimeout(() => releaseFlingLock(el), FLING_LOCK_MS);
  flingLocks.set(el, { restore, timer });
}

/**
 * 把当前页面所有主滚动容器滚回顶部。
 *
 * 默认用 `smooth`：回顶是一段「往上滑」的动画，而不是瞬间闪回顶部——
 * 长列表（歌词、歌单）瞬移会让人分不清是回顶了还是页面重绘。
 * 只有明确不在乎过程的场景（例如惯性还没停、要立刻归零）才传 `auto`。
 *
 * @param behavior 滚动行为，默认 `smooth`；需要瞬时归零时显式传 `auto`
 * @returns 是否真的发生了滚动（已经在顶部时返回 false）
 */
export function scrollPageToTop(behavior: ScrollBehavior = "smooth"): boolean {
  if (typeof document === "undefined") return false;

  const targets: HTMLElement[] = [];
  document.querySelectorAll<HTMLElement>(PAGE_SCROLL_SELECTOR).forEach((el) => {
    if (el.scrollTop > 0) targets.push(el);
  });

  const windowMoved = typeof window !== "undefined" && window.scrollY > 0;

  if (targets.length === 0 && !windowMoved) return false;

  // 先通知再滚动：订阅方此时读到的还是滚动前的 scrollTop
  scrollToTopListeners.forEach((listener) => listener());

  targets.forEach((el) => el.scrollTo({ top: 0, behavior }));

  // 浏览器（非 Capacitor WebView）里 document 自身也可能滚动，兜底一次
  if (windowMoved) {
    window.scrollTo({ top: 0, behavior });
  }

  /**
   * 惯性滑动的页面点「回顶」时会失效：手势虽然结束了，滚动还在按惯性继续推进，
   * 我们这一帧设成 0 之后，下一帧又被 fling 顶回去，看起来就是「点了没反应」，
   * 或者到了顶部还在原地来回抖。
   *
   * 这里直接取消惯性（见 cancelFling）；平滑滚动时不这么做，会和动画抢位置。
   */
  if (behavior !== "smooth") {
    targets.forEach(cancelFling);
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
