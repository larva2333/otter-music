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

export function UpdateDialog({ open, onOpenChange }: UpdateDialogProps) {
  const {
    currentVersion,
    latestVersionInfo,
    hasUpdate,
    isChecking,
    checkUpdate,
    lastCheckTime,
  } = useAppStore();

  const neverChecked = lastCheckTime === 0;

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

    const url =
      source === "proxy"
        ? latestVersionInfo.downloadUrl
        : latestVersionInfo.directUrl;

    setFailedSource(null);
    setDownloading({ source, percent: 0 });

    try {
      await downloadAndInstallApk({
        url,
        expectedSize: latestVersionInfo.size,
        onProgress: (percent) => setDownloading({ source, percent }),
      });
    } catch (err) {
      logger.error("update", "应用内下载更新包失败", err as Error, { source });
      setFailedSource(source);
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`下载失败：${message}`);
    } finally {
      setDownloading(null);
    }
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
            alt="Otter Music"
            className="w-16 h-16 rounded-xl shadow"
          />
          <DrawerTitle className="font-bold mt-2">Otter Music</DrawerTitle>
          <div className="text-xs font-mono text-muted-foreground">
            {currentVersion}
          </div>
        </DrawerHeader>

        <div className="space-y-4 overflow-y-auto px-4 pb-5">
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">版本更新</span>
              {/* Badge 支持点击检查更新，带 Icon 和 Loading 动画 */}
              <Badge
                variant={hasUpdate ? "default" : "secondary"}
                className={`gap-1 cursor-pointer select-none ${isChecking ? "opacity-70" : ""}`}
                onClick={() => !isChecking && checkUpdate(false)}
              >
                <RefreshCw
                  className={`h-3 w-3 ${isChecking ? "animate-spin" : ""}`}
                />
                {isChecking
                  ? "检查中..."
                  : neverChecked
                    ? "检查更新"
                    : hasUpdate
                      ? `新版本 ${latestVersionInfo?.latestVersion}`
                      : "已是最新版本"}
              </Badge>
            </div>

            {/* 不管是否为最新版本，只要有数据就显示更新日志 */}
            {latestVersionInfo && (
              <div className="text-xs text-muted-foreground space-y-1">
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

                <div className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed bg-muted/40 p-2 rounded">
                  {latestVersionInfo.changelog}
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
