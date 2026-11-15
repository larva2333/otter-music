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

/** 单条繁转简结果 */
export interface SimplifiedConvertItem {
  path: string;
  /** 改名后的新路径，未改名为原路径 */
  newPath?: string;
  tagsChanged?: boolean;
  renamed?: boolean;
  /** dryRun 时表示“会改但还没改” */
  wouldChange?: boolean;
  /** 未改写内嵌标签的原因（如非 FLAC） */
  skipReason?: string;
  /** 转换失败的原因 */
  error?: string;
}

export interface SimplifiedConvertResult {
  success: boolean;
  total?: number;
  changed?: number;
  renamed?: number;
  skipped?: number;
  failed?: number;
  items?: SimplifiedConvertItem[];
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
  /** 繁体转简体：改内嵌标签（FLAC）并可选重命名文件 */
  convertToSimplified(options: {
    localPaths: string[];
    renameFiles?: boolean;
    /** 只检测不落盘 */
    dryRun?: boolean;
  }): Promise<SimplifiedConvertResult>;
  /** 批量把文本转成简体，仅用于列表显示，不写任何文件 */
  toSimplifiedTexts(options: { texts: string[] }): Promise<{
    success: boolean;
    texts?: string[];
    error?: string;
  }>;
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
