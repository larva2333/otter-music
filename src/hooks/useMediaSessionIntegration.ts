import { useEffect } from "react";
import { useMusicStore } from "@/store/music-store";
import {
  MediaSession,
  type ActionHandlerOptions,
  type ActionStateOptions,
} from "@jofr/capacitor-media-session";
import { forceHttps } from "@otter-music/shared";
import { IS_NATIVE } from "@/lib/api/config";
import { logger } from "@/lib/logger";

const BLOB_CONVERT_TIMEOUT_MS = 3000;

/**
 * 通知栏上的自定义按钮，不属于 MediaSession 标准动作，需要插件原生支持。
 * - like：喜欢 / 取消喜欢，图标随收藏状态切换
 * - playmode：播放模式，图标随「列表循环 / 单曲循环 / 随机播放」切换
 */
type CustomAction = "like" | "playmode";

/** 播放模式，与应用内切换顺序一致 */
type PlayMode = "list" | "repeat" | "shuffle";

/** 原生插件在 Web 端没有 setActionState，仅 Android 需要同步按钮状态 */
function syncActionState(options: ActionStateOptions) {
  if (!IS_NATIVE) return;
  const errorMessage = `MediaSession ${options.action} state error:`;
  try {
    void MediaSession.setActionState(options).catch((e) =>
      logger.error("MediaSession", errorMessage, e)
    );
  } catch (e) {
    logger.error("MediaSession", errorMessage, e);
  }
}

/**
 * 将同源 blob: 封面（如 B 站原生代理封面）转为 base64 data URL，
 * 使原生 MediaSessionPlugin 可以直接解码为 Bitmap。
 */
