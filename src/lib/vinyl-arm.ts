/**
 * 唱臂旋转的唯一通道。
 *
 * 唱臂只有一个可变量：SVG 上的 CSS `rotate`（绝对角度，播放 -4°、暂停 -40°）。
 * 所有写入方（播放/暂停、横滑跟手、切歌动画）都先读当前视觉角度，再以恒定角速度
 * （0.12°/ms，即 36° / 300ms）平滑过渡到目标角度。
 *
 * 切歌动画（「当前角 → 抬至 -40° → 落回 -4°」）走单条连续 WAAPI 动画：
 * - 不再停在半空等待音源/封面网络就绪（那会导致「顿一下」）；
 * - 不再用两段 CSS transition + setTimeout 拼接（两段之间有帧间停顿，且横滑剩余角度
 *   仍套 300ms 会导致抬臂慢、落针快、整体不匀速）；
 * - 预先把 inline `rotate` 写到终点角（-4°），WAAPI 不需要 `fill: forwards`，
 *   动画结束时没有交接闪烁。
 */

export const ARM_PLAY_ANGLE = -4;
export const ARM_PAUSE_ANGLE = -40;

/** 恒定角速度：与播放/暂停一致（36° / 300ms = 0.12°/ms） */
export const ARM_ANGULAR_SPEED = (ARM_PLAY_ANGLE - ARM_PAUSE_ANGLE) / 300;

/**
 * 播放/暂停稳态切换：匀速、同速（36° / 300ms）。
 */
export const ARM_STEADY_TRANSITION = "rotate 300ms linear";
/** 横滑跟手：一帧到位才跟得住手，不能有过渡 */
export const ARM_FOLLOW_TRANSITION = "none";
/** 松手/切歌抬到切割位 */
export const ARM_CUT_TRANSITION = "rotate 300ms linear";
/** 新唱片落位后转回播放位 */
export const ARM_SETTLE_TRANSITION = "rotate 300ms linear";

/** 根据角度差计算恒定角速度对应的过渡字符串 */
export function buildArmTransition(fromAngle: number, toAngle: number): string {
  const delta = Math.abs(toAngle - fromAngle);
  if (delta < 0.01) return "none";
  const ms = Math.max(16, Math.round(delta / ARM_ANGULAR_SPEED));
  return `rotate ${ms}ms linear`;
}

const ANGLE_RE = /^(-?\d+(?:\.\d+)?)deg/;

/**
 * 读唱臂当前角度。优先 computed（WAAPI / CSS transition 进行中时这才是真实视觉角度），
 * 测试环境/jsdom 没有展开 computed 时回退到 inline style。
 */
export function readArmAngle(el: SVGElement | null): number {
  if (!el) return ARM_PLAY_ANGLE;
  if (typeof getComputedStyle === "function") {
    const value = getComputedStyle(el).rotate;
    const matched = value && value !== "none" ? value.match(ANGLE_RE) : null;
    if (matched) return Number(matched[1]);
  }
  const inline = el.style.rotate.match(ANGLE_RE);
  return inline ? Number(inline[1]) : ARM_PLAY_ANGLE;
}

/** 写唱臂绝对角度；transition 不传时保留元素上已有的值 */
export function writeArmAngle(
  el: SVGElement | null,
  angle: number,
  transition?: string
): void {
  if (!el) return;
  if (transition !== undefined) el.style.transition = transition;
  el.style.rotate = `${Number(angle.toFixed(2))}deg`;
}

/**
 * 手势占用窗口：横滑期间手势直接写角度，VinylCover 的播放/暂停 effect 必须让开，
 * 否则切歌时 isPlaying 一翻就会把手势的切歌动作打断。
 */
let gestureArmUntil = 0;

export function markGestureArmControl(durationMs = 1000): void {
  gestureArmUntil = Date.now() + durationMs;
}

export function isGestureArmControlled(): boolean {
  return Date.now() < gestureArmUntil;
}

/* -------------------------------------------------------------------------- */
/*                              切歌连续动画控制器                             */
/* -------------------------------------------------------------------------- */

export type ArmReadySource = "audio" | "cover";

interface ArmCutSession {
  el: SVGSVGElement;
  animation: Animation | null;
  liftTimer: ReturnType<typeof setTimeout> | null;
  dropTimer: ReturnType<typeof setTimeout> | null;
  done: boolean;
}

/** VinylCover 挂载时注册，卸载/换节点时注销 */
let registeredArm: SVGSVGElement | null = null;
let onCutFinishCallback: (() => void) | null = null;
let activeCut: ArmCutSession | null = null;

export function registerArm(
  el: SVGSVGElement | null,
  onCutFinish?: () => void
): void {
  if (registeredArm === el) {
    onCutFinishCallback = onCutFinish ?? null;
    return;
  }
  registeredArm = el;
  onCutFinishCallback = onCutFinish ?? null;
  // 唱臂节点换了（退出播放页、切换封面样式）：旧会话写的是已卸载的 DOM，直接收掉
  if (activeCut && activeCut.el !== el) cancelArmCut();
}

