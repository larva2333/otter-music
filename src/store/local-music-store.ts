import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { LocalMusicFile } from "@/plugins/local-music";
import { storeKey } from "./store-keys";
import { idbStorage } from "@/lib/storage-adapter";

interface LocalMusicState {
  files: LocalMusicFile[];
  isScanning: boolean;
  scanType: "quick" | "full" | null;

  setFiles: (files: LocalMusicFile[]) => void;
  updateFiles: (updater: (files: LocalMusicFile[]) => LocalMusicFile[]) => void;
  /** 写回在线匹配到的封面/歌词，随列表持久化 */
  updateLocalMeta: (
    localPath: string,
    patch: Partial<
      Pick<LocalMusicFile, "matchedCoverUrl" | "matchedLyric" | "matchedTlyric">
    >
  ) => void;
  clear: () => void;
  setScanning: (isScanning: boolean, scanType?: "quick" | "full") => void;
}

export const useLocalMusicStore = create<LocalMusicState>()(
  persist(
    (set) => ({
      files: [],
      isScanning: false,
      scanType: null,

      setFiles: (files) => set({ files }),
      updateFiles: (updater) =>
        set((state) => ({ files: updater(state.files) })),
      updateLocalMeta: (localPath, patch) =>
        set((state) => ({
          files: state.files.map((f) =>
            f.localPath === localPath ? { ...f, ...patch } : f
          ),
        })),
      clear: () => set({ files: [] }),
      setScanning: (isScanning, scanType) =>
        set({ isScanning, scanType: scanType || null }),
    }),
    {
      name: storeKey.LocalMusicStore,
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        files: state.files,
      }),
    }
  )
);

/**
 * 等本地音乐列表从 IndexedDB 恢复完成（最多 timeoutMs，超时放行）。
 *
 * persist 的恢复是异步的：本地音乐页挂载时 store 往往还是空的，
 * 直接拿 files.length === 0 判断「没有缓存」会误触发一次完整扫描，
 * 表现就是冷启动进页面很慢。先用这个函数等水合结束再决定是否扫描。
 */
export function whenLocalMusicHydrated(timeoutMs = 1500): Promise<void> {
  if (useLocalMusicStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    // 订阅的回调有可能早于赋值返回，先声明再用可选调用
    // eslint-disable-next-line prefer-const
    let unsub: (() => void) | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub?.();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    unsub = useLocalMusicStore.persist.onFinishHydration(finish);
  });
}
