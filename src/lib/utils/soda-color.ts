/**
 * 汽水音乐播放页背景取色算法
 * 流程：封面像素 k-means 聚类 → 打分混合得主色 → Lab 变换得背景基色 → 生成垂直渐变。
 *
 * 性能约定（切歌动画是否顺滑取决于这里）：
 * - 一次取色**只允许跑一次 k-means**。旧实现 `dominantColor` 与 `gradientStops`
 *   各跑一遍（2 × 100 轮 × 9216 像素 ≈ 1500 万次距离计算），单张封面 200ms+；
 * - k-means 在分配不再变化时立即收敛退出，剩余几十轮是纯空转；
 * - 结果必须只依赖像素与固定种子，保证同一封面每次取色一致（worker / 主线程两条路径
 *   都要给出完全相同的颜色，否则降级时会看到背景跳色）。
 */

export type RGB = [number, number, number];
export type Lab = [number, number, number];

/** 背景色方案：top 为渐变起点基色，bottom 为渐变终点，dominant 为主色（用于封面投影） */
export interface SodaColors {
  dominant: RGB;
  top: RGB;
  bottom: RGB;
}

/** 聚类结果：中心按权重降序，weights 为各簇像素占比 */
export interface KMeansResult {
  centers: RGB[];
  weights: number[];
}

/** 选色与映射参数（由 20 张截图联合拟合得到） */
export const PARAMS = {
  k: 8,
  iters: 100,
  seed: 1,
  alpha: 1.88,
  beta: 0.25,
  l0: 35,
  sigma: 55,
  lScale: 1.01,
  lBias: -9.2,
  // 播放器背景保留封面色相，但亮度抬到能被眼睛识别出来的深色区间：
  // 12–28 几乎是纯黑，所有封面看起来都像同一块固定深色背景。
  lMin: 18,
  lMax: 42,
  cGain: 1.13,
  cMax: 64,
  // 渐变上下落差加大，让"渐变"本身看得出来；底部仍落在近黑区间托住白色歌词
  gradientDL: -22,
} as const;

/** 浅色主题背景参数：主色抬到高明度区间（L 82–92），只留一点色相。 */
export const LIGHT_PARAMS = {
  // 封面主色亮度若在深色区间（L≈35），抬到这个浅色带；亮封面也不会顶到纯白
  lScale: 0.55,
  lBias: 60,
  lMin: 82,
  lMax: 92,
  // 色度压到三成：浅底上高饱和会像荧光色块，且文字对比度不足
  cGain: 0.75,
  cMax: 30,
  // 浅色下大落差会显脏，只留一点点方向感
  gradientDL: -6,
} as const;

/** 取色目标：深色主题压暗背景，浅色主题提亮背景 */
export type ColorMode = "dark" | "light";

/** 固定种子的伪随机数发生器，保证取色结果可复现。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** sRGB(0-255) → CIELab，输入 [r,g,b] 返回 [L,a,b]。 */
export function srgbToLab(rgb: RGB): Lab {
  const c = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255].map((v) =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  );
  const x = (0.4124 * c[0] + 0.3576 * c[1] + 0.1805 * c[2]) / 0.9505;
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const z = (0.0193 * c[0] + 0.1192 * c[1] + 0.9505 * c[2]) / 1.089;
  const f = [x, y, z].map((v) =>
    v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116
  );
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

/** CIELab → sRGB(0-255)，输入 [L,a,b] 返回 [r,g,b]，越界截断。 */
export function labToSrgb(lab: Lab): RGB {
  const fy = (lab[0] + 16) / 116;
  const fx = fy + lab[1] / 500;
  const fz = fy - lab[2] / 200;

  /** Lab f 函数反推 XYZ 分量 */
  const finv = (t: number) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  };

  const x = finv(fx) * 0.9505;
  const y = finv(fy);
  const z = finv(fz) * 1.089;
  const lin = [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
  return lin.map((v) => {
    const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, Math.round(s * 255)));
  }) as RGB;
}

/**
 * 对 RGB 像素做 k-means，返回按权重降序的 { centers, weights }。
 *
 * 全部运算在类型化数组上做（像素先扁平化成 Float64Array），内层循环不再做
 * `pixels[p][0]` 这种数组解引用；分配不再变化时立刻退出——中心已稳定，
 * 继续迭代只会白烧 CPU，而这段计算正落在切歌那一帧。
 */
