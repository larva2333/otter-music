import { registerPlugin } from "@capacitor/core";

/**
 * 应用缓存管理插件（仅 Android 原生实现）。
 *
 * WebView 的 HTTP 磁盘缓存（cache/WebView/Default/HTTP Cache）不受 Cache Storage API
 * 管理，JS 侧既读不到体积也无法清理，因此由原生插件提供统计与清理入口。
 */
export interface CacheManagerPlugin {
  /** 应用 cache 目录的实际体积（字节） */
  getCacheSize(): Promise<{ bytes: number }>;
  /** 清理 WebView HTTP Cache，返回清理后的剩余体积（字节） */
  clearWebViewCache(): Promise<{ bytes: number }>;
}

const CacheManager = registerPlugin<CacheManagerPlugin>("CacheManager");

export { CacheManager };
