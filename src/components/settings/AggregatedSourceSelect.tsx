import { useMusicStore } from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import {
  aggregatedSourceOptions,
  LOCKED_SOURCES,
  type SourceConfig,
} from "@/types/music";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Radio,
  GripVertical,
  Trash2,
  Pencil,
  Loader2,
  ScanSearch,
  RefreshCw,
} from "lucide-react";
import { SourceImport } from "./SourceImport";
import { sortConfigsByHealth, sortLxConfigs } from "./health-sort";
import { useImportedSourcesStore } from "@/lib/imported-sources/store";
import { probeSource, normalizeSourceUrl } from "@/lib/imported-sources/probe";
import {
  duplicateReasonText,
  findDuplicateSource,
} from "@/lib/imported-sources/rules";
import {
  checkSourcesHealth,
  type SourceHealthResult,
} from "@/lib/source-health";
import {
  getLxSourcePlatforms,
  LX_PLATFORM_LABELS,
} from "@/lib/imported-sources/lx-playback";
import { EXCLUDED_FOR_SEARCH } from "@/hooks/use-aggregated-sources";
import { toast } from "react-hot-toast";
import type { ImportedSource } from "@/lib/imported-sources/types";
import { SettingItem } from "./SettingItem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";

/**
 * 底部 4 个 tab 切换会卸载设置页，组件内的 useState 会全部回到初始值。
 * 音源面板的展开状态、检测结果等属于「切回来应当还在」的界面状态，
 * 统一放在模块级缓存里（进程内有效，重启 App 重新来过）。
 */
const uiStateCache = new Map<string, unknown>();

function useStickyState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() =>
    uiStateCache.has(key) ? (uiStateCache.get(key) as T) : initial
  );
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        uiStateCache.set(key, resolved);
        return resolved;
      });
    },
    [key]
  );
  return [value, set] as const;
}

