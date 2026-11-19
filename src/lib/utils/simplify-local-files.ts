import { LocalMusicFile } from "@/plugins/local-music";
import { t2s } from "./t2s";

const DISPLAY_FIELDS = ["name", "artist", "album"] as const;

/**
 * 把扫描结果里的曲名、歌手、专辑转成简体，只影响列表显示，不写任何文件。
 *
 * 词表随 JS 包一起加载（见 lib/utils/t2s），同步完成，不再走原生 IPC。
 */
export async function simplifyLocalFilesText(
  files: LocalMusicFile[]
): Promise<LocalMusicFile[]> {
  if (files.length === 0) return files;

  let changed = false;
  const next = files.map((file) => {
    let copy: LocalMusicFile | null = null;
    for (const field of DISPLAY_FIELDS) {
      const value = file[field];
      if (!value) continue;
      const converted = t2s(value);
      if (converted !== value) {
        copy ??= { ...file };
        copy[field] = converted;
        changed = true;
      }
    }
    return copy ?? file;
  });

  // 没有实际变化时返回原引用，避免触发无意义的 store 更新
  return changed ? next : files;
}
