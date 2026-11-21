"use client";

import { useState } from "react";
import { Check, Download, Loader2, Plus } from "lucide-react";
import { Button } from "../ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { Input } from "../ui/input";
import { toast } from "react-hot-toast";
import {
  normalizeSourceUrl,
  probeSourceCandidates,
  type ProbeCandidate,
  type ProbeFailReason,
} from "@/lib/imported-sources/probe";
import { useImportedSourcesStore } from "@/lib/imported-sources/store";
import type { ImportedSource } from "@/lib/imported-sources/types";

interface Props {
  onImported: () => void;
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

export function SourceImport({ onImported }: Props) {
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
      setCandidates(outcome.candidates);
      // 默认全选，不想要的取消勾选即可
      setSelected(new Set(outcome.candidates.map((_, i) => i)));
      toast.success(
        outcome.candidates.length > 1
          ? `找到 ${outcome.candidates.length} 个音源，默认全选，可取消不想要的`
          : `识别为${outcome.candidates[0].kind === "gd" ? "GD 兼容 API" : "洛雪 JS 脚本"}`
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

    const base = Date.now().toString(36);
    const list: ImportedSource[] = picked.map((c, i) => ({
      // 同一批导入要保证 id 唯一：时间戳 + 序号 + 随机串
      id: `imp_${base}${i.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      name: c.name,
      kind: c.kind,
      // 仓库地址已展开成具体文件，保存下来方便以后重新探测
      url: c.url ?? normalizeSourceUrl(input.trim()),
      script: c.script,
      capabilities: c.capabilities,
      sourceCode: c.sourceCode,
      enabled: true,
      visible: true,
      addedAt: Date.now() + i,
    }));

    addMany(list);
    onImported();
    setOpen(false);
    setInput("");
    reset();
    toast.success(
      list.length > 1
        ? `已导入 ${list.length} 个音源`
        : `已导入「${list[0].name}」`
    );
  };

  const closeAndReset = () => {
    setOpen(false);
    reset();
  };

  const single = candidates.length === 1 ? candidates[0] : null;

  return (
    <>
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span>导入音源（GD API / 洛雪脚本）</span>
          {sources.length > 0 && (
            <span className="ml-auto text-xs">
              已导入 {sources.length} 个音源
            </span>
          )}
        </button>
      </div>

      <Drawer
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : closeAndReset())}
      >
        <DrawerContent
          className="max-h-[85vh]"
          // 点遮罩/区域外直接收起（不依赖 vaul 内部判定，避免真机上首次点击被吞）
          onPointerDownOutside={closeAndReset}
          onInteractOutside={closeAndReset}
        >
          <DrawerHeader>
            <DrawerTitle>导入音源</DrawerTitle>
            <DrawerDescription>
              支持 GD Studio 兼容的 api.php 地址，或洛雪音乐的 JS 音源脚本。 填
              GitHub 仓库地址会列出里面的全部音源，可多选导入。
            </DrawerDescription>
          </DrawerHeader>

          <div className="space-y-3 px-4">
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
                  {single.capabilities?.length
                    ? ` · 能力：${single.capabilities.join(", ")}`
                    : ""}
                </div>
              </div>
            )}
          </div>

          <DrawerFooter>
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
                ? `探测中 ${progress.done}/${progress.total}`
                : "探测"}
            </Button>
            <Button onClick={handleImport} disabled={selected.size === 0}>
              {selected.size > 1 ? `导入 ${selected.size} 个` : "导入"}
            </Button>
            <Button variant="outline" onClick={closeAndReset}>
              取消
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}
