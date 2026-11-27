import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface LocalMusicFile {
  id: string;
  name: string | null;
  artist: string | null;
  album: string | null;
  /** 真实文件名（带扩展名）；localPath 为 content:// 时用它反推歌手/歌名 */
  fileName?: string | null;
  duration: number;
  localPath: string;
  fileSize: number;
  modifiedTime?: number;
  /** 在线匹配到的封面 URL（无内嵌封面时），随本地音乐列表持久化 */
  matchedCoverUrl?: string;
  /** 在线匹配到的歌词（无内嵌歌词时），随本地音乐列表持久化 */
  matchedLyric?: string;
  matchedTlyric?: string;
}

export interface ScanResult {
  success: boolean;
  files: LocalMusicFile[];
  error?: string;
  needManageStorage?: boolean;
}

export interface LocalFileUrlResult {
  success: boolean;
  url?: string;
  error?: string;
}

export interface EmbeddedCoverResult {
  success: boolean;
  dataUrl?: string;
  error?: string;
}

export interface EmbeddedLyricsResult {
  success: boolean;
  lyric?: string;
  tlyric?: string;
  error?: string;
}

export interface WriteEmbeddedLyricsResult {
  success: boolean;
  error?: string;
}

export interface HasPermissionResult {
  hasPermission: boolean;
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

export interface PickDirectoryResult {
  success: boolean;
  path?: string;
  uri?: string;
  error?: string;
}

/** 选图并压缩后的背景图（data URL 直接可当 CSS background-image 用） */
export interface PickImageResult {
  success: boolean;
  dataUrl?: string;
  error?: string;
}

export interface SystemDarkModeResult {
  isDarkMode: boolean;
}

export interface DarkModeChangeEvent {
  isDarkMode: boolean;
}

export interface ExcludedFoldersResult {
  success: boolean;
  folders: string[];
}

export interface ExcludedFolderMutationResult {
  success: boolean;
  folder?: string;
  error?: string;
}

export interface LocalMusicPlugin {
  scanLocalMusic(): Promise<ScanResult>;
  scanAllStorage(): Promise<ScanResult>;
  getLocalFileUrl(options: { localPath: string }): Promise<LocalFileUrlResult>;
  getEmbeddedCover(options: {
    localPath: string;
  }): Promise<EmbeddedCoverResult>;
  getEmbeddedLyrics(options: {
    localPath: string;
  }): Promise<EmbeddedLyricsResult>;
  /** FLAC 专用：原生流式重写 VORBIS_COMMENT 写入歌词，原文/译文用 [TLYRIC] 分隔 */
  writeEmbeddedLyrics(options: {
    localPath: string;
    lyric: string;
    tlyric?: string;
  }): Promise<WriteEmbeddedLyricsResult>;
  openManageStorageSettings(): Promise<void>;
  hasAllStoragePermission(): Promise<HasPermissionResult>;
  deleteLocalMusic(options: { localPath: string }): Promise<DeleteResult>;
  pickDownloadDirectory(): Promise<PickDirectoryResult>;
  /** 自选播放器背景图：原生 SAF 选图 + 压缩，Web 端由 input[type=file] 兜底 */
  pickBackgroundImage(): Promise<PickImageResult>;
  getSystemDarkMode(): Promise<SystemDarkModeResult>;
  /**
   * 把 APP 内的主题偏好同步给原生。网页层用 localStorage 存主题，原生读不到，
   * 而冷启动时启动窗口/WebView 的底色必须提前决定，所以另存一份到 SharedPreferences。
   */
  setStoredTheme(options: {
    value: "system" | "light" | "dark";
  }): Promise<void>;
  getExcludedFolders(): Promise<ExcludedFoldersResult>;
  addExcludedFolder(options: {
    folder: string;
  }): Promise<ExcludedFolderMutationResult>;
  removeExcludedFolder(options: {
    folder: string;
  }): Promise<ExcludedFolderMutationResult>;
  pickExcludedDirectory(): Promise<PickDirectoryResult>;
  /** 读取与音频同名的侧挂 .lrc 歌词 */
  readSidecarLyric(options: {
    localPath: string;
  }): Promise<EmbeddedLyricsResult>;
  addListener(
    eventName: "darkModeChange",
    listenerFunc: (event: DarkModeChangeEvent) => void
  ): Promise<PluginListenerHandle>;
}

const LocalMusicPlugin = registerPlugin<LocalMusicPlugin>("LocalMusicPlugin");

export { LocalMusicPlugin };
