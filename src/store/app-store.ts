import { createElement, type KeyboardEvent } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { storeKey } from "./store-keys";
import { idbStorage } from "@/lib/storage-adapter";
import {
  type UpdateInfo,
  checkUpdate as apiCheckUpdate,
} from "@/lib/api/update";
import { App } from "@capacitor/app";
import { toast } from "react-hot-toast";
import { logger } from "@/lib/logger";
import { IS_NATIVE, ApiError } from "@/lib/api/config";

/** 新版本提醒 toast 的固定 id：多次检查只保留最新一条，不会叠加 */
const UPDATE_TOAST_ID = "app-update-available";
/** 新版本提醒的自动消失时长 */
const UPDATE_TOAST_DURATION = 4000;
/** 兜底关闭定时器（触摸设备上 Toaster 的 pause 状态可能卡住） */
let updateToastTimer: ReturnType<typeof setTimeout> | null = null;

interface AppState {
  currentVersion: string;
  lastCheckTime: number;
  latestVersionInfo: UpdateInfo | null;
  hasUpdate: boolean;
  isChecking: boolean;
  /** toast 里点「发现新版本」或进设置自动弹窗时置位，渲染期直接打开更新弹窗（不持久化） */
  updateDialogRequested: boolean;
  /** 本次冷启动会话内是否已经自动弹过更新弹窗（不持久化，重启进程重置） */
  updateDialogAutoShown: boolean;
  /** 启动时是否自动检查更新并提醒 */
  enableUpdateNotify: boolean;
  /** 是否与其他应用同时播放(被其他应用抢占音频焦点时不暂停) */
  allowSimultaneousPlayback: boolean;
}

interface AppActions {
  /** 对齐真实安装版本；升级后清掉上一版遗留的 hasUpdate */
  syncInstalledVersion: () => Promise<void>;
  checkUpdate: (silent?: boolean) => Promise<void>;
  consumeUpdateDialogRequest: () => void;
  /** 进设置页时用：有新版本且本次会话还没自动弹过，就把弹窗标记置位 */
  autoOpenUpdateDialogOnce: () => boolean;
  resetCheckTime: () => void;
  setEnableUpdateNotify: (enableUpdateNotify: boolean) => void;
  setAllowSimultaneousPlayback: (allowSimultaneousPlayback: boolean) => void;
}

const initialState: AppState = {
  currentVersion: "0.0.0",
  lastCheckTime: 0,
  latestVersionInfo: null,
  hasUpdate: false,
  isChecking: false,
  updateDialogRequested: false,
  updateDialogAutoShown: false,
  enableUpdateNotify: true,
  allowSimultaneousPlayback: false,
};

/* =========================
   工具函数
========================= */

const getCurrentVersion = async (): Promise<string> => {
  try {
    if (IS_NATIVE) {
      const info = await App.getInfo();
      return info.version;
    }
  } catch (e) {
    logger.error("app-store", "Failed to get app version", e);
  }
  return __APP_VERSION__;
};

const normalizeVersion = (version: string): string => {
  const trimmed = version.trim().replace(/^v/i, "");
  const match = trimmed.match(/\d+(?:\.\d+)*/);
  return match?.[0] ?? "0.0.0";
};

