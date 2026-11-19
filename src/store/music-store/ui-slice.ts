import type { StateCreator } from "zustand";
import type { MusicState } from "./types";
import {
  DEFAULT_SOURCE_CONFIGS,
  type MusicSource,
  type SourceConfig,
} from "@/types/music";

export type FullScreenBackgroundMode = "theme" | "cover" | "texture" | "photo";
export type LyricAlign = "center" | "left" | "right";
export type CoverStyle = "original" | "vinyl";

/** 黑胶盘面默认色：与原来的 bg-neutral-950 一致 */
export const DEFAULT_VINYL_COLOR = "#0A0A0A";
/** 黑胶盘面「透明」的特殊取值：透出播放器背景 */
export const TRANSPARENT_VINYL_COLOR = "transparent";

/**
 * 「上次浏览位置」的出厂值：发现页默认落在「推荐」。
 * 退出应用 / 冷启动时都回到这里，App 不记忆上次停在哪个分类。
 */
export const DEFAULT_BROWSE_POSITION = {
  lastPlaylistCategory: "recommend",
  lastBillboardGroup: "songs",
} as const;

export interface AutoMatchContext {
  index: number;
  tried: Set<MusicSource>;
}

export interface UiSlice {
  quality: string;
  searchSource: MusicSource;
  sourceConfigs: SourceConfig[];
  lastPlaylistCategory: string;
  lastMineTab: "created" | "subscribed" | "albums";
  lastBillboardGroup: "songs" | "albums" | "artists";
  /** 歌单广场常驻分类的自定义顺序；null 表示未自定义（使用默认序列） */
  playlistCategoryOrder: string[] | null;
  enableAutoMatch: boolean;
  autoMatchFavorites: boolean;
  autoMatchPlaylists: boolean;
  autoMatchContext: AutoMatchContext | null;
  enableProxyFallback: boolean;
  bilibiliKeepOriginalMeta: boolean;
  bilibiliAutoMatchSuffix: string;
  fullScreenBackgroundMode: FullScreenBackgroundMode;
  /** 自定义播放器背景图（压缩后的 data URL），mode === "photo" 时使用 */
  customBackgroundImage: string | null;
  coverSize: number;
  coverRadius: number;
  /** 播放页封面样式：原始 / 黑胶唱片 */
  coverStyle: CoverStyle;
  /** 黑胶盘面颜色（hex，或 "transparent" 表示透明） */
  vinylColor: string;
  showSourceBadge: boolean;
  /** 歌曲列表中给正在播放的歌曲整行加背景高亮 */
  highlightCurrentTrack: boolean;
  /** 播放条是否显示封面取色的渐变背景；关闭时回退卡片底色 */
  showBarBackground: boolean;
  /** 浅色主题下播放条/播放页是否使用浅色背景；关闭时按深色取色 */
  lightThemeLightBackground: boolean;
  lyricAlign: LyricAlign;
  lyricFontSize: number;
  lyricOffset: number;
  /** 蓝牙车载歌词：把当前歌词行覆写到 AVRCP 的 TITLE 上供车机显示 */
  carLyricEnabled: boolean;
  /** 桌面歌词：悬浮在其他应用上方的歌词条（Android 悬浮窗） */
  desktopLyricEnabled: boolean;
  /** 桌面歌词字号（单位 sp），默认与原生初始字号一致 */
  desktopLyricFontSize: number;
  /** 桌面歌词字色（hex，如 "#FFFFFF"），默认与原生初始颜色一致 */
  desktopLyricColor: string;
  playbackSpeed: number;
  isFullScreenPlayer: boolean;
  setQuality: (quality: string) => void;
  setSearchSource: (source: MusicSource) => void;
  setSourceConfigs: (configs: SourceConfig[]) => void;
  setLastPlaylistCategory: (category: string) => void;
  setLastMineTab: (tab: "created" | "subscribed" | "albums") => void;
  setLastBillboardGroup: (group: "songs" | "albums" | "artists") => void;
  /**
   * 把「上次浏览到哪儿」归零：分类回到第一个「全部」、榜单分组
   * 回到默认。退出应用时调用，保证下次进来看不到上次停的位置。
   * 注意只清位置，不清已缓存的数据（列表快照仍在，切回不会白屏）。
   */
  resetBrowsePosition: () => void;
  setPlaylistCategoryOrder: (order: string[]) => void;
  setEnableAutoMatch: (enable: boolean) => void;
  setAutoMatchFavorites: (enable: boolean) => void;
  setAutoMatchPlaylists: (enable: boolean) => void;
  setAutoMatchContext: (ctx: AutoMatchContext | null) => void;
  setEnableProxyFallback: (enable: boolean) => void;
  setBilibiliKeepOriginalMeta: (enable: boolean) => void;
  setBilibiliAutoMatchSuffix: (suffix: string) => void;
  setFullScreenBackgroundMode: (mode: FullScreenBackgroundMode) => void;
  setCustomBackgroundImage: (dataUrl: string | null) => void;
  setCoverSize: (size: number) => void;
  setCoverRadius: (radius: number) => void;
  setCoverStyle: (style: CoverStyle) => void;
  setVinylColor: (color: string) => void;
  setShowSourceBadge: (show: boolean) => void;
  setHighlightCurrentTrack: (highlight: boolean) => void;
  setShowBarBackground: (show: boolean) => void;
  setLightThemeLightBackground: (enable: boolean) => void;
  setLyricAlign: (align: LyricAlign) => void;
  setLyricFontSize: (size: number) => void;
  setLyricOffset: (offset: number) => void;
  setCarLyricEnabled: (enable: boolean) => void;
  setDesktopLyricEnabled: (enable: boolean) => void;
  setDesktopLyricFontSize: (size: number) => void;
  setDesktopLyricColor: (color: string) => void;
  setPlaybackSpeed: (speed: number) => void;
  setIsFullScreenPlayer: (isFullScreen: boolean) => void;
}

