import { CacheManager } from "@/plugins/cache-manager";

export const AUDIO_CACHE_NAME = "audio-stream-cache";
export const API_CACHE_NAME = "otter-cache-v1";
export const PAGES_CACHE_NAME = "pages-cache";

/**
 * 参与统计/清理的业务缓存。
 * workbox 的构建 precache 不在此列：删掉会让运行中动态 import 的 chunk 失效。
 */
export const BUSINESS_CACHES = [
  AUDIO_CACHE_NAME,
  API_CACHE_NAME,
  PAGES_CACHE_NAME,
] as const;

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export interface CacheStats {
  /** 业务缓存总条目数（含音频片段、API 响应、页面缓存） */
  entryCount: number;
  /** 其中音频流片段数 */
  audioEntryCount: number;
}

export async function getAudioCacheStats(): Promise<CacheStats> {
  let entryCount = 0;
  let audioEntryCount = 0;
  try {
    const names = await caches.keys();
    for (const name of names) {
      if (!(BUSINESS_CACHES as readonly string[]).includes(name)) continue;
      const cache = await caches.open(name);
      const count = (await cache.keys()).length;
      entryCount += count;
      if (name === AUDIO_CACHE_NAME) audioEntryCount = count;
    }
  } catch {
    /* Cache Storage 不可用时按空处理 */
  }
  return { entryCount, audioEntryCount };
}

/**
 * 应用缓存的实际磁盘占用。
 *
 * 大头是 WebView 的 HTTP 磁盘缓存（cache/WebView/Default/HTTP Cache），
 * Cache Storage API 和 navigator.storage.estimate() 都覆盖不到它，必须问原生。
 */
export async function getStorageUsage(): Promise<number> {
  try {
    const { bytes } = await CacheManager.getCacheSize();
    if (typeof bytes === "number") return bytes;
  } catch {
    /* 非原生端回退到 Web Storage 估算 */
  }
  try {
    if ("storage" in navigator && "estimate" in navigator.storage) {
      const est = await navigator.storage.estimate();
      return est.usage ?? 0;
    }
  } catch {
    /* unavailable */
  }
  return 0;
}

/** 清空业务缓存与 WebView HTTP 磁盘缓存，返回清理后的剩余占用 */
export async function clearAudioCache(): Promise<number> {
  await Promise.all(
    BUSINESS_CACHES.map(async (name) => {
      try {
        await caches.delete(name);
      } catch {
        /* 单个缓存清理失败不影响其余 */
      }
    })
  );

  try {
    const { bytes } = await CacheManager.clearWebViewCache();
    if (typeof bytes === "number") return bytes;
  } catch {
    /* 非原生端无 WebView 缓存可清 */
  }
  return 0;
}

export async function deleteAudioCacheEntry(url: string): Promise<boolean> {
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    return await cache.delete(url);
  } catch {
    return false;
  }
}
