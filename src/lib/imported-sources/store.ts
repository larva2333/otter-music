import { create } from "zustand";
import type { ImportedSource } from "./types";
import { clearLxRuntime } from "./lx-sandbox";

const STORAGE_KEY = "otter_imported_sources";

function load(): ImportedSource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ImportedSource[]) : [];
  } catch {
    return [];
  }
}

function persist(sources: ImportedSource[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
  } catch {
    // 存储不可用时仅保留在内存，不影响本次会话
  }
}

interface ImportedSourcesState {
  sources: ImportedSource[];
  add: (source: ImportedSource) => void;
  /** 批量添加（一次写盘），用于仓库里多选导入 */
  addMany: (sources: ImportedSource[]) => void;
  /** 局部更新（改名/换地址），保持列表顺序不变 */
  update: (id: string, patch: Partial<ImportedSource>) => void;
  remove: (id: string) => void;
  toggleEnabled: (id: string) => void;
  toggleVisible: (id: string) => void;
  get: (id: string) => ImportedSource | undefined;
}

export const useImportedSourcesStore = create<ImportedSourcesState>(
  (set, get) => ({
    sources: load(),

    add: (source) => {
      const next = [...get().sources.filter((s) => s.id !== source.id), source];
      persist(next);
      set({ sources: next });
    },

    addMany: (list) => {
      if (list.length === 0) return;
      const incoming = new Set(list.map((s) => s.id));
      const next = [
        ...get().sources.filter((s) => !incoming.has(s.id)),
        ...list,
      ];
      persist(next);
      set({ sources: next });
    },

    remove: (id) => {
      clearLxRuntime(id);
      const next = get().sources.filter((s) => s.id !== id);
      persist(next);
      set({ sources: next });
    },

    update: (id, patch) => {
      // 换了脚本或平台代号，旧的沙箱运行时作废，否则检测/播放还在用老脚本
      if (patch.script !== undefined || patch.sourceCode !== undefined) {
        clearLxRuntime(id);
      }
      const next = get().sources.map((s) =>
        s.id === id ? { ...s, ...patch, id: s.id } : s
      );
      persist(next);
      set({ sources: next });
    },

    toggleEnabled: (id) => {
      const next = get().sources.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      );
      persist(next);
      set({ sources: next });
    },

    toggleVisible: (id) => {
      const next = get().sources.map((s) =>
        s.id === id ? { ...s, visible: !s.visible } : s
      );
      persist(next);
      set({ sources: next });
    },

    get: (id) => get().sources.find((s) => s.id === id),
  })
);

/** 供非 React 代码（工厂/聚合）同步读取 */
export const getImportedSource = (id: string) =>
  useImportedSourcesStore.getState().sources.find((s) => s.id === id);

export const getEnabledImportedSources = () =>
  useImportedSourcesStore.getState().sources.filter((s) => s.enabled);
