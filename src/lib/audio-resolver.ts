import { Capacitor } from "@capacitor/core";
import { musicApi } from "@/lib/music-api";
import { normalizeAudioUrlForPlayback } from "@/lib/utils/audio-url";
import { useDownloadStore } from "@/store/download-store";
import { useOfflineStore } from "@/store/offline-store";
import {
  useUrlCacheStore,
  buildUrlCacheKey,
  whenUrlCacheReady,
} from "@/store/url-cache-store";
import { retry } from "@/lib/utils";
import { buildDownloadKey } from "@/lib/utils/download";
import {
  resolveViaLxPlayback,
  getLxUrlOverride,
} from "@/lib/imported-sources/lx-playback";
import { getSourceLabel } from "@/lib/imported-sources/labels";
import { shouldSkipOfficialResolve } from "@/lib/playback-access";
import {
  getSongDetail as getNeteaseSongDetail,
  convertSongToMusicTrack,
} from "@/lib/netease/netease-api";
import { useMusicStore } from "@/store/music-store";
import type { AudioOrigin } from "@/store/music-store/playback-slice";
import type { MusicSource, MusicTrack } from "@/types/music";
import { IS_NATIVE } from "@/lib/api/config";

/** 洛雪接管的最长等待时间，超时就回落内置平台的直链 */
const LX_RESOLVE_TIMEOUT = 8000;

/**
 * 官方接口取链的最长等待时间。
 * 之前只依赖 provider 内部的 fetch 超时，叠加 retry（2 次 + 退避）后
 * 最坏能挂 40 秒以上，表现就是「一直加载中」。超时即转洛雪兜底。
 */
const OFFICIAL_URL_TIMEOUT = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

/**
 * 获取远程音频 URL 并带有重试机制
 */
async function resolveRemoteAudioUrl(
  trackId: string,
  source: MusicSource,
  quality: number,
  forceRefresh = false
): Promise<string> {
  const maxRetries = navigator.onLine ? 2 : 0;
  return retry(
    async () => {
      const url = await musicApi.getUrl(trackId, source, quality, {
        forceRefresh,
      });
      if (!url) throw new Error("EMPTY_URL");
      return url;
    },
    maxRetries,
    800
  );
}

/**
 * 补齐老数据缺失的网易 VIP 标记。
 *
 * v96 之前 `cleanTrack` 会把 `privilege` 一起持久化时删掉，于是队列/歌单里
 * 存下来的网易曲目全都「没有 VIP 标记」：从播放列表点播时被判成免费歌，
 * 官方接口返回 30 秒试听片段却照播不误，也就永远走不到换源逻辑。
 * 这里在播放前补一次详情（getSongDetail 自带长缓存），并把结果写回队列，
 * 之后的播放就不用再补。
 */
async function fillMissingNeteasePrivilege(
  track: MusicTrack
): Promise<MusicTrack> {
  if (track.source !== "_netease" || track.privilege) return track;
  try {
    const song = await getNeteaseSongDetail(track.id);
    if (!song) return track;
    const enriched = convertSongToMusicTrack(song);
    if (!enriched.privilege) return track;
    const merged: MusicTrack = { ...track, privilege: enriched.privilege };
    useMusicStore.getState().updateTrackInQueue(track.id, merged);
    return merged;
  } catch {
    return track;
  }
}

/**
 * 解析曲目的最佳播放 URL
 * 优先级：本地下载 → 内存缓存 → 离线缓存 → 远端请求
 *
 * 供 useAudioTrackLoader（主播放）和 useAudioPreloader（预加载）共享使用
 * @param options.forceRefresh 播放错误恢复时使用：绕过全部 URL 缓存重新请求，
 *        避免把已过期的签名直链原样返回导致二次失败
 */
