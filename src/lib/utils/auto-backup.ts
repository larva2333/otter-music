import { Encoding, Filesystem } from "@capacitor/filesystem";
import { App as CapacitorApp } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { get, set } from "idb-keyval";
import { AppPaths, STORAGE_CONFIG } from "@/lib/storage-manager";
import { logger } from "@/lib/logger";
import { IS_NATIVE } from "@/lib/api/config";
import { storeKey } from "@/store/store-keys";
import { useMusicStore } from "@/store/music-store";
import { applyFontScale } from "@/store/ui-prefs-store";

/**
 * 自动备份：每天把持久化状态落一份 JSON 到公共下载目录。
 *
 * 为什么需要它：数据只存在应用私有目录的 IndexedDB 里，一份副本都没有。
 * 一旦被空状态覆盖（见 storage-adapter 的注释）、清理数据、或换机，就是全损。
 * 这里把 IndexedDB 的原始值原样写出去，恢复时再原样写回来，不经过任何序列化转换，
 * 避免「导出格式」与「存储格式」不一致导致恢复丢字段（比如播放队列）。
 */

/** 备份目录：与音乐文件同根，用户能直接在文件管理器里看到 */
export const AUTO_BACKUP_DIR = `${AppPaths.Data}/backups`;

const AUTO_PREFIX = "auto-";
const MANUAL_PREFIX = "manual-";

/** 保留最近 7 天 */
const KEEP_COUNT = 7;

/** 手动备份保留最近 10 份：用户主动建的，留得久一点，但不能无限长 */
const KEEP_MANUAL_COUNT = 10;

/** 同一天内的重复备份最小间隔：切后台很频繁，没必要每次都写几十 KB */
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

/** 定时检查间隔 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * 备份范围：只收「用户自己攒出来的数据」，离线缓存、URL 缓存这类可再生的大块头排除在外。
 */
const BACKUP_KEYS: storeKey[] = [
  storeKey.MusicStore,
  storeKey.HistoryStore,
  storeKey.DownloadStore,
  storeKey.AppStore,
  storeKey.PodcastStore,
  storeKey.AlistStore,
  storeKey.WebdavStore,
  storeKey.UiPrefsStore,
];

/**
 * 同样属于「用户设置」但存在 localStorage 的项（ui-prefs-store 的 fontSize、
 * next-themes 的主题、导入音源与搜索历史）。这些不经过 idbStorage，
 * readStores() 用 idb-keyval 读不到，必须单独读取并随备份一起写回。
 */
const LOCAL_STORAGE_KEYS = [
  storeKey.UiPrefsStore,
  "theme",
  "otter_imported_sources",
  "otter_search_history",
] as const;

export interface AutoBackupSummary {
  favorites: number;
  playlists: number;
  queue: number;
}

export interface AutoBackupEntry {
  fileName: string;
  /** auto = 定时自动生成；manual = 用户点「立即备份」生成 */
  kind: "auto" | "manual";
  /** 备份对应的日期（YYYY-MM-DD，本地时区）；手动备份带 HH:mm */
  date: string;
  /** 文件字节数 */
  size: number;
  summary?: AutoBackupSummary;
}

interface AutoBackupEnvelope {
  version: 1;
  type: "otter-music-auto-backup";
  exportedAt: number;
  summary: AutoBackupSummary;
  /** key → 持久化层原始 JSON 字符串（IndexedDB） */
  stores: Record<string, string>;
  /** key → localStorage 原始值（主题/字体/导入音源/搜索历史） */
  localStorage?: Record<string, string>;
}

