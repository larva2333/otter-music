import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { storeKey } from "./store-keys";
import { idbStorage } from "@/lib/storage-adapter";
import { revokeBlobUrl } from "@/lib/utils/blob-registry";
import type { MusicSource } from "@/types/music";

/**
 * 构建 URL 缓存 key
 * @param source 音源
 * @param trackId 曲目目录 ID
 * @param urlId 曲目 URL 标识（local/podcast 等音源使用 urlId，其余使用 trackId）
 * @param quality 音质档位
 * @returns 缓存 key，格式为 `${source}:${id}:${quality}`
 */
export function buildUrlCacheKey(
  source: MusicSource,
  trackId: string,
  urlId: string | undefined,
  quality: string
): string {
  const id =
    (source as string) === "local" || source === "podcast"
      ? (urlId ?? trackId)
      : trackId;
  return `${source}:${id}:${quality}`;
}

/**
 * 远端播放 URL 的缓存时长。
 *
 * 平台签名直链一般是小时级（QQ 的 vkey、网易的 auth 都在 1~2 小时内有效），
 * 之前只留 15 分钟，导致「刚放过的歌过一会儿再切回来」又要重新取链一次。
 * 真过期了不会卡死：播放错误恢复会带 forceRefresh 绕过缓存重新解析。
 */
const URL_CACHE_TTL = 2 * 60 * 60 * 1000;

/** 本地/blob 资源不会失效，不参与 TTL */
const NON_EXPIRING_URL_PREFIXES = ["blob:", "capacitor:", "file:", "content:"];

/** 这条链接是谁给的：平台官方接口，还是洛雪脚本 */
export type UrlCacheVia = "official" | "lx";

export interface UrlCacheEntry {
  url: string;
  cachedAt: number;
  /** 取链来源。旧版本条目没有这个字段 */
  via?: UrlCacheVia;
  /** via=lx 时，具体是哪个洛雪脚本给的链接（用于播放时显示音源） */
  lxName?: string;
}

export interface UrlCacheMeta {
  via?: UrlCacheVia;
  lxName?: string;
}

const isNonExpiringUrl = (url: string) =>
  NON_EXPIRING_URL_PREFIXES.some((p) => url.startsWith(p));

/** 兼容读取：旧版本持久化的是纯字符串条目 */
const entryUrl = (entry: UrlCacheEntry | string | undefined) =>
  typeof entry === "string" ? entry : entry?.url;

/**
 * 已解析音频 URL 的持久化缓存状态
 */
interface UrlCacheState {
  /** URL 映射表，key 格式为 `${source}:${id}:${quality}` */
  urlMap: Record<string, UrlCacheEntry>;

  /** 获取指定 key 的缓存 URL（超过 TTL 或旧格式条目视为过期并清除） */
  get: (key: string) => string | undefined;

  /** 获取完整缓存条目（含取链来源），过期条目同样会被清除 */
  getEntry: (key: string) => UrlCacheEntry | undefined;

  /** 缓存并持久化 URL；若覆盖旧 blob URL 则先释放 */
  set: (key: string, value: string, meta?: UrlCacheMeta) => void;

  /** 删除缓存 URL；若为 blob URL 则先释放 */
  delete: (key: string) => void;

  /** 清空所有缓存 URL；若包含 blob URL 则先释放 */
  clear: () => void;
}

export const useUrlCacheStore = create<UrlCacheState>()(
  persist(
    (set, storeGet) => ({
      urlMap: {},

      getEntry: (key) => {
        const entry = storeGet().urlMap[key] as
          | UrlCacheEntry
          | string
          | undefined;
        if (!entry) return undefined;
        const url = entryUrl(entry);
        if (!url) return undefined;

        // 旧版本条目无时间戳、也无取链来源，视为过期：重新解析一次就能写回新格式
        const expired =
          typeof entry === "string" ||
          (!isNonExpiringUrl(url) &&
            Date.now() - entry.cachedAt > URL_CACHE_TTL);
        if (!expired) return entry as UrlCacheEntry;

        storeGet().delete(key);
        return undefined;
      },

      get: (key) => storeGet().getEntry(key)?.url,

      set: (key, value, meta) => {
        set((state) => {
          const oldUrl = entryUrl(state.urlMap[key]);
          if (oldUrl && oldUrl !== value && oldUrl.startsWith("blob:")) {
            revokeBlobUrl(oldUrl);
          }
          return {
            urlMap: {
              ...state.urlMap,
              [key]: { url: value, cachedAt: Date.now(), ...meta },
            },
          };
        });
      },

      delete: (key) => {
        set((state) => {
          const oldUrl = entryUrl(state.urlMap[key]);
          if (oldUrl?.startsWith("blob:")) {
            revokeBlobUrl(oldUrl);
          }
          const { [key]: _, ...rest } = state.urlMap;
          return { urlMap: rest };
        });
      },

      clear: () => {
        set((state) => {
          for (const entry of Object.values(state.urlMap)) {
            const url = entryUrl(entry);
            if (url?.startsWith("blob:")) revokeBlobUrl(url);
          }
          return { urlMap: {} };
        });
      },
    }),
    {
      name: storeKey.UrlCacheStore,
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({ urlMap: state.urlMap }),
      // blob URL 仅当前页面会话有效，重启后必失效；
      // 但 blob 条目被标记为永不过期，必须在恢复时清除避免一直命中死链
      onRehydrateStorage: () => () => purgeDeadBlobEntries(),
    }
  )
);

/** 清除持久化恢复回来的 blob 条目（跨会话已失效），供 rehydrate 与单测使用 */
export function purgeDeadBlobEntries() {
  const { urlMap, delete: del } = useUrlCacheStore.getState();
  for (const key of Object.keys(urlMap)) {
    if (entryUrl(urlMap[key])?.startsWith("blob:")) del(key);
  }
}

/**
 * 等 URL 缓存从 IndexedDB 恢复完成。
 *
 * persist 的 rehydrate 是异步的：冷启动后立即点播放时，store 还是空的，
 * 于是「明明上次解析过」的歌照样重新取链。这里等它读完（最多 timeoutMs），
 * 超时也放行，不影响正常解析。
 */
export function whenUrlCacheReady(timeoutMs = 1500): Promise<void> {
  if (useUrlCacheStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    // 订阅的回调有可能早于赋值返回，先声明再用可选调用
    // eslint-disable-next-line prefer-const
    let unsub: (() => void) | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub?.();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    unsub = useUrlCacheStore.persist.onFinishHydration(finish);
  });
}
