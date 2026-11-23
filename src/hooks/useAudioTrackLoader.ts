import { useEffect, useRef } from "react";
import { getProxyUrl, isProxyUrl } from "@/lib/api";
import { useMusicStore } from "@/store/music-store";
import { useSourceQualityStore } from "@/store/source-quality-store";
import { useDownloadStore } from "@/store/download-store";
import { useOfflineStore } from "@/store/offline-store";
import { useUrlCacheStore, buildUrlCacheKey } from "@/store/url-cache-store";
import { buildDownloadKey } from "@/lib/utils/download";
import type { MusicSource } from "@/types/music";
import toast from "react-hot-toast";
import { handleAutoMatch } from "@/lib/audio-match";
import { logger } from "@/lib/logger";
import { resolveTrackUrl } from "@/lib/audio-resolver";
import { resolveViaLxPlayback } from "@/lib/imported-sources/lx-playback";
import { resolveViaHigequFallback } from "@/lib/higequ/higequ-fallback";
import { resolveViaCrossPlatform } from "@/lib/cross-platform-fallback";
import { isVipOnlyTrack } from "@/lib/playback-access";
import { muteAndPause, restoreVolume } from "@/lib/audio-fade";
import { IS_NATIVE } from "@/lib/api/config";

const AUDIO_READY_TIMEOUT = 8000;
/** 播放失败后给洛雪源重新取链的时限 */
const LX_FALLBACK_TIMEOUT = 7000;
/** 播放失败后给嗨歌曲搜索+取链的时限（站点较慢，给足时间） */
const HIGEQU_FALLBACK_TIMEOUT = 15000;
/** 播放失败后跨平台搜同曲+并发取链的时限（多平台搜索） */
const CROSS_PLATFORM_FALLBACK_TIMEOUT = 20000;
type FallbackStage = "none" | "proxy" | "final";

/** 带超时的 Promise：超时返回 null，不抛错 */
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

/** 校验歌曲在当前网络/缓存状态下是否可播 */
function isTrackPlayable(
  track: { source: MusicSource; id: string } | null
): boolean {
  if (!track) return false;
  if (track.source === "local" || navigator.onLine) return true;

  if (IS_NATIVE) {
    const downloadKey = buildDownloadKey(track.source, track.id);
    return useDownloadStore.getState().hasRecord(downloadKey);
  }

  return Boolean(useOfflineStore.getState().records?.[track.id]);
}

/**
 * 判断是否为网络层加载失败（MEDIA_ERR_NETWORK == 2）。
 * 鉴权/格式类失败（DECODE、SRC_NOT_SUPPORTED）不代表直连不可达，
 * 不应触发代理回退（否则会掩盖真实原因且回退也无效）。
 */
function isNetworkMediaError(err: unknown): boolean {
  return (err as { mediaErrorCode?: number | null })?.mediaErrorCode === 2;
}

/** 查找队列中下一首可播歌曲 */
function findNextPlayableTrack(
  queue: { source: MusicSource; id: string }[],
  startIndex: number
): number | null {
  if (!queue.length) return null;
  for (let i = 0; i < queue.length; i++) {
    const index = (startIndex + i) % queue.length;
    if (isTrackPlayable(queue[index])) return index;
  }
  return null;
}

/** 将音频加载事件封装为 Promise */
function waitForAudioReady(
  audio: HTMLAudioElement,
  timeout = AUDIO_READY_TIMEOUT
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("loadedmetadata", onReady);
      audio.removeEventListener("error", onError);
      clearTimeout(timer);
    };

    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(
        Object.assign(new Error("AUDIO_NOT_READY"), {
          mediaErrorCode: audio.error?.code ?? null,
        })
      );
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("AUDIO_READY_TIMEOUT"));
    }, timeout);

    audio.addEventListener("canplay", onReady, { once: true });
    audio.addEventListener("loadedmetadata", onReady, { once: true });
    audio.addEventListener("error", onError, { once: true });
  });
}

