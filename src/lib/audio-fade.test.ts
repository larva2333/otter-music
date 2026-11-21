import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fadeOutAndPause, muteAndPause, restoreVolume } from "@/lib/audio-fade";

type FakeAudio = HTMLAudioElement & { volume: number; paused: boolean };

/** 最小 audio 桩：只需要 volume / paused / pause()，不必真的解码音频 */
function makeAudio(volume = 1, paused = false): FakeAudio {
  return {
    volume,
    paused,
    pause() {
      (this as FakeAudio).paused = true;
    },
  } as unknown as FakeAudio;
}

describe("audio-fade", () => {
  beforeEach(() => {
    // performance.now 也要 fake：阶梯按真实经过时间算进度，否则推进假定时器时
    // 进度永远停在 0，测不到收尾分支
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("淡出分步压到 0 再暂停，不是一次硬切", () => {
    const audio = makeAudio(1, false);

    fadeOutAndPause(audio);
    vi.advanceTimersByTime(16);
    const mid = audio.volume;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(audio.paused).toBe(false);

    vi.advanceTimersByTime(80);
    expect(audio.volume).toBe(0);
    expect(audio.paused).toBe(true);
  });

  it("主线程卡住导致 tick 被推迟时，下一次直接归零并暂停", () => {
    const audio = makeAudio(1, false);

    fadeOutAndPause(audio);
    // 模拟切歌时主线程被阻塞 200ms：中间没有任何 tick 机会
    vi.advanceTimersByTime(200);

    expect(audio.volume).toBe(0);
    expect(audio.paused).toBe(true);
  });

  it("已经暂停时直接把音量归零，不排空阶梯", () => {
    const audio = makeAudio(0.8, true);

    fadeOutAndPause(audio);

    expect(audio.volume).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("muteAndPause 同步静音并暂停（换 src 前必须立刻生效）", () => {
    const audio = makeAudio(0.65, false);

    muteAndPause(audio);

    expect(audio.volume).toBe(0);
    expect(audio.paused).toBe(true);
  });

  it("restoreVolume 作废进行中的淡出，旧阶梯不会再压低音量", () => {
    const audio = makeAudio(1, false);

    // 暂停 → 淡出排上阶梯
    fadeOutAndPause(audio);
    vi.advanceTimersByTime(16);
    expect(audio.volume).toBeLessThan(1);

    // 用户立刻又点播放：先恢复音量，再起播
    audio.paused = false;
    restoreVolume(audio, 1);
    expect(audio.volume).toBe(1);

    // 旧阶梯醒来时 token 已失效，不能把音量再压回去
    vi.advanceTimersByTime(200);
    expect(audio.volume).toBe(1);
    expect(audio.paused).toBe(false);
  });
});
