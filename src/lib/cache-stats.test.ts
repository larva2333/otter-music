import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAudioCache,
  formatBytes,
  getAudioCacheStats,
  getStorageUsage,
} from "./cache-stats";
import { CacheManager } from "@/plugins/cache-manager";

const { cacheStore, cachesMock } = vi.hoisted(() => {
  const cacheStore = new Map<string, string[]>();
  return {
    cacheStore,
    cachesMock: {
      keys: vi.fn(async () => Array.from(cacheStore.keys())),
      open: vi.fn(async (name: string) => ({
        keys: async () => (cacheStore.get(name) ?? []).map((url) => ({ url })),
      })),
      delete: vi.fn(async (name: string) => cacheStore.delete(name)),
    },
  };
});

vi.mock("@/plugins/cache-manager", () => ({
  CacheManager: {
    getCacheSize: vi.fn(),
    clearWebViewCache: vi.fn(),
  },
}));

describe("cache-stats", () => {
  beforeEach(() => {
    cacheStore.clear();
    vi.clearAllMocks();
    vi.stubGlobal("caches", cachesMock);
    vi.mocked(CacheManager.getCacheSize).mockResolvedValue({ bytes: 0 });
    vi.mocked(CacheManager.clearWebViewCache).mockResolvedValue({ bytes: 0 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("只统计业务缓存，音频片段数单独计数，忽略 workbox precache", async () => {
    cacheStore.set("audio-stream-cache", ["a.mp3", "b.mp3"]);
    cacheStore.set("otter-cache-v1", ["search:jay"]);
    cacheStore.set("workbox-precache-v2-https://localhost/", ["index.html"]);

    expect(await getAudioCacheStats()).toEqual({
      entryCount: 3,
      audioEntryCount: 2,
    });
  });

  it("缓存占用取原生统计（WebView HTTP Cache），不是 Cache Storage 条目数", async () => {
    vi.mocked(CacheManager.getCacheSize).mockResolvedValue({
      bytes: 305 * 1024 * 1024,
    });

    expect(await getStorageUsage()).toBe(305 * 1024 * 1024);
  });

  it("清空时删掉全部业务缓存和 WebView HTTP Cache，但不碰构建 precache", async () => {
    cacheStore.set("audio-stream-cache", ["a.mp3"]);
    cacheStore.set("otter-cache-v1", ["search:jay"]);
    cacheStore.set("pages-cache", ["/"]);
    cacheStore.set("workbox-precache-v2-https://localhost/", ["index.html"]);
    vi.mocked(CacheManager.clearWebViewCache).mockResolvedValue({
      bytes: 4096,
    });

    expect(await clearAudioCache()).toBe(4096);
    expect(CacheManager.clearWebViewCache).toHaveBeenCalledOnce();
    expect(Array.from(cacheStore.keys())).toEqual([
      "workbox-precache-v2-https://localhost/",
    ]);
  });

  it("原生插件不可用时按空缓存处理，不抛错", async () => {
    vi.mocked(CacheManager.getCacheSize).mockRejectedValue(
      new Error("not implemented")
    );
    vi.mocked(CacheManager.clearWebViewCache).mockRejectedValue(
      new Error("not implemented")
    );

    expect(await getStorageUsage()).toBe(0);
    expect(await clearAudioCache()).toBe(0);
  });

  it("formatBytes 按 1024 进制输出", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(305 * 1024 * 1024)).toBe("305.0 MB");
  });
});
