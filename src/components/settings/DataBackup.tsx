"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Copy,
  Check,
  Download,
  FileUp,
  Upload,
  RotateCcw,
  Save,
} from "lucide-react";
import { toastUtils } from "@/lib/utils/toast";
import { writeClipboardText } from "@/lib/clipboard";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { IS_NATIVE } from "@/lib/api/config";
import {
  serializeStoreData,
  validateBackupData,
  importStoreData,
  saveBackupFile,
  type BackupValidationResult,
} from "@/lib/utils/data-backup";
import {
  AUTO_BACKUP_DIR,
  createManualBackup,
  listAutoBackups,
  restoreAutoBackup,
  type AutoBackupEntry,
} from "@/lib/utils/auto-backup";

interface DataBackupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 从校验结果中提取预览文字 */
function summaryText(result: BackupValidationResult): string {
  if (!result.valid) return "";
  const s = result.summary;
  const parts: string[] = [];
  if (s.favoritesCount > 0) parts.push(`${s.favoritesCount} 首喜欢`);
  if (s.playlistsCount > 0) parts.push(`${s.playlistsCount} 个歌单`);
  return parts.length > 0 ? `共 ${parts.join("、")}` : "备份中无收藏或歌单数据";
}

/**
 * 数据备份对话框 —— 支持 JSON 文本导出（复制）与导入（粘贴）
 */
