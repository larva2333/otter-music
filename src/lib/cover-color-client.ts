/**
 * 封面取色的「主线程 / worker」分发层。
 *
 * k-means 本身是纯计算，96×96 像素 × k=8 在主线程上要几十毫秒到两百毫秒。
 * 切歌那一帧本来已经挤着封面换图、背景渐变重绘、歌词重算，再叠一次取色，
 * 主线程就卡到动画掉帧（唱臂动画走到一半冻住，然后整段跳过去）。
 *
 * 所以把聚类丢进 worker，主线程只留 canvas 解码与十几毫秒的收尾。
 * worker 不可用（老 WebView、CSP 禁止 blob worker、测试环境没有 Worker 构造器）
 * 时**同步降级**到主线程计算，功能不受影响，只是慢一点。
 *
 * 约定：
 * - 像素缓冲**不 transfer**，只做 structured clone。36 KB 的复制在 0.1ms 级别，
 *   换来的是降级路径还能复用同一份像素算一遍；
 * - 单 worker 实例，请求靠自增 id 配对，不排队不并发限制——取色本身就是轻任务，
 *   且同一封面的重复请求在 `useCoverColors` 已被去重。
 */
import { logger } from "@/lib/logger";
import {
  extractFromPixels,
  type ColorMode,
  type SodaColors,
} from "@/lib/utils/soda-color";
import type {
  CoverColorRequest,
  CoverColorResponse,
} from "./cover-color.worker";

/**
 * 单次请求的超时。
 *
 * 超时不等于 worker 挂了：主线程卡住时 worker 的回复也会被排队。
 * 所以只让本次请求降级到主线程，不把 worker 标记为坏掉。
 */
const REQUEST_TIMEOUT_MS = 2000;

interface PendingRequest {
  resolve: (colors: SodaColors) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
/** worker 确认不可用后不再尝试创建，避免每次取色都抛一次异常 */
let workerDisabled = false;
let requestSeq = 0;
const pending = new Map<number, PendingRequest>();

function disableWorker(reason: string): void {
  if (!workerDisabled) {
    logger.warn(
      "cover-color-client",
      `Worker 不可用，取色回退主线程：${reason}`
    );
  }
  workerDisabled = true;
  if (worker) {
    worker.terminate();
    worker = null;
  }
  // 排队中的请求全部失败给调用方，由外层 catch 走主线程兜底
  for (const [id, item] of pending) {
    clearTimeout(item.timer);
    item.reject(new Error("COVER_COLOR_WORKER_DOWN"));
    pending.delete(id);
  }
}

function ensureWorker(): Worker | null {
  if (workerDisabled) return null;
  if (worker) return worker;
  if (typeof Worker === "undefined") {
    workerDisabled = true;
    return null;
  }

  try {
    worker = new Worker(new URL("./cover-color.worker.ts", import.meta.url), {
      type: "module",
      name: "cover-color",
    });
  } catch (err) {
    // 同步抛错（CSP、老 WebView 不支持 module worker）→ 以后都走主线程
    disableWorker(err instanceof Error ? err.message : String(err));
    return null;
  }

  worker.onmessage = (event: MessageEvent<CoverColorResponse>) => {
    const { id, colors, error } = event.data ?? {};
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    clearTimeout(item.timer);
    if (error || !colors) {
      item.reject(new Error(error ?? "COVER_COLOR_EMPTY_RESULT"));
    } else {
      item.resolve(colors);
    }
  };

  worker.onerror = (event) => {
    event.preventDefault?.();
    disableWorker(event.message || "worker error");
  };

  return worker;
}

function request(
  target: Worker,
  pixels: Uint8ClampedArray,
  mode: ColorMode
): Promise<SodaColors> {
  return new Promise<SodaColors>((resolve, reject) => {
    const id = ++requestSeq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("COVER_COLOR_TIMEOUT"));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });

    const message: CoverColorRequest = { id, pixels, mode };
    try {
      target.postMessage(message);
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * 从 RGBA 像素缓冲提取背景色方案，优先在 worker 里算。
 *
 * 任何失败（worker 不可用、崩溃、超时、返回空结果）都在这里兜底为主线程计算，
 * 调用方永远拿得到颜色——「背景不变色」比「主线程不卡」更不能出错。
 */
export async function extractColorsOffThread(
  pixels: Uint8ClampedArray,
  mode: ColorMode = "dark"
): Promise<SodaColors> {
  const target = ensureWorker();
  if (!target) return extractFromPixels(pixels, mode);

  try {
    return await request(target, pixels, mode);
  } catch (err) {
    logger.warn("cover-color-client", "Worker 取色失败，主线程兜底", err);
    return extractFromPixels(pixels, mode);
  }
}

/** 仅供测试：重置模块级 worker 状态 */
export function __resetCoverColorWorker(): void {
  if (worker) worker.terminate();
  worker = null;
  workerDisabled = false;
  for (const [, item] of pending) {
    clearTimeout(item.timer);
    item.reject(new Error("RESET"));
  }
  pending.clear();
}