/** 本地时区的日期键。不能用 toISOString：UTC 会比本地晚 8 小时，跨零点会记错日期 */
function dateKey(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function backupFileName(d = new Date()): string {
  return `${AUTO_PREFIX}${dateKey(d)}.json`;
}

/**
 * 手动备份文件名：带时分秒，同一分钟内连点两次也不会互相覆盖。
 * 时间戳写成紧凑格式（不带冒号），否则在 Windows 上不是合法文件名。
 */
function manualFileName(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${MANUAL_PREFIX}${dateKey(d)}-${time}.json`;
}

/** 从文件名还原展示用的日期：自动备份只有日期，手动备份精确到分钟 */
function parseEntryName(name: string): {
  kind: "auto" | "manual";
  date: string;
} {
  const base = name.replace(/\.json$/, "");
  if (base.startsWith(MANUAL_PREFIX)) {
    const stamp = base.slice(MANUAL_PREFIX.length); // 2026-11-17-220501
    const date = `${stamp.slice(0, 10)} ${stamp.slice(11, 13)}:${stamp.slice(13, 15)}`;
    return { kind: "manual", date };
  }
  return { kind: "auto", date: base.slice(AUTO_PREFIX.length) };
}

/** 从原始 music store JSON 里数一下规模，用于跳过空库备份 + 界面上给用户看 */
function summarizeMusicStore(raw?: string): AutoBackupSummary {
  const empty = { favorites: 0, playlists: 0, queue: 0 };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
    const state = parsed.state ?? {};
    return {
      favorites: Array.isArray(state.favorites) ? state.favorites.length : 0,
      playlists: Array.isArray(state.playlists) ? state.playlists.length : 0,
      queue: Array.isArray(state.queue) ? state.queue.length : 0,
    };
  } catch {
    return empty;
  }
}

/** 读取当前持久化层的原始值 */
async function readStores(): Promise<Record<string, string>> {
  const entries = await Promise.all(
    BACKUP_KEYS.map(async (key) => {
      const raw = await get<string>(key);
      return raw ? [key, raw] : null;
    })
  );
  return Object.fromEntries(entries.filter(Boolean) as [string, string][]);
}

/** 读取存在 localStorage 里的设置项原始值 */
function readLocalStorage(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of LOCAL_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) result[key] = raw;
    } catch {
      // localStorage 不可用（隐私模式）时跳过，不影响 IndexedDB 部分
    }
  }
  return result;
}

/** 把 localStorage 设置写回并即时生效（字体/主题需要刷新 DOM） */
function restoreLocalStorage(values: Record<string, string>): void {
  for (const [key, raw] of Object.entries(values)) {
    try {
      localStorage.setItem(key, raw);
    } catch {
      // 存储不可用时跳过，不阻断其余设置恢复
    }
  }
  // 字体档位写回后要立刻同步到 <html data-font-scale>，否则要重启才见效
  const uiRaw = values[storeKey.UiPrefsStore];
  if (uiRaw) {
    try {
      const parsed = JSON.parse(uiRaw) as { state?: { fontScale?: string } };
      const scale = parsed.state?.fontScale;
      if (scale === "small" || scale === "standard" || scale === "large") {
        applyFontScale(scale);
      }
    } catch {
      // 值坏掉就交给 provider 的 onRehydrate 兜底
    }
  }
  // 主题由 Provider 在 reload 后从 localStorage["theme"] 读取，无需额外同步
}

async function ensureBackupDir(): Promise<void> {
  try {
    await Filesystem.mkdir({
      path: AUTO_BACKUP_DIR,
      directory: STORAGE_CONFIG.BASE_DIR,
      recursive: true,
    });
  } catch (error) {
    // 目录已存在时各平台抛的错不一样，用 stat 兜底判断
    const message = error instanceof Error ? error.message : String(error);
    if (/exist/i.test(message)) return;
    try {
      await Filesystem.stat({
        path: AUTO_BACKUP_DIR,
        directory: STORAGE_CONFIG.BASE_DIR,
      });
    } catch {
      throw error;
    }
  }
}

/** 列出目录里的自动 / 手动备份文件 */
async function listFiles(): Promise<{ name: string; size: number }[]> {
  try {
    const { files } = await Filesystem.readdir({
      path: AUTO_BACKUP_DIR,
      directory: STORAGE_CONFIG.BASE_DIR,
    });
    return files
      .filter(
        (f) =>
          f.name &&
          f.name.endsWith(".json") &&
          (f.name.startsWith(AUTO_PREFIX) || f.name.startsWith(MANUAL_PREFIX))
      )
      .map((f) => ({ name: f.name as string, size: f.size ?? 0 }));
  } catch {
    return [];
  }
}

/** 自动备份留 7 天，手动备份留 10 份 */
async function pruneOldBackups(names: string[]): Promise<void> {
  const desc = (a: string, b: string) => b.localeCompare(a);
  const autos = names.filter((n) => n.startsWith(AUTO_PREFIX)).sort(desc);
  const manuals = names.filter((n) => n.startsWith(MANUAL_PREFIX)).sort(desc);
  const stale = [
    ...autos.slice(KEEP_COUNT),
    ...manuals.slice(KEEP_MANUAL_COUNT),
  ];
  await Promise.all(
    stale.map((name) =>
      Filesystem.deleteFile({
        path: `${AUTO_BACKUP_DIR}/${name}`,
        directory: STORAGE_CONFIG.BASE_DIR,
      }).catch((error) => {
        logger.warn("auto-backup", `删除旧备份 ${name} 失败`, error);
      })
    )
  );
}

/** 真正落盘：读原始状态 → 空库保护 → 写文件 → 裁剪旧备份 */
async function writeBackup(
  fileName: string,
  existing: { name: string; size: number }[]
): Promise<{ fileName: string } | { error: "empty" | "failed" }> {
  const stores = await readStores();
  const summary = summarizeMusicStore(stores[storeKey.MusicStore]);

  // 空库不落盘：防止「hydrate 前的空状态」被当成有效备份，
  // 以后拿它恢复反而把用户仅剩的数据盖掉
  if (
    summary.favorites === 0 &&
    summary.playlists === 0 &&
    summary.queue === 0
  ) {
    logger.warn("auto-backup", "音乐库为空，跳过本次备份");
    return { error: "empty" };
  }

  const envelope: AutoBackupEnvelope = {
    version: 1,
    type: "otter-music-auto-backup",
    exportedAt: Date.now(),
    summary,
    stores,
    localStorage: readLocalStorage(),
  };

  await Filesystem.writeFile({
    path: `${AUTO_BACKUP_DIR}/${fileName}`,
    data: JSON.stringify(envelope),
    directory: STORAGE_CONFIG.BASE_DIR,
    encoding: Encoding.UTF8,
    recursive: true,
  });

  await pruneOldBackups([
    ...existing.map((f) => f.name).filter((name) => name !== fileName),
    fileName,
  ]);

  logger.info(
    "auto-backup",
    `备份完成：${fileName}（喜欢 ${summary.favorites} / 歌单 ${summary.playlists} / 队列 ${summary.queue}）`
  );
  return { fileName };
}

/**
 * 生成一次自动备份。
 *
 * @param force 为 true 时忽略「今天已备份」与 30 分钟节流，强制重写当天文件
 * @returns 写入的文件名；跳过（非原生端 / 空库 / 未到间隔）时返回 null
 */
export async function createAutoBackup(
  options: { force?: boolean } = {}
): Promise<string | null> {
  if (!IS_NATIVE) return null;

  try {
    await ensureBackupDir();
    const fileName = backupFileName();
    const existing = await listFiles();
    const todayFile = existing.find((f) => f.name === fileName);

    if (todayFile && !options.force) {
      // 当天已经有一份了，只有超过节流间隔才刷新内容（让当天的备份尽可能新）
      const age = Date.now() - (await fileMtime(fileName));
      if (age >= 0 && age < REFRESH_INTERVAL_MS) return null;
    }

    const result = await writeBackup(fileName, existing);
    return "fileName" in result ? result.fileName : null;
  } catch (error) {
    logger.error("auto-backup", "自动备份失败", error);
    return null;
  }
}

export type ManualBackupResult =
  | { fileName: string }
  | { error: "empty" | "failed" };

/**
 * 手动备份：无视当天已有文件和节流，另存一份带时间的快照。
 * 与自动备份分开命名，不会互相覆盖 —— 用户手动点的那份要留得住。
 */
export async function createManualBackup(): Promise<ManualBackupResult> {
  if (!IS_NATIVE) return { error: "failed" };

  try {
    await ensureBackupDir();
    const existing = await listFiles();
    return await writeBackup(manualFileName(), existing);
  } catch (error) {
    logger.error("auto-backup", "手动备份失败", error);
    return { error: "failed" };
  }
}

/** 文件修改时间，用来做节流判断；拿不到就当作很久以前 */
async function fileMtime(fileName: string): Promise<number> {
  try {
    const stat = await Filesystem.stat({
      path: `${AUTO_BACKUP_DIR}/${fileName}`,
      directory: STORAGE_CONFIG.BASE_DIR,
    });
    return stat.mtime ?? 0;
  } catch {
    return 0;
  }
}

/** 列出可恢复的备份（自动 + 手动），最新在前 */
export async function listAutoBackups(): Promise<AutoBackupEntry[]> {
  if (!IS_NATIVE) return [];
  const files = await listFiles();
  const entries = await Promise.all(
    files.map(async (f) => {
      const { kind, date } = parseEntryName(f.name);
      let summary: AutoBackupSummary | undefined;
      try {
        const { data } = await Filesystem.readFile({
          path: `${AUTO_BACKUP_DIR}/${f.name}`,
          directory: STORAGE_CONFIG.BASE_DIR,
          encoding: Encoding.UTF8,
        });
        if (typeof data === "string") {
          summary = (JSON.parse(data) as AutoBackupEnvelope).summary;
        }
      } catch {
        // 读不出来就只显示文件信息，不影响列表
      }
      return { fileName: f.name, kind, date, size: f.size, summary };
    })
  );
  return entries.sort((a, b) => b.fileName.localeCompare(a.fileName));
}

/**
 * 用指定备份覆盖当前的持久化数据。
 *
 * 直接写回持久化层原始值，再整页重载让各 store 重新 hydrate，
 * 避免在运行时拼一份「部分替换」的 state（容易漏掉 queue 这类字段）。
 */
export async function restoreAutoBackup(
  fileName: string
): Promise<AutoBackupSummary> {
  const { data } = await Filesystem.readFile({
    path: `${AUTO_BACKUP_DIR}/${fileName}`,
    directory: STORAGE_CONFIG.BASE_DIR,
    encoding: Encoding.UTF8,
  });
  if (typeof data !== "string") throw new Error("备份文件读取失败");

  const envelope = JSON.parse(data) as AutoBackupEnvelope;
  if (envelope.type !== "otter-music-auto-backup" || !envelope.stores) {
    throw new Error("备份文件格式不对");
  }

  await Promise.all(
    Object.entries(envelope.stores).map(([key, value]) => set(key, value))
  );
  // 主题/字体/导入音源/搜索历史存在 localStorage，恢复时覆盖写回
  if (envelope.localStorage) {
    restoreLocalStorage(envelope.localStorage);
  }

  // 导入音源 store 是模块级内存缓存，写回 localStorage 后需重新加载页面才会重读。
  // 恢复流程本来就会 reload，这里交给它即可。
  logger.warn("auto-backup", `已从 ${fileName} 恢复数据，准备重载页面`);
  return envelope.summary;
}

/**
 * 启动自动备份：
 * - 等音乐库 hydrate 完成后跑第一次（否则会对着空状态写备份）
 * - 切到后台时刷新当天那份
 * - 每 6 小时兜一次，防止应用长期在前台不产生 pause
 *
 * @returns 清理函数
 */
export function initAutoBackup(): () => void {
  if (!IS_NATIVE) return () => undefined;

  let disposed = false;
  const cleanups: Array<() => void> = [];

  const run = (force = false) => {
    if (disposed) return;
    createAutoBackup({ force }).catch(() => undefined);
  };

  const finishHydration = () => {
    // 稍等一拍，让其它 store 的 hydrate 也落定
    setTimeout(() => run(), 1500);
  };

  if (useMusicStore.persist.hasHydrated()) {
    finishHydration();
  } else {
    const unsubscribe = useMusicStore.persist.onFinishHydration(() => {
      unsubscribe();
      finishHydration();
    });
    cleanups.push(unsubscribe);
  }

  let appListener: PluginListenerHandle | undefined;
  CapacitorApp.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) run();
  })
    .then((handle) => {
      appListener = handle;
    })
    .catch(() => undefined);

  const timer = window.setInterval(() => run(), CHECK_INTERVAL_MS);
  const onVisibility = () => {
    if (document.visibilityState === "hidden") run();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    disposed = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    appListener?.remove().catch(() => undefined);
    cleanups.forEach((fn) => fn());
  };
}