export function DataBackup({ open, onOpenChange }: DataBackupProps) {
  const [importText, setImportText] = useState("");
  const [fileText, setFileText] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [copied, setCopied] = useState(false);
  const [validation, setValidation] = useState<BackupValidationResult | null>(
    null
  );
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [autoBackups, setAutoBackups] = useState<AutoBackupEntry[]>([]);
  const [loadingAuto, setLoadingAuto] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [manualBackingUp, setManualBackingUp] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 每次打开对话框时重新序列化导出数据
  const exportJson = open ? serializeStoreData() : "";

  /** 打开时刷新自动备份列表 */
  useEffect(() => {
    if (!open || !IS_NATIVE) return;
    let cancelled = false;
    setLoadingAuto(true);
    listAutoBackups()
      .then((list) => {
        if (!cancelled) setAutoBackups(list);
      })
      .finally(() => {
        if (!cancelled) setLoadingAuto(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 实时校验导入文本
  useEffect(() => {
    const raw = importText || fileText;
    if (!raw.trim()) {
      setValidation(null);
      return;
    }
    setValidation(validateBackupData(raw));
  }, [fileText, importText]);

  /** 复制导出数据到剪贴板 */
  const handleCopy = useCallback(async () => {
    const ok = await writeClipboardText(exportJson);
    if (ok) {
      setCopied(true);
      toastUtils.success("已复制到剪贴板");
      setTimeout(() => setCopied(false), 2000);
    } else {
      toastUtils.error("复制失败，请手动选择复制");
    }
  }, [exportJson]);

  /** 保存备份文件 */
  const handleExportFile = useCallback(async () => {
    setExporting(true);
    try {
      const location = await saveBackupFile(exportJson);
      toastUtils.success(`备份文件已保存：\n${location}`, { duration: 4000 });
    } catch {
      toastUtils.error("保存文件失败，请检查存储权限");
    } finally {
      setExporting(false);
    }
  }, [exportJson]);

  /** 从文件读取备份文本，并复用文本导入校验流程 */
  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      try {
        setImportText("");
        setFileText(await file.text());
        setSelectedFileName(file.name);
      } catch {
        toastUtils.error("读取备份文件失败");
      }
    },
    []
  );

  /** 执行导入 */
  const handleImport = useCallback(async () => {
    if (!validation?.valid) return;
    setImporting(true);
    try {
      importStoreData(validation.data);
      toastUtils.success(
        `导入成功：${validation.summary.favoritesCount} 首收藏、${validation.summary.playlistsCount} 个歌单`
      );
      setImportText("");
      setFileText("");
      setSelectedFileName("");
      setValidation(null);
      onOpenChange(false);
    } catch (_e) {
      toastUtils.error("导入失败，数据可能不完整");
    } finally {
      setImporting(false);
    }
  }, [validation, onOpenChange]);

  /** 手动备份一份，成功后就地刷新列表 */
  const handleManualBackup = useCallback(async () => {
    setManualBackingUp(true);
    try {
      const result = await createManualBackup();
      if ("error" in result) {
        toastUtils.error(
          result.error === "empty"
            ? "当前没有可备份的数据（收藏、歌单、播放队列都为空）"
            : "备份失败，请检查存储权限"
        );
        return;
      }
      toastUtils.success("已备份一份快照", { duration: 2000 });
      setAutoBackups(await listAutoBackups());
    } catch {
      toastUtils.error("备份失败，请检查存储权限");
    } finally {
      setManualBackingUp(false);
    }
  }, []);

  /** 从自动备份恢复：覆盖当前数据后整页重载，让各 store 重新 hydrate */
  const handleRestore = useCallback(async (entry: AutoBackupEntry) => {
    const ok = await confirmDialog({
      title: `恢复到 ${entry.date} 的备份？`,
      description:
        "当前的收藏、歌单和播放队列会被备份内容覆盖，恢复后应用会自动重启。",
      confirmText: "恢复",
    });
    if (!ok) return;

    setRestoring(entry.fileName);
    try {
      const summary = await restoreAutoBackup(entry.fileName);
      toastUtils.success(
        `已恢复：${summary.favorites} 首喜欢、${summary.playlists} 个歌单、${summary.queue} 首队列`,
        { duration: 3000 }
      );
      setTimeout(() => window.location.reload(), 800);
    } catch {
      toastUtils.error("恢复失败，备份文件可能已损坏");
      setRestoring(null);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>数据备份</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="export">
          <TabsList className="w-full">
            <TabsTrigger value="export" className="flex-1">
              导出数据
            </TabsTrigger>
            <TabsTrigger value="import" className="flex-1">
              导入数据
            </TabsTrigger>
            <TabsTrigger value="auto" className="flex-1">
              自动备份
            </TabsTrigger>
          </TabsList>

          {/* 导出 Tab */}
          <TabsContent value="export" className="mt-3 space-y-3">
            <Textarea
              readOnly
              value={exportJson}
              className="h-64 font-mono text-xs resize-none max-w-full break-all"
            />
            <div className="flex gap-2">
              <Button
                onClick={handleExportFile}
                className="flex-1"
                disabled={exporting}
              >
                <Download className="h-4 w-4" />
                {exporting ? "保存中..." : "保存为文件"}
              </Button>
              <Button
                onClick={handleCopy}
                className="flex-1"
                variant={copied ? "secondary" : "outline"}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    复制文本
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          {/* 导入 Tab */}
          <TabsContent value="import" className="mt-3 space-y-3">
            <Textarea
              placeholder="在此粘贴备份数据（JSON 格式）..."
              value={importText}
              onChange={(e) => {
                setFileText("");
                setSelectedFileName("");
                setImportText(e.target.value);
              }}
              className="h-64 font-mono text-xs resize-none max-w-full break-all"
            />

            {/* 预览/错误信息 */}
            {validation && (
              <div
                className={`text-sm px-3 py-2 rounded-md ${
                  validation.valid
                    ? "bg-primary/10 text-primary"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {validation.valid ? summaryText(validation) : validation.error}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="h-4 w-4" />
              {selectedFileName || "从文件读取"}
            </Button>

            <Button
              onClick={handleImport}
              disabled={!validation?.valid || importing}
              className="w-full"
            >
              <Upload className="h-4 w-4" />
              {importing ? "导入中..." : "导入数据"}
            </Button>
          </TabsContent>

          {/* 自动备份 Tab */}
          <TabsContent value="auto" className="mt-3 space-y-3">
            <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
              <p>
                每天首次启动自动存一份，最多保留 7 份（约 7
                天），第八天起最旧的那份自动删掉；手动备份单独保留最近 10
                份。应用被清理数据、崩溃写坏 IndexedDB 时可从这里恢复。
              </p>
              <p className="break-all">目录：{AUTO_BACKUP_DIR}</p>
            </div>

            {IS_NATIVE && (
              <Button
                variant="outline"
                className="w-full"
                disabled={manualBackingUp}
                onClick={handleManualBackup}
              >
                <Save className="h-4 w-4" />
                {manualBackingUp ? "备份中..." : "立即备份"}
              </Button>
            )}

            <div className="h-64 space-y-2 overflow-y-auto">
              {!IS_NATIVE && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  自动备份仅在手机端生效
                </p>
              )}

              {IS_NATIVE && loadingAuto && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  读取中...
                </p>
              )}

              {IS_NATIVE && !loadingAuto && autoBackups.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  还没有自动备份。有收藏、歌单或播放队列后，下次启动会自动生成
                </p>
              )}

              {autoBackups.map((entry) => (
                <div
                  key={entry.fileName}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span>{entry.date}</span>
                      {entry.kind === "manual" ? (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-2xs leading-none text-primary">
                          手动
                        </span>
                      ) : (
                        <span className="rounded bg-sky-500/12 px-1.5 py-0.5 text-2xs leading-none text-sky-500 dark:bg-sky-400/15 dark:text-sky-400">
                          自动
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {entry.summary
                        ? `${entry.summary.favorites} 首喜欢 · ${entry.summary.playlists} 个歌单 · ${entry.summary.queue} 首队列`
                        : "—"}
                      {" · "}
                      {Math.max(1, Math.round(entry.size / 1024))} KB
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={restoring !== null}
                    onClick={() => handleRestore(entry)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {restoring === entry.fileName ? "恢复中" : "恢复"}
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
