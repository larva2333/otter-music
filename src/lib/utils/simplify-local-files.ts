import { LocalMusicPlugin, LocalMusicFile } from "@/plugins/local-music";
import { logger } from "@/lib/logger";

const DISPLAY_FIELDS = ["name", "artist", "album"] as const;

/**
 * 把扫描结果里的曲名、歌手、专辑转成简体，只影响列表显示，不写任何文件。
 *
 * 整批只调一次原生方法（词表在 assets 里，JS 侧没有），
 * 失败时原样返回——宁可显示繁体，也不能把列表弄丢。
 */
export async function simplifyLocalFilesText(
  files: LocalMusicFile[]
): Promise<LocalMusicFile[]> {
  if (files.length === 0) return files;

  const texts: string[] = [];
  const slots: Array<{
    fileIndex: number;
    field: (typeof DISPLAY_FIELDS)[number];
  }> = [];

  files.forEach((file, fileIndex) => {
    DISPLAY_FIELDS.forEach((field) => {
      const value = file[field];
      if (value) {
        slots.push({ fileIndex, field });
        texts.push(value);
      }
    });
  });

  if (texts.length === 0) return files;

  try {
    const result = await LocalMusicPlugin.toSimplifiedTexts({ texts });
    const converted = result.texts;
    if (!result.success || !converted || converted.length !== texts.length) {
      return files;
    }

    const next = files.map((file) => ({ ...file }));
    let changed = false;
    slots.forEach((slot, index) => {
      const value = converted[index];
      if (next[slot.fileIndex][slot.field] !== value) {
        next[slot.fileIndex][slot.field] = value;
        changed = true;
      }
    });
    // 没有实际变化时返回原引用，避免触发无意义的 store 更新
    return changed ? next : files;
  } catch (e) {
    logger.warn("simplifyLocalFilesText", "繁转简显示转换失败", e);
    return files;
  }
}
