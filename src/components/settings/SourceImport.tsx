"use client";

import { useEffect, useState } from "react";
import { Check, Download, Loader2, Plus } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { useExitLayer } from "@/hooks/useExitLayer";
import { toast } from "react-hot-toast";
import {
  normalizeSourceUrl,
  probeSourceCandidates,
  type ProbeCandidate,
  type ProbeFailReason,
} from "@/lib/imported-sources/probe";
import { useImportedSourcesStore } from "@/lib/imported-sources/store";
import { findDuplicateSource } from "@/lib/imported-sources/rules";
import type { ImportedSource } from "@/lib/imported-sources/types";

interface Props {
  onImported: () => void;
  /** 放进「聚合音源」操作栏时只渲染入口按钮，数量交给父层展示 */
  inline?: boolean;
}

/** 候选转成入库结构；探测阶段也用它判重，两边规则保持一致 */
function toImportedSource(
  c: ProbeCandidate,
  index: number,
  rawInput: string
): ImportedSource {
  const now = Date.now();
  const fallbackUrl = /^https?:\/\//i.test(rawInput)
    ? normalizeSourceUrl(rawInput)
    : "";
  return {
    id: `imp_${now.toString(36)}${index.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: c.name,
    kind: c.kind,
    url: c.url ?? fallbackUrl,
    script: c.script,
    capabilities: c.capabilities,
    sourceCode: c.sourceCode,
    version: c.version,
    enabled: true,
    visible: true,
    addedAt: now + index,
    updatedAt: now + index,
  };
}

function reasonText(reason: ProbeFailReason) {
  switch (reason) {
    case "empty":
      return "请输入 URL 或粘贴脚本内容";
    case "network":
      return "访问失败：网络打不开这个地址（GitHub 可能被拦截），可换成 raw 直链或直接粘贴脚本";
    case "not-found":
      return "找不到这个仓库，请确认地址正确且仓库是公开的";
    case "no-source":
      return "仓库里没找到可用的洛雪脚本";
    default:
      return "无法识别：不是有效的 GD API 或洛雪脚本";
  }
}

export function SourceImport({ onImported, inline = false }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [probing, setProbing] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [candidates, setCandidates] = useState<ProbeCandidate[]>([]);
  /** 勾选的下标；仓库里通常有多个音源，支持一次全导入 */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { sources, addMany } = useImportedSourcesStore();
  const { push, pop } = useExitLayer();

  // Dialog 不像 Drawer 那样自带退出栈，按规范手动接入：Android 返回键/Esc 只关弹窗
  useEffect(() => {
    if (!open) return;
    const id = push({ close: () => setOpen(false) });
    return () => pop(id);
  }, [open, push, pop]);

  const reset = () => {
    setCandidates([]);
    setSelected(new Set());
  };

  const toggle = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const allSelected =
    candidates.length > 0 && selected.size === candidates.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(candidates.map((_, i) => i)));
  };

  const handleProbe = async () => {
    const value = input.trim();
    if (!value) {
      toast.error(reasonText("empty"));
      return;
    }
    setProbing(true);
    reset();
    setProgress(null);
    try {
      const outcome = await probeSourceCandidates(value, (done, total) =>
        setProgress({ done, total })
      );
      if (!outcome.ok) {
        toast.error(reasonText(outcome.reason));
        return;
      }
      // 已存在的音源直接从候选里过滤掉，避免列表一大坨、还要靠导入后再提示
      const taken = [...useImportedSourcesStore.getState().sources];
      const fresh: ProbeCandidate[] = [];
      let filtered = 0;
      outcome.candidates.forEach((c, i) => {
        const probe = toImportedSource(c, i, value);
        if (findDuplicateSource(taken, probe)) {
          filtered += 1;
          return;
        }
        fresh.push(c);
        taken.push(probe);
      });
      if (fresh.length === 0) {
        toast.error(
          `找到的 ${outcome.candidates.length} 个音源都已存在，没有可导入的`
        );
        return;
      }
      setCandidates(fresh);
      // 默认全选，不想要的取消勾选即可
      setSelected(new Set(fresh.map((_, i) => i)));
      const dupText = filtered > 0 ? `，已过滤 ${filtered} 个已存在的` : "";
      toast.success(
        fresh.length > 1
          ? `找到 ${fresh.length} 个音源，默认全选${dupText}`
          : `识别为${fresh[0].kind === "gd" ? "GD 兼容 API" : "洛雪 JS 脚本"}${dupText}`
      );
    } finally {
      setProbing(false);
      setProgress(null);
    }
  };

  const handleImport = () => {
    const picked = candidates.filter((_, i) => selected.has(i));
    if (picked.length === 0) {
      toast.error("请先选择要导入的音源");
      return;
    }

    const rawInput = input.trim();
    // 已存在的 + 本批已接收的都要参与判重，防止一次导入多个同名源
    const taken = [...useImportedSourcesStore.getState().sources];
    let duplicateCount = 0;
    const list: ImportedSource[] = [];

    picked.forEach((c, i) => {
      const item = toImportedSource(c, i, rawInput);
      if (findDuplicateSource(taken, item)) {
        duplicateCount += 1;
        return;
      }
      list.push(item);
      taken.push(item);
    });

    if (list.length === 0) {
      toast.error(`这 ${duplicateCount} 个音源已存在，未导入`);
      return;
    }

    // 新导入的洛雪脚本自动接管，旧的由 store 按单启规则停用
    const { disabled } = addMany(list);
    onImported();
    setOpen(false);
    setInput("");
    reset();

    const switched = disabled.length
      ? `，已停用原洛雪脚本「${disabled.map((s) => s.name).join("、")}」`
      : "";
    toast.success(
      `${list.length > 1 ? `已导入 ${list.length} 个音源` : `已导入「${list[0].name}」`}${switched}`
    );
    if (duplicateCount > 0) {
      toast.error(`已跳过 ${duplicateCount} 个重复音源`);
    }
  };

  const closeAndReset = () => {
    setOpen(false);
    reset();
  };

  const single = candidates.length === 1 ? candidates[0] : null;

  return (
    <>
      {inline ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setOpen(true)}
        >
          <Plus className="h-4 w-4 shrink-0" />
          导入音源
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
          >
            <Plus className="h-4 w-4 shrink-0" />
            导入音源
          </Button>
          {sources.length > 0 && (
            <span className="text-xs text-muted-foreground">
              已导入 {sources.length} 个
            </span>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={closeAndReset}>
        <DialogContent className="max-h-[85vh] max-w-sm overflow-y-auto sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>导入音源</DialogTitle>
            <DialogDescription>
              支持 GD Studio 兼容的 api.php 地址，或洛雪音乐的 JS 音源脚本。填
              GitHub
              仓库地址可多选导入；已存在的音源会自动过滤，洛雪脚本同时只启用一个。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                reset();
              }}
              placeholder="https://github.com/... 或粘贴 JS 脚本"
            />

            {candidates.length > 1 && (
              <>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    已选 {selected.size} / {candidates.length}
                  </span>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-primary"
                  >
                    {allSelected ? "全不选" : "全选"}
                  </button>
                </div>

                <div className="max-h-52 overflow-y-auto rounded-lg border divide-y divide-border/60">
                  {candidates.map((c, i) => {
                    const checked = selected.has(i);
                    return (
                      <button
                        key={c.path ?? c.url ?? i}
                        type="button"
                        onClick={() => toggle(i)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-foreground">
                            {c.name}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {c.path ?? c.url}
                          </div>
                        </div>
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border"
                          }`}
                        >
                          {checked && <Check className="h-3.5 w-3.5" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {single && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{single.name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  类型：{single.kind === "gd" ? "GD 兼容 API" : "洛雪 JS 脚本"}
                  {single.version ? ` · ${single.version}` : ""}
                  {single.capabilities?.length
                    ? ` · 能力：${single.capabilities.join(", ")}`
                    : ""}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              onClick={handleProbe}
              disabled={probing}
              variant="secondary"
            >
              {probing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {probing && progress
                ? `解析中 ${progress.done}/${progress.total}`
                : "解析"}
            </Button>
            {/* 解析成功前不显示导入按钮，避免用户误点/误以为可以直接导入 */}
            {candidates.length > 0 && (
              <Button onClick={handleImport} disabled={selected.size === 0}>
                {selected.size > 1 ? `导入 ${selected.size} 个` : "导入"}
              </Button>
            )}
            <Button variant="outline" onClick={closeAndReset}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
