/** 小于此值视为导航栏/舍入误差，不当成键盘 */
const KEYBOARD_OVERLAP_MIN_PX = 80;

/** 键盘开合时临时把底部栏过渡归零，之后再恢复的延迟 */
const ANIM_SUPPRESS_MS = 400;

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

/**
 * 底部固定栏（播放胶囊 / 导航栏）要下移多少，才能"钉"在屏幕原位而不是被顶到键盘上方。
 *
 * 两种键盘实现各算一遍：
 * - 壳层被 {@link keyboardViewportPatch} 显式缩小时（Android 15+ 强制 edge-to-edge，
 *   IME 不再 resize 窗口，innerHeight 恒为全屏高），壳底已经落在键盘上沿 → 下移
 *   `壳层可视高度 + 偏移`；
 * - 窗口被 adjustResize 压缩时（Android 14 及以下），壳层高度跟着 dvh 变，壳底同样
 *   落在键盘上沿 → 下移压缩量 `fullHeight - layoutHeight`。
 */
export function keyboardLift(
  fullHeight: number,
  patch: KeyboardViewportPatch | null,
  layoutHeight: number
): number {
  const base = patch ? patch.height + patch.translateY : layoutHeight;
  return Math.max(0, Math.round(fullHeight - base));
}

/** 监听 visualViewport，键盘弹出时把壳层钉在键盘上方 */
export function bindKeyboardViewport(shell: HTMLElement): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};

  // 键盘未弹时的布局视口高度（adjustResize 下窗口会被键盘压缩）。
  // 只增不减：旋转变高时跟随，避免把普通变矮误判成键盘。
  let fullHeight = window.innerHeight;
  // 上一次的键盘开合状态 + 关掉过渡的计时器（见 apply 内的注释）
  let kbOpen = false;
  let animTimer = 0;

  const apply = () => {
    if (window.innerHeight > fullHeight) fullHeight = window.innerHeight;
    const patch = keyboardViewportPatch(
      window.innerHeight,
      viewport.height,
      viewport.offsetTop
    );

    // 键盘开合那一帧壳层高度是同步跳变的（布局立刻收缩），但底部栏的 transform
    // 还带着 320ms 过渡 —— 它会先出现在键盘上沿（看起来"弹起来"），再花 320ms
    // 滑回屏幕底（看起来"被挤下去隐藏"）。开合瞬间把过渡时长归零，让布局收缩和
    // 位移补偿落在同一帧，底部栏就待在原地不动；400ms 后恢复过渡时长，
    // 保留 tab ↔ 二级页切换时的 68px 平滑位移。
    const open = patch !== null;
    if (open !== kbOpen) {
      kbOpen = open;
      window.clearTimeout(animTimer);
      document.documentElement.style.setProperty("--kb-anim", "0ms");
      animTimer = window.setTimeout(() => {
        document.documentElement.style.removeProperty("--kb-anim");
      }, ANIM_SUPPRESS_MS);
    }

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
    // 底部播放条/导航栏用 transform 下移同样的高度，视觉上钉在屏幕原位（被键盘盖住），
    // 而不是跟着壳层底边被顶到键盘上方
    const kbLift = keyboardLift(fullHeight, patch, window.innerHeight);
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
    window.clearTimeout(animTimer);
    shell.style.height = "";
    shell.style.transform = "";
    document.documentElement.style.removeProperty("--vv-height");
    document.documentElement.style.removeProperty("--kb-inset");
    document.documentElement.style.removeProperty("--kb-lift");
    document.documentElement.style.removeProperty("--kb-half");
    document.documentElement.style.removeProperty("--kb-anim");
  };
}
