import { useEffect, useState } from "react";

/**
 * 检测封面图自带的纯白边（letterbox）。
 *
 * 有些平台上传的封面原图本身带白边——例如某张 1400×1400 的图，顶部 58px、底部
 * 59px 是纯白（#FFFFFF），左右没有。显示时这圈白边就成了一条「白框」，在深色
 * 背景上非常显眼，改样式没用，只能按图裁掉。
 *
 * 做法：把图缩到 240px 高，从四条边往里数「整行/整列都是纯白」的行数，换算成
 * 比例，再折算成一个居中放大的倍数。放大会同时裁掉左右，但只有检测到白边时
 * 才会放大，正常封面完全不动。
 */

const SAMPLE = 240;
/** 单通道 ≥ 该值算纯白（避开压缩噪点、接近白的浅色内容） */
const WHITE = 250;
/** 一行里 ≥95% 的采样像素是白的，才算「整行白」 */
const ROW_WHITE_RATIO = 0.95;
/** 单边白边超过 12% 基本是「整张图本来就白」，不当作白边处理 */
const MAX_BAND = 0.12;
/** 上下（或左右）白边合计超过 25%，判定为浅色封面，宁可不裁 */
const MAX_TOTAL = 0.25;

interface CropResult {
  /** 需要居中等比放大的倍数；1 表示不裁 */
  zoom: number;
  /** 顶/底白边占比，仅用于调试时排查 */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const NO_CROP: CropResult = { zoom: 1, top: 0, bottom: 0, left: 0, right: 0 };

function measureBands(img: HTMLImageElement): CropResult {
  const ratio = SAMPLE / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.max(8, Math.round(img.naturalWidth * ratio));
  const h = Math.max(8, Math.round(img.naturalHeight * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return NO_CROP;
  ctx.drawImage(img, 0, 0, w, h);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // 跨域且没有 CORS 头：读不到像素，直接不裁
    return NO_CROP;
  }

  const isWhite = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return data[i] >= WHITE && data[i + 1] >= WHITE && data[i + 2] >= WHITE;
  };
  const rowWhite = (y: number) => {
    let n = 0;
    for (let x = 0; x < w; x++) if (isWhite(x, y)) n++;
    return n / w >= ROW_WHITE_RATIO;
  };
  const colWhite = (x: number) => {
    let n = 0;
    for (let y = 0; y < h; y++) if (isWhite(x, y)) n++;
    return n / h >= ROW_WHITE_RATIO;
  };

  let top = 0;
  while (top < h && rowWhite(top)) top++;
  let bottom = 0;
  while (bottom < h - top && rowWhite(h - 1 - bottom)) bottom++;
  let left = 0;
  while (left < w && colWhite(left)) left++;
  let right = 0;
  while (right < w - left && colWhite(w - 1 - right)) right++;

  const t = top / h;
  const b = bottom / h;
  const l = left / w;
  const r = right / w;

  const vertical = t + b;
  const horizontal = l + r;
  const bad =
    vertical > MAX_TOTAL ||
    horizontal > MAX_TOTAL ||
    t > MAX_BAND ||
    b > MAX_BAND ||
    l > MAX_BAND ||
    r > MAX_BAND;

  if (bad || (vertical < 0.004 && horizontal < 0.004)) {
    return { zoom: 1, top: t, bottom: b, left: l, right: r };
  }

  // 居中放大后可见区域为 1/zoom，需要 ≥ 白边之外的内容
  const cover = Math.max(vertical, horizontal);
  const zoom = Math.min(1.35, 1 / Math.max(0.5, 1 - cover));
  return { zoom, top: t, bottom: b, left: l, right: r };
}

/** 同一张封面重复进入播放页时避免重复解码 */
const cache = new Map<string, CropResult>();

/**
 * 返回封面需要的放大倍数（用于裁掉图片自带的纯白边）。
 * 未检测完成时返回 1，不影响首帧。
 */
export function useCoverWhiteBands(url: string | null | undefined): number {
  /** 只记录「本组件自己算出来的那一张」，切换封面时不会串味 */
  const [detected, setDetected] = useState<{
    url: string;
    zoom: number;
  } | null>(null);

  useEffect(() => {
    if (!url || cache.has(url)) return;

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      const result = measureBands(img);
      cache.set(url, result);
      setDetected({ url, zoom: result.zoom });
    };
    img.src = url;

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) return 1;
  const cached = cache.get(url);
  if (cached) return cached.zoom;
  return detected?.url === url ? detected.zoom : 1;
}