export async function resolveTrackUrl(
  track: MusicTrack,
  quality: number,
  options?: { forceRefresh?: boolean }
): Promise<{
  url: string;
  dlKey?: string;
  fromLx?: boolean;
  origin?: AudioOrigin;
}> {
  const { id: trackId, source, url_id: urlId } = track;
  const trackKey = buildUrlCacheKey(source, trackId, urlId, String(quality));
  const forceRefresh = options?.forceRefresh ?? false;

  // 冷启动时 IndexedDB 里的 URL 缓存是异步恢复的。不等它读完就查，
  // 会和「没有缓存」一样重新取一遍链 —— 这正是「上一首切回来又查一次」的成因之一。
  // 最多等 1.5 秒，真读不出来照常走网络解析。
  await whenUrlCacheReady();

  // Native 本地下载资源
  if (IS_NATIVE && source !== "local") {
    const dlKey = buildDownloadKey(source, trackId);
    const uri = useDownloadStore.getState().getUri(dlKey);
    if (uri)
      return {
        url: Capacitor.convertFileSrc(uri),
        dlKey,
        origin: { via: "download", source },
      };
  }

  const cacheStore = useUrlCacheStore.getState();

  // 手动指定了某个洛雪源：直接用它的直链，优先级高于缓存（用户是显式选的）
  const override = getLxUrlOverride(track);
  if (override) {
    const lxName = getSourceLabel(override.sourceId);
    cacheStore.set(trackKey, override.url, { via: "lx", lxName });
    return {
      url: normalizeAudioUrlForPlayback(override.url),
      fromLx: true,
      origin: { via: "lx", source, lxName },
    };
  }

  // 老数据补齐 VIP 标记：补齐后之前缓存的「官方 30 秒试听直链」必须作废，
  // 否则下面虽然判定为会员曲，却还是会把试听片段当成正式直链播出去
  let workingTrack = track;
  const filledTrack = await fillMissingNeteasePrivilege(track);
  if (filledTrack !== track) {
    workingTrack = filledTrack;
    cacheStore.delete(trackKey);
  }

  // 会员曲 + 当前账号没会员：官方接口只会给 30/45 秒试听片段，
  // 播下去必然是「听半分钟就断」。直接从洛雪开始，取不到就交给上层换源。
  if (shouldSkipOfficialResolve(workingTrack)) {
    // 但先看缓存：洛雪取到的链接两小时内可以直接复用，
    // 不然每次切回这首都要重新跑一遍脚本（还是十几秒）。
    if (!forceRefresh) {
      const cached = cacheStore.getEntry(trackKey);
      // 只认 via=lx 的条目：旧版本可能在这里存过官方 30 秒试听片段
      if (cached?.url && cached.via === "lx") {
        return {
          url: normalizeAudioUrlForPlayback(cached.url),
          fromLx: true,
          origin: { via: "lx", source, lxName: cached.lxName },
        };
      }
    }
    cacheStore.delete(trackKey);
    const lxResult = await withTimeout(
      resolveViaLxPlayback(workingTrack, quality).catch(() => null),
      LX_RESOLVE_TIMEOUT
    );
    if (!lxResult) throw new Error("VIP_NO_ACCESS");
    cacheStore.set(trackKey, lxResult.url, {
      via: "lx",
      lxName: lxResult.sourceName,
    });
    return {
      url: normalizeAudioUrlForPlayback(lxResult.url),
      fromLx: true,
      origin: { via: "lx", source, lxName: lxResult.sourceName },
    };
  }

  if (forceRefresh) {
    cacheStore.delete(trackKey);
  } else {
    const cachedEntry = cacheStore.getEntry(trackKey);
    if (cachedEntry) {
      const isLx = cachedEntry.via === "lx";
      return {
        url: normalizeAudioUrlForPlayback(cachedEntry.url),
        fromLx: isLx,
        origin: isLx
          ? { via: "lx", source, lxName: cachedEntry.lxName }
          : { via: "official", source },
      };
    }
  }

  // 离线缓存（校验 trackSource 防止不同音源同 ID 命中旧缓存）
  // stream-cache 记录的是播放地址快照，恢复播放时可能已过期
  const offlineRecord = useOfflineStore.getState().records?.[trackId];
  if (
    offlineRecord &&
    offlineRecord.trackSource === source &&
    !(forceRefresh && offlineRecord.source === "stream-cache")
  ) {
    return {
      url: normalizeAudioUrlForPlayback(offlineRecord.url),
      origin: { via: "offline", source },
    };
  }

  // 离线无资源（本地/播客音源 URL 来自磁盘，无需联网，仍继续解析）
  if (!navigator.onLine && source !== "local" && source !== "podcast") {
    return { url: "", origin: { via: "official", source } };
  }

  // 远端请求。先走平台官方接口，失败/超时才用洛雪导入源兜底——
  // 洛雪源不该抢正常播放（多源串行探测会拖慢首播），它的价值是
  // 官方接口取不到（版权/风控/链接失效）时换一条能播的直链。
  const queryId = source === "local" || source === "podcast" ? urlId : trackId;
  const remoteUrl = await withTimeout(
    resolveRemoteAudioUrl(queryId || "", source, quality, forceRefresh),
    OFFICIAL_URL_TIMEOUT
  );

  if (!remoteUrl) {
    const lxResult = await withTimeout(
      resolveViaLxPlayback(workingTrack, quality).catch(() => null),
      LX_RESOLVE_TIMEOUT
    );
    if (!lxResult) throw new Error("EMPTY_URL");
    cacheStore.set(trackKey, lxResult.url, {
      via: "lx",
      lxName: lxResult.sourceName,
    });
    // 非白名单域名的 http 仍需走代理，否则会被混合内容策略拦掉
    return {
      url: normalizeAudioUrlForPlayback(lxResult.url),
      fromLx: true,
      origin: { via: "lx", source, lxName: lxResult.sourceName },
    };
  }

  cacheStore.set(trackKey, remoteUrl, { via: "official" });
  // 强刷成功后回写 stream-cache 快照，否则下次播放仍会命中其中的过期 URL
  if (
    forceRefresh &&
    offlineRecord?.source === "stream-cache" &&
    offlineRecord.trackSource === source
  ) {
    useOfflineStore
      .getState()
      .addRecord({ ...offlineRecord, url: remoteUrl, cachedAt: Date.now() });
  }
  return {
    url: remoteUrl,
    origin:
      source === "local" || source === "podcast"
        ? { via: "local", source }
        : { via: "official", source },
  };
}
