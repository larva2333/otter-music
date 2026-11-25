/**
 * 播放页主题色背景的像素合成：线性渐变 + 顶部径向光晕 + 底部压暗 + 二维抖动（dither）。
 *
 * 拆成纯函数（不依赖 DOM / Canvas）以便放在 Web Worker 里跑：
 * 1080p/2K 屏幕按 DPR 放大后是 300~460 万像素，放在主线程会卡 150~400ms，
 * 刚好撞上切歌时的唱臂抬起/落针动画。在 Worker 里算完后零拷贝 transfer 回主线程，
 * 主线程只做一次 putImageData 即可。
 */
import { srgbToLab, type SodaColors } from "@/lib/utils/soda-color";

const BG_GLOW_STEPS = 64;
export const BG_DARK_MAX = 0.55;
/** 浅色底只做极轻的底部压暗：压到 55% 会把浅色渐变直接拉成深色 */
export const BG_LIGHT_DARK_MAX = 0.05;

export function renderThemeBackgroundPixels(
  width: number,
  height: number,
  colors: SodaColors,
  darkenMax: number = BG_DARK_MAX
): Uint8ClampedArray<ArrayBuffer> {
  const W = width | 0;
  const H = height | 0;
  if (W <= 0 || H <= 0) return new Uint8ClampedArray(new ArrayBuffer(0));

  const data = new Uint8ClampedArray(new ArrayBuffer(W * H * 4));

  const [tr, tg, tb] = colors.top;
  const [br, bg, bb] = colors.bottom;
  const [dr, dg, db] = colors.dominant;
  const l = srgbToLab(colors.dominant)[0];
  // 亮主色（白底封面）若按固定透明度叠加会把顶部糊成一片，白字和图标直接失读
  const glowAlpha = l > 65 ? 0.12 : l > 45 ? 0.22 : 0.32;

  // 光晕横向曲线按 64 段采样、逐像素线性插值：省掉 W×H 次 sqrt，
  // 64 段在 1200px 上的折线误差远小于 1 级，看不出竖纹。
  const alphaTab = new Float32Array(BG_GLOW_STEPS);
  const uScale = W > 1 ? (BG_GLOW_STEPS - 1) / (W - 1) : 0;

  // xorshift32：每像素一次的伪随机，比 Math.random 快一个量级
  let seed = 0x9e3779b9 | 0;

  for (let y = 0; y < H; y++) {
    const t = H > 1 ? y / (H - 1) : 0;
    const baseR = tr + (br - tr) * t;
    const baseG = tg + (bg - tg) * t;
    const baseB = tb + (bb - tb) * t;

    // 顶部径向光晕：中心 (0.5, -0.20)，半径 (1.30, 1.20)，终点在元素外
    const dy = (t + 0.2) / 1.2;
    const dy2 = dy * dy;
    for (let j = 0; j < BG_GLOW_STEPS; j++) {
      const dx = (j / (BG_GLOW_STEPS - 1) - 0.5) / 1.3;
      let s = Math.sqrt(dx * dx + dy2);
      if (s > 1) s = 1;
      alphaTab[j] = glowAlpha * (1 - s);
    }

    // 压暗：底部压到 darkenMax，斜率恒定（浅色底几乎不压）
    const darken = 1 - darkenMax * t;

    let i = y * W * 4;
    for (let x = 0; x < W; x++) {
      const u = x * uScale;
      const i0 = u | 0;
      const f = u - i0;
      const a =
        i0 + 1 < BG_GLOW_STEPS
          ? alphaTab[i0] + (alphaTab[i0 + 1] - alphaTab[i0]) * f
          : alphaTab[i0];

      const r = (baseR + (dr - baseR) * a) * darken;
      const g = (baseG + (dg - baseG) * a) * darken;
      const b = (baseB + (db - baseB) * a) * darken;

      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      // ±0.8 级：刚好足以把相位在整数边界附近的量化台阶打散
      const n = ((seed >>> 0) / 4294967296 - 0.5) * 1.6;

      const rv = r + n;
      const gv = g + n;
      const bv = b + n;
      data[i] = rv <= 0 ? 0 : rv >= 255 ? 255 : (rv + 0.5) | 0;
      data[i + 1] = gv <= 0 ? 0 : gv >= 255 ? 255 : (gv + 0.5) | 0;
      data[i + 2] = bv <= 0 ? 0 : bv >= 255 ? 255 : (bv + 0.5) | 0;
      data[i + 3] = 255;
      i += 4;
    }
  }

  return data;
}
