import { create } from "zustand";
import {
  persist,
  createJSONStorage,
  type PersistStorage,
  type StorageValue,
} from "zustand/middleware";
import { storeKey } from "../store-keys";
import { idbStorage } from "@/lib/storage-adapter";
import { cleanTrack } from "@/lib/utils/music";
import { cleanPlaylist } from "./shared";
import {
  DEFAULT_SOURCE_CONFIGS,
  type MusicSource,
  type MusicTrack,
  type SourceConfig,
} from "@/types/music";

import { createFavoritesSlice } from "./favorites-slice";
import { createPlaylistSlice } from "./playlist-slice";
import { createPlaybackSlice } from "./playback-slice";
import { createSearchSlice } from "./search-slice";
import { createUiSlice, DEFAULT_BROWSE_POSITION } from "./ui-slice";
import { createDownloadSettingsSlice } from "./download-settings-slice";

import type { MusicState } from "./types";

/**
 * 旧版默认配置里酷我写了两次，老用户的持久化数据里可能还留着两条同 id 记录
 * （列表里显示两个「酷我」，聚合搜索也会请求两遍）。同 source 只保留一条，
 * 重复的两者取「启用且可见」的那条，避免去掉唯一一个开着的开关。
 */
export function dedupeSourceConfigs(configs: SourceConfig[]): SourceConfig[] {
  const unique = new Map<string, SourceConfig>();
  for (const config of configs) {
    if (!config?.source) continue;
    const prev = unique.get(config.source);
    const on = config.enabled && config.visible;
    const prevOn = prev ? prev.enabled && prev.visible : false;
    if (!prev || (on && !prevOn)) unique.set(config.source, config);
  }
  return Array.from(unique.values());
}

export type { MusicState } from "./types";
export type { FullScreenBackgroundMode } from "./ui-slice";
export type { LyricAlign } from "./ui-slice";
export type { CoverStyle } from "./ui-slice";
export { DEFAULT_VINYL_COLOR, TRANSPARENT_VINYL_COLOR } from "./ui-slice";

/**
 * 跳过未持久化字段变更（isLoading / isPlaying / coverUrl / currentAudioUrl / currentAudioOrigin 等）
 * 触发的无效 500KB+ JSON.stringify，并按引用缓存 cleanTrack/cleanPlaylist 结果。
 */
function createDeduplicatedMusicStorage(): PersistStorage<MusicState> {
  const base = createJSONStorage<MusicState>(() => idbStorage)!;
  let lastSnapshot: Record<string, unknown> | null = null;
  let lastVersion: number | undefined;

  return {
    getItem: (name) => base.getItem(name),
    removeItem: (name) => {
      lastSnapshot = null;
      return base.removeItem(name);
    },
    setItem: (name, value: StorageValue<MusicState>) => {
      const next = value.state as unknown as Record<string, unknown>;
      if (lastSnapshot && lastVersion === value.version) {
        const keys = Object.keys(next);
        let changed = keys.length !== Object.keys(lastSnapshot).length;
        if (!changed) {
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (!Object.is(next[k], lastSnapshot[k])) {
              changed = true;
              break;
            }
          }
        }
        if (!changed) return;
      }
      lastSnapshot = next;
      lastVersion = value.version;
      return base.setItem(name, value);
    },
  };
}

