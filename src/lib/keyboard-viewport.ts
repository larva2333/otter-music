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

  // 键盘未弹时的布局视口高度（adjustResize 下窗口会被键盘压缩）。
  // 只增不减：旋转变高时跟随，避免把普通变矮误判成键盘。
  let fullHeight = window.innerHeight;

  const apply = () => {
    if (window.innerHeight > fullHeight) fullHeight = window.innerHeight;
    const patch = keyboardViewportPatch(
      window.innerHeight,
      viewport.height,
      viewport.offsetTop
    );
    document.documentElement.style.setProperty(
      "--vv-height",
      `${Math.round(viewport.height)}px`
    );
    // 键盘真实遮挡高度：抽屉/弹窗在 body 层的 portal 里，页面壳层的缩放管不到它们，
    // 这里留一个全局变量给它们把底边抬到键盘上方（窗口本身已缩小时为 0，不会叠加）
    const keyboardInset = Math.max(
      0,
      Math.round(window.innerHeight - viewport.height - viewport.offsetTop)
    );
    document.documentElement.style.setProperty(
      "--kb-inset",
      `${keyboardInset}px`
    );
    // adjustResize 下窗口被键盘压缩的高度：底部播放条/导航用 transform 下移同样
    // 高度，视觉上钉在屏幕原位（被键盘盖住），而不是被顶到键盘上方
    const kbLift = Math.max(0, Math.round(fullHeight - window.innerHeight));
    document.documentElement.style.setProperty("--kb-lift", `${kbLift}px`);
    // 居中弹窗要往上抬半个键盘高度，才能落在「键盘上方」这段可视区正中
    document.documentElement.style.setProperty(
      "--kb-half",
      `${Math.round(keyboardInset / 2)}px`
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
  // 旋转后重算「全高」基准，避免把变矮的窗口误判成键盘
  const onOrientationChange = () => {
    window.setTimeout(() => {
      fullHeight = window.innerHeight;
      apply();
    }, 300);
  };
  window.addEventListener("orientationchange", onOrientationChange);
  return () => {
    viewport.removeEventListener("resize", apply);
    viewport.removeEventListener("scroll", apply);
    window.removeEventListener("orientationchange", onOrientationChange);
    shell.style.height = "";
    shell.style.transform = "";
    document.documentElement.style.removeProperty("--vv-height");
    document.documentElement.style.removeProperty("--kb-inset");
    document.documentElement.style.removeProperty("--kb-lift");
    document.documentElement.style.removeProperty("--kb-half");
  };
}
