import { LocalMusicFile } from "@/plugins/local-music";

/**
 * 全盘扫描的扩展名 / 大小过滤。
 *
 * 原生扫描按扩展名收集（见 LocalMusicPlugin.java 的 AUDIO_EXTENSIONS），
 * 这里在 JS 层再按用户勾选的扩展名 + 大小下限过滤一遍。
 * 默认勾 mp3 + flac，避免录音/音效等杂项混进本地音乐列表。
 */

/** 与原生 AUDIO_EXTENSIONS 对齐的小写扩展名（不带点） */
export const AUDIO_EXTENSIONS = [
  "mp3",
  "flac",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "wma",
  "ape",
  "opus",
  "m4b",
  "m4s",
] as const;

export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];

export interface ScanFilter {
  /** 勾选的扩展名；空集合表示不限（全部） */
  extensions: Set<AudioExtension>;
  /** 最小文件大小（字节），低于它的文件被过滤掉；0 表示不限 */
  minSize: number;
}

export const DEFAULT_SCAN_FILTER: ScanFilter = {
  extensions: new Set<AudioExtension>(["mp3", "flac"]),
  minSize: 0,
};

/** 从文件名/路径里取小写扩展名 */
export function getAudioExtension(file: LocalMusicFile): string {
  // fileName 带扩展名且优先；localPath 兜底（content:// 可能没有扩展名）
  const source = file.fileName || file.localPath || "";
  const clean = source.split(/[?#]/)[0]; // 去掉 query 参数
  const dot = clean.lastIndexOf(".");
  return dot === -1 ? "" : clean.slice(dot + 1).toLowerCase();
}

/** 按过滤条件筛掉扫描结果 */
export function filterScannedFiles(
  files: LocalMusicFile[],
  filter: ScanFilter
): LocalMusicFile[] {
  return files.filter((file) => {
    if (
      filter.extensions.size > 0 &&
      !filter.extensions.has(getAudioExtension(file) as AudioExtension)
    ) {
      return false;
    }
    if (filter.minSize > 0 && (file.fileSize ?? 0) < filter.minSize) {
      return false;
    }
    return true;
  });
}

export const SIZE_OPTIONS = [
  { label: "不限", value: 0 },
  { label: "≥ 1 MB", value: 1 * 1024 * 1024 },
  { label: "≥ 3 MB", value: 3 * 1024 * 1024 },
  { label: "≥ 10 MB", value: 10 * 1024 * 1024 },
] as const;
