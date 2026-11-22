"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Copy, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { SettingItem } from "./SettingItem";
import { writeClipboardText } from "@/lib/clipboard";
import { LOG_LEVELS, logger, type LogLevel } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { toastUtils } from "@/lib/utils/toast";
import { GithubUrl } from "@/types";

export function IssueLogs() {
  const [isOpen, setIsOpen] = useState(false);
  // 默认全选：想看什么级别就取消其他级别，不用先想起来去开 info
  const [selectedLevels, setSelectedLevels] = useState<LogLevel[]>([
    ...LOG_LEVELS,
  ]);
  const [logs, setLogs] = useState({ count: 0, all: "", recent: "" });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const buildTexts = (levels: LogLevel[]) => ({
    count: logger.getLogs().length,
    all: logger.exportText({ levels }),
    recent: logger.exportText({ recent: true, levels }),
  });

  const handleOpen = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setLogs(buildTexts(selectedLevels));
      // 打开后滚动到底部
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
        }
      }, 0);
    }
  };

  const toggleLevel = (level: LogLevel) => {
    const next = selectedLevels.includes(level)
      ? selectedLevels.filter((item) => item !== level)
      : LOG_LEVELS.filter(
          (item) => selectedLevels.includes(item) || item === level
        );
    setSelectedLevels(next);
    setLogs(buildTexts(next));
  };

  const handleAction = async (action: "copy-recent" | "copy-all" | "clear") => {
    if (action === "clear") {
      logger.clear();
      setLogs({ count: 0, all: "", recent: "" });
      toastUtils.success("日志已清空");
      return;
    }

    const isRecent = action === "copy-recent";
    const ok = await writeClipboardText(isRecent ? logs.recent : logs.all);
    if (ok) {
      toastUtils.success(`${isRecent ? "本次" : "全部"}日志已复制`);
    } else {
      toastUtils.error("操作失败或无内容");
    }
  };

  return (
    <>
      <SettingItem
        icon={AlertTriangle}
        title="诊断日志"
        subtitle="用于排查运行异常或提交反馈"
        action={
          <span className="text-xs text-muted-foreground">
            {logs.count ? `${logs.count} 条` : "暂无"}
          </span>
        }
        onClick={() => handleOpen(true)}
        showChevron
      />

      <Drawer open={isOpen} onOpenChange={handleOpen}>
        <DrawerContent className="max-h-[85vh] flex flex-col">
          <DrawerHeader>
            <DrawerTitle>诊断日志</DrawerTitle>
            <DrawerDescription>
              复制后粘贴到 GitHub issue，仅保留最近 100 条
            </DrawerDescription>
          </DrawerHeader>

          {/* 级别筛选：多选，点一下切换该级别；复制按钮复制的是筛选后的文本 */}
          <div className="flex flex-wrap gap-2 px-4 pb-3">
            {LOG_LEVELS.map((level) => {
              const active = selectedLevels.includes(level);
              return (
                <button
                  key={level}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleLevel(level)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground"
                  )}
                >
                  {level}
                </button>
              );
            })}
          </div>

          <div className="px-4 pb-4 overflow-hidden">
            <Textarea
              ref={textareaRef}
              readOnly
              value={logs.all || "暂无日志记录"}
              className="h-[45vh] w-full resize-none overflow-y-auto bg-muted/30 font-mono text-xs leading-relaxed"
            />
          </div>

          <DrawerFooter className="grid grid-cols-2 gap-2 pt-0 sm:flex sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => window.open(`${GithubUrl}/issues`, "_blank")}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              去反馈
            </Button>
            <Button
              variant="outline"
              onClick={() => handleAction("clear")}
              disabled={!logs.all}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              清空
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleAction("copy-all")}
              disabled={!logs.all}
            >
              <Copy className="h-4 w-4 mr-2" />
              复制全部
            </Button>
            <Button
              variant="default"
              onClick={() => handleAction("copy-recent")}
              disabled={!logs.recent}
            >
              <Copy className="h-4 w-4 mr-2" />
              复制本次
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}
