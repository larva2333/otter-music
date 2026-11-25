import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractColorsOffThread,
  renderThemeBackgroundOffThread,
  __resetCoverColorWorker,
} from "@/lib/cover-color-client";
import { renderThemeBackgroundPixels } from "@/lib/theme-background";
import {
  extractFromPixels,
  type ColorMode,
  type SodaColors,
} from "@/lib/utils/soda-color";

/** 构造 96×96 的纯色 RGBA 像素缓冲（与 soda-color 测试同一套输入口径） */
function solidPixels(r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(96 * 96 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return data;
}

interface FakeMessage {
  id: number;
  pixels: Uint8ClampedArray;
  mode: ColorMode;
}

/**
 * 最小 Worker 桩：只实现 client 用到的三件事——postMessage、onmessage、terminate。
 * `reply` 决定收到消息后回什么，由用例自己控制同步/异步投递。
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static reply: ((message: FakeMessage) => void) | null = null;
  static throwOnPost = false;

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: FakeMessage) {
    if (FakeWorker.throwOnPost) throw new Error("DataCloneError");
    FakeWorker.reply?.(message);
  }

  /** 模拟 worker 内部回包 */
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }

  terminate() {
    this.terminated = true;
  }
}

const originalWorker = globalThis.Worker;

function installWorker(): typeof FakeWorker {
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  return FakeWorker;
}

afterEach(() => {
  __resetCoverColorWorker();
  FakeWorker.instances = [];
  FakeWorker.reply = null;
  FakeWorker.throwOnPost = false;
  (globalThis as unknown as { Worker: unknown }).Worker = originalWorker;
  vi.restoreAllMocks();
});

describe("extractColorsOffThread", () => {
  it("没有 Worker 构造器时同步降级到主线程，结果与 extractFromPixels 完全一致", async () => {
    (globalThis as unknown as { Worker: unknown }).Worker = undefined;
    const pixels = solidPixels(34, 68, 204);

    const result = await extractColorsOffThread(pixels, "dark");

    expect(result).toEqual(extractFromPixels(pixels, "dark"));
  });

  it("worker 可用时由 worker 返回颜色，postMessage 带上 id / 像素 / 模式", async () => {
    const Fake = installWorker();
    const fromWorker: SodaColors = {
      dominant: [1, 2, 3],
      top: [4, 5, 6],
      bottom: [7, 8, 9],
    };
    const seen: FakeMessage[] = [];
    Fake.reply = (message) => {
      seen.push(message);
      // 异步回包，模拟真实 worker 的跨线程投递
      setTimeout(
        () => Fake.instances[0].emit({ id: message.id, colors: fromWorker }),
        0
      );
    };

    const pixels = solidPixels(240, 232, 200);
    const result = await extractColorsOffThread(pixels, "light");

    expect(result).toEqual(fromWorker);
    expect(seen).toHaveLength(1);
    expect(seen[0].mode).toBe("light");
    expect(seen[0].id).toBeGreaterThan(0);
    expect(Array.from(seen[0].pixels.slice(0, 3))).toEqual([240, 232, 200]);
  });

  it("worker 返回 error 时降级主线程，调用方仍拿到颜色", async () => {
    const Fake = installWorker();
    Fake.reply = (message) => {
      setTimeout(
        () => Fake.instances[0].emit({ id: message.id, error: "boom" }),
        0
      );
    };
    const pixels = solidPixels(12, 18, 30);

    await expect(extractColorsOffThread(pixels, "dark")).resolves.toEqual(
      extractFromPixels(pixels, "dark")
    );
  });

  it("postMessage 同步抛错（像素无法复制）时降级主线程", async () => {
    const Fake = installWorker();
    Fake.throwOnPost = true;
    const pixels = solidPixels(51, 85, 170);

    await expect(extractColorsOffThread(pixels, "dark")).resolves.toEqual(
      extractFromPixels(pixels, "dark")
    );
  });

  it("worker 崩溃后终止实例，后续请求直接走主线程不再重建", async () => {
    const Fake = installWorker();
    Fake.reply = () => {};
    const pixels = solidPixels(122, 122, 94);

    // 第一次：worker 建起来了，但 onerror 崩掉 → 请求降级主线程
    const promise = extractColorsOffThread(pixels, "dark");
    await Promise.resolve();
    await Promise.resolve();
    const errored = Fake.instances[0];
    errored.onerror?.({ message: "crash", preventDefault() {} } as ErrorEvent);
    await expect(promise).resolves.toEqual(extractFromPixels(pixels, "dark"));
    expect(errored.terminated).toBe(true);

    // 第二次：直接走主线程，不会创建新 worker
    await extractColorsOffThread(pixels, "light");
    expect(Fake.instances).toHaveLength(1);
  });
});

describe("renderThemeBackgroundOffThread", () => {
  const sampleColors: SodaColors = {
    dominant: [80, 120, 200],
    top: [20, 30, 60],
    bottom: [8, 12, 24],
  };

  it("没有 Worker 时同步在主线程合成正确尺寸与 Alpha 的像素", async () => {
    (globalThis as unknown as { Worker: unknown }).Worker = undefined;

    const pixels = await renderThemeBackgroundOffThread(
      16,
      24,
      sampleColors,
      0.55
    );

    expect(pixels.length).toBe(16 * 24 * 4);
    expect(pixels).toEqual(
      renderThemeBackgroundPixels(16, 24, sampleColors, 0.55)
    );
    expect(pixels[3]).toBe(255);
  });

  it("worker 可用时走 worker 通道并解包 buffer；异常时降级主线程", async () => {
    const Fake = installWorker();
    const expected = renderThemeBackgroundPixels(8, 10, sampleColors, 0.05);
    Fake.reply = (message) => {
      const req = message as unknown as { id: number; type?: string };
      if (req.type === "theme-bg") {
        const copy = new Uint8ClampedArray(expected);
        setTimeout(
          () => Fake.instances[0].emit({ id: req.id, buffer: copy.buffer }),
          0
        );
      }
    };

    const viaWorker = await renderThemeBackgroundOffThread(
      8,
      10,
      sampleColors,
      0.05
    );
    expect(viaWorker).toEqual(expected);

    Fake.throwOnPost = true;
    const viaFallback = await renderThemeBackgroundOffThread(
      8,
      10,
      sampleColors,
      0.05
    );
    expect(viaFallback).toEqual(expected);
  });
});