function createMemoizedPartialize() {
  let prevFav: MusicState["favorites"] | null = null;
  let cachedFav: MusicTrack[] = [];
  let prevPlaylists: MusicState["playlists"] | null = null;
  let cachedPlaylists: ReturnType<typeof cleanPlaylist>[] = [];
  let prevQueue: MusicState["queue"] | null = null;
  let cachedQueue: MusicTrack[] = [];
  let prevOrigQueue: MusicState["originalQueue"] | null = null;
  let cachedOrigQueue: MusicTrack[] = [];

  return (state: MusicState): MusicState => {
    if (prevFav !== state.favorites) {
      prevFav = state.favorites;
      cachedFav = state.favorites.map(cleanTrack);
    }
    if (prevPlaylists !== state.playlists) {
      prevPlaylists = state.playlists;
      cachedPlaylists = state.playlists.map(cleanPlaylist);
    }
    if (prevQueue !== state.queue) {
      prevQueue = state.queue;
      cachedQueue = state.queue.map(cleanTrack);
    }
    if (prevOrigQueue !== state.originalQueue) {
      prevOrigQueue = state.originalQueue;
      cachedOrigQueue = state.originalQueue.map(cleanTrack);
    }

    return {
      favorites: cachedFav,
      playlists: cachedPlaylists,
      queue: cachedQueue,
      originalQueue: cachedOrigQueue,
      currentIndex: state.currentIndex,
      volume: state.volume,
      isRepeat: state.isRepeat,
      isShuffle: state.isShuffle,
      currentAudioTime: state.currentAudioTime,
      duration: state.duration,
      quality: state.quality,
      commentSource: state.commentSource,
      searchSource: state.searchSource,
      sourceConfigs: state.sourceConfigs,
      lastMineTab: state.lastMineTab,
      // 不持久化「上次浏览位置」（lastPlaylistCategory /
      // lastBillboardGroup）：下次进入 App 一律回到第一个分类。
      playlistCategoryOrder: state.playlistCategoryOrder,
      enableAutoMatch: state.enableAutoMatch,
      autoMatchFavorites: state.autoMatchFavorites,
      autoMatchPlaylists: state.autoMatchPlaylists,
      enableProxyFallback: state.enableProxyFallback,
      bilibiliKeepOriginalMeta: state.bilibiliKeepOriginalMeta,
      bilibiliAutoMatchSuffix: state.bilibiliAutoMatchSuffix,
      fullScreenBackgroundMode: state.fullScreenBackgroundMode,
      customBackgroundImage: state.customBackgroundImage,
      coverSize: state.coverSize,
      coverRadius: state.coverRadius,
      coverStyle: state.coverStyle,
      vinylColor: state.vinylColor,
      showSourceBadge: state.showSourceBadge,
      showBarBackground: state.showBarBackground,
      lightThemeLightBackground: state.lightThemeLightBackground,
      lyricAlign: state.lyricAlign,
      lyricFontSize: state.lyricFontSize,
      lyricOffset: state.lyricOffset,
      carLyricEnabled: state.carLyricEnabled,
      desktopLyricEnabled: state.desktopLyricEnabled,
      desktopLyricFontSize: state.desktopLyricFontSize,
      desktopLyricColor: state.desktopLyricColor,
      downloadQuality: state.downloadQuality,
      embedCover: state.embedCover,
      embedLyric: state.embedLyric,
      downloadDirectory: state.downloadDirectory,
    } as unknown as MusicState;
  };
}

export const useMusicStore = create<MusicState>()(
  persist(
    (...a) => ({
      ...createFavoritesSlice(...a),
      ...createPlaylistSlice(...a),
      ...createPlaybackSlice(...a),
      ...createSearchSlice(...a),
      ...createUiSlice(...a),
      ...createDownloadSettingsSlice(...a),
    }),
    {
      name: storeKey.MusicStore,
      storage: createDeduplicatedMusicStorage(),
      version: 2,
      // 迁移只在版本升级时跑一次，之后用户手动改回别的值不会被再次覆盖。
      // v0 → v1：歌词正文字号默认值 18 → 13。
      // v1 → v2：歌词正文字号 13 → 15，对齐 left → center。
      migrate: (persisted, version) => {
        const old = persisted as Partial<MusicState>;
        if (version < 1 && old.lyricFontSize === 18) old.lyricFontSize = 13;
        if (version < 2) {
          if (old.lyricFontSize === 13) old.lyricFontSize = 15;
          if (old.lyricAlign === "left") old.lyricAlign = "center";
        }
        return old as MusicState;
      },
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<MusicState>) };
        // 「上次浏览位置」不做跨进程记忆：老版本可能把「说唱」这类分类存进了
        // IndexedDB，这里在 hydration 阶段就按出厂值覆盖，冷启动不会又停在
        // 上次的分类上（会话内的切换不受影响，仍会正常记着）。
        state.lastPlaylistCategory =
          DEFAULT_BROWSE_POSITION.lastPlaylistCategory;
        state.lastBillboardGroup = DEFAULT_BROWSE_POSITION.lastBillboardGroup;
        // 合并 sourceConfigs：过滤已移除的音源，追加新增音源。
        // 用户导入的音源（localStorage 独立存储）也要豁免过滤，否则重启就被删掉。
        const validSources = new Set(
          DEFAULT_SOURCE_CONFIGS.map((c) => c.source)
        );
        try {
          const imported = JSON.parse(
            localStorage.getItem("otter_imported_sources") || "[]"
          ) as { id: string }[];
          imported.forEach((s) => validSources.add(s.id as MusicSource));
        } catch {
          // 解析失败就按默认白名单处理
        }
        state.sourceConfigs = state.sourceConfigs.filter((c) =>
          validSources.has(c.source)
        );
        const existingSources = new Set(
          state.sourceConfigs.map((c) => c.source)
        );
        const newConfigs = DEFAULT_SOURCE_CONFIGS.filter(
          (c) => !existingSources.has(c.source)
        );
        if (newConfigs.length > 0) {
          state.sourceConfigs = [...state.sourceConfigs, ...newConfigs];
        }
        // 老数据可能带着两条酷我（历史默认配置重复），这里一次性收敛掉
        state.sourceConfigs = dedupeSourceConfigs(state.sourceConfigs);
        // 搜索固定走酷我，不再有音源下拉；持久化里的旧值统一纠正。
        if (state.searchSource !== "kuwo") {
          state.searchSource = "kuwo";
        }
        return state;
      },
      partialize: createMemoizedPartialize(),
    }
  )
);
