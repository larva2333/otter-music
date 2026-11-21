/**
 * 封面取色 worker。
 *
 * 取色算法是 96×96 像素、k=8、100 轮迭代的 k-means（再加一次主色聚类），
 * 真机上单张封面要 200ms 以上。这段计算放在主线程，正好落在切歌那一帧：
 * 唱片换图、背景重画、取色一起挤进来，主线程直接卡 200~400ms。
 * 表现就是唱臂动画走到一半冻住，然后一下子跳过去。
 *
 * 这里只搬 k-means：canvas 解码留在主线程（`drawImage` 拿 ImageData 是 canvas
 * 的活，worker 里要另开 OffscreenCanvas 还得自己处理 CORS），
 * 把 96×96 的像素缓冲传进来算完再传回去，主线程只剩十几毫秒。
 */
import {
  extractFromPixels,
  type ColorMode,
  type SodaColors,
} from "@/lib/utils/soda-color";

export interface CoverColorRequest {
  id: number;
  /** 96×96 canvas 的 RGBA 缓冲 */
  pixels: Uint8ClampedArray;
  mode: ColorMode;
}

export interface CoverColorResponse {
  id: number;
  colors?: SodaColors;
  error?: string;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<CoverColorRequest>) => void) | null;
  postMessage: (message: CoverColorResponse) => void;
};

scope.onmessage = (event) => {
  const { id, pixels, mode } = event.data;
  try {
    scope.postMessage({ id, colors: extractFromPixels(pixels, mode) });
  } catch (err) {
    scope.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
