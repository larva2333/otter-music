import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyApiKey,
  clearCacheCategory,
  decodeCacheKey,
  getCacheDetails,
} from "./cache-details";
import { CacheManager } from "@/plugins/cache-manager";

const { stores, cacheStore } = vi.hoisted(() => {
  const cacheStore = new Map<string, Map<string, Response>>();
  return {
    cacheStore,
    stores: {
      offline: { records: {} as Record<string, unknown>, clear: vi.fn() },
      links: { urlMap: {} as Record<string, unknown>, clear: vi.fn() },
    },
  };
});

vi.mock("@/store/offline-store", () => ({
  useOfflineStore: { getState: () => stores.offline },
}));
vi.mock("@/store/url-cache-store", () => ({
  useUrlCacheStore: { getState: () => stores.links },
}));
vi.mock("@/plugins/cache-manager", () => ({
  CacheManager: {
    getCacheSize: vi.fn(async () => ({ bytes: 4096 })),
    clearWebViewCache: vi.fn(async () => ({ bytes: 0 })),
  },
}));

function makeCache(name: string) {
  if (!cacheStore.has(name)) cacheStore.set(name, new Map());
  const entries = cacheStore.get(name)!;
  return {
    keys: async () =>
      Array.from(entries.keys()).map(
        (key) => new Request(`https://cache.local/${encodeURIComponent(key)}`)
      ),
    match: async (req: Request) =>
      entries.get(decodeURIComponent(new URL(req.url).pathname.slice(1))) ??
      null,
    delete: async (req: Request) =>
      entries.delete(decodeURIComponent(new URL(req.url).pathname.slice(1))),
    put: async (key: string, body: string) => {
      entries.set(key, new Response(body));
    },
  };
}

describe("cache-details", () => {
  beforeEach(() => {
    cacheStore.clear();
    stores.offline.records = {};
    stores.links.urlMap = {};
    vi.clearAllMocks();
    vi.stubGlobal("caches", {
      open: async (name: string) => makeCache(name),
      delete: async (name: string) => cacheStore.delete(name),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("按 key 区分歌词、封面和接口数据", () => {
    expect(classifyApiKey("netease:lyric:123")).toBe("lyric");
    expect(classifyApiKey("lyric:v2:qq:456")).toBe("lyric");
    expect(classifyApiKey("local:lyric:v3:/sdcard/a.mp3")).toBe("lyric");
    expect(classifyApiKey("pic:v3:netease:123:300")).toBe("cover");
    expect(classifyApiKey("local:cover:v3:/sdcard/a.mp3:200")).toBe("cover");
    expect(classifyApiKey("netease:playlist:789")).toBe("api");
    expect(classifyApiKey("podcast:feed:https://x.com/rss")).toBe("api");
  });

  it("decodeCacheKey 还原中文和特殊字符", () => {
    expect(
      decodeCacheKey("https://cache.local/" + encodeURIComponent("歌词:周杰伦"))
    ).toBe("歌词:周杰伦");
  });

  it("明细摘要里的 cookie 片段被脱敏", async () => {
    const api = makeCache("otter-cache-v1");
    await api.put("netease:v2:my-info:a1b2c3d4e5f60718", "profile");
    await api.put("netease:v2:daily-songs:4000; MUSIC_SNS=abc", "songs");
    const details = await getCacheDetails();
    const apiItem = details.find((d) => d.category === "api")!;
    expect(apiItem.samples.join(" ")).not.toContain("a1b2c3d4e5f60718");
    expect(apiItem.samples.join(" ")).not.toContain("MUSIC_SNS");
    expect(apiItem.samples.join(" ")).toContain("a1b2…");
  });

  it("明细按分类统计数量、体积和摘要", async () => {
    const api = makeCache("otter-cache-v1");
    await api.put("netease:lyric:1", "lyric-body");
    await api.put("pic:v3:netease:2:300", "cover-body");
    await api.put("netease:playlist:3", "api-body");
    const audio = makeCache("audio-stream-cache");
    await audio.put("https://cdn.example/song-A.mp3?key=abc", "audio");
    stores.offline.records = {
      t1: { name: "稻香", artist: ["周杰伦"] },
    };
    stores.links.urlMap = { "netease:1:320": { url: "https://x" } };

    const details = await getCacheDetails();
    const byCategory = Object.fromEntries(details.map((d) => [d.category, d]));

    expect(byCategory.audio.count).toBe(1);
    expect(byCategory.audio.samples[0]).toContain("song-A.mp3");
    expect(byCategory.offline.samples[0]).toBe("稻香 · 周杰伦");
    expect(byCategory.lyric.count).toBe(1);
    expect(byCategory.cover.count).toBe(1);
    expect(byCategory.api.count).toBe(1);
    expect(byCategory.links.count).toBe(1);
    expect(byCategory.webview.size).toBe(4096);
  });

  it("清歌词只删歌词条目，保留封面与接口数据", async () => {
    const api = makeCache("otter-cache-v1");
    await api.put("netease:lyric:1", "lyric");
    await api.put("pic:v3:netease:2:300", "cover");
    await api.put("netease:playlist:3", "api");

    await clearCacheCategory("lyric");

    const items = await api.keys();
    expect(items).toHaveLength(2);
    expect(await api.match(items[0])).toBeTruthy();
  });

  it("清接口数据同时清理页面缓存，离线记录与链接各自独立清理", async () => {
    const api = makeCache("otter-cache-v1");
    await api.put("netease:lyric:1", "lyric");
    await api.put("netease:playlist:3", "api");
    cacheStore.set("pages-cache", new Map([["/", new Response("html")]]));

    await clearCacheCategory("api");
    expect(await api.keys()).toHaveLength(1);
    expect(cacheStore.has("pages-cache")).toBe(false);

    await clearCacheCategory("offline");
    await clearCacheCategory("links");
    expect(stores.offline.clear).toHaveBeenCalledOnce();
    expect(stores.links.clear).toHaveBeenCalledOnce();
  });

  it("清浏览器缓存走原生插件", async () => {
    await clearCacheCategory("webview");
    expect(CacheManager.clearWebViewCache).toHaveBeenCalledOnce();
  });

  it("明细文案不使用开发术语", async () => {
    const details = await getCacheDetails();
    const text = details.map((d) => `${d.label} ${d.description}`).join(" ");

    expect(text).not.toContain("Service Worker");
    expect(text).not.toContain("WebView");
    expect(text).not.toContain("音频分片");
    expect(text).not.toContain("接口响应");
  });
});
