/**
 * 轻量滚动位置快照工具。
 *
 * 用于元素从显示切换到 `display: none`（hidden）前记录内部滚动容器的 `scrollTop`，
 * 并在恢复显示时单帧同步还原，避免 `display: none` 导致的滚动归零，
 * 也无需启动多帧 rAF 循环去抢占滑动动画帧率。
 */
const savedScrollTops = new WeakMap<HTMLElement, number>();

function collectScrollContainers(root: HTMLElement): HTMLElement[] {
  const list: HTMLElement[] = [];
  if (root.scrollHeight > root.clientHeight) list.push(root);
  root
    .querySelectorAll<HTMLElement>(
      "[data-page-scroll], [data-market-pane], [data-mine-pane], .overflow-y-auto"
    )
    .forEach((el) => list.push(el));
  return list;
}

export function saveScrollPositions(
  root: HTMLElement | null | undefined
): void {
  if (!root) return;
  for (const el of collectScrollContainers(root)) {
    if (el.scrollTop > 0) {
      savedScrollTops.set(el, el.scrollTop);
    } else {
      savedScrollTops.delete(el);
    }
  }
}

export function restoreScrollPositions(
  root: HTMLElement | null | undefined
): void {
  if (!root) return;
  for (const el of collectScrollContainers(root)) {
    const saved = savedScrollTops.get(el);
    if (saved && saved > 0 && el.scrollTop !== saved) {
      el.scrollTop = saved;
    }
  }
}
