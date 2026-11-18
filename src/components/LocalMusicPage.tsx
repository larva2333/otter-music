"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  RefreshCw,
  Music,
  HardDrive,
  HardDriveDownload,
  WifiOff,
  FolderX,
  Plus,
  Trash2,
  ChevronDown,
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  LocalMusicPlugin,
  LocalMusicFile,
  SimplifiedConvertItem,
} from "@/plugins/local-music";
import { MusicTrack } from "@/types/music";
import { simplifyLocalFilesText } from "@/lib/utils/simplify-local-files";
import { normalizeLocalMusicFiles } from "@/lib/utils/local-track-meta";
import { MusicPlaylistView } from "./MusicPlaylistView";
import { cn } from "@/lib/utils";
import { PageLayout } from "./PageLayout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import toast from "react-hot-toast";
import { convertToMusicTrack } from "@/lib/utils/download";
import { useMusicStore } from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import { getPlayAllStartIndex } from "@/hooks/usePlayHelper";
import { useLocalMusicStore } from "@/store/local-music-store";
import { LocalMusicPermissionDialog } from "./LocalMusicPermissionDialog";
import { logger } from "@/lib/logger";
import { useNavigate } from "react-router-dom";

function mergeLocalMusicFiles(
  oldFiles: LocalMusicFile[],
  newFiles: LocalMusicFile[]
): LocalMusicFile[] {
  const oldMap = new Map(oldFiles.map((f) => [f.localPath, f]));
  return newFiles.map((newFile) => {
    const oldFile = oldMap.get(newFile.localPath);
    if (!oldFile) return newFile;
    return {
      ...oldFile,
      ...newFile,
      name: newFile.name || oldFile.name,
      artist: newFile.artist || oldFile.artist,
      album: newFile.album || oldFile.album,
      duration: newFile.duration || oldFile.duration,
      fileSize: newFile.fileSize || oldFile.fileSize,
      modifiedTime: newFile.modifiedTime || oldFile.modifiedTime,
    };
  });
}

interface LocalMusicPageProps {
  onBack?: () => void;
  onPlay: (track: MusicTrack, list: MusicTrack[], contextId?: string) => void;
  currentTrackId?: string;
  isPlaying: boolean;
  /** embedded：嵌在「歌单」页的 type 里，不带 PageLayout 头部 */
  embedded?: boolean;
}

