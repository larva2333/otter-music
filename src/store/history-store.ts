import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { storeKey } from "./store-keys";
import { idbStorage } from "@/lib/storage-adapter";
import type { MusicTrack } from "@/types/music";
import { cleanTrack } from "@/lib/utils/music";

const MAX_HISTORY = 100;

interface HistoryState {
  history: MusicTrack[];
  addToHistory: (track: MusicTrack) => void;
  /** 换源后同步历史里的同一条（id + 原 source 双条件，避免跨源同 id 撞车） */
  updateTrackInHistory: (
    trackId: string,
    oldSource: string,
    newTrack: MusicTrack
  ) => void;
  removeFromHistory: (trackId: string) => void;
  /** 批量删除：和歌单页的 removeBatchFromPlaylist 对齐 */
  removeBatchFromHistory: (trackIds: string[]) => void;
  clearHistory: () => void;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      history: [],

      addToHistory: (track) =>
        set((state) => {
          const filtered = state.history.filter((t) => t.id !== track.id);
          const newHistory = [track, ...filtered];
          return { history: newHistory.slice(0, MAX_HISTORY) };
        }),

      updateTrackInHistory: (trackId, oldSource, newTrack) =>
        set((state) => ({
          history: state.history.map((t) =>
            t.id === trackId && t.source === oldSource ? newTrack : t
          ),
        })),

      removeFromHistory: (trackId) =>
        set((state) => ({
          history: state.history.filter((t) => t.id !== trackId),
        })),

      removeBatchFromHistory: (trackIds) =>
        set((state) => {
          const ids = new Set(trackIds);
          return {
            history: state.history.filter((t) => !ids.has(t.id)),
          };
        }),

      clearHistory: () => set({ history: [] }),
    }),
    {
      name: storeKey.HistoryStore,
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        history: state.history.map(cleanTrack),
      }),
    }
  )
);
