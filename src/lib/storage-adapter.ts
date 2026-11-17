import { StateStorage } from "zustand/middleware";
import { get, set, del } from "idb-keyval";
import { logger } from "@/lib/logger";

/**
 * 最近一次成功写入的镜像槽后缀。
 *
 * 主槽 `oh_music_store` 被写坏或写空时（进程被杀在 IndexedDB 提交中途、
 * LevelDB 需要恢复），这里还留着上一份完整快照，hydrate 会优先回退到它，
 * 用户至少能看到崩溃前的歌单和收藏。
 */
const MIRROR_SUFFIX = "__prev";

/** 镜像写入的最小间隔：播放进度这类高频写不必每次都复制一份几百 KB 的 state */
const MIRROR_INTERVAL_MS = 60_000;

/** 正在从磁盘读取的 store：读到之前写回，等于用内存里的初始空状态覆盖磁盘 */
const reading = new Set<string>();

/**
 * 读取抛过异常的 store：磁盘数据可能还救得回来（比如 IndexedDB 需要恢复），
 * 本次启动一律拒绝写回，避免把它彻底盖成空数组。
 */
const readBlocked = new Set<string>();

const lastMirrorAt = new Map<string, number>();

/**
 * 迁移 localStorage 里的旧数据（Web 端升级路径）。
 * 返回 null 表示两边都没有。
 */
async function migrateFromLocalStorage(name: string): Promise<string | null> {
  const localValue = localStorage.getItem(name);
  if (!localValue) return null;

  try {
    // 迁移数据到 IndexedDB
    await set(name, localValue);
    // 迁移成功后清理 localStorage
    localStorage.removeItem(name);
    return localValue;
  } catch (error) {
    logger.error(
      "storage-adapter",
      `[Storage] Failed to migrate ${name}:`,
      error
    );
    // 如果写入失败，仍返回 localStorage 的值，确保应用可用
    return localValue;
  }
}

/**
 * 基于 idb-keyval 的异步存储适配器
 * 用于替代 localStorage，解决容量限制和主线程阻塞问题
 *
 * 两个关键保护：
 *
 * 1. **读盘期间拒绝写入**。zustand 的 persist 不会在 hydrate 完成前拦住
 *    setState —— 每一次 setState 都会把「内存里当前这份 state」整份写进
 *    IndexedDB。而 IndexedDB 读取是异步的，冷启动时组件先挂载、先 setState，
 *    等到 hydrate 真读到数据时，磁盘上那份歌单已经被默认的空数组盖掉了。
 *    进程刚崩过、WebView 反复重建时这个窗口会被放大，表现为「闪退一次，
 *    歌单和收藏全没了」。
 *
 * 2. **写前留镜像，读空回退镜像**。主槽一旦丢失，镜像还能顶一份。
 */
export const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    reading.add(name);

    try {
      // 1. 尝试从 IndexedDB 读取
      const value = await get<string>(name);
      if (value) return value;

      // 2. 主槽没有值：可能是首次安装，也可能是上一次写入被崩溃打断。
      //    有镜像就先用镜像，别让用户一打开就是空库。
      const mirror = await get<string>(name + MIRROR_SUFFIX);
      if (mirror) {
        logger.warn(
          "storage-adapter",
          `[Storage] ${name} 主槽为空，已回退到最近一次镜像`
        );
        return mirror;
      }

      // 3. 再试 localStorage（老版本 Web 端数据迁移）
      return await migrateFromLocalStorage(name);
    } catch (error) {
      readBlocked.add(name);
      logger.error(
        "storage-adapter",
        `[Storage] 读取 ${name} 失败，本次启动停止写回以保护磁盘数据`,
        error
      );
      return null;
    } finally {
      reading.delete(name);
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (readBlocked.has(name)) {
      logger.warn(
        "storage-adapter",
        `[Storage] ${name} 读取失败过，跳过本次写回`
      );
      return;
    }

    if (reading.has(name)) {
      logger.warn(
        "storage-adapter",
        `[Storage] ${name} 仍在读盘，丢弃这次写回（hydration 前的 setState）`
      );
      return;
    }

    // 写前留镜像：只在间隔外做，且镜像必须是「写之前那份完整数据」
    try {
      const now = Date.now();
      const last = lastMirrorAt.get(name) ?? 0;
      if (now - last >= MIRROR_INTERVAL_MS) {
        const previous = await get<string>(name);
        if (previous && previous !== value) {
          await set(name + MIRROR_SUFFIX, previous);
          lastMirrorAt.set(name, now);
        }
      }
    } catch (error) {
      // 镜像失败不能影响主写入，否则用户以为存上了其实没存
      logger.warn(
        "storage-adapter",
        `[Storage] ${name} 写入镜像失败，继续写主槽`,
        error
      );
    }

    await set(name, value);
  },

  removeItem: async (name: string): Promise<void> => {
    await del(name);
    await del(name + MIRROR_SUFFIX);
    readBlocked.delete(name);
    lastMirrorAt.delete(name);
    // 同时也清理 localStorage，确保彻底删除
    localStorage.removeItem(name);
  },
};
