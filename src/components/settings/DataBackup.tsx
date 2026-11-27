"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw, Save } from "lucide-react";
import { toastUtils } from "@/lib/utils/toast";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { IS_NATIVE } from "@/lib/api/config";
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

/**
 * 数据备份对话框 —— 展示本地自动备份与手动快照，并支持一键恢复
 */
export function DataBackup({ open, onOpenChange }: DataBackupProps) {
  const [autoBackups, setAutoBackups] = useState<AutoBackupEntry[]>([]);
  const [loadingAuto, setLoadingAuto] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [manualBackingUp, setManualBackingUp] = useState(false);

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

        <div className="min-w-0 space-y-3">
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
              <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                自动备份仅在手机端生效
              </p>
            )}

            {IS_NATIVE && loadingAuto && (
              <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                读取中...
              </p>
            )}

            {IS_NATIVE && !loadingAuto && autoBackups.length === 0 && (
              <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