export function kmeans(
  pixels: RGB[],
  k: number = PARAMS.k,
  iters: number = PARAMS.iters,
  seed: number = PARAMS.seed
): KMeansResult {
  const n = pixels.length;
  if (n === 0) return { centers: [], weights: [] };

  const flat = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    flat[i * 3] = pixels[i][0];
    flat[i * 3 + 1] = pixels[i][1];
    flat[i * 3 + 2] = pixels[i][2];
  }

  // 洗牌后取前 k 个作为初始中心。洗的是索引，rng 调用序列与旧实现一致，
  // 因此同一输入得到的初始中心、最终结果都与旧实现逐位相同。
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const rng = mulberry32(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }

  const kk = Math.min(k, n);
  const centers = new Float64Array(kk * 3);
  for (let c = 0; c < kk; c++) {
    const src = order[c] * 3;
    centers[c * 3] = flat[src];
    centers[c * 3 + 1] = flat[src + 1];
    centers[c * 3 + 2] = flat[src + 2];
  }

  const assign = new Int32Array(n).fill(-1);
  const sums = new Float64Array(kk * 4);

  for (let it = 0; it < iters; it++) {
    let changed = false;
    for (let p = 0; p < n; p++) {
      const r = flat[p * 3];
      const g = flat[p * 3 + 1];
      const b = flat[p * 3 + 2];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < kk; c++) {
        const dr = r - centers[c * 3];
        const dg = g - centers[c * 3 + 1];
        const db = b - centers[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[p] !== best) {
        assign[p] = best;
        changed = true;
      }
    }

    sums.fill(0);
    for (let q = 0; q < n; q++) {
      const s = assign[q] * 4;
      sums[s] += flat[q * 3];
      sums[s + 1] += flat[q * 3 + 1];
      sums[s + 2] += flat[q * 3 + 2];
      sums[s + 3]++;
    }
    for (let m = 0; m < kk; m++) {
      const count = sums[m * 4 + 3];
      if (count > 0) {
        centers[m * 3] = sums[m * 4] / count;
        centers[m * 3 + 1] = sums[m * 4 + 1] / count;
        centers[m * 3 + 2] = sums[m * 4 + 2] / count;
      }
    }

    // 本轮分配没有变化：中心不会再动，剩下的迭代（通常 80+ 轮）全是空转
    if (!changed) break;
  }

  const counts = new Int32Array(kk);
  for (let p = 0; p < n; p++) counts[assign[p]]++;

  const ranked = Array.from({ length: kk }, (_, i) => i).sort(
    (a, b) => counts[b] - counts[a]
  );
  return {
    centers: ranked.map(
      (i) => [centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]] as RGB
    ),
    weights: ranked.map((i) => counts[i] / n),
  };
}

/** 提取主色：按 权重^α × 色度^β × 亮度高斯 打分，对聚类中心加权混合。 */
export function dominantColorFromClusters(km: KMeansResult): RGB {
  const score: number[] = [];
  let total = 0;
  for (let i = 0; i < km.centers.length; i++) {
    const lab = srgbToLab(km.centers[i]);
    const chroma = Math.max(Math.hypot(lab[1], lab[2]), 1e-3);
    const gauss = Math.exp(
      -0.5 * Math.pow((lab[0] - PARAMS.l0) / PARAMS.sigma, 2)
    );
    const v =
      Math.pow(km.weights[i], PARAMS.alpha) *
      Math.pow(chroma, PARAMS.beta) *
      gauss;
    score.push(v);
    total += v;
  }
  const out: RGB = [0, 0, 0];
  for (let j = 0; j < km.centers.length; j++) {
    const w = total > 0 ? score[j] / total : 0;
    out[0] += km.centers[j][0] * w;
    out[1] += km.centers[j][1] * w;
    out[2] += km.centers[j][2] * w;
  }
  return out;
}

/** 提取主色（自带聚类）。已有聚类结果时用 `dominantColorFromClusters` 复用。 */
export function dominantColor(pixels: RGB[]): RGB {
  return dominantColorFromClusters(kmeans(pixels));
}

/** 由主色计算背景基色：Lab 下压缩并钳制亮度、增益色度、保持色相。 */
export function backgroundColorFromClusters(
  km: KMeansResult,
  mode: ColorMode = "dark"
): RGB {
  const p = mode === "light" ? LIGHT_PARAMS : PARAMS;
  const lab = srgbToLab(dominantColorFromClusters(km));
  const l = Math.min(p.lMax, Math.max(p.lMin, p.lScale * lab[0] + p.lBias));
  const c = Math.min(p.cMax, Math.hypot(lab[1], lab[2]) * p.cGain);
  const h = Math.atan2(lab[2], lab[1]);
  return labToSrgb([l, c * Math.cos(h), c * Math.sin(h)]);
}

/** 由主色计算背景基色（自带聚类）。 */
export function backgroundColor(pixels: RGB[], mode: ColorMode = "dark"): RGB {
  return backgroundColorFromClusters(kmeans(pixels), mode);
}

/** 生成背景渐变起止色：顶部为基色，底部为基色亮度按主题落差下移。 */
export function gradientStopsFromClusters(
  km: KMeansResult,
  mode: ColorMode = "dark"
): { top: RGB; bottom: RGB } {
  const p = mode === "light" ? LIGHT_PARAMS : PARAMS;
  const base = srgbToLab(backgroundColorFromClusters(km, mode));
  const bottom: Lab = [Math.max(base[0] + p.gradientDL, 0), base[1], base[2]];
  return { top: labToSrgb(base), bottom: labToSrgb(bottom) };
}

/** 生成背景渐变起止色（自带聚类）。 */
export function gradientStops(
  pixels: RGB[],
  mode: ColorMode = "dark"
): { top: RGB; bottom: RGB } {
  return gradientStopsFromClusters(kmeans(pixels), mode);
}

/** 从 RGBA 像素缓冲（如 96×96 canvas 的 getImageData 结果）提取背景色方案。 */
export function extractFromPixels(
  data: Uint8ClampedArray,
  mode: ColorMode = "dark"
): SodaColors {
  const pixels: RGB[] = [];
  for (let i = 0; i < data.length; i += 4) {
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  // 主色与背景基色共用同一份聚类结果：旧实现各跑一遍 k-means，
  // 等于把同一张封面的 100 轮迭代算两次，白白多花一倍时间。
  const km = kmeans(pixels);
  const stops = gradientStopsFromClusters(km, mode);
  return {
    dominant: dominantColorFromClusters(km).map(Math.round) as RGB,
    top: stops.top,
    bottom: stops.bottom,
  };
}