/** 延迟文案：小于 1 秒给毫秒，超过给一位小数的秒 */
function formatLatency(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

interface SourceItemProps {
  config: SourceConfig;
  onToggle: (next: boolean) => void;
  onRename: () => void;
  /** 检测结果：含状态与本次检测耗时 */
  health?: SourceHealthResult;
  /** 最近一次更新结果 */
  updateResult?: string;
  /** 搜索等基础能力依赖，开关锁定 */
  locked?: boolean;
}

function SourceItem({
  config,
  onToggle,
  onRename,
  health,
  updateResult,
  locked,
}: SourceItemProps) {
  const imported = useImportedSourcesStore((s) =>
    s.sources.find((x) => x.id === config.source)
  );
  const opt = aggregatedSourceOptions.find((o) => o.value === config.source);
  const alias = config.alias?.trim();
  const label = alias || opt?.label || imported?.name;
  const on = config.enabled && config.visible;
  const description = opt?.description || (imported ? "已导入" : "");
  const latency = formatLatency(health?.latencyMs);
  if (!label) return null;

  return (
    <div className="flex items-center gap-2 py-2">
      {/* 整行都能长按拖动，这个图标只作视觉提示 */}
      <div className="text-muted-foreground/70 shrink-0 p-1 pointer-events-none">
        <GripVertical className="h-4 w-4" />
      </div>

      <div
        className={cn(
          "flex flex-col flex-1 min-w-0 transition-opacity",
          !on && "opacity-50"
        )}
      >
        <span className="text-sm text-foreground">{label}</span>
        {health?.status === "fail" ? (
          <span className="text-xs text-destructive">
            不可用{latency && ` · ${latency}`}
          </span>
        ) : health?.status === "unknown" ? (
          <span
            className="text-xs text-amber-600 dark:text-amber-500"
            title="检测没能确认可用或不可用（如换链落空、上游限流），不会自动停用"
          >
            未判定{latency && ` · ${latency}`}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {description}
            {latency && ` · 延迟 ${latency}`}
          </span>
        )}
        {updateResult && (
          <span className="text-xs text-primary">{updateResult}</span>
        )}
      </div>

      <button
        className="shrink-0 text-muted-foreground hover:text-foreground p-1"
        onClick={(e) => {
          e.stopPropagation();
          onRename();
        }}
        title="设置别名"
      >
        <Pencil className="h-4 w-4" />
      </button>

      <Switch
        checked={on}
        onCheckedChange={onToggle}
        disabled={locked}
        aria-label={locked ? "搜索音源不可关闭" : on ? "停用音源" : "启用音源"}
      />
    </div>
  );
}

/** 通用可拖拽行：内置源和导入源共用一个列表，顺序都能调 */
function SortableRow({ id, children }: { id: string; children: ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    // 长按整行即可拖动：listeners 挂在行容器上；用 touch-action: manipulation
    // 而不是 none，否则手指一放上去列表就滚不动了。
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="touch-manipulation select-none"
    >
      {children}
    </div>
  );
}

/** 导入音源行：与内置音源观感一致，多一个删除按钮 */
function ImportedSourceItem({
  source,
  config,
  onToggle,
  onRename,
  onUpdate,
  onDelete,
  updating,
  health,
  updateResult,
}: {
  source: ImportedSource;
  config: SourceConfig;
  onToggle: (next: boolean) => void;
  onRename: () => void;
  onUpdate: () => void;
  onDelete: () => void;
  updating?: boolean;
  health?: SourceHealthResult;
  updateResult?: string;
}) {
  const label = config.alias?.trim() || source.name;
  const on = config.enabled && config.visible;
  const latency = formatLatency(health?.latencyMs);
  const platforms = getLxSourcePlatforms(source)
    .map((p) => LX_PLATFORM_LABELS[p] || p)
    .filter(Boolean);
  const canUpdate = /^https?:\/\//i.test(source.url ?? "");
  const description =
    source.kind === "gd"
      ? "GD 兼容 API"
      : platforms.length > 0
        ? `支持平台：${platforms.join("/")}`
        : "支持平台：未识别";
  return (
    <div className="flex items-center gap-2 py-2">
      {/* 与内置源一致：整行长按可拖，图标只作提示 */}
      <div className="text-muted-foreground/70 shrink-0 p-1 pointer-events-none">
        <GripVertical className="h-4 w-4" />
      </div>

      <div
        className={cn(
          "flex flex-col flex-1 min-w-0 transition-opacity",
          !on && "opacity-50"
        )}
      >
        <span className="text-sm text-foreground truncate">{label}</span>
        {health?.status === "fail" ? (
          <span className="text-xs text-destructive">
            不可用{latency && ` · ${latency}`}
          </span>
        ) : health?.status === "unknown" ? (
          <span
            className="text-xs text-amber-600 dark:text-amber-500"
            title="检测没能确认可用或不可用（如换链落空、上游限流），不会自动停用"
          >
            未判定{latency && ` · ${latency}`}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {description}
            {latency && ` · 延迟 ${latency}`}
          </span>
        )}
        {updateResult && (
          <span className="text-xs text-primary">{updateResult}</span>
        )}
      </div>

      <button
        className="shrink-0 text-muted-foreground hover:text-foreground p-1"
        onClick={(e) => {
          e.stopPropagation();
          onRename();
        }}
        title="编辑音源与别名"
      >
        <Pencil className="h-4 w-4" />
      </button>

      <button
        className="shrink-0 text-muted-foreground hover:text-foreground p-1 disabled:opacity-40"
        onClick={(e) => {
          e.stopPropagation();
          onUpdate();
        }}
        disabled={!canUpdate || updating}
        title={
          !canUpdate
            ? "粘贴脚本导入的音源没有更新地址"
            : "从原地址重新拉取最新脚本"
        }
      >
        {updating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
      </button>

      <Switch
        checked={on}
        onCheckedChange={onToggle}
        aria-label={on ? "停用音源" : "启用音源"}
      />

      <button
        className="shrink-0 text-muted-foreground hover:text-destructive p-1"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="删除该音源"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export function AggregatedSourceSelect() {
  const { sourceConfigs, setSourceConfigs } = useMusicStore(
    useShallow((state) => ({
      sourceConfigs: state.sourceConfigs,
      setSourceConfigs: state.setSourceConfigs,
    }))
  );
  const importedSources = useImportedSourcesStore((s) => s.sources);
  const [showSourcePicker, setShowSourcePicker] = useStickyState(
    "showSourcePicker",
    false
  );
  const [sourceTab, setSourceTab] = useStickyState("sourceTab", "builtin");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    source: string;
    /** 导入音源可改地址；内置音源只能改别名 */
    imported: boolean;
    alias: string;
    url: string;
    saving: boolean;
  } | null>(null);
  // 开关与数据分开：关闭时只关 open，保留 editor 内容，
  // 否则 200ms 的关闭动画里标题会退回「设置别名」、地址框被卸载（看着像高度先缩一下）
  const [editorOpen, setEditorOpen] = useState(false);
  /** 一键检测结果：source → 状态与延迟。底部 tab 切换后仍保留 */
  const [health, setHealth] = useStickyState<
    Record<string, SourceHealthResult>
  >("health", {});
  const [checking, setChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState({ done: 0, total: 0 });
  const [checkSummary, setCheckSummary] = useStickyState<string | null>(
    "checkSummary",
    null
  );
  const checkRunRef = useRef(0);
  /** 正在从原地址更新的音源 id */
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [updateProgress, setUpdateProgress] = useState({ done: 0, total: 0 });
  const [updateSummary, setUpdateSummary] = useStickyState<string | null>(
    "updateSummary",
    null
  );
  /** 每个音源的最近一次更新结果，直接显示在对应行下面 */
  const [sourceUpdateResults, setSourceUpdateResults] = useStickyState<
    Record<string, string>
  >("sourceUpdateResults", {});

  const isImported = (id: string) => id.startsWith("imp_");

  /**
   * 导入/删除/切换/更新后，按 store 的最新状态对齐 sourceConfigs（保留顺序与别名）。
   * 返回对齐后的列表，供检测流程继续排序/启用，避免重复读 store。
   */
  const syncImportedToConfigs = (base?: SourceConfig[]): SourceConfig[] => {
    const imported = useImportedSourcesStore.getState().sources;
    const ids = new Set(imported.map((s) => s.id));
    const next = (base ?? useMusicStore.getState().sourceConfigs).filter(
      (c) => !isImported(c.source) || ids.has(c.source)
    );
    imported.forEach((s) => {
      // 可见与启用已合并成一个开关，两者都开才算开启
      const on = s.enabled && s.visible;
      const idx = next.findIndex((c) => c.source === s.id);
      if (idx === -1) {
        next.push({
          source: s.id as SourceConfig["source"],
          enabled: on,
          visible: on,
        });
      } else {
        next[idx] = { ...next[idx], enabled: on, visible: on };
      }
    });
    setSourceConfigs(next);
    return next;
  };

  /**
   * 检测结束后，若某个分组（默认 / GD API / LX Script）一个启用的源都没有，
   * 自动启用排序最靠前的可用源；洛雪走 store 的单启规则，只会开一个。
   * 全组都没有 ok/unknown 时不动，避免把一个已确认失效的源强行打开。
   */
  const autoEnableFirstPerGroup = (
    ordered: SourceConfig[],
    results: Record<string, SourceHealthResult>
  ): SourceConfig[] => {
    const imported = useImportedSourcesStore.getState().sources;
    const groupOf = (c: SourceConfig) =>
      isImported(c.source)
        ? (imported.find((s) => s.id === c.source)?.kind ?? "imported")
        : "builtin";
    let base = ordered;
    Array.from(new Set(base.map(groupOf))).forEach((group) => {
      const rows = base.filter((c) => groupOf(c) === group);
      if (rows.some((c) => c.enabled && c.visible)) return;
      const pick =
        rows.find((c) => results[c.source]?.status === "ok") ??
        rows.find((c) => results[c.source]?.status === "unknown");
      if (!pick) return;
      if (isImported(pick.source)) {
        useImportedSourcesStore
          .getState()
          .update(pick.source, { enabled: true, visible: true });
        base = syncImportedToConfigs(base);
      } else {
        base = base.map((c) =>
          c.source === pick.source
            ? { ...c, enabled: true, visible: true, healthDisabled: false }
            : c
        );
      }
    });
    return base;
  };

  // 老数据里 enabled 与 visible 可能不一致（旧版「眼睛」和「对勾」是分开的），
  // 合并成一个开关后统一成「两者都开才算开」，否则界面显示关、聚合搜索却还在用它。
  useEffect(() => {
    const current = useMusicStore.getState().sourceConfigs;
    const mismatched = current.filter((c) => c.enabled !== c.visible);
    if (mismatched.length === 0) return;

    const next = current.map((c) => {
      if (c.enabled === c.visible) return c;
      const on = c.enabled && c.visible;
      return { ...c, enabled: on, visible: on };
    });
    mismatched.forEach((c) => {
      if (isImported(c.source)) {
        useImportedSourcesStore
          .getState()
          .update(c.source, { enabled: false, visible: false });
      }
    });
    useMusicStore.getState().setSourceConfigs(next);
    // 只在挂载时做一次迁移，之后以用户操作为准
  }, []);

  // 已导入但配置里还缺条目的（历史数据），展开时补齐
  useEffect(() => {
    if (importedSources.length > 0) syncImportedToConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importedSources]);

  const sensors = useSensors(
    // 整行都能拖：长按 350ms 才进入拖拽，手指一上来就滑动时（超过 8px）取消，
    // 让列表正常滚动；用 TouchSensor 而不是 PointerSensor，后者会吃掉滚动事件。
    useSensor(TouchSensor, {
      activationConstraint: { delay: 350, tolerance: 8 },
    }),
    // 桌面端：按住稍微移动即开始拖，短按（点开关/眼睛）不会误触发
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  /** 配置里还缺的导入源（历史数据）先用导入记录兜底，等同步 effect 补进列表 */
  const rows: SourceConfig[] = [
    ...sourceConfigs,
    ...importedSources
      .filter((s) => !sourceConfigs.some((c) => c.source === s.id))
      .map((s) => {
        const on = s.enabled && s.visible;
        return {
          source: s.id as SourceConfig["source"],
          enabled: on,
          visible: on,
        };
      }),
  ];

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // 分组（默认 / GD / 洛雪）后仍只在同一组内重排：
    // 把组内新顺序按原来的位置填回全局列表，其它组的位置保持不动。
    const groupOf = (id: string) => {
      const imp = importedSources.find((s) => s.id === id);
      return imp ? imp.kind : "builtin";
    };
    if (groupOf(String(active.id)) !== groupOf(String(over.id))) return;

    const positions: number[] = [];
    rows.forEach((c, i) => {
      if (groupOf(c.source) === groupOf(String(active.id))) positions.push(i);
    });
    const group = positions.map((i) => rows[i]);
    const oldIndex = group.findIndex((c) => c.source === active.id);
    const newIndex = group.findIndex((c) => c.source === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const moved = arrayMove(group, oldIndex, newIndex);
    const next = [...rows];
    positions.forEach((pos, k) => {
      next[pos] = moved[k];
    });
    setSourceConfigs(next);
  };

  /** 可见与启用合并后的唯一开关：一起开、一起关 */
  const toggleSource = (source: string, next: boolean) => {
    const current = useMusicStore.getState().sourceConfigs;
    const activeCount = current.filter((c) => c.enabled && c.visible).length;
    const target = current.find((c) => c.source === source);
    if (!target) return;
    if (!next && LOCKED_SOURCES.includes(source as SourceConfig["source"])) {
      toast.error("酷我是搜索音源，不能关闭");
      return;
    }
    if (!next && target.enabled && activeCount <= 1) {
      toast.error("至少保留一个音源");
      return;
    }
    // 手动操作后不再算「被检测停用」，避免下次检测擅自改回来
    const base = current.map((c) =>
      c.source === source ? { ...c, healthDisabled: false } : c
    );

    if (isImported(source)) {
      const { disabled } = useImportedSourcesStore
        .getState()
        .update(source, { enabled: next, visible: next });
      // 洛雪单启在 store 里收敛，界面按最新状态对齐（含被自动停用的旧脚本）
      syncImportedToConfigs(base);
      if (next && disabled.length > 0) {
        const label =
          target.alias?.trim() ||
          importedSources.find((s) => s.id === source)?.name ||
          source;
        toast.success(
          `已切换到「${label}」，已停用原洛雪脚本「${disabled.map((s) => s.name).join("、")}」`
        );
      }
      return;
    }

    setSourceConfigs(
      base.map((c) =>
        c.source === source ? { ...c, enabled: next, visible: next } : c
      )
    );
  };

  /** 一键检测：失败的音源自动停用；全部失败时按网络异常处理，不改配置 */
  const runHealthCheck = async () => {
    if (checking) return;
    // 全部音源都测：停用的也要给出延迟，方便判断是不是网络问题导致没启用
    const targets = sourceConfigs
      .filter((c) => !EXCLUDED_FOR_SEARCH.includes(c.source))
      .map((c) => c.source);
    if (targets.length === 0) return;

    const runId = ++checkRunRef.current;
    setChecking(true);
    setHealth({});
    setCheckSummary(null);
    setUpdateSummary(null);
    setSourceUpdateResults({});
    setCheckProgress({ done: 0, total: targets.length });

    try {
      const results = await checkSourcesHealth(targets, {
        // 一键检测全并发：不计较少量限流，换取整体等待时间最短
        concurrency: targets.length,
        onProgress: (done, total) => {
          if (checkRunRef.current === runId) setCheckProgress({ done, total });
        },
      });
      if (checkRunRef.current !== runId) return;

      const map: Record<string, SourceHealthResult> = {};
      results.forEach((r) => {
        map[r.source] = r;
      });
      setHealth(map);

      const okList = results
        .filter((r) => r.status === "ok")
        .map((r) => r.source);
      const failed = results
        .filter((r) => r.status === "fail")
        .map((r) => r.source);
      const okCount = okList.length;
      const unavailableCount = targets.length - okCount;

      if (okCount === 0 && failed.length === 0) {
        setCheckSummary("无法验证，未改动配置");
        return;
      }

      if (okCount === 0) {
        setCheckSummary("全部检测失败，未改动配置");
        toast.error("所有音源都检测失败，可能是网络问题，已保持原设置");
        return;
      }

      if (failed.length === 0) {
        // 全部可用也要真正重排（以前这里只写了「已按延迟排序」却没排序）
        const sorted = sortConfigsByHealth(
          useMusicStore.getState().sourceConfigs,
          map
        );
        const final = autoEnableFirstPerGroup(sorted, map);
        useMusicStore.getState().setSourceConfigs(final);
        setCheckSummary(`${okCount} 个可用 · ${unavailableCount} 个不可用`);
        toast.success(
          `检测完成：${okCount} 个可用，${unavailableCount} 个不可用`
        );
        return;
      }

      // 用最新配置，避免检测期间用户手动改过开关
      const okSet = new Set(okList);
      const failedSet = new Set(failed);
      const latest = useMusicStore.getState().sourceConfigs;
      const mapped = latest.map((c) => {
        if (failedSet.has(c.source)) {
          // 搜索依赖的锁定源、以及本来就手动停用的源都不自动停
          if (LOCKED_SOURCES.includes(c.source) || !(c.enabled && c.visible))
            return c;
          return { ...c, enabled: false, visible: false, healthDisabled: true };
        }
        // 之前被检测停用、这次恢复了：自动开回来
        if (okSet.has(c.source) && c.healthDisabled) {
          return { ...c, enabled: true, visible: true, healthDisabled: false };
        }
        return c;
      });

      // 序位同时决定「全部」聚合搜索的源权重：可用且快的在前，停用/失败沉底
      const sorted = sortConfigsByHealth(mapped, map);
      const imported = useImportedSourcesStore.getState();
      failed.forEach((id) => {
        if (isImported(id)) {
          imported.update(id, { enabled: false, visible: false });
        }
      });
      okList.forEach((id) => {
        if (isImported(id)) {
          const cfg = latest.find((c) => c.source === id);
          if (cfg?.healthDisabled) {
            imported.update(id, { enabled: true, visible: true });
          }
        }
      });
      // 每组都没有启用源时，自动开排序第一的可用源（洛雪走单启规则）
      const final = autoEnableFirstPerGroup(sorted, map);
      useMusicStore.getState().setSourceConfigs(final);
      // 恢复启用的洛雪脚本可能触发单启规则停掉另一个，按最新 store 对齐（保留排序）
      syncImportedToConfigs(final);
      setCheckSummary(`${okCount} 个可用 · ${unavailableCount} 个不可用`);
      toast.success(
        `检测完成：${okCount} 个可用，${unavailableCount} 个不可用`
      );
    } finally {
      if (checkRunRef.current === runId) setChecking(false);
    }
  };

  const deleteImported = (source: ImportedSource) => {
    useImportedSourcesStore.getState().remove(source.id);
    syncImportedToConfigs();
  };

  type UpdateResult = {
    status: "updated" | "unchanged" | "failed" | "duplicate" | "no-url";
    label: string;
  };

  /** 从保存的地址（多数是 latest.js）重新拉取脚本，单个更新与一键更新共用 */
  const refreshImported = async (
    source: ImportedSource
  ): Promise<UpdateResult> => {
    const record = (text: string) =>
      setSourceUpdateResults((prev) => ({ ...prev, [source.id]: text }));
    if (!/^https?:\/\//i.test(source.url ?? "")) {
      record("无更新地址");
      return { status: "no-url", label: source.name };
    }
    try {
      const res = await probeSource(source.url);
      if (!res) {
        record("更新失败");
        return { status: "failed", label: source.name };
      }
      const label = `${res.name}${res.version ? ` · ${res.version}` : ""}`;
      const nextUrl = res.url ?? source.url;
      const dup = findDuplicateSource(
        useImportedSourcesStore.getState().sources,
        {
          name: res.name,
          url: nextUrl,
          script: res.script,
          kind: res.kind,
        },
        source.id
      );
      if (dup) {
        record("更新失败：与已有音源重复");
        return { status: "duplicate", label };
      }
      const changed =
        res.script !== source.script ||
        res.name !== source.name ||
        res.version !== source.version ||
        res.sourceCode !== source.sourceCode;
      useImportedSourcesStore.getState().update(source.id, {
        kind: res.kind,
        name: res.name,
        url: nextUrl,
        script: res.script,
        capabilities: res.capabilities,
        sourceCode: res.sourceCode,
        version: res.version,
        updatedAt: Date.now(),
      });
      record(
        changed ? `已更新${res.version ? ` · ${res.version}` : ""}` : "已是最新"
      );
      return { status: changed ? "updated" : "unchanged", label };
    } catch {
      record("更新失败");
      return { status: "failed", label: source.name };
    }
  };

  const updateImported = async (source: ImportedSource) => {
    if (updatingId || updatingAll) return;
    if (!/^https?:\/\//i.test(source.url ?? "")) {
      toast.error("该音源是粘贴脚本导入的，没有更新地址，请重新导入");
      return;
    }
    setUpdatingId(source.id);
    try {
      const { status, label } = await refreshImported(source);
      syncImportedToConfigs();
      if (status === "updated") toast.success(`已更新「${label}」`);
      else if (status === "unchanged")
        toast.success(`「${label}」已是最新版本`);
      else if (status === "duplicate")
        toast.error(`更新失败：与已有音源重复，未改动`);
      else toast.error("更新失败：无法从原地址获取有效音源，请检查网络或地址");
    } finally {
      setUpdatingId(null);
    }
  };

  /** 一键更新所有有地址的导入音源；粘贴脚本导入的没有地址，跳过 */
  const updateAllImported = async () => {
    if (updatingAll || updatingId) return;
    const targets = importedSources.filter((s) =>
      /^https?:\/\//i.test(s.url ?? "")
    );
    if (targets.length === 0) {
      toast.error("没有可更新的音源（粘贴脚本导入的源没有地址）");
      return;
    }
    setUpdatingAll(true);
    setUpdateProgress({ done: 0, total: targets.length });
    setUpdateSummary(null);
    setCheckSummary(null);
    setSourceUpdateResults({});
    let updated = 0;
    let unchanged = 0;
    let failed = 0;
    let done = 0;
    try {
      // 全部并发拉取，谁先回来先记进度；refreshImported 内部已吞掉单个失败
      await Promise.all(
        targets.map(async (source) => {
          const { status } = await refreshImported(source);
          if (status === "updated") updated += 1;
          else if (status === "unchanged") unchanged += 1;
          else failed += 1;
          done += 1;
          setUpdateProgress({ done, total: targets.length });
        })
      );
      syncImportedToConfigs();
      // 失败永远排最前，其次才是已更新
      const summary = [
        failed > 0 ? `${failed} 个更新失败` : null,
        updated > 0 ? `${updated} 个已更新` : null,
        unchanged > 0 ? `${unchanged} 个已是最新` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      setUpdateSummary(summary);
      toast.success(`一键更新完成：${summary}`);
    } finally {
      setUpdatingAll(false);
    }
  };

  /** 音源默认显示名（没有别名时用它，作为输入框占位提示） */
  const defaultLabelOf = (source: string) =>
    aggregatedSourceOptions.find((o) => o.value === source)?.label ||
    importedSources.find((s) => s.id === source)?.name ||
    source;

  const openEditor = (source: string) => {
    const cfg = sourceConfigs.find((c) => c.source === source);
    const imp = importedSources.find((s) => s.id === source);
    setEditor({
      source,
      imported: Boolean(imp),
      alias: cfg?.alias ?? "",
      url: imp?.url ?? "",
      saving: false,
    });
    setEditorOpen(true);
  };

  const saveEditor = async () => {
    if (!editor || editor.saving) return;
    const { source, imported, alias: rawAlias, url: rawUrl } = editor;
    const alias = rawAlias.trim();
    const imp = importedSources.find((s) => s.id === source);
    const nextUrl = rawUrl.trim();

    // 导入音源换了地址：先重新探测，成功了再一起保存，避免存进一个用不了的地址
    if (imported && imp && nextUrl && nextUrl !== imp.url) {
      setEditor((e) => (e ? { ...e, saving: true } : e));
      try {
        const res = await probeSource(nextUrl);
        if (!res) {
          toast.error("无法识别这个地址：不是有效的 GD API 或洛雪脚本");
          setEditor((e) => (e ? { ...e, saving: false } : e));
          return;
        }
        const resolvedUrl = res.url ?? normalizeSourceUrl(nextUrl);
        const dup = findDuplicateSource(
          useImportedSourcesStore.getState().sources,
          {
            name: res.name,
            url: resolvedUrl,
            script: res.script,
            kind: res.kind,
          },
          source
        );
        if (dup) {
          toast.error(
            `该地址与「${dup.source.name}」${duplicateReasonText(dup.reason)}，未保存`
          );
          setEditor((e) => (e ? { ...e, saving: false } : e));
          return;
        }
        useImportedSourcesStore.getState().update(source, {
          kind: res.kind,
          name: res.name,
          // 仓库地址会被展开成具体文件直链
          url: resolvedUrl,
          script: res.script,
          capabilities: res.capabilities,
          sourceCode: res.sourceCode,
          version: res.version,
          updatedAt: Date.now(),
        });
        toast.success("音源地址已更新");
      } catch {
        toast.error("地址解析失败，请检查网络或链接");
        setEditor((e) => (e ? { ...e, saving: false } : e));
        return;
      }
    }

    setSourceConfigs(
      sourceConfigs.map((c) =>
        c.source === source ? { ...c, alias: alias || undefined } : c
      )
    );
    setEditorOpen(false);
  };

  const enabledCount = sourceConfigs.filter(
    (c) => c.enabled && c.visible
  ).length;

  /** 按分类渲染可拖拽列表：默认 / GD API / 洛雪音乐各一组 */
  const renderGroup = (configs: SourceConfig[], emptyHint: string) => {
    if (configs.length === 0) {
      return (
        <div className="py-6 text-center text-xs text-muted-foreground">
          {emptyHint}
        </div>
      );
    }
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis]}
      >
        <SortableContext
          items={configs.map((c) => c.source)}
          strategy={verticalListSortingStrategy}
        >
          {configs.map((config) => {
            if (isImported(config.source)) {
              const source = importedSources.find(
                (s) => s.id === config.source
              );
              if (!source) return null;
              return (
                <SortableRow key={config.source} id={config.source}>
                  <ImportedSourceItem
                    source={source}
                    config={config}
                    health={health[source.id]}
                    updateResult={sourceUpdateResults[source.id]}
                    onToggle={(next) => toggleSource(source.id, next)}
                    onRename={() => openEditor(source.id)}
                    onUpdate={() => updateImported(source)}
                    updating={updatingId === source.id}
                    onDelete={() => deleteImported(source)}
                  />
                </SortableRow>
              );
            }
            return (
              <SortableRow key={config.source} id={config.source}>
                <SourceItem
                  config={config}
                  health={health[config.source]}
                  locked={LOCKED_SOURCES.includes(config.source)}
                  onToggle={(next) => toggleSource(config.source, next)}
                  onRename={() => openEditor(config.source)}
                />
              </SortableRow>
            );
          })}
        </SortableContext>
        <DragOverlay>
          {activeConfig ? (
            <div className="shadow-xl rounded-lg bg-card border">
              {activeImported ? (
                <ImportedSourceItem
                  source={activeImported}
                  config={activeConfig}
                  onToggle={() => {}}
                  onRename={() => {}}
                  onUpdate={() => {}}
                  onDelete={() => {}}
                />
              ) : (
                <SourceItem
                  config={activeConfig}
                  onToggle={() => {}}
                  onRename={() => {}}
                />
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    );
  };

  const activeConfig = activeId
    ? sourceConfigs.find((c) => c.source === activeId)
    : null;
  const activeImported =
    activeId && isImported(activeId)
      ? importedSources.find((s) => s.id === activeId)
      : undefined;

  const builtinRows = sortConfigsByHealth(
    rows.filter((c) => !isImported(c.source)),
    health
  );
  const gdRows = sortConfigsByHealth(
    rows.filter(
      (c) => importedSources.find((s) => s.id === c.source)?.kind === "gd"
    ),
    health
  );
  const lxRows = sortLxConfigs(
    rows.filter(
      (c) => importedSources.find((s) => s.id === c.source)?.kind === "lx"
    ),
    health
  );

  return (
    <>
      <SettingItem
        icon={Radio}
        title="聚合音源"
        action={
          <span className="text-sm shrink-0 whitespace-nowrap">
            已选择 {enabledCount} 个音源
          </span>
        }
        onClick={() => setShowSourcePicker(!showSourcePicker)}
        showChevron
        chevronPosition="end"
        actionPassThrough
        isExpanded={showSourcePicker}
        expandedContent={
          <div>
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <SourceImport inline onImported={syncImportedToConfigs} />
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={runHealthCheck}
                disabled={checking || updatingAll}
              >
                {checking ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ScanSearch className="mr-1 h-3.5 w-3.5" />
                )}
                {checking
                  ? `检测中 ${checkProgress.done}/${checkProgress.total}`
                  : "一键检测"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={updateAllImported}
                disabled={updatingAll || checking || Boolean(updatingId)}
              >
                {updatingAll ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                )}
                {updatingAll
                  ? `更新中 ${updateProgress.done}/${updateProgress.total}`
                  : "一键更新"}
              </Button>
            </div>
            <div className="truncate pb-1 text-xs text-muted-foreground">
              {updateSummary ??
                checkSummary ??
                (importedSources.length > 0
                  ? `已导入 ${importedSources.length} 个音源`
                  : "")}
            </div>

            <Tabs
              value={sourceTab}
              onValueChange={setSourceTab}
              className="mt-1"
            >
              <TabsList className="w-full">
                <TabsTrigger value="builtin">默认</TabsTrigger>
                <TabsTrigger value="gd">GD API</TabsTrigger>
                <TabsTrigger value="lx">LX Script</TabsTrigger>
              </TabsList>

              <TabsContent value="builtin">
                {renderGroup(builtinRows, "还没有默认音源")}
              </TabsContent>
              <TabsContent value="gd">
                {renderGroup(gdRows, "还没有导入 GD API 音源")}
              </TabsContent>
              <TabsContent value="lx">
                {renderGroup(lxRows, "还没有导入 LX Script 音源")}
              </TabsContent>
            </Tabs>
          </div>
        }
      />

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          // 关闭时保留 editor 数据，让关闭动画用的是同一份内容
          setEditorOpen(open);
        }}
      >
        <DialogContent className="max-w-[85vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editor?.imported ? "编辑音源" : "设置别名"}
            </DialogTitle>
            <DialogDescription>
              {editor?.imported
                ? "可修改地址和显示别名；换地址会先解析，确认是可用的音源才保存。"
                : "只改显示名，不影响音源本身；留空则恢复默认名称。"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {editor?.imported && (
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">地址</label>
                <Input
                  value={editor.url}
                  onChange={(e) =>
                    setEditor((prev) =>
                      prev ? { ...prev, url: e.target.value } : prev
                    )
                  }
                  placeholder="https://.../api.php 或脚本直链"
                  className="text-xs"
                  autoFocus
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">别名</label>
              <Input
                value={editor?.alias ?? ""}
                onChange={(e) =>
                  setEditor((prev) =>
                    prev ? { ...prev, alias: e.target.value } : prev
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEditor();
                }}
                placeholder={editor ? defaultLabelOf(editor.source) : ""}
                autoFocus={!editor?.imported}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              取消
            </Button>
            <Button onClick={saveEditor} disabled={editor?.saving}>
              {editor?.saving && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
