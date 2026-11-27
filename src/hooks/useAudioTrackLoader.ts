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
import { logger } from "@/lib/logger";
import { resolveTrackUrl } from "@/lib/audio-resolver";
import { shouldSkipOfficialResolve } from "@/lib/playback-access";
import { resolveViaLxPlayback } from "@/lib/imported-sources/lx-playback";
import { resolveViaHigequFallback } from "@/lib/higequ/higequ-fallback";
import { resolveViaCrossPlatform } from "@/lib/cross-platform-fallback";
import { muteAndPause, restoreVolume } from "@/lib/audio-fade";
import { IS_NATIVE } from "@/lib/api/config";

const AUDIO_READY_TIMEOUT = 8000;
/** 播放失败后给洛雪源重新取链的时限 */
const LX_FALLBACK_TIMEOUT = 7000;
/** 播放失败后给嗨歌曲搜索+取链的时限（站点较慢，给足时间） */
const HIGEQU_FALLBACK_TIMEOUT = 15000;
/** 播放失败后跨平台搜同曲+并发取链的时限（多平台搜索） */
const CROSS_PLATFORM_FALLBACK_TIMEOUT = 20000;
/** 网易/QQ 免费曲官方直链失效后，强制刷新再取一次的时限 */
const OFFICIAL_RETRY_TIMEOUT = 10000;
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

/**
 * 优先级并发兜底：所有任务同时发起取链，但按数组顺序决定胜负。
 *
 * 高优先级一旦拿到结果就立即返回，其余请求即便仍在跑，结果也会被丢弃；
 * 高优先级失败/超时才依次看下一个。这和「谁先返回谁播放」相反 ——
 * 洛雪必须排在嗨歌曲和其他平台前面，后两者先拿到链也要等洛雪认输。
 */
