import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { storeKey } from "../store-keys";
import { idbStorage } from "@/lib/storage-adapter";
import { cleanTrack } from "@/lib/utils/music";
import { cleanPlaylist } from "./shared";
import { DEFAULT_SOURCE_CONFIGS, type MusicSource } from "@/types/music";

import { createFavoritesSlice } from "./favorites-slice";
import { createPlaylistSlice } from "./playlist-slice";
import { createPlaybackSlice } from "./playback-slice";
import { createSearchSlice } from "./search-slice";
import { createUiSlice, DEFAULT_BROWSE_POSITION } from "./ui-slice";
import { createDownloadSettingsSlice } from "./download-settings-slice";

import type { MusicState } from "./types";

export type { MusicState } from "./types";
export type { FullScreenBackgroundMode } from "./ui-slice";
export type { LyricAlign } from "./ui-slice";
export type { CoverStyle } from "./ui-slice";
export { DEFAULT_VINYL_COLOR, TRANSPARENT_VINYL_COLOR } from "./ui-slice";

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
      storage: createJSONStorage(() => idbStorage),
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
        // 老用户可能把搜索源选成了已移除的音源，Select 会显示空白；
        // 不在保留列表里就回退到聚合搜索。
        if (
          state.searchSource !== "all" &&
          !validSources.has(state.searchSource)
        ) {
          state.searchSource = "all";
        }
        return state;
      },
      partialize: (state) => ({
        favorites: state.favorites.map(cleanTrack),
        playlists: state.playlists.map(cleanPlaylist),
        queue: state.queue.map(cleanTrack),
        originalQueue: state.originalQueue.map(cleanTrack),
        currentIndex: state.currentIndex,
        volume: state.volume,
        isRepeat: state.isRepeat,
        isShuffle: state.isShuffle,
        currentAudioTime: state.currentAudioTime,
        duration: state.duration,
        quality: state.quality,
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
        highlightCurrentTrack: state.highlightCurrentTrack,
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
      }),
    }
  )
);