export function LocalMusicPage({
  onBack,
  onPlay,
  currentTrackId,
  isPlaying,
  embedded,
}: LocalMusicPageProps) {
  /* --- 状态 --- */
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);

  // 删除状态（统一为数组，单删/批删复用）
  const [deleteTargets, setDeleteTargets] = useState<MusicTrack[]>([]);
  const [deleteLocalFile, setDeleteLocalFile] = useState(false);
  const singleDeleteTarget =
    deleteTargets.length === 1 ? deleteTargets[0] : null;

  // 扫描与排除目录状态
  const [scanDrawerOpen, setScanDrawerOpen] = useState(false);
  const [excludedFolders, setExcludedFolders] = useState<string[]>([]);
  const [excludedExpanded, setExcludedExpanded] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [excludedLoading, setExcludedLoading] = useState(false);

  // 繁转简状态
  const [t2sConverting, setT2sConverting] = useState(false);
  const [t2sPending, setT2sPending] = useState<SimplifiedConvertItem[]>([]);
  const [t2sConfirmOpen, setT2sConfirmOpen] = useState(false);

  /* --- Store --- */
  const { queue, currentIndex, skipToNext, isShuffle } = useMusicStore(
    useShallow((state) => ({
      queue: state.queue,
      currentIndex: state.currentIndex,
      skipToNext: state.skipToNext,
      isShuffle: state.isShuffle,
    }))
  );
  const { files, setFiles, updateFiles, setScanning, scanType } =
    useLocalMusicStore();
  const navigate = useNavigate();

  /* --- 扫描逻辑 --- */
  const performScan = useCallback(
    async (type: "quick" | "full") => {
      setIsLoading(true);
      setError(null);
      setScanning(true, type);

      try {
        const result =
          type === "quick"
            ? await LocalMusicPlugin.scanLocalMusic()
            : await LocalMusicPlugin.scanAllStorage();

        if (result.success) {
          const merged =
            type === "full"
              ? mergeLocalMusicFiles(files, result.files)
              : result.files;
          // 显示层繁转简：只改列表里的文字，不动文件
          const simplified = await simplifyLocalFilesText(
            normalizeLocalMusicFiles(merged)
          );
          setFiles(simplified);
          return simplified.length;
        }

        if (result.needManageStorage) {
          setShowPermissionDialog(true);
          throw new Error(result.error || "需要授予存储权限");
        }
        throw new Error(result.error || "扫描失败");
      } catch (err: any) {
        const message = err.message || String(err);
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
        setScanning(false);
      }
    },
    [files, setFiles, setScanning]
  );

  const initRef = useRef(false);
  useEffect(() => {
    // 只在首次挂载时决定要不要自动扫描；后续列表被清空/替换不应再触发
    if (initRef.current) return;
    initRef.current = true;
    if (files.length > 0) return;

    performScan("quick").catch((err) => {
      logger.error("LocalMusicPage", "Initial local music scan failed", err);
    });
  }, [files.length, performScan]);

  // 列表里的曲名/歌手/专辑统一按简体显示。幂等：转换后没有变化就返回原引用，
  // 因此不会反复触发；持久化数据恢复（hydration）后会再补一次。
  const simplifyingRef = useRef(false);
  useEffect(() => {
    if (simplifyingRef.current || files.length === 0) return;
    simplifyingRef.current = true;
    simplifyLocalFilesText(normalizeLocalMusicFiles(files))
      .then((simplified) => {
        if (simplified !== files) setFiles(simplified);
      })
      .catch((err) => {
        logger.error("LocalMusicPage", "Simplify local list failed", err);
      })
      .finally(() => {
        simplifyingRef.current = false;
      });
  }, [files, setFiles]);

  const handleScan = (type: "quick" | "full") => {
    if (isLoading) return;
    toast.promise(performScan(type), {
      loading: type === "full" ? "全盘扫描中..." : "正在扫描本地音乐...",
      success: (count) =>
        count === 0 ? "未找到本地音乐" : `找到 ${count} 首本地音乐`,
      error: (err) => err.message,
    });
  };

  /* --- 删除逻辑 --- */
  const removeLocalTrack = useCallback(
    async (track: MusicTrack, shouldDeleteFile: boolean) => {
      if (!track.url_id) throw new Error("缺少文件路径");
      try {
        if (shouldDeleteFile) {
          const result = await LocalMusicPlugin.deleteLocalMusic({
            localPath: track.url_id,
          });
          if (!result.success) throw new Error(result.error || "删除失败");
        }
        updateFiles((prev) => prev.filter((f) => f.localPath !== track.url_id));
        if (queue[currentIndex]?.id === track.id) skipToNext();
      } catch (error) {
        logger.error("LocalMusicPage", "Delete local track failed", error, {
          trackId: track.id,
          localPath: track.url_id,
        });
        throw error;
      }
    },
    [currentIndex, queue, skipToNext, updateFiles]
  );

  const resetDeleteState = () => {
    setDeleteTargets([]);
    setDeleteLocalFile(false);
  };

  const confirmDeleteTracks = async () => {
    if (!deleteTargets.length) return;
    const promise = Promise.all(
      deleteTargets.map((t) => removeLocalTrack(t, deleteLocalFile))
    ).then(resetDeleteState);

    toast.promise(promise, {
      loading: deleteLocalFile ? "正在删除文件..." : "正在移除...",
      success: deleteLocalFile ? "已删除文件" : "已从列表移除",
      error: (err) => err.message,
    });
    await promise;
  };

  /* --- 排除目录逻辑 --- */
  const loadExcludedFolders = useCallback(async () => {
    setExcludedLoading(true);
    try {
      const result = await LocalMusicPlugin.getExcludedFolders();
      if (result.success) setExcludedFolders(result.folders);
    } catch (err) {
      logger.warn("LocalMusicPage", "加载排除目录失败", { err });
    } finally {
      setExcludedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (scanDrawerOpen) loadExcludedFolders();
  }, [scanDrawerOpen, loadExcludedFolders]);

  const handlePickExcluded = useCallback(async () => {
    setPickingFolder(true);
    try {
      const result = await LocalMusicPlugin.pickExcludedDirectory();
      if (result.success && result.path) await loadExcludedFolders();
    } catch (err) {
      logger.warn("LocalMusicPage", "选择排除目录失败", { err });
    } finally {
      setPickingFolder(false);
    }
  }, [loadExcludedFolders]);

  const handleRemoveExcluded = useCallback(async (folder: string) => {
    try {
      await LocalMusicPlugin.removeExcludedFolder({ folder });
      setExcludedFolders((prev) => prev.filter((f) => f !== folder));
    } catch (err) {
      logger.warn("LocalMusicPage", "移除排除目录失败", { err, folder });
    }
  }, []);

  /* --- 繁转简逻辑 --- */
  const handleDetectTraditional = useCallback(async (targets: MusicTrack[]) => {
    if (!targets.length) {
      toast("没有选中的歌曲");
      return;
    }

    const toastId = toast.loading("正在检测繁体...");
    try {
      // 改内嵌标签要写文件，必须持有「所有文件管理」权限
      const permission = await LocalMusicPlugin.hasAllStoragePermission();
      if (!permission.hasPermission) {
        toast.dismiss(toastId);
        setShowPermissionDialog(true);
        return;
      }

      const result = await LocalMusicPlugin.convertToSimplified({
        localPaths: targets.map((t) => t.url_id),
        dryRun: true,
      });
      if (!result.success) throw new Error(result.error || "检测失败");

      const items = (result.items ?? []).filter((item) => item.wouldChange);
      toast.dismiss(toastId);
      // 预检读不到标签（异体字、特殊容器格式）时不再直接拦掉，
      // 交给用户决定是否强制试一次；转换内部对没变化的文件不会写入。
      setT2sPending(
        items.length > 0
          ? items
          : targets.map((t) => ({ path: t.url_id, wouldChange: false }))
      );
      setT2sConfirmOpen(true);
    } catch (err) {
      toast.dismiss(toastId);
      logger.warn("LocalMusicPage", "繁转简检测失败", err);
      toast.error(err instanceof Error ? err.message : "检测失败");
    }
  }, []);

  const handleConvertTraditional = useCallback(async () => {
    const paths = t2sPending.map((item) => item.path);
    if (paths.length === 0) return;

    setT2sConverting(true);
    const promise = LocalMusicPlugin.convertToSimplified({
      localPaths: paths,
      renameFiles: true,
    })
      .then(async (result) => {
        if (!result.success) throw new Error(result.error || "转换失败");
        // 文件名可能变了，重新走一次媒体库扫描拿到新路径
        await performScan("quick");
        setT2sConfirmOpen(false);
        setT2sPending([]);
        return result;
      })
      .finally(() => setT2sConverting(false));

    toast.promise(promise, {
      loading: "正在转换...",
      success: (result) => {
        if (result.failed) {
          const reason = result.items?.find((item) => item.error)?.error;
          return `已转换 ${result.changed} 首，${result.failed} 首失败${
            reason ? `：${reason}` : ""
          }`;
        }
        if (!result.changed) return "没有文件被修改（可能已是简体）";
        return `已转换 ${result.changed} 首`;
      },
      error: (err) => (err instanceof Error ? err.message : "转换失败"),
    });
  }, [performScan, t2sPending]);

  /* --- 数据转换与播放 --- */
  const tracks = useMemo(
    () =>
      files
        .map((file, index) => ({ file, index }))
        .sort(
          (a, b) =>
            (b.file.modifiedTime ?? -Infinity) -
              (a.file.modifiedTime ?? -Infinity) || a.index - b.index
        )
        .map(({ file }) => convertToMusicTrack(file)),
    [files]
  );

  const handlePlay = (track: MusicTrack | null, index?: number) => {
    const targetTrack =
      track ||
      (index !== undefined
        ? tracks[index]
        : tracks[getPlayAllStartIndex(tracks.length, isShuffle)]);
    if (targetTrack) onPlay(targetTrack, tracks, "local");
  };

  /* --- 渲染部分 --- */
  const isEmpty = files.length === 0;

  const fullScanButton = (
    <button
      onClick={() => setScanDrawerOpen(true)}
      disabled={isLoading}
      className={cn(
        "flex items-center gap-1.5 px-3 h-8 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors",
        isLoading && "opacity-50 cursor-not-allowed"
      )}
    >
      <HardDrive className="h-3.5 w-3.5 shrink-0" />
      全盘扫描
    </button>
  );

  const body = (
    <>
      {/* 状态视图与内容视图 */}
      {isLoading && isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <RefreshCw className="h-10 w-10 text-primary/80 animate-spin" />
          <p className="text-foreground text-sm font-medium">
            {scanType === "full" ? "正在全盘扫描..." : "正在扫描本地音乐..."}
          </p>
        </div>
      ) : error && isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <Music className="h-14 w-14 text-muted-foreground/30 mb-4" />
          <p className="text-sm mb-2">{error}</p>
          <button
            onClick={() => handleScan("quick")}
            className="px-4 py-2 bg-primary text-white rounded-lg"
          >
            重试
          </button>
        </div>
      ) : (
        <MusicPlaylistView
          title="本地音乐"
          tracks={tracks}
          icon={<HardDriveDownload className="h-8 w-8 text-primary/80" />}
          onPlay={handlePlay}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          onRemove={(track) => setDeleteTargets([track])}
          onBatchRemove={setDeleteTargets}
          onBatchConvertToSimplified={handleDetectTraditional}
          removeLabel="删除"
          confirmRemove={false}
          action={
            embedded ? (
              <>
                {fullScanButton}
                <button
                  onClick={() => navigate("/playlist/__offline__")}
                  className="flex items-center gap-1.5 px-3 h-8 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <WifiOff size={14} className="shrink-0" />
                </button>
              </>
            ) : (
              <button
                onClick={() => navigate("/playlist/__offline__")}
                className="flex items-center gap-1.5 px-3 h-8 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <WifiOff size={14} className="shrink-0" />
              </button>
            )
          }
        />
      )}

      {/* 弹窗及抽屉 */}
      <LocalMusicPermissionDialog
        open={showPermissionDialog}
        onOpenChange={setShowPermissionDialog}
      />

      <Dialog
        open={deleteTargets.length > 0}
        onOpenChange={(open) => !open && resetDeleteState()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {singleDeleteTarget
                ? `删除《${singleDeleteTarget.name}》`
                : `删除选中的 ${deleteTargets.length} 首歌曲`}
            </DialogTitle>
            <DialogDescription>
              {deleteLocalFile
                ? "将从手机上删除音频文件，无法恢复；正在播放的歌曲会跳到下一首。"
                : "仅从当前列表移除，不会动手机上的文件，重新扫描后会再次出现。"}
            </DialogDescription>
          </DialogHeader>
          {/* 整行可点：16px 的勾选框在手机上很难点中，点文字也要能勾上 */}
          <div
            data-testid="delete-local-file-row"
            role="checkbox"
            aria-checked={deleteLocalFile}
            aria-label="删除本地文件"
            tabIndex={0}
            onClick={() => setDeleteLocalFile((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                setDeleteLocalFile((v) => !v);
              }
            }}
            className="flex items-center gap-2.5 min-h-11 -mx-2 px-2 rounded-md cursor-pointer select-none active:bg-muted/50"
          >
            <Checkbox
              data-testid="delete-local-file"
              className="size-5"
              checked={deleteLocalFile}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={(checked) =>
                setDeleteLocalFile(checked === true)
              }
            />
            <span className="text-sm">删除本地文件</span>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={resetDeleteState}>
              取消
            </Button>
            <Button
              variant="destructive"
              data-testid="confirm-local-delete"
              onClick={confirmDeleteTracks}
            >
              {deleteLocalFile
                ? deleteTargets.length > 1
                  ? `删除 ${deleteTargets.length} 个文件`
                  : "删除文件"
                : "从列表移除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={t2sConfirmOpen} onOpenChange={setT2sConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>写入简体标签</DialogTitle>
            <DialogDescription>
              {t2sPending.some((item) => item.wouldChange) ? (
                <>
                  列表显示已经是简体，这一步会把简体写进文件本身：修改{" "}
                  {t2sPending.length} 首歌曲的内嵌标签（FLAC 的
                  TITLE/ARTIST/ALBUM）并重命名文件。音频数据不会被重新编码。
                  文件名变更后旧播放列表路径会失效，且操作不可撤销。
                </>
              ) : (
                <>
                  预检没有检测到繁体中文字（可能是异体字或标签读取差异）。仍要对这{" "}
                  {t2sPending.length}{" "}
                  首写入简体标签吗？已是简体的文件不会被改动。
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setT2sConfirmOpen(false)}
              disabled={t2sConverting}
            >
              取消
            </Button>
            <Button
              data-testid="confirm-traditional"
              onClick={handleConvertTraditional}
              disabled={t2sConverting}
            >
              {t2sConverting ? "转换中..." : "开始转换"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Drawer open={scanDrawerOpen} onOpenChange={setScanDrawerOpen}>
        <DrawerContent className="outline-none">
          <DrawerHeader className="px-5 pt-6 pb-2">
            <DrawerTitle className="text-lg font-semibold text-center">
              全盘扫描
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-5 py-4 space-y-4">
            <ExcludedFoldersSection
              folders={excludedFolders}
              loading={excludedLoading}
              picking={pickingFolder}
              isExpanded={excludedExpanded}
              onToggleExpand={() => setExcludedExpanded((v) => !v)}
              onPick={handlePickExcluded}
              onRemove={handleRemoveExcluded}
            />
            <button
              type="button"
              data-testid="confirm-full-scan"
              onClick={() => {
                setScanDrawerOpen(false);
                handleScan("full");
              }}
              disabled={isLoading}
              className="w-full h-10 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <HardDrive className="h-4 w-4" />
              {isLoading ? "扫描中..." : "开始扫描"}
            </button>
          </div>
          <div className="h-6" />
        </DrawerContent>
      </Drawer>

      {/* 扫描遮罩：列表已有内容时也要盖住整页。扫描是「一次性 setFiles」，
          没有遮罩的话结果会在任意时刻突然替换列表，视觉上像页面自己跳了一下。 */}
      {isLoading && !isEmpty && (
        <div
          data-testid="scan-overlay"
          aria-busy="true"
          className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur-sm"
        >
          <RefreshCw className="h-10 w-10 text-primary/80 animate-spin" />
          <p className="text-sm font-medium text-foreground">
            {scanType === "full" ? "正在全盘扫描..." : "正在扫描本地音乐..."}
          </p>
          <p className="text-xs text-muted-foreground">
            请保持应用在前台，扫描完成后会自动更新列表
          </p>
        </div>
      )}
    </>
  );

  if (embedded) return body;

  return (
    <PageLayout title="本地音乐" onBack={onBack} action={fullScanButton}>
      {body}
    </PageLayout>
  );
}

/* --- 排除目录子组件保持原样但结构紧凑 --- */
interface ExcludedFoldersSectionProps {
  folders: string[];
  loading: boolean;
  picking: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onPick: () => void;
  onRemove: (folder: string) => void;
}

function ExcludedFoldersSection({
  folders,
  loading,
  picking,
  isExpanded,
  onToggleExpand,
  onPick,
  onRemove,
}: ExcludedFoldersSectionProps) {
  const count = folders.length;
  return (
    <div className="rounded-lg border border-border/50 bg-card/40">
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
      >
        <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0 flex-[0_0_28px] min-w-7 min-h-7">
          <div className="h-3.5 w-3.5 shrink-0 flex-[0_0_14px] min-w-3.5 min-h-3.5">
            <FolderX className="h-full w-full text-primary" />
          </div>
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm text-foreground">排除目录</span>
          <span className="text-xs text-muted-foreground truncate">
            {count > 0 ? `已排除 ${count} 个目录` : "使用默认通话录音黑名单"}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            isExpanded && "rotate-180"
          )}
        />
      </button>

      <div
        className={cn(
          "grid transition-all duration-200 ease-in-out",
          isExpanded
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/40">
            <button
              type="button"
              data-testid="excluded-folder-pick"
              onClick={onPick}
              disabled={picking || loading}
              className="w-full h-8 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded-md transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              {picking ? "选择中..." : "选择目录"}
            </button>
            <div
              data-testid="excluded-folder-list"
              className="space-y-1.5 max-h-56 overflow-y-auto"
            >
              {count === 0 && !loading && (
                <div className="text-xs text-muted-foreground text-center py-3">
                  暂无自定义排除目录
                </div>
              )}
              {folders.map((folder) => (
                <div
                  key={folder}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-muted/40 border border-border/40"
                >
                  <span className="text-xs truncate flex-1" title={folder}>
                    {folder}
                  </span>
                  <button
                    type="button"
                    data-testid="excluded-folder-remove"
                    onClick={() => onRemove(folder)}
                    className="p-1 text-muted-foreground hover:text-foreground shrink-0"
                    title="移除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
