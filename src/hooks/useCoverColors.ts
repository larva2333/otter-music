import { useEffect, useRef, useState } from "react";
import { forceHttps } from "@otter-music/shared";
import type { ColorMode, SodaColors } from "@/lib/utils/soda-color";
import { extractColorsOffThread } from "@/lib/cover-color-client";
import { logger } from "@/lib/logger";
import { getProxyUrl, isProxyUrl } from "@/lib/api/config";

/** 取色降采样尺寸（与算法标定时使用的 96×96 输入一致） */
const SAMPLE_SIZE = 96;

/** 结果缓存上限：够覆盖常规听歌的封面数量，又不会无限增长 */
const CACHE_LIMIT = 60;

interface UseCoverColorsResult {
  colors: SodaColors | null;
  error: Error | null;
}

interface ColorsState {
  key: string | null;
  colors: SodaColors | null;
  error: Error | null;
}

/**
 * 模块级缓存 + 进行中请求去重。
 *
 * 取色是「加载图片 → 画 canvas → k-means」的重活（几十毫秒），
 * 播放页与播放条同时看同一封面、或播放条随全屏播放收起再展开时，
 * 每次重算就会出现「背景色空一拍再刷上」的闪烁。缓存按「主题模式 + 图片地址」索引，
 * 命中的组件在渲染期就同步拿到颜色，连一帧回退底色都不会有。
 */
const colorCache = new Map<string, SodaColors>();
const pendingRequests = new Map<string, Promise<SodaColors>>();

function cacheKey(url: string, mode: ColorMode) {
  return `${mode}|${url}`;
}

function remember(key: string, colors: SodaColors) {
  colorCache.set(key, colors);
  if (colorCache.size > CACHE_LIMIT) {
    const oldest = colorCache.keys().next().value;
    if (oldest !== undefined) colorCache.delete(oldest);
  }
}

/** 以 crossOrigin 加载图片，跨域封面无 CORS 头时由 getImageData 抛错走 error 分支 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("封面加载失败"));
    img.src = url;
  });
}

/** 绘制降采样 canvas 并执行取色算法（k-means 在 worker 里跑，见 cover-color-client） */
async function extractFromUrl(
  imageUrl: string,
  mode: ColorMode
): Promise<SodaColors> {
  const img = await loadImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D 上下文不可用");
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  return extractColorsOffThread(data, mode);
}

async function extract(imageUrl: string, mode: ColorMode): Promise<SodaColors> {
  try {
    return await extractFromUrl(imageUrl, mode);
  } catch (err) {
    // 部分图床（非网易/QQ CDN）不给跨域头：<img src> 能显示封面，
    // 但取色用的 crossOrigin 图片会让 canvas 被污染，getImageData 抛
    // SecurityError，播放条就退回纯色底。走后端同源代理补上 CORS 再试一次。
    if (isProxyUrl(imageUrl)) throw err;
    logger.warn("useCoverColors", "直连取色失败，改用代理重试", err as Error, {
      url: imageUrl,
    });
    return extractFromUrl(getProxyUrl(imageUrl), mode);
  }
}

/**
 * 从封面图片提取汽水算法背景色方案：
 * 将封面绘制到 96×96 离屏 canvas 取像素，再交给 soda-color 的 k-means 取色流程。
 *
 * mode 决定背景明暗：dark（默认，深色主题/播放页）压到深色区间，
 * light（浅色主题）抬到高明度区间，让胶囊在浅色界面上是浅底深字。
 *
 * 注意必须先 forceHttps：网易图床给的是 http 地址，而 app 页面本身跑在
 * https 下（Capacitor 的 localhost 也是安全上下文）。直接 new Image 加载
 * http 图会被当成混合内容拦掉（onerror），取色永远失败 → 播放条退回白底。
 */
export function useCoverColors(
  url: string | null,
  mode: ColorMode = "dark"
): UseCoverColorsResult {
  const safeUrl = forceHttps(url);
  const key = safeUrl ? cacheKey(safeUrl, mode) : null;
  const cached = key ? (colorCache.get(key) ?? null) : null;

  const [state, setState] = useState<ColorsState>(() => ({
    key,
    colors: cached,
    error: null,
  }));

  // 渲染期同步缓存：切歌 / 切主题 / 组件重挂时首帧就带着颜色渲染，
  // 不走 effect 里的 setState（那样会先渲染一帧旧色或无色的胶囊）。
  if (key !== state.key) {
    setState({
      key,
      colors: cached ?? state.colors,
      error: cached ? null : state.error,
    });
  }

  const latestKeyRef = useRef<string | null>(key);

  useEffect(() => {
    latestKeyRef.current = key;
    if (!key || !safeUrl || colorCache.has(key)) return;

    let cancelled = false;

    let request = pendingRequests.get(key);
    if (!request) {
      request = extract(safeUrl, mode)
        .then((result) => {
          remember(key, result);
          return result;
        })
        .finally(() => {
          pendingRequests.delete(key);
        });
      pendingRequests.set(key, request);
    }

    request
      .then((result) => {
        if (!cancelled && latestKeyRef.current === key) {
          setState({ key, colors: result, error: null });
        }
      })
      .catch((err) => {
        // 取色失败会让播放条/播放页退回纯色底，之前这里静默吞掉错误，
        // 只剩「背景又没了」的现象，排查时完全看不到原因（多为跨域图片
        // 未带 CORS 头，canvas.getImageData 抛 SecurityError）。
        logger.warn("useCoverColors", "封面取色失败", err as Error, {
          url: safeUrl,
          mode,
        });
        if (!cancelled && latestKeyRef.current === key) {
          setState({
            key,
            colors: null,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [key, safeUrl, mode]);

  return { colors: state.colors, error: state.error };
}