const compareVersions = (a: string, b: string): number => {
  const va = normalizeVersion(a).split(".").map(Number);
  const vb = normalizeVersion(b).split(".").map(Number);

  const len = Math.max(va.length, vb.length);
  for (let i = 0; i < len; i++) {
    const na = va[i] ?? 0;
    const nb = vb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
};

/** 关闭新版本 toast，同时清掉兜底定时器，避免重复触发时旧定时器提前关掉新 toast */
function dismissUpdateToast() {
  if (updateToastTimer) {
    clearTimeout(updateToastTimer);
    updateToastTimer = null;
  }
  toast.dismiss(UPDATE_TOAST_ID);
}

/** toast 点击：先置位再跳路由，设置页可能还没挂载，等它挂载后消费这个标记 */
function openUpdateDialog(set: (partial: Partial<AppState>) => void) {
  set({ updateDialogAutoShown: true, updateDialogRequested: true });
  void import("@/router").then(({ router }) => router.navigate("/settings"));
}

/* =========================
   Store
========================= */

export const useAppStore = create<AppState & AppActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      syncInstalledVersion: async () => {
        const currentVersion = await getCurrentVersion();
        const state = get();
        if (state.currentVersion === currentVersion) return;

        // 刚装完更新：持久化的 currentVersion/hasUpdate 还是上一版算出来的，
        // 而启动静默检查会被 24h 节流跳过，绿点就一直挂着。
        // 先用缓存的最新版信息重算，并清掉检查时间让后续检查真正发出去。
        const hasUpdate = state.latestVersionInfo
          ? compareVersions(
              currentVersion,
              state.latestVersionInfo.latestVersion
            ) < 0
          : false;
        logger.info("app-store", "Installed version changed", {
          from: state.currentVersion,
          to: currentVersion,
          hasUpdate,
        });
        set({ currentVersion, hasUpdate, lastCheckTime: 0 });
      },

      checkUpdate: async (silent = false) => {
        const now = Date.now();
        const state = get();

        if (state.isChecking) return;
        // 冷启动检查不做 24h 节流：开关开着就每次启动都真正查一次。
        // 升级后残留的旧 hasUpdate 由 syncInstalledVersion() 负责清掉。
        set({ isChecking: true });

        try {
          const currentVersion = await getCurrentVersion();
          set({ currentVersion });

          const info = await apiCheckUpdate();

          const hasUpdate =
            compareVersions(currentVersion, info.latestVersion) < 0;

          set({
            latestVersionInfo: info,
            hasUpdate,
            lastCheckTime: now,
          });

          if (hasUpdate) {
            // react-hot-toast 的普通 toast 没有 onClick，只有 custom 能放可点击元素。
            // 固定 id：每次冷启动检查都会走这里，随机 id 会叠成一摞相同的 toast；
            // 同一个 id 则会替换掉上一条，屏幕上永远只有一条。
            dismissUpdateToast();
            toast.custom(
              () =>
                createElement(
                  "div",
                  {
                    role: "button",
                    tabIndex: 0,
                    className:
                      "flex max-w-md cursor-pointer items-center gap-2 rounded-lg bg-foreground px-4 py-3 text-sm text-background shadow-lg",
                    onClick: () => {
                      dismissUpdateToast();
                      openUpdateDialog(set);
                    },
                    onKeyDown: (event: KeyboardEvent) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      dismissUpdateToast();
                      openUpdateDialog(set);
                    },
                  },
                  `✨ 发现新版本 ${info.latestVersion}，点击查看`
                ),
              { id: UPDATE_TOAST_ID, duration: UPDATE_TOAST_DURATION }
            );
            // Toaster 在触摸设备上 onMouseLeave 不触发时 pausedAt 会卡住，
            // react-hot-toast 内部会跳过自动消失（源码中 if (pausedAt) return），
            // 所以自己钉一个定时器兜底，保证 toast 一定会关掉。
            updateToastTimer = setTimeout(
              dismissUpdateToast,
              UPDATE_TOAST_DURATION
            );
          } else if (!silent) {
            toast.success(`当前已是最新版本 (${currentVersion})`);
          }
        } catch (error) {
          if (
            silent &&
            error instanceof DOMException &&
            error.name === "AbortError"
          ) {
            logger.info("app-store", "Update check timed out (offline)", {
              silent,
            });
          } else {
            logger.error("app-store", "Update check failed", error, {
              silent,
            });
          }
          if (!silent) {
            toast.error(
              error instanceof ApiError
                ? error.message
                : "检查更新失败，请稍后重试"
            );
          }
        } finally {
          set({ isChecking: false });
        }
      },

      consumeUpdateDialogRequest: () => set({ updateDialogRequested: false }),

      autoOpenUpdateDialogOnce: () => {
        const { hasUpdate, updateDialogAutoShown } = get();
        if (!hasUpdate || updateDialogAutoShown) return false;
        // 去重改用内存态（不持久化），每次冷启动第一次进设置弹一次，
        // 关闭后同会话不再弹，避免写入 localStorage 后跨会话永久锁死。
        set({ updateDialogAutoShown: true, updateDialogRequested: true });
        return true;
      },

      resetCheckTime: () => set({ lastCheckTime: 0 }),

      setEnableUpdateNotify: (enableUpdateNotify) =>
        set({ enableUpdateNotify }),

      setAllowSimultaneousPlayback: (allowSimultaneousPlayback) =>
        set({ allowSimultaneousPlayback }),
    }),
    {
      name: storeKey.AppStore,
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        currentVersion: state.currentVersion,
        lastCheckTime: state.lastCheckTime,
        latestVersionInfo: state.latestVersionInfo,
        hasUpdate: state.hasUpdate,
        enableUpdateNotify: state.enableUpdateNotify,
        allowSimultaneousPlayback: state.allowSimultaneousPlayback,
      }),
    }
  )
);
