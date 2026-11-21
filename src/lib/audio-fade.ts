/**
 * 切歌 / 暂停前的音频淡出与音量恢复。
 *
 * 直接 `pause()` + 清空 `src` 换流在 Android WebView 上有两个听感问题：
 * 1. 解码器被硬截断，输出一声短促的爆音（pop）；
 * 2. 系统音频通路里还压着几十毫秒的残留缓冲，听感就是「上一首的杂音尾音」。
 * 连续横滑切歌时这两下会连着出现好几次，非常刺耳。
 *
 * 所以打断播放前先用 64ms 把 volume 压到 0 再暂停。音量会停在 0，恢复播放的
 * 一侧必须调 `restoreVolume` 把它**同步**写回目标值 —— 起播前不插任何定时器，
 * 因为切歌那一刻主线程会被封面重建 / 歌词重算阻塞几百毫秒（真机实测 560ms），
 * 延后恢复的写法会让音乐开头静音半秒。
 *
 * 阶梯按真实经过时间算进度，不是「每 16ms 走一步」：主线程卡住时串行的定时器
 * 全被推迟，下一次 tick 直接对齐到该到的音量，最坏退化成一次硬切静音。
 * 也不用 requestAnimationFrame：锁屏或切到后台时 rAF 会被完全暂停，
 * 阶梯会停在中间音量上（轻则半音量播放，重则整首歌静音）。
 */

/** 淡出总时长：短到不影响切歌手感，长到足够避开硬截断的爆音 */
const FADE_OUT_MS = 64;
/** 阶梯刷新间隔 */
const FADE_STEP_MS = 16;

interface FadeSlot {
  token: number;
}

/** 每个 audio 元素一条阶梯：新的淡出/恢复换 token，旧的自己退出 */
const slots = new WeakMap<HTMLAudioElement, FadeSlot>();

/**
 * 作废该元素上进行中的阶梯，返回新的 token。
 *
 * 任何「直接写 volume」的动作都必须先调它，否则进行中的阶梯会在下一次 tick
 * 按自己的进度把音量覆盖回去：暂停时淡出没走完就恢复播放，旧的淡出阶梯
 * 会把音量继续往下压，听起来就是「点了播放没声音，几百毫秒后突然出声」。
 */
function beginFade(audio: HTMLAudioElement): { slot: FadeSlot; token: number } {
  const slot = slots.get(audio) ?? { token: 0 };
  slot.token += 1;
  slots.set(audio, slot);
  return { slot, token: slot.token };
}

function now(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

/**
 * 立刻静音并暂停，不看淡出走没走完。
 *
 * 换 `src` 之前必须同步调用一次：淡出靠定时器推进，而切歌那一刻主线程会被
 * 封面重建 / 取色 / 歌词重算阻塞几百毫秒，定时器全部推迟。如果此时直接换流，
 * 元素还在原音量上被硬截断 —— 解码器断在半路就是一声爆音，
 * 系统音频通路里压着的残留缓冲听起来就是「上一首的杂音尾音」。
 *
 * 写 volume 是同步生效的（音频管线里的增益），所以哪怕解码立刻被掐断，
 * 输出也是静音的；随后由切歌流程在起播前把音量同步写回。
 */
export function muteAndPause(audio: HTMLAudioElement | null): void {
  if (!audio) return;
  // 先作废进行中的阶梯，避免它稍后把音量又拉回中间值
  beginFade(audio);
  audio.volume = 0;
  if (!audio.paused) audio.pause();
}

/**
 * 淡出到 0 后暂停。
 *
 * 不返回 Promise：调用方（切歌 / 暂停流程）不需要等这 64ms，
 * 让换流与音量收尾并行，手感才不会被拖慢。
 */
export function fadeOutAndPause(audio: HTMLAudioElement | null): void {
  if (!audio) return;

  // 已经停了（连续切歌的第二、三次会走到这里）：直接把音量归零即可，
  // 没必要再排一轮空的阶梯
  if (audio.paused) {
    beginFade(audio);
    audio.volume = 0;
    return;
  }

  const start = audio.volume;
  if (start <= 0) {
    audio.pause();
    return;
  }

  const { slot, token } = beginFade(audio);
  const startedAt = now();

  const tick = () => {
    if (slot.token !== token) return;
    const progress = Math.min(1, (now() - startedAt) / FADE_OUT_MS);
    if (progress >= 1) {
      // 收尾强制写 0 再暂停：即使中途掉帧也不会留半音量给下一首
      audio.volume = 0;
      if (!audio.paused) audio.pause();
      return;
    }
    audio.volume = start * (1 - progress);
    window.setTimeout(tick, FADE_STEP_MS);
  };

  window.setTimeout(tick, FADE_STEP_MS);
}

/**
 * 恢复播放前把音量同步写回目标值，并作废可能还在跑的淡出阶梯。
 *
 * 必须在 `audio.play()` **之前**同步调用：起播的第一个采样就该是正常音量，
 * 任何 setTimeout/rAF 延迟都会让用户听到「前奏被吞掉半秒」。
 * 起播时音量从 0 阶跃到目标值不会爆音——爆音来自波形被截断，不是增益跳变。
 */
export function restoreVolume(
  audio: HTMLAudioElement | null,
  volume: number
): void {
  if (!audio) return;
  beginFade(audio);
  audio.volume = volume;
}