export const createUiSlice: StateCreator<MusicState, [], [], UiSlice> = (
  set
) => ({
  quality: "192",
  searchSource: "all",
  sourceConfigs: DEFAULT_SOURCE_CONFIGS,
  lastPlaylistCategory: DEFAULT_BROWSE_POSITION.lastPlaylistCategory,
  lastMineTab: "created",
  lastBillboardGroup: DEFAULT_BROWSE_POSITION.lastBillboardGroup,
  playlistCategoryOrder: null,
  enableAutoMatch: true,
  autoMatchFavorites: false,
  autoMatchPlaylists: true,
  autoMatchContext: null,
  enableProxyFallback: true,
  bilibiliKeepOriginalMeta: false,
  bilibiliAutoMatchSuffix: "高音质 原曲",
  fullScreenBackgroundMode: "theme",
  customBackgroundImage: null,
  coverSize: 328,
  coverRadius: 24,
  coverStyle: "original",
  vinylColor: DEFAULT_VINYL_COLOR,
  showSourceBadge: true,
  highlightCurrentTrack: true,
  showBarBackground: true,
  lightThemeLightBackground: true,
  lyricAlign: "center",
  lyricFontSize: 15,
  lyricOffset: -0.5,
  carLyricEnabled: false,
  desktopLyricEnabled: false,
  desktopLyricFontSize: 15,
  desktopLyricColor: "#FFFFFF",
  playbackSpeed: 1.0,
  isFullScreenPlayer: false,
  setQuality: (quality) => set({ quality }),
  setSearchSource: (searchSource) => set({ searchSource }),
  setSourceConfigs: (sourceConfigs) => set({ sourceConfigs }),
  setLastPlaylistCategory: (lastPlaylistCategory) =>
    set({ lastPlaylistCategory }),
  setLastMineTab: (lastMineTab) => set({ lastMineTab }),
  setLastBillboardGroup: (lastBillboardGroup) => set({ lastBillboardGroup }),
  resetBrowsePosition: () =>
    set({
      lastPlaylistCategory: DEFAULT_BROWSE_POSITION.lastPlaylistCategory,
      lastBillboardGroup: DEFAULT_BROWSE_POSITION.lastBillboardGroup,
    }),
  setPlaylistCategoryOrder: (playlistCategoryOrder) =>
    set({ playlistCategoryOrder }),
  setEnableAutoMatch: (enableAutoMatch) => set({ enableAutoMatch }),
  setAutoMatchFavorites: (autoMatchFavorites) => set({ autoMatchFavorites }),
  setAutoMatchPlaylists: (autoMatchPlaylists) => set({ autoMatchPlaylists }),
  setAutoMatchContext: (autoMatchContext) => set({ autoMatchContext }),
  setEnableProxyFallback: (enableProxyFallback) => set({ enableProxyFallback }),
  setBilibiliKeepOriginalMeta: (bilibiliKeepOriginalMeta) =>
    set({ bilibiliKeepOriginalMeta }),
  setBilibiliAutoMatchSuffix: (bilibiliAutoMatchSuffix) =>
    set({ bilibiliAutoMatchSuffix }),
  setFullScreenBackgroundMode: (fullScreenBackgroundMode) =>
    set({ fullScreenBackgroundMode }),
  setCustomBackgroundImage: (customBackgroundImage) =>
    set({ customBackgroundImage }),
  setCoverSize: (coverSize) => set({ coverSize }),
  setCoverRadius: (coverRadius) => set({ coverRadius }),
  setCoverStyle: (coverStyle) => set({ coverStyle }),
  setVinylColor: (vinylColor) => set({ vinylColor }),
  setShowSourceBadge: (showSourceBadge) => set({ showSourceBadge }),
  setHighlightCurrentTrack: (highlightCurrentTrack) =>
    set({ highlightCurrentTrack }),
  setShowBarBackground: (showBarBackground) => set({ showBarBackground }),
  setLightThemeLightBackground: (lightThemeLightBackground) =>
    set({ lightThemeLightBackground }),
  setLyricAlign: (lyricAlign) => set({ lyricAlign }),
  setLyricFontSize: (lyricFontSize) => set({ lyricFontSize }),
  setLyricOffset: (lyricOffset) => set({ lyricOffset }),
  setCarLyricEnabled: (carLyricEnabled) => set({ carLyricEnabled }),
  setDesktopLyricEnabled: (desktopLyricEnabled) => set({ desktopLyricEnabled }),
  setDesktopLyricFontSize: (desktopLyricFontSize) =>
    set({ desktopLyricFontSize }),
  setDesktopLyricColor: (desktopLyricColor) => set({ desktopLyricColor }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
  setIsFullScreenPlayer: (isFullScreenPlayer) => set({ isFullScreenPlayer }),
});
