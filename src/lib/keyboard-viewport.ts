/** 小于此值视为导航栏/舍入误差，不当成键盘 */
const KEYBOARD_OVERLAP_MIN_PX = 80;

export interface KeyboardViewportPatch {
  height: number;
  translateY: number;
}

/**
 * 键盘弹出后，布局视口往往还是全屏，可视区域被顶上去。
 * 有明显重叠或页面被上推时，把壳层缩进可视区域并平移回来。
 *
 * @returns 不需要调整时返回 null
 */
export function keyboardViewportPatch(
  innerHeight: number,
  viewportHeight: number,
  offsetTop: number
): KeyboardViewportPatch | null {
  const overlap = innerHeight - viewportHeight - offsetTop;
  if (overlap < KEYBOARD_OVERLAP_MIN_PX && offsetTop <= 1) return null;
  return {
    height: Math.max(0, Math.round(viewportHeight)),
    translateY: Math.max(0, Math.round(offsetTop)),
  };
}

/** 监听 visualViewport，键盘弹出时把壳层钉在键盘上方 */
export function bindKeyboardViewport(shell: HTMLElement): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};

  const apply = () => {
    const patch = keyboardViewportPatch(
      window.innerHeight,
      viewport.height,
      viewport.offsetTop
    );
    document.documentElement.style.setProperty(
      "--vv-height",
      `${Math.round(viewport.height)}px`
    );
    if (!patch) {
      shell.style.height = "";
      shell.style.transform = "";
      return;
    }
    shell.style.height = `${patch.height}px`;
    shell.style.transform = patch.translateY
      ? `translateY(${patch.translateY}px)`
      : "";
  };

  apply();
  viewport.addEventListener("resize", apply);
  viewport.addEventListener("scroll", apply);
  return () => {
    viewport.removeEventListener("resize", apply);
    viewport.removeEventListener("scroll", apply);
    shell.style.height = "";
    shell.style.transform = "";
    document.documentElement.style.removeProperty("--vv-height");
  };
}