async function priorityFallbackResult<T>(
  tasks: Promise<T | null>[]
): Promise<T | null> {
  for (const task of tasks) {
    const result = await task.catch(() => null);
    if (result) return result;
  }
  return null;
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

        // 官方直链播不出来时，所有生效的替代源一起取链，但播放有固定优先级：
        // 网易/QQ 免费曲先重试官方 → 洛雪 → 嗨歌曲 → 其他平台。
        // 高优先级拿到链就直接用它，其余结果丢弃；低优先级即便先返回，
        // 也要等前面的失败/超时才轮到。
        type FallbackWinner =
          | { kind: "official"; url: string }
          | { kind: "lx"; url: string; sourceName: string }
          | { kind: "higequ"; url: string }
          | { kind: "cross"; url: string; source: MusicSource };
        const canFallback =
          getState().enableAutoMatch &&
          source !== "local" &&
          source !== "podcast" &&
          !isStale();
        // 顺序即优先级：priorityFallbackResult 按此顺序收敛
        const fallbackTasks: Promise<FallbackWinner | null>[] = [];

        // ① 网易/QQ 免费曲先重试官方：官方本来就能给完整链接，只是这次签名过期/
        // 节点抖动。强制刷新绕开已删的缓存再取一次，比直接让洛雪接管更稳。
        // 会员曲（shouldSkipOfficialResolve）官方只给试听片段，不在这里重试。
        const canRetryOfficial =
          !currentTrack.pendingSourceFrom &&
          (currentTrack.source === "_netease" ||
            currentTrack.source === "qq") &&
          !isVipSkip &&
          !shouldSkipOfficialResolve(currentTrack);
        if (canRetryOfficial) {
          fallbackTasks.push(
            withTimeout(
              resolveTrackUrl(currentTrack, parseInt(quality, 10), {
                forceRefresh: true,
              }),
              OFFICIAL_RETRY_TIMEOUT
            )
              .then((result) => (result?.url ? result : null))
              .catch(() => null)
              .then((result) =>
                result ? { kind: "official" as const, url: result.url } : null
              )
          );
        }

        // ② 洛雪：脚本按同曲换直链，不动 songmid。
        // 洛雪已试过（fromLx）、待匹配目标源 id 尚未拿到、或跳过官方的会员曲都不重复取链。
        if (
          !currentTrack.pendingSourceFrom &&
          source !== "local" &&
          source !== "podcast" &&
          !skipLxFallback &&
          lxFallbackTrackRef.current !== trackKey
        ) {
          lxFallbackTrackRef.current = trackKey;
          fallbackTasks.push(
            withTimeout(
              resolveViaLxPlayback(currentTrack, parseInt(quality, 10)),
              LX_FALLBACK_TIMEOUT
            )
              .catch(() => null)
              .then((result) =>
                result
                  ? {
                      kind: "lx" as const,
                      url: result.url,
                      sourceName: result.sourceName,
                    }
                  : null
              )
          );
        }

        // ③ 嗨歌曲：同名曲直链，不动队列曲目。
        const higequEnabled = getState().sourceConfigs.some(
          (c) => c.source === "higequ" && c.enabled && c.visible
        );
        if (
          canFallback &&
          higequEnabled &&
          source !== "higequ" &&
          higequFallbackTrackRef.current !== trackKey
        ) {
          higequFallbackTrackRef.current = trackKey;
          fallbackTasks.push(
            withTimeout(
              resolveViaHigequFallback(currentTrack, 4000),
              HIGEQU_FALLBACK_TIMEOUT
            )
              .then((result) =>
                result ? { kind: "higequ" as const, url: result.url } : null
              )
              .catch(() => null)
          );
        }

        // ④ 其他平台：搜同曲后并发取链，同样不动队列曲目。
        if (canFallback && crossPlatformFallbackTrackRef.current !== trackKey) {
          crossPlatformFallbackTrackRef.current = trackKey;
          fallbackTasks.push(
            withTimeout(
              resolveViaCrossPlatform(
                currentTrack,
                parseInt(quality, 10),
                CROSS_PLATFORM_FALLBACK_TIMEOUT
              ),
              CROSS_PLATFORM_FALLBACK_TIMEOUT
            )
              .then((result) =>
                result
                  ? {
                      kind: "cross" as const,
                      url: result.url,
                      source: result.track.source,
                    }
                  : null
              )
              .catch(() => null)
          );
        }

        if (fallbackTasks.length > 0) {
          toast("正在寻找可播的替代音源…", { id: "playback-fallback" });
          const winner = await priorityFallbackResult(fallbackTasks);
          toast.dismiss("playback-fallback");
          if (isStale()) return;

          if (winner && winner.url !== remoteUrlRef.current) {
            remoteUrlRef.current = winner.url;
            const origin =
              winner.kind === "lx"
                ? { via: "lx" as const, source, lxName: winner.sourceName }
                : winner.kind === "cross"
                  ? { via: "official" as const, source: winner.source }
                  : winner.kind === "official"
                    ? { via: "official" as const, source: currentTrack.source }
                    : { via: "higequ" as const, source };
            if (winner.kind === "lx") fromLxRef.current = true;
            getState().setCurrentAudioOrigin(origin);
            getState().recordTrackOrigin(currentTrack, origin);
            try {
              await play(winner.url);
              toast.success(
                winner.kind === "official"
                  ? "官方源已重新取链播放"
                  : winner.kind === "lx"
                    ? `洛雪源「${winner.sourceName}」已接管播放`
                    : winner.kind === "cross"
                      ? `已切换到${winner.source}音源播放`
                      : "嗨歌曲已接管播放",
                { id: "playback-fallback" }
              );
              return;
            } catch (fallbackPlayError) {
              logger.warn("useAudioTrackLoader", "替代音源播放仍失败", {
                trackId,
                source,
                fallbackPlayError,
              });
            }
          }
        }

        // 最后兜底：网易会员曲宁可放官方试听片段，也别直接跳歌。
        // 只在「没会员导致官方被跳过」且替代音源全落空时走一次。
        if (isVipSkip && currentTrack.source === "_netease" && !isStale()) {
          try {
            const preview = await resolveTrackUrl(
              currentTrack,
              parseInt(quality, 10),
              { forceRefresh: true, allowVipPreview: true }
            );
            if (
              preview.url &&
              preview.url !== remoteUrlRef.current &&
              !isStale()
            ) {
              remoteUrlRef.current = preview.url;
              fromLxRef.current = false;
              if (preview.origin) {
                getState().setCurrentAudioOrigin(preview.origin);
                getState().recordTrackOrigin(currentTrack, preview.origin);
              }
              toast("无可用替代源，播放官方试听片段", {
                id: "vip-preview-fallback",
              });
              await play(preview.url);
              return;
            }
          } catch (previewError) {
            logger.warn("useAudioTrackLoader", "网易试听兜底失败", {
              trackId,
              source,
              previewError,
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