export function useAudioTrackLoader(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  isSwitchingTrackRef: React.MutableRefObject<boolean>,
  hasRecordedRef: React.MutableRefObject<boolean>
) {
  const currentTrack = useMusicStore((s) => s.queue[s.currentIndex]) || null;
  const quality = useMusicStore((s) => s.quality);
  const hasUserGesture = useMusicStore((s) => s.hasUserGesture);
  const urlRecoveryKey = useMusicStore((s) => s.urlRecoveryKey);

  const requestIdRef = useRef(0);
  const remoteUrlRef = useRef<string | null>(null);
  const fallbackStageRef = useRef<{
    trackKey: string | null;
    stage: FallbackStage;
  }>({ trackKey: null, stage: "none" });
  const prevTrackRef = useRef<{
    id?: string;
    source?: string;
    quality?: string;
    recoveryKey?: number;
  }>({});
  /** 本曲已经用洛雪源试过兜底，避免失败后无限重试 */
  const lxFallbackTrackRef = useRef<string | null>(null);
  /** 本曲已经用嗨歌曲试过兜底，避免失败后无限重试 */
  const higequFallbackTrackRef = useRef<string | null>(null);
  /** 本曲已经用跨平台换源试过兜底，避免失败后无限重试 */
  const crossPlatformFallbackTrackRef = useRef<string | null>(null);
  /** 当前这次播放的直链是不是洛雪给的（是则不再重复走洛雪兜底） */
  const fromLxRef = useRef(false);

  useEffect(() => {
    if (
      !hasUserGesture ||
      !currentTrack?.id ||
      !currentTrack?.source ||
      !audioRef.current
    )
      return;

    const { id: trackId, source, url_id: urlId } = currentTrack;
    const getState = useMusicStore.getState;
    const requestId = ++requestIdRef.current;
    const trackKey = buildUrlCacheKey(source, trackId, urlId, quality);

    const loadAudio = async () => {
      const audio = audioRef.current!;
      // 连续切歌时旧请求仍在 await 中；一旦被新请求取代就不许再碰 audio/store，
      // 否则旧歌 URL 晚返回会覆盖新歌，表现为"先播上一首，几秒后才切过来"
      const isStale = () => requestId !== requestIdRef.current;
      const prev = prevTrackRef.current;

      // prev.recoveryKey 为 undefined说明是本 effect 首次运行，非错误恢复
      const isRecovery =
        prev.recoveryKey !== undefined && prev.recoveryKey !== urlRecoveryKey;
      const isSameTrack = prev.id === trackId && prev.source === source;
      const qualityChanged = isSameTrack && prev.quality !== quality;
      // 单一品质音源没有多档码率流可换（本地文件、B站、播客、Hi歌曲、Jamendo），
      // 音质切换静默跳过：重载只会带来多余请求与 loading 闪烁，音频流其实不变
      const skipQualityReload =
        qualityChanged &&
        ["local", "bilibili", "podcast", "higequ", "jamendo"].includes(source);

      // 无需重新加载的场景
      if (
        isSameTrack &&
        (!qualityChanged || skipQualityReload) &&
        !isSwitchingTrackRef.current &&
        !isRecovery
      )
        return;

      // 状态初始化与缓存清理
      if (
        isRecovery ||
        (qualityChanged && !skipQualityReload) ||
        fallbackStageRef.current.trackKey !== trackKey
      ) {
        remoteUrlRef.current = null;
        fallbackStageRef.current = { trackKey, stage: "none" };
      }

      isSwitchingTrackRef.current = true;
      hasRecordedRef.current = false;
      // 换歌 / 换音质 / 错误恢复时先清掉上一首的来源标记，
      // 否则解析失败时播放界面会残留上一首的「音源」
      getState().setCurrentAudioOrigin(null);
      getState().setIsLoading(true);

      const resumeTime = qualityChanged
        ? audio.currentTime
        : getState().currentAudioTime;
      // 切歌开始就**同步**静音并暂停，不等淡出阶梯。
      //
      // 阶梯靠定时器推进，而切歌这一帧主线程正被封面重建 / 歌词重算占满，
      // tick 会被推迟几百毫秒 —— 这段时间旧歌仍按原音量在响，
      // 用户听到的就是「上一首拖出来的尾音」。写 volume 是同步生效的：
      // 增益先归零再暂停，解码中断时输出已是静音，不会留下爆音。
      if (!qualityChanged) muteAndPause(audio);

      /** 核心播放器加载逻辑 */
      const play = async (audioUrl: string) => {
        if (isStale()) return;
        if (audio.src !== audioUrl) {
          getState().setCurrentAudioUrl(audioUrl);
          // 换流前同步静音：淡出用的是定时器，切歌阻塞时可能还没走完，
          // 此时直接换 src 会按原音量硬截断 —— 爆音 + 尾音。
          muteAndPause(audio);
          // 先清空再赋值，强制 WebView 释放旧缓冲、重置 media element 状态
          audio.src = "";
          audio.src = audioUrl;
          audio.load();
        }
        await waitForAudioReady(audio);
        // 等待就绪期间可能已被下一次切歌接管：旧请求不得写回进度或调 play
        if (isStale()) return;
        audio.currentTime = resumeTime;
        // 音量必须在起播前**同步**写回：切歌那一刻主线程会被封面重建 / 歌词重算
        // 阻塞 300~600ms，任何延后恢复（setTimeout / rAF）都会让音乐开头静音半秒
        // （真机实测 560ms）。起播时音频从第一个采样开始，不存在阶跃，不会出爆音。
        // 走 restoreVolume 而不是裸写 volume：顺带作废可能还挂着的淡出阶梯，
        // 否则它下一次 tick 会按自己的进度把音量再压下去。
        restoreVolume(audio, getState().volume);
        await audio.play();
      };

      /** 解析获取最佳 URL (本地 -> 内存缓存 -> 离线库 -> 网络) */
      const resolveOptimalUrl = async () => {
        // 代理备用线路容灾时，直接使用已缓存的远程 URL
        if (remoteUrlRef.current) return { url: remoteUrlRef.current };

        // 播放错误恢复时强制绕过 URL 缓存重新请求，
        // 否则会命中缓存里的过期签名直链，导致恢复后二次失败
        const result = await resolveTrackUrl(
          currentTrack,
          parseInt(quality, 10),
          { forceRefresh: isRecovery }
        );
        // 记录本次是否是洛雪给的直链：它已经失败过一次的话，
        // 再让脚本取一遍只会多等 7 秒拿到同样不可播的链接
        fromLxRef.current = !!result.fromLx;
        // 播放界面据此显示「当前用的音源」：官方 / 洛雪脚本 / 本地下载 / 离线
        if (result.origin) {
          getState().setCurrentAudioOrigin(result.origin);
          // 同时写进曲目级记录：列表行和「···」菜单读这份，
          // 否则洛雪接管时它们还标着曲目原本的平台
          getState().recordTrackOrigin(currentTrack, result.origin);
        }
        // 同步到 remoteUrlRef 以支持代理备用线路容灾（旧请求不得污染新歌的备用线路）
        if (result.url && !result.dlKey && !isStale()) {
          remoteUrlRef.current = result.url;
        }
        return result;
      };

      try {
        const { url: primaryUrl, dlKey } = await resolveOptimalUrl();
        if (isStale()) return;

        // 离线无资源容灾跳过
        if (!primaryUrl && !navigator.onLine && source !== "local") {
          const state = getState();
          const nextIdx = findNextPlayableTrack(
            state.queue,
            state.currentIndex
          );
          if (nextIdx !== null && nextIdx !== state.currentIndex) {
            state.setCurrentIndexAndPlay(nextIdx);
          } else {
            logger.error(
              "useAudioTrackLoader",
              "Network unavailable, no playable tracks",
              { trackId, source }
            );
            state.setIsPlaying(false);
          }
          return;
        }

        try {
          await play(primaryUrl);
        } catch (err) {
          if (err instanceof DOMException && err.name === "NotAllowedError")
            throw err;

          // 本地文件失效退化为网络
          if (
            dlKey &&
            primaryUrl !== remoteUrlRef.current &&
            remoteUrlRef.current
          ) {
            useDownloadStore.getState().removeRecord(dlKey);
            toast.error("播放失败，已切换在线播放");
            await play(remoteUrlRef.current);
            return;
          }

          // 代理备用线路容灾（仅网络层失败才回退，鉴权/格式类失败不走）
          if (
            getState().enableProxyFallback &&
            isNetworkMediaError(err) &&
            source !== "local" &&
            fallbackStageRef.current.stage === "none" &&
            remoteUrlRef.current &&
            navigator.onLine
          ) {
            fallbackStageRef.current.stage = "proxy";
            toast("已切换备用线路", { icon: "🌐", id: "proxy-notice" });
            const proxyUrl = isProxyUrl(remoteUrlRef.current)
              ? remoteUrlRef.current
              : getProxyUrl(remoteUrlRef.current);
            await play(proxyUrl);
            return;
          }

          throw err;
        }
      } catch (err: unknown) {
        // 清理失效缓存（置于 requestId 守卫前：audio error 触发的恢复流程
        // 会使本请求失效，但失效缓存仍需删除，避免恢复/重试再次命中死链）
        useOfflineStore.getState().removeRecord(trackId);
        useUrlCacheStore.getState().delete(trackKey);

        if (requestId !== requestIdRef.current) return;

        const errorMsg = err instanceof Error ? err.message : String(err);
        // mediaErrorCode: 2=网络 3=解码 4=源不支持。排查「链接能拉到但播不了」时
        // 只有这个码能区分是混合内容拦截还是解码问题
        const mediaErrorCode =
          (err as { mediaErrorCode?: number | null })?.mediaErrorCode ?? null;
        logger.error(
          "useAudioTrackLoader",
          `Audio load failed: ${errorMsg} (media=${mediaErrorCode ?? "-"})`,
          err,
          { trackId, source, urlId }
        );

        // 官方直链取到了却播不出来（403 / vkey 失效 / 域名下线）：
        // 先用洛雪脚本给同一首歌换一条直链。这是洛雪源唯一能做、也最对症的事，
        // 不走「换源搜索」——那样会换掉 songmid，变成另一条曲目。
        // 洛雪已经试过（fromLx）或这本来就是一只要跳过官方的会员曲，
        // 都不该再花 7 秒重复取链，直接进入换源
        const isVipSkip = errorMsg === "VIP_NO_ACCESS";
        const skipLxFallback = fromLxRef.current || isVipSkip;
        if (
          source !== "local" &&
          source !== "podcast" &&
          !skipLxFallback &&
          lxFallbackTrackRef.current !== trackKey
        ) {
          lxFallbackTrackRef.current = trackKey;
          toast("官方链接不可播，正在用洛雪源重新取链…", {
            id: "lx-fallback",
            icon: "🎵",
          });
          const lxResult = await withTimeout(
            resolveViaLxPlayback(currentTrack, parseInt(quality, 10)),
            LX_FALLBACK_TIMEOUT
          );
          if (lxResult && !isStale() && lxResult.url !== remoteUrlRef.current) {
            remoteUrlRef.current = lxResult.url;
            fromLxRef.current = true;
            getState().setCurrentAudioOrigin({
              via: "lx",
              source,
              lxName: lxResult.sourceName,
            });
            getState().recordTrackOrigin(currentTrack, {
              via: "lx",
              source,
              lxName: lxResult.sourceName,
            });
            try {
              await play(lxResult.url);
              toast.success("洛雪源已接管播放", { id: "lx-fallback" });
              return;
            } catch (lxError) {
              logger.warn("useAudioTrackLoader", "洛雪源兜底播放仍失败", {
                trackId,
                source,
                lxError,
              });
              // 取到了链但播放仍失败：这条 if 不会走下面的 else，
              // 不在这里 dismiss，「正在取链」的 toast 就会残留
              toast.dismiss("lx-fallback");
            }
          } else {
            toast.dismiss("lx-fallback");
          }
        }

        // 洛雪也没接住：按洛雪桌面版 findMusic 的思路跨平台搜同曲换链。
        // 并发搜用户启用的多个平台、歌名+歌手+专辑严格校验（挡翻唱），
        // 再并发取链探活，只换播放地址不动队列。放在嗨歌曲之前——命中率高
        // 且严格，避免嗨歌曲那种同名曲（可能翻唱）抢先接管。
        // 尊重「自动换源」总开关：关掉就说明用户不想自动替换播放来源。
        if (
          getState().enableAutoMatch &&
          source !== "local" &&
          source !== "podcast" &&
          crossPlatformFallbackTrackRef.current !== trackKey
        ) {
          crossPlatformFallbackTrackRef.current = trackKey;
          toast("正在跨平台寻找同曲的可播音源…", {
            id: "cross-platform-fallback",
            icon: "🎵",
          });
          const crossResult = await withTimeout(
            resolveViaCrossPlatform(
              currentTrack,
              parseInt(quality, 10),
              CROSS_PLATFORM_FALLBACK_TIMEOUT
            ),
            CROSS_PLATFORM_FALLBACK_TIMEOUT
          );
          if (
            crossResult &&
            !isStale() &&
            crossResult.url !== remoteUrlRef.current
          ) {
            remoteUrlRef.current = crossResult.url;
            const origin = {
              via: "official" as const,
              source: crossResult.track.source,
            };
            getState().setCurrentAudioOrigin(origin);
            getState().recordTrackOrigin(currentTrack, origin);
            try {
              await play(crossResult.url);
              toast.success(`已切换到${crossResult.track.source}音源播放`, {
                id: "cross-platform-fallback",
              });
              return;
            } catch (crossPlayError) {
              logger.warn("useAudioTrackLoader", "跨平台换源播放仍失败", {
                trackId,
                source,
                crossPlayError,
              });
            }
          }
          toast.dismiss("cross-platform-fallback");
        }

        // 洛雪也没接住：用嗨歌曲搜同名曲换一条直链。它相对其他源稳定，
        // 只换播放地址、不动队列曲目（和洛雪接管一致）。搜索+取链较慢，
        // 放在洛雪之后、会员曲跨平台自动匹配之前。
        // 尊重「自动换源」总开关和设置里嗨歌曲的启用状态：关掉其中之一
        // 就说明用户不想要自动替换，不该在播放失败时偷偷再发搜索请求。
        const higequEnabled = getState().sourceConfigs.some(
          (c) => c.source === "higequ" && c.enabled && c.visible
        );
        if (
          getState().enableAutoMatch &&
          higequEnabled &&
          source !== "local" &&
          source !== "podcast" &&
          source !== "higequ" &&
          higequFallbackTrackRef.current !== trackKey
        ) {
          higequFallbackTrackRef.current = trackKey;
          toast("官方链接不可播，正在用嗨歌曲找同名歌曲…", {
            id: "higequ-fallback",
            icon: "🎵",
          });
          const higequResult = await withTimeout(
            resolveViaHigequFallback(currentTrack, 4000),
            HIGEQU_FALLBACK_TIMEOUT
          );
          if (
            higequResult &&
            !isStale() &&
            higequResult.url !== remoteUrlRef.current
          ) {
            remoteUrlRef.current = higequResult.url;
            const origin = { via: "higequ" as const, source };
            getState().setCurrentAudioOrigin(origin);
            getState().recordTrackOrigin(currentTrack, origin);
            try {
              await play(higequResult.url);
              toast.success("嗨歌曲已接管播放", { id: "higequ-fallback" });
              return;
            } catch (higequError) {
              logger.warn("useAudioTrackLoader", "嗨歌曲兜底播放仍失败", {
                trackId,
                source,
                higequError,
              });
            }
          }
          toast.dismiss("higequ-fallback");
        }

        // 自动匹配容灾：只给会员曲跨平台换源。
        // 免费歌在 QQ / 网易自己的源上就能播，整条替换成别家平台
        // 反而会把列表里的曲目和音源标记一起改掉。
        if (getState().enableAutoMatch && isVipOnlyTrack(currentTrack)) {
          try {
            if (await handleAutoMatch(currentTrack)) return;
          } catch {
            logger.warn("useAudioTrackLoader", "Auto match failed", {
              trackId,
              source,
            });
          }
        }

        // 会员曲被跳过不是「音源故障」，不该记进音源失败统计
        if (!isVipSkip) useSourceQualityStore.getState().recordFail(source);

        fallbackStageRef.current.stage = "final";
        audio.src = "";
        getState().setCurrentAudioUrl(null);
        toast.error(
          isVipSkip ? "会员歌曲未找到可播源" : "播放失败，已自动切到下一首"
        );

        const state = getState();
        if (state.incrementFailures() >= state.maxConsecutiveFailures) {
          if (audio.paused) getState().setIsPlaying(false);
          else
            logger.warn(
              "useAudioTrackLoader",
              "Skip setIsPlaying(false) because audio is still playing"
            );
        } else {
          getState().skipToNext();
        }
      } finally {
        if (requestId === requestIdRef.current) {
          isSwitchingTrackRef.current = false;
          getState().setIsLoading(false);
        }
      }
    };

    loadAudio();
    prevTrackRef.current = {
      id: trackId,
      source,
      quality,
      recoveryKey: urlRecoveryKey,
    };

    return () => {
      if (requestId === requestIdRef.current) requestIdRef.current++;
    };
  }, [
    currentTrack?.id,
    currentTrack?.source,
    currentTrack?.url_id,
    quality,
    hasUserGesture,
    urlRecoveryKey,
  ]);
}
