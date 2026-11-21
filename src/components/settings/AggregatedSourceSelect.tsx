import { useMusicStore } from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import { aggregatedSourceOptions, type SourceConfig } from "@/types/music";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Radio,
  GripVertical,
  Trash2,
  Pencil,
  Loader2,
  ScanSearch,
} from "lucide-react";
import { SourceImport } from "./SourceImport";
import { useImportedSourcesStore } from "@/lib/imported-sources/store";
import { probeSource, normalizeSourceUrl } from "@/lib/imported-sources/probe";
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
}

function SourceItem({ config, onToggle, onRename, health }: SourceItemProps) {
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
            {on ? "上次检测不可用" : "检测不可用，已停用"}
            {latency && ` · ${latency}`}
          </span>
        ) : health?.status === "unknown" ? (
          <span className="text-xs text-amber-600 dark:text-amber-500">
            缺少可验证的曲目，未判定
            {latency && ` · ${latency}`}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {description}
            {latency && ` · 延迟 ${latency}`}
          </span>
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
        aria-label={on ? "停用音源" : "启用音源"}
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
  onDelete,
  health,
}: {
  source: ImportedSource;
  config: SourceConfig;
  onToggle: (next: boolean) => void;
  onRename: () => void;
  onDelete: () => void;
  health?: SourceHealthResult;
}) {
  const label = config.alias?.trim() || source.name;
  const on = config.enabled && config.visible;
  const latency = formatLatency(health?.latencyMs);
  const platforms = getLxSourcePlatforms(source)
    .map((p) => LX_PLATFORM_LABELS[p] || p)
    .filter(Boolean);
  const description =
    source.kind === "gd"
      ? "GD 兼容 API"
      : platforms.length > 0
        ? `仅兜底 ${platforms.join("/")} 取链 · 不参与搜索`
        : "洛雪 JS 脚本 · 不参与搜索";
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
            {on ? "上次检测不可用" : "检测不可用，已停用"}
            {latency && ` · ${latency}`}
          </span>
        ) : health?.status === "unknown" ? (
          <span className="text-xs text-amber-600 dark:text-amber-500">
            {description} · 本次未判定
            {latency && ` · ${latency}`}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {description}
            {latency && ` · 延迟 ${latency}`}
          </span>
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
  const [showSourcePicker, setShowSourcePicker] = useState(false);
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
  /** 一键检测结果：source → 状态与延迟。只在本次展开期间保留 */
  const [health, setHealth] = useState<Record<string, SourceHealthResult>>({});
  const [checking, setChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState({ done: 0, total: 0 });
  const [checkSummary, setCheckSummary] = useState<string | null>(null);
  const checkRunRef = useRef(0);

  const isImported = (id: string) => id.startsWith("imp_");

  /** 导入/删除音源后，同步 sourceConfigs（排序/开关列表） */
  const syncImportedToConfigs = () => {
    const imported = useImportedSourcesStore.getState().sources;
    const ids = new Set(imported.map((s) => s.id));
    const next = sourceConfigs.filter(
      (c) => !isImported(c.source) || ids.has(c.source)
    );
    imported.forEach((s) => {
      if (!next.some((c) => c.source === s.id)) {
        // 可见与启用已合并成一个开关，新补的条目按「两者都开」才算开启
        const on = s.enabled && s.visible;
        next.push({
          source: s.id as SourceConfig["source"],
          enabled: on,
          visible: on,
        });
      }
    });
    setSourceConfigs(next);
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
    if (!next && target.enabled && activeCount <= 1) {
      toast.error("至少保留一个音源");
      return;
    }
    setSourceConfigs(
      current.map((c) =>
        c.source === source
          ? // 手动操作后不再算「被检测停用」，避免下次检测擅自改回来
            { ...c, enabled: next, visible: next, healthDisabled: false }
          : c
      )
    );
    if (isImported(source)) {
      useImportedSourcesStore
        .getState()
        .update(source, { enabled: next, visible: next });
    }
  };

  /** 一键检测：失败的音源自动停用；全部失败时按网络异常处理，不改配置 */
  const runHealthCheck = async () => {
    if (checking) return;
    // 内置源只测开启的；导入源全测，才能把上次误停用的恢复回来
    const importedIds = new Set(importedSources.map((s) => s.id));
    const targets = sourceConfigs
      .filter((c) => !EXCLUDED_FOR_SEARCH.includes(c.source))
      .filter((c) => (c.enabled && c.visible) || importedIds.has(c.source))
      .map((c) => c.source);
    if (targets.length === 0) return;

    const runId = ++checkRunRef.current;
    setChecking(true);
    setHealth({});
    setCheckSummary(null);
    setCheckProgress({ done: 0, total: targets.length });

    try {
      const results = await checkSourcesHealth(targets, {
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
      const unknownCount = results.filter((r) => r.status === "unknown").length;
      const okCount = okList.length;
      const tail = unknownCount > 0 ? ` · ${unknownCount} 个未判定` : "";

      if (okCount === 0 && failed.length === 0) {
        setCheckSummary(`无法验证，未改动配置${tail}`);
        return;
      }

      if (okCount === 0) {
        setCheckSummary("全部检测失败，未改动配置");
        toast.error("所有音源都检测失败，可能是网络问题，已保持原设置");
        return;
      }

      if (failed.length === 0) {
        setCheckSummary(`${okCount} 个全部可用${tail} · 已按延迟排序`);
        toast.success(`检测完成：${okCount} 个音源全部可用`);
        return;
      }

      // 用最新配置，避免检测期间用户手动改过开关
      const okSet = new Set(okList);
      const failedSet = new Set(failed);
      const latest = useMusicStore.getState().sourceConfigs;
      const mapped = latest.map((c) => {
        if (failedSet.has(c.source)) {
          return { ...c, enabled: false, visible: false, healthDisabled: true };
        }
        // 之前被检测停用、这次恢复了：自动开回来
        if (okSet.has(c.source) && c.healthDisabled) {
          return { ...c, enabled: true, visible: true, healthDisabled: false };
        }
        return c;
      });

      // 检测完成后按延迟升序重排。序位同时决定「全部」聚合搜索的源权重，
      // 所以让快的源排在前面：启用且可用的按延迟从快到慢，未启用 /
      // 失败的沉底（它们不参与搜索，位置只影响列表观感）。
      const tested = new Set(targets);
      const rankOf = (c: SourceConfig) => {
        const r = map[c.source];
        const on = c.enabled && c.visible;
        if (!on) return 4e9 + (r?.latencyMs ?? 1e8);
        if (!r || r.status === "fail") return 3e9 + (r?.latencyMs ?? 1e8);
        if (r.status === "unknown") return 2e9 + (r.latencyMs ?? 1e8);
        return r.latencyMs ?? 0;
      };
      const testedRows = mapped
        .filter((c) => tested.has(c.source))
        .sort((a, b) => rankOf(a) - rankOf(b));
      const restRows = mapped.filter((c) => !tested.has(c.source));
      useMusicStore.getState().setSourceConfigs([...testedRows, ...restRows]);
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
      const restored = okList.filter(
        (id) => latest.find((c) => c.source === id)?.healthDisabled
      ).length;
      setCheckSummary(
        `${okCount} 个可用 · ${failed.length} 个已停用${
          restored > 0 ? ` · ${restored} 个已恢复` : ""
        }${tail} · 已按延迟排序`
      );
      toast.success(
        `检测完成：${okCount} 个可用，${failed.length} 个无效已自动停用`
      );
    } finally {
      if (checkRunRef.current === runId) setChecking(false);
    }
  };

  const deleteImported = (source: ImportedSource) => {
    useImportedSourcesStore.getState().remove(source.id);
    syncImportedToConfigs();
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
        useImportedSourcesStore.getState().update(source, {
          kind: res.kind,
          name: res.name,
          // 仓库地址会被展开成具体文件直链
          url: res.url ?? normalizeSourceUrl(nextUrl),
          script: res.script,
          capabilities: res.capabilities,
          sourceCode: res.sourceCode,
        });
        toast.success("音源地址已更新");
      } catch {
        toast.error("地址探测失败，请检查网络或链接");
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
                    onToggle={(next) => toggleSource(source.id, next)}
                    onRename={() => openEditor(source.id)}
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

  const builtinRows = rows.filter((c) => !isImported(c.source));
  const gdRows = rows.filter(
    (c) => importedSources.find((s) => s.id === c.source)?.kind === "gd"
  );
  const lxRows = rows.filter(
    (c) => importedSources.find((s) => s.id === c.source)?.kind === "lx"
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
            <SourceImport onImported={syncImportedToConfigs} />

            <div className="flex items-center justify-between gap-2 pb-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={runHealthCheck}
                disabled={checking}
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
              <span className="text-xs text-muted-foreground truncate">
                {checkSummary ?? "无效音源将自动停用"}
              </span>
            </div>

            <Tabs defaultValue="builtin" className="mt-1">
              <TabsList className="w-full">
                <TabsTrigger value="builtin">默认</TabsTrigger>
                <TabsTrigger value="gd">GD API</TabsTrigger>
                <TabsTrigger value="lx">洛雪音乐</TabsTrigger>
              </TabsList>

              <TabsContent value="builtin">
                {renderGroup(builtinRows, "还没有默认音源")}
              </TabsContent>
              <TabsContent value="gd">
                {renderGroup(gdRows, "还没有导入 GD API 音源")}
              </TabsContent>
              <TabsContent value="lx">
                {renderGroup(lxRows, "还没有导入洛雪音乐音源")}
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
                ? "可修改地址和显示别名；换地址会先探测，确认是可用的音源才保存。"
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
