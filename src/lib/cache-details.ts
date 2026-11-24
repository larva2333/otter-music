import { CacheManager } from "@/plugins/cache-manager";
import { useOfflineStore } from "@/store/offline-store";
import { useUrlCacheStore } from "@/store/url-cache-store";
import {
  API_CACHE_NAME,
  AUDIO_CACHE_NAME,
  PAGES_CACHE_NAME,
} from "./cache-stats";

export type CacheCategory =
  | "audio"
  | "offline"
  | "lyric"
  | "cover"
  | "links"
  | "api"
  | "webview";

export interface CacheDetail {
  category: CacheCategory;
  /** 分类标题 */
  label: string;
  /** 清除后的影响说明 */
  description: string;
  /** 条目数；浏览器缓存无法逐条列出，固定为 0 */
  count: number;
  /** 已知体积（字节）；音频片段不读响应体，按 0 处理 */
  size: number;
  /** 前几条内容摘要，方便用户确认缓存的是什么 */
  samples: string[];
}

/** Cache Storage 的请求 URL 里 key 是 encodeURIComponent 过的 */
export function decodeCacheKey(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/^\//, "");
    return decodeURIComponent(path);
  } catch {
    return url;
  }
}

/**
 * otter-cache-v1 的 key 分类：
 * - 歌词：lyric:v2:... / netease:lyric:... / local:lyric:v3:...
 * - 封面：pic:v3:... / local:cover:v3:...
 * - 其余（歌单、榜单、搜索、歌手详情等）归为接口数据
 */
export function classifyApiKey(key: string): "lyric" | "cover" | "api" {
  if (/(^|:)lyric(?::|v\d+:)/.test(key) || key.includes(":lyric:")) {
    return "lyric";
  }
  if (/(^|:)(pic|cover)(?::|v\d+:)/.test(key)) return "cover";
  return "api";
}

/**
 * 明细摘要脱敏：部分 netease key 尾部带 cookie 片段（16 位十六进制），
 * 展示给用户前打码，避免把登录凭证显示在设置页。
 */
function maskSample(value: string): string {
  // netease:v2:* 的尾段是 cookie.slice(-16)，形如 "4000; MUSIC_SNS="，
  // 不只是十六进制，整段打码
  const neteaseV = value.match(/^(netease:v\d+:.+):([^:]+)$/);
  if (neteaseV) {
    return `${neteaseV[1]}:${neteaseV[2].slice(0, 4)}…`;
  }
  return value.replace(/[0-9a-f]{12,}/gi, (s) => `${s.slice(0, 4)}…`);
}

function makeDetail(
  category: CacheCategory,
  label: string,
  description: string,
  samples: string[],
  count = samples.length,
  size = 0
): CacheDetail {
  return {
    category,
    label,
    description,
    count,
    size,
    samples: samples.map(maskSample),
  };
}

/** 从音频 URL 中提取可读的片段名，去掉鉴权 query */
function audioSample(url: string): string {
  try {
    const u = new URL(url);
    const name = decodeURIComponent(u.pathname.split("/").pop() || "");
    return name || u.hostname;
  } catch {
    return url.slice(0, 80);
  }
}

/** 统计各类缓存中实际存了什么，不做破坏性操作 */
export async function getCacheDetails(): Promise<CacheDetail[]> {
  const details: CacheDetail[] = [];

  try {
    const audio = await caches.open(AUDIO_CACHE_NAME);
    const audioKeys = await audio.keys();
    details.push(
      makeDetail(
        "audio",
        "已缓存音频",
        "播放时保存的音频数据，清理后下次需要重新加载",
        audioKeys.slice(0, 5).map((req) => audioSample(req.url)),
        audioKeys.length
      )
    );

    const snapshot = useOfflineStore.getState().records ?? {};
    const offlineValues = Object.values(snapshot);
    details.push(
      makeDetail(
        "offline",
        "播放过的歌曲",
        "只记录歌曲信息，不是歌曲文件；清理后来源标记会消失",
        offlineValues.slice(0, 5).map((r) => {
          const artist = (r.artist ?? []).join(" / ");
          return artist ? `${r.name} · ${artist}` : r.name;
        }),
        offlineValues.length
      )
    );

    const api = await caches.open(API_CACHE_NAME);
    const apiKeys = await api.keys();
    const bucket: Record<
      "lyric" | "cover" | "api",
      { samples: string[]; size: number; count: number }
    > = {
      lyric: { samples: [], size: 0, count: 0 },
      cover: { samples: [], size: 0, count: 0 },
      api: { samples: [], size: 0, count: 0 },
    };
    for (const req of apiKeys) {
      const key = decodeCacheKey(req.url);
      const type = classifyApiKey(key);
      const group = bucket[type];
      group.count += 1;
      if (group.samples.length < 5) group.samples.push(key);
      try {
        const res = await api.match(req);
        if (res) group.size += (await res.clone().arrayBuffer()).byteLength;
      } catch {
        /* 单条读取失败不影响其余统计 */
      }
    }
    details.push(
      makeDetail(
        "lyric",
        "歌词",
        "看过的歌词，断网时也可能显示",
        bucket.lyric.samples,
        bucket.lyric.count,
        bucket.lyric.size
      ),
      makeDetail(
        "cover",
        "封面图片",
        "看过的封面，清理后需要重新加载",
        bucket.cover.samples,
        bucket.cover.count,
        bucket.cover.size
      ),
      makeDetail(
        "api",
        "页面内容",
        "歌单、榜单、搜索、歌手详情、播客等看过的页面内容",
        bucket.api.samples,
        bucket.api.count,
        bucket.api.size
      )
    );

    const links = Object.keys(useUrlCacheStore.getState().urlMap ?? {});
    details.push(
      makeDetail(
        "links",
        "播放地址",
        "下次播放用的临时地址，清理后播放前会重新获取",
        links.slice(0, 5),
        links.length
      )
    );

    const pages = await caches.open(PAGES_CACHE_NAME);
    const pageKeys = await pages.keys();
    const apiItem = details.find((d) => d.category === "api");
    if (apiItem) {
      apiItem.count += pageKeys.length;
    }
  } catch {
    /* Cache Storage 不可用时仍返回其余分类 */
  }

  try {
    const { bytes } = await CacheManager.getCacheSize();
    details.push(
      makeDetail(
        "webview",
        "临时网络数据",
        "播放和浏览时临时保存的数据，清理后下次可能需要重新联网加载",
        [],
        0,
        typeof bytes === "number" ? bytes : 0
      )
    );
  } catch {
    /* 非原生端无此项 */
  }

  return details;
}

/** 只清指定分类，保留其他缓存 */
export async function clearCacheCategory(
  category: CacheCategory
): Promise<void> {
  switch (category) {
    case "audio":
      await caches.delete(AUDIO_CACHE_NAME);
      return;
    case "webview":
      await CacheManager.clearWebViewCache();
      return;
    case "links":
      useUrlCacheStore.getState().clear();
      return;
    case "offline":
      useOfflineStore.getState().clear();
      return;
    case "lyric":
    case "cover":
    case "api": {
      const cache = await caches.open(API_CACHE_NAME);
      const requests = await cache.keys();
      const doomed = requests.filter((req) => {
        const type = classifyApiKey(decodeCacheKey(req.url));
        if (category === "api") return type === "api";
        return type === category;
      });
      await Promise.all(doomed.map((req) => cache.delete(req)));
      if (category === "api") await caches.delete(PAGES_CACHE_NAME);
      return;
    }
  }
}