export function getRegisteredArm(): SVGSVGElement | null {
  return registeredArm;
}

/** 播放/暂停的稳态 effect 用它判断要不要让开正在进行的切歌 */
export function isArmCutPending(): boolean {
  return activeCut !== null && !activeCut.done;
}

function clearSessionTimers(session: ArmCutSession): void {
  if (session.liftTimer !== null) {
    clearTimeout(session.liftTimer);
    session.liftTimer = null;
  }
  if (session.dropTimer !== null) {
    clearTimeout(session.dropTimer);
    session.dropTimer = null;
  }
}

/** 取消当前切歌会话，并把当前视觉角度定格到 inline（避免回跳） */
export function cancelArmCut(): void {
  const session = activeCut;
  if (!session) return;
  activeCut = null;
  session.done = true;
  clearSessionTimers(session);
  if (session.animation) {
    const current = readArmAngle(session.el);
    session.animation.onfinish = null;
    session.animation.oncancel = null;
    session.animation.cancel();
    writeArmAngle(session.el, current, "none");
  }
}

function finishSession(session: ArmCutSession): void {
  if (session.done || activeCut !== session) return;
  session.done = true;
  clearSessionTimers(session);
  activeCut = null;
  onCutFinishCallback?.();
}

/**
 * 开始一次切歌：从当前真实视觉角度以恒定角速度（0.12°/ms）连续完成
 * 「抬臂到 -40° → 立即匀速落回 -4°」，中间不停顿、不等网络/图片就绪。
 *
 * - 暂停态起手（已在 -40°）只跑单段「-40° → -4°」（300ms），与点播放完全一致；
 * - 横滑松手接力时从松手角度起算剩余抬臂时长，整段速度与播放/暂停完全一致；
 * - 全程使用单条 WAAPI 动画（无 fill:forwards），提前把 inline 设为终点 -4°。
 */
export function beginArmCut(
  options: { hasCover?: boolean; reducedMotion?: boolean } = {}
): void {
  const el = registeredArm;
  if (!el) return;

  // 在取消前读出真实视觉角度，连续切歌时从当前位置顺滑接力
  const startAngle = readArmAngle(el);
  cancelArmCut();

  if (options.reducedMotion) {
    writeArmAngle(el, ARM_PLAY_ANGLE, "none");
    return;
  }

  const liftDeg = Math.max(0, startAngle - ARM_PAUSE_ANGLE);
  const dropDeg = ARM_PLAY_ANGLE - ARM_PAUSE_ANGLE;
  const liftMs = liftDeg / ARM_ANGULAR_SPEED;
  const dropMs = dropDeg / ARM_ANGULAR_SPEED;
  const totalMs = Math.max(16, Math.round(liftMs + dropMs));

  const session: ArmCutSession = {
    el,
    animation: null,
    liftTimer: null,
    dropTimer: null,
    done: false,
  };
  activeCut = session;

  // 优先单条连续 WAAPI 动画：零定时器接缝、纯合成线程匀速运行
  if (typeof el.animate === "function") {
    writeArmAngle(el, ARM_PLAY_ANGLE, "none");

    const keyframes: Keyframe[] =
      liftDeg < 0.5
        ? [
            { rotate: `${Number(startAngle.toFixed(2))}deg` },
            { rotate: `${ARM_PLAY_ANGLE}deg` },
          ]
        : [
            { rotate: `${Number(startAngle.toFixed(2))}deg` },
            { rotate: `${ARM_PAUSE_ANGLE}deg`, offset: liftMs / totalMs },
            { rotate: `${ARM_PLAY_ANGLE}deg` },
          ];

    const anim = el.animate(keyframes, {
      duration: totalMs,
      easing: "linear",
    });
    session.animation = anim;
    anim.onfinish = () => finishSession(session);
    return;
  }

  // 兜底（jsdom 等无 WAAPI 环境）：按同一角速度走 CSS 过渡
  if (liftDeg < 0.5) {
    writeArmAngle(
      el,
      ARM_PLAY_ANGLE,
      buildArmTransition(startAngle, ARM_PLAY_ANGLE)
    );
    session.dropTimer = setTimeout(
      () => finishSession(session),
      Math.round(dropMs)
    );
    return;
  }

  const roundedLiftMs = Math.max(16, Math.round(liftMs));
  writeArmAngle(
    el,
    ARM_PAUSE_ANGLE,
    buildArmTransition(startAngle, ARM_PAUSE_ANGLE)
  );
  session.liftTimer = setTimeout(() => {
    if (session.done || activeCut !== session) return;
    session.liftTimer = null;
    writeArmAngle(el, ARM_PLAY_ANGLE, ARM_SETTLE_TRANSITION);
    session.dropTimer = setTimeout(
      () => finishSession(session),
      Math.round(dropMs)
    );
  }, roundedLiftMs);
}

/** 保留导出以兼容既有音频/封面就绪通知调用方；切歌动画不再等待网络就绪 */
export function notifyArmReady(_source: ArmReadySource): void {
  void _source;
}
