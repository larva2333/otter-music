import { create } from "zustand";
import type { ImportedSource } from "./types";
import { clearLxRuntime } from "./lx-sandbox";
import { extraEnabledLx } from "./rules";

const STORAGE_KEY = "otter_imported_sources";

/** 写操作返回值：告诉调用方是否有洛雪脚本因单启规则被自动停用 */
export interface SourceChangeResult {
  disabled: ImportedSource[];
}

/** 保证最多一个启用的洛雪脚本；keepId 优先，否则保留当前第一个 */
function applySingleLx(
  next: ImportedSource[],
  keepId?: string
): { next: ImportedSource[]; disabled: ImportedSource[] } {
  const disabled = extraEnabledLx(next, keepId);
  if (disabled.length === 0) return { next, disabled };
  const ids = new Set(disabled.map((s) => s.id));
  return {
    next: next.map((s) =>
      ids.has(s.id) ? { ...s, enabled: false, visible: false } : s
    ),
    disabled,
  };
}

function load(): ImportedSource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const list = parsed as ImportedSource[];
    // 历史数据里可能同时开了多个洛雪脚本，加载时收敛成一个
    return applySingleLx(list).next;
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
  add: (source: ImportedSource) => SourceChangeResult;
  /** 批量添加（一次写盘），用于仓库里多选导入 */
  addMany: (sources: ImportedSource[]) => SourceChangeResult;
  /** 局部更新（改名/换地址/更新脚本），保持列表顺序不变 */
  update: (id: string, patch: Partial<ImportedSource>) => SourceChangeResult;
  remove: (id: string) => void;
  toggleEnabled: (id: string) => SourceChangeResult;
  toggleVisible: (id: string) => void;
  get: (id: string) => ImportedSource | undefined;
}

export const useImportedSourcesStore = create<ImportedSourcesState>(
  (set, get) => ({
    sources: load(),

    add: (source) => {
      const merged = [
        ...get().sources.filter((s) => s.id !== source.id),
        source,
      ];
      const { next, disabled } = applySingleLx(
        merged,
        source.kind === "lx" && source.enabled ? source.id : undefined
      );
      persist(next);
      set({ sources: next });
      return { disabled };
    },

    addMany: (list) => {
      if (list.length === 0) return { disabled: [] };
      const incoming = new Set(list.map((s) => s.id));
      const merged = [
        ...get().sources.filter((s) => !incoming.has(s.id)),
        ...list,
      ];
      const firstLx = list.find((s) => s.kind === "lx" && s.enabled);
      const { next, disabled } = applySingleLx(merged, firstLx?.id);
      persist(next);
      set({ sources: next });
      return { disabled };
    },

    remove: (id) => {
      clearLxRuntime(id);
      const next = get().sources.filter((s) => s.id !== id);
      persist(next);
      set({ sources: next });
    },

    update: (id, patch) => {
      const current = get().sources;
      const target = current.find((s) => s.id === id);
      if (!target) return { disabled: [] };
      // 换了脚本或平台代号，旧的沙箱运行时作废，否则检测/播放还在用老脚本
      if (patch.script !== undefined || patch.sourceCode !== undefined) {
        clearLxRuntime(id);
      }
      const merged = current.map((s) =>
        s.id === id ? { ...s, ...patch, id: s.id } : s
      );
      const { next, disabled } = applySingleLx(
        merged,
        patch.enabled === true && target.kind === "lx" ? id : undefined
      );
      persist(next);
      set({ sources: next });
      return { disabled };
    },

    toggleEnabled: (id) => {
      const current = get().sources;
      const target = current.find((s) => s.id === id);
      if (!target) return { disabled: [] };
      const enabled = !target.enabled;
      const merged = current.map((s) => (s.id === id ? { ...s, enabled } : s));
      const { next, disabled } = applySingleLx(
        merged,
        enabled && target.kind === "lx" ? id : undefined
      );
      persist(next);
      set({ sources: next });
      return { disabled };
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
