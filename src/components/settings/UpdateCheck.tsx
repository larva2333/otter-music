import { useState, type ReactNode } from "react";
import { SettingItem } from "./SettingItem";
import {
  Download,
  Github,
  Loader2,
  Milestone,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { Badge } from "@/components/ui/badge";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { downloadAndInstallApk } from "@/lib/apk-update";
import { logger } from "@/lib/logger";

interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type DownloadSource = "proxy" | "direct";

/**
 * 更新说明的逐行渲染。
 *
 * 原来的 `whitespace-pre-wrap` 有个问题：一条说明换行后，第二行会顶到最左边，
 * 和第一行的第一个字（"·"/"-" 后面的正文）对不齐，看着像另起一条。
 * 这里把行首标记单独放进定宽列，正文整块右移，折行自然与首字对齐。
 */
function ChangelogText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <div className="text-xs leading-relaxed">
      {lines.map((line, index) => {
        const match = line.match(/^(\s*(?:[-*•·]|\d+[.)、]))\s+/);
        if (!match) {
          return (
            <div key={index} className="whitespace-pre-wrap break-words">
              {line || "\u00A0"}
            </div>
          );
        }
        return (
          <div key={index} className="flex gap-1">
            <span className="w-3 shrink-0 text-right opacity-60">
              {match[1].trim()}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
              {line.slice(match[0].length)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function UpdateDialog({ open, onOpenChange }: UpdateDialogProps) {
  const {
    currentVersion,
    latestVersionInfo,
    hasUpdate,
    isChecking,
    lastCheckTime,
    checkUpdate,
  } = useAppStore();

  // 正在下载的源与进度；同时只允许一个下载任务
  const [downloading, setDownloading] = useState<{
    source: DownloadSource;
    percent: number;
  } | null>(null);
  // 上次失败（或需要授权）的源，按钮显示「重试」
  const [failedSource, setFailedSource] = useState<DownloadSource | null>(null);

  const startDownload = async (source: DownloadSource) => {
    // 已是最新版本时不允许下载：latestVersionInfo 只是更新日志缓存，
    // 与「是否有新版本」是两件事
    if (!latestVersionInfo || !hasUpdate || downloading) return;

    // 国内加速按顺序轮换镜像（兼容老后端未返回 mirrorUrls 的情况）；
    // GitHub 直连只有一个地址。
    const urls =
      source === "proxy"
        ? latestVersionInfo.mirrorUrls?.length
          ? latestVersionInfo.mirrorUrls
          : [latestVersionInfo.downloadUrl]
        : [latestVersionInfo.directUrl];

    setFailedSource(null);
    setDownloading({ source, percent: 0 });

    let lastError: unknown;
    for (const url of urls) {
      try {
        await downloadAndInstallApk({
          url,
          expectedSize: latestVersionInfo.size,
          onProgress: (percent) => setDownloading({ source, percent }),
        });
        setDownloading(null);
        return; // 成功即结束（内部已拉起安装器）
      } catch (err) {
        lastError = err;
        // 权限未授予是确定性的，换镜像也没用，直接停
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          err.code === "NEED_INSTALL_PERMISSION"
        ) {
          break;
        }
        logger.warn("update", "镜像下载失败，尝试下一个", err as Error, {
          source,
          host: (() => {
            try {
              return new URL(url).host;
            } catch {
              return url;
            }
          })(),
        });
      }
    }

    logger.error("update", "应用内下载更新包失败", lastError as Error, {
      source,
    });
    setFailedSource(source);
    const message =
      lastError instanceof Error ? lastError.message : String(lastError);
    toast.error(`下载失败：${message}`);
    setDownloading(null);
  };

  const renderButtonContent = (
    source: DownloadSource,
    label: string,
    icon: ReactNode
  ) => {
    const active = downloading?.source === source;

    if (active) {
      return (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          下载中 {downloading.percent}%
        </>
      );
    }

    if (failedSource === source) {
      return (
        <>
          <RotateCcw className="mr-2 h-4 w-4" />
          下载失败，点击重试
        </>
      );
    }

    return (
      <>
        {icon}
        {label}
      </>
    );
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="items-center pt-4">
          <img
            src="/favicon.svg"
            alt="水獭音乐"
            className="w-16 h-16 rounded-xl shadow"
          />
          <DrawerTitle className="font-bold mt-2">水獭音乐</DrawerTitle>
          <div className="text-xs font-mono text-muted-foreground">
            {currentVersion}
          </div>
        </DrawerHeader>

        <div className="space-y-4 overflow-y-auto px-4 pb-5">
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">版本更新</span>
              {/* 打开弹窗不再自动检查，按钮文案固定「检查更新」，只有检查中才临时变文案 */}
              <Badge
                variant={hasUpdate ? "default" : "secondary"}
                className={`gap-1 cursor-pointer select-none ${isChecking ? "opacity-70" : ""}`}
                onClick={() => !isChecking && checkUpdate(false)}
              >
                <RefreshCw
                  className={`h-3 w-3 ${isChecking ? "animate-spin" : ""}`}
                />
                {isChecking ? "检查中..." : "检查更新"}
              </Badge>
            </div>

            {/* 最近检查时间：手动检查与启动时的自动检查都会写入 lastCheckTime */}
            {lastCheckTime > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>最近检查</span>
                <span>
                  {format(new Date(lastCheckTime), "yyyy-MM-dd HH:mm")}
                </span>
              </div>
            )}

            {/* 不管是否为最新版本，只要有数据就显示更新日志 */}
            {latestVersionInfo && (
              <div className="text-xs text-muted-foreground space-y-1">
                {/* 徽标不再显示版本号，这里补一行，避免丢失「最新版本是哪个」 */}
                <div className="flex justify-between">
                  <span>最新版本</span>
                  <span className="font-mono">
                    {latestVersionInfo.latestVersion}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>
                    {format(
                      new Date(latestVersionInfo.publishDate),
                      "yyyy-MM-dd HH:mm"
                    )}
                  </span>
                  <span>
                    {(latestVersionInfo.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>

                <div className="max-h-32 overflow-y-auto bg-muted/40 p-2 rounded">
                  <ChangelogText text={latestVersionInfo.changelog} />
                </div>
              </div>
            )}

            {/* 仅在有新版本时才显示下载按钮；已是最新版本时只展示更新日志 */}
            {latestVersionInfo && hasUpdate && (
              <>
                <Button
                  className="w-full"
                  disabled={!!downloading}
                  onClick={() => startDownload("proxy")}
                >
                  {renderButtonContent(
                    "proxy",
                    "国内加速下载",
                    <Download className="mr-2 h-4 w-4" />
                  )}
                </Button>

                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!!downloading}
                  onClick={() => startDownload("direct")}
                >
                  {renderButtonContent(
                    "direct",
                    "从 GitHub 下载",
                    <Github className="mr-2 h-4 w-4" />
                  )}
                </Button>
              </>
            )}
          </div>

          <Footer />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function UpdateCheck() {
  const [showDialog, setShowDialog] = useState(false);
  const { currentVersion, hasUpdate } = useAppStore();

  return (
    <>
      <SettingItem
        icon={Milestone}
        title="版本更新"
        onClick={() => setShowDialog(true)}
        action={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {currentVersion}
            </span>

            {hasUpdate && (
              <Badge variant="destructive" className="gap-1">
                新版本
              </Badge>
            )}
          </div>
        }
        showChevron
      />

      <UpdateDialog open={showDialog} onOpenChange={setShowDialog} />
    </>
  );
}