async function blobUrlToDataUrl(blobUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BLOB_CONVERT_TIMEOUT_MS);
  try {
    const res = await fetch(blobUrl, { signal: controller.signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function sanitizeMediaSessionArtworkUrl(
  rawUrl: string | null | undefined
): string | null {
  if (!rawUrl) return null;

  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // 本地文件的内嵌封面是 base64 data URL，原生插件直接解码，不需要联网也不用转 https。
  // 不放行会把本地歌曲的通知栏/锁屏封面全部丢掉。
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) return trimmed;

  const normalized = forceHttps(trimmed);

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:") return null;
    if (!parsed.hostname || parsed.hostname === "localhost") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function useMediaSessionIntegration(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  coverUrl: string | null | undefined
) {
  const currentTrack = useMusicStore((s) => s.queue[s.currentIndex]);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const hasUserGesture = useMusicStore((s) => s.hasUserGesture);
  const isRepeat = useMusicStore((s) => s.isRepeat);
  const isShuffle = useMusicStore((s) => s.isShuffle);
  const favorites = useMusicStore((s) => s.favorites);

  const currentTrackId = currentTrack?.id;
  const isCurrentTrackFavorite = currentTrackId
    ? favorites.some((t) => t.id === currentTrackId && !t.is_deleted)
    : false;

  const playMode: PlayMode = isShuffle
    ? "shuffle"
    : isRepeat
      ? "repeat"
      : "list";

  // 同步通知栏两个自定义按钮的图标状态
  useEffect(() => {
    syncActionState({ action: "like", active: isCurrentTrackFavorite });
  }, [isCurrentTrackFavorite]);

  useEffect(() => {
    syncActionState({ action: "playmode", mode: playMode });
  }, [playMode]);

  useEffect(() => {
    let cancelled = false;

    const updateMetadata = async () => {
      if (!currentTrack) return;
      if (!hasUserGesture) return;

      try {
        let resolvedArtworkUrl = sanitizeMediaSessionArtworkUrl(coverUrl);
        if (!resolvedArtworkUrl && coverUrl?.trim().startsWith("blob:")) {
          const dataUrl = await blobUrlToDataUrl(coverUrl.trim());
          if (cancelled) return;
          resolvedArtworkUrl = sanitizeMediaSessionArtworkUrl(dataUrl);
        }

        // 内嵌封面/blob 转换结果是内联 data URL，离线也能用，不该被 navigator.onLine 拦掉；
        // 远端 HTTPS 图床不能在 WebView 用 fetch() 预检（QQ 等无 CORS 头的图床会直接报错丢图），
        // 直接把合法 URL 交给原生 HttpURLConnection 拉取解码。
        const isInlineArtwork = !!resolvedArtworkUrl?.startsWith("data:");
        const safeArtwork: { src: string }[] =
          resolvedArtworkUrl && (isInlineArtwork || navigator.onLine)
            ? [{ src: resolvedArtworkUrl }]
            : [];

        if (cancelled) return;
        await MediaSession.setMetadata({
          title: currentTrack.name || "Unknown Track",
          artist: currentTrack.artist?.join("/") || "Unknown Artist",
          album: currentTrack.album || "",
          artwork: safeArtwork,
        });
      } catch (e) {
        logger.error("MediaSession", "MediaSession metadata error:", e);
      }
    };
    void updateMetadata();

    return () => {
      cancelled = true;
    };
  }, [currentTrack, coverUrl, hasUserGesture]);

  useEffect(() => {
    const audio = audioRef.current;

    const updatePlaybackState = async () => {
      try {
        const playbackState = audio
          ? audio.paused
            ? "paused"
            : "playing"
          : isPlaying
            ? "playing"
            : "paused";

        await MediaSession.setPlaybackState({
          playbackState,
        });
      } catch (e) {
        logger.error("MediaSession", "MediaSession state error:", e);
      }
    };

    const syncPlaybackState = () => {
      void updatePlaybackState();
    };

    syncPlaybackState();

    if (!audio) return;

    const playbackEvents: Array<keyof HTMLMediaElementEventMap> = [
      "play",
      "pause",
      "ended",
      "waiting",
      "stalled",
      "error",
    ];

    playbackEvents.forEach((event) => {
      audio.addEventListener(event, syncPlaybackState);
    });

    return () => {
      playbackEvents.forEach((event) => {
        audio.removeEventListener(event, syncPlaybackState);
      });
    };
  }, [audioRef, isPlaying, currentTrack?.id]);

  // 播放进度同步：通知栏/锁屏/背屏（小米 17 Pro 等双屏机）卡片的进度条
  // 依赖 positionState（秒）。系统按 playbackRate 自行推算位置，
  // 无需高频过桥，timeupdate 节流到 1 秒即可；seek/换曲立即刷新。
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updatePositionState = () => {
      const duration = audio.duration;
      // 无限时长（直播流）或尚未加载完成时不该上报
      if (!Number.isFinite(duration) || duration <= 0) return;
      try {
        void MediaSession.setPositionState({
          duration,
          position: Math.min(audio.currentTime, duration),
          playbackRate: audio.playbackRate || 1,
        });
      } catch (e) {
        logger.error("MediaSession", "MediaSession position error:", e);
      }
    };

    let lastSync = 0;
    const throttledSync = () => {
      const now = Date.now();
      if (now - lastSync >= 1000) {
        lastSync = now;
        updatePositionState();
      }
    };

    updatePositionState();

    const events: Array<keyof HTMLMediaElementEventMap> = [
      "timeupdate",
      "seeked",
      "loadedmetadata",
      "ratechange",
      "play",
    ];
    events.forEach((event) => {
      audio.addEventListener(
        event,
        event === "timeupdate" ? throttledSync : updatePositionState
      );
    });

    return () => {
      events.forEach((event) => {
        audio.removeEventListener(
          event,
          event === "timeupdate" ? throttledSync : updatePositionState
        );
      });
    };
  }, [audioRef, currentTrack?.id]);

  useEffect(() => {
    const actionHandlers: [
      string,
      (details?: { seekTime?: number | null }) => void,
    ][] = [
      [
        "play",
        () => {
          useMusicStore.getState().setUserGesture();
          const audio = audioRef.current;
          if (!audio) return;
          audio
            .play()
            .catch((e) =>
              logger.error("MediaSession", "MediaSession play error:", e)
            );
        },
      ],
      [
        "pause",
        () => {
          // 先同步 store 再暂停，避免被"外部抢占恢复"逻辑误判
          useMusicStore.getState().setIsPlaying(false);
          const audio = audioRef.current;
          audio?.pause();
        },
      ],
      [
        "previoustrack",
        () => {
          const { queue, currentIndex } = useMusicStore.getState();
          const prevIndex = currentIndex - 1;
          useMusicStore
            .getState()
            .setCurrentIndexAndPlay(
              prevIndex < 0 ? queue.length - 1 : prevIndex
            );
        },
      ],
      [
        "nexttrack",
        () => {
          const { queue, currentIndex } = useMusicStore.getState();
          if (queue.length > 0) {
            const nextIndex = (currentIndex + 1) % queue.length;
            useMusicStore.getState().setCurrentIndexAndPlay(nextIndex);
          }
        },
      ],
      [
        "seekto",
        (details) => {
          if (details?.seekTime !== undefined && details?.seekTime !== null) {
            useMusicStore.getState().seek(details.seekTime);
          }
        },
      ],
    ];

    // 自定义按钮仅原生端支持，Web 端 setActionHandler 遇到未知 action 会抛错
    if (IS_NATIVE) {
      const customActionHandlers: [CustomAction, () => void][] = [
        [
          "like",
          () => {
            const state = useMusicStore.getState();
            const track = state.queue[state.currentIndex];
            if (!track) return;
            if (state.isFavorite(track.id)) {
              state.removeFromFavorites(track.id);
            } else {
              state.addToFavorites(track);
            }
          },
        ],
        [
          "playmode",
          () => {
            const state = useMusicStore.getState();
            // 与应用内 handleModeToggle 保持一致：列表循环 → 单曲循环 → 随机 → 列表循环
            if (!state.isShuffle && !state.isRepeat) state.toggleRepeat();
            else if (state.isRepeat) {
              state.toggleRepeat();
              state.toggleShuffle();
            } else state.toggleShuffle();
          },
        ],
      ];
      actionHandlers.push(...customActionHandlers);
    }

    for (const [action, handler] of actionHandlers) {
      try {
        MediaSession.setActionHandler(
          { action } as ActionHandlerOptions,
          handler
        );
      } catch (e) {
        logger.error(
          "MediaSession",
          `Failed to set action handler for ${action}`,
          e
        );
      }
    }
  }, [audioRef]);
}
