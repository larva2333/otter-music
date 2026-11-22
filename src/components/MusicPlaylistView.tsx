import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Play, Search, X } from "lucide-react";
import { filterTracks } from "@/lib/utils/filter-tracks";
import { MusicTrackList } from "./MusicTrackList";
import { Input } from "@/components/ui/input";
import { useState, useMemo, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { MusicCover } from "./MusicCover";
import { PlaylistCover } from "./PlaylistCover";
import { PlaylistOperations } from "./PlaylistOperations";
import { MusicTrack } from "@/types/music";
import { useMusicStore } from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import { useDownloadStore } from "@/store/download-store";
import { buildDownloadKey } from "@/lib/utils/download";
import toast from "react-hot-toast";
import { createTrackFromUrl, deduplicateTracks } from "@/lib/utils/music";
import { toastUtils } from "@/lib/utils/toast";
import { exportPlaylist } from "@/lib/utils/playlist-backup";
import { musicApi } from "@/lib/music-api";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from "@/components/ui/drawer";
import { Label } from "@/components/ui/label";

import { format } from "date-fns";
import { t2s } from "@/lib/utils/t2s";
import { AddByUrlDrawer } from "./AddByUrlDrawer";
import { useSearchBackClear } from "@/hooks/useSearchBackClear";
import { logger } from "@/lib/logger";

interface MusicPlaylistViewProps {
  title: string;
  tracks: MusicTrack[];
  playlistId?: string;
  /**
   * index 可选：
   * - 传入 index：播放指定歌曲
   * - 不传 index：播放全部（由上层/Store 决定起始点，如随机播放）
   */
  onPlay: (track: MusicTrack | null, index?: number) => void;
  onRemove?: (track: MusicTrack, silent?: boolean) => void | Promise<void>;
  onBatchRemove?: (tracks: MusicTrack[]) => void;
  onRename?: (playlistId: string, newName: string) => void;
  onDelete?: (playlistId: string) => void;
  description?: string;
  createdAt?: number;
  currentTrackId?: string;
  isPlaying?: boolean;
  action?: React.ReactNode;
  coverUrl?: string;
  removeLabel?: string;
  confirmRemove?: boolean;
  icon?: React.ReactNode;
  /**
   * 隐藏整个头部（封面 / 标题 / 播放按钮 / 搜索框），只留纯列表。
   * 推荐流这类「内容即全部」的页面用，避免一块与内容无关的表头占掉半屏。
   */
  hideHeader?: boolean;
  /** 行首显示歌曲封面（代替序号），与 hideHeader 搭配使用 */
  showTrackCover?: boolean;
  /**
   * 头部右上角的操作区（绝对定位）。
   * 「全盘扫描」这类页面级操作放这里，不跟播放按钮挤在标题下方那一行。
   */
  headerRight?: React.ReactNode;
  /**
   * 标题文字样式覆盖。默认与「喜欢」页一致（text-base font-bold tracking-tight）；
   * 「播放列表」这类需要与「我的歌单」标题对齐的页面可传入自己的样式。
   */
  titleClassName?: string;
  /**
   * 嵌入「歌单」tab 的子页用紧凑头部：不显示 80px 大图标，标题左对齐到
   * 与「我的歌单」同一条基线（px-5 + px-1），操作按钮仍在标题行右侧。
   */
  compactHeader?: boolean;
  /** 紧凑行距 + 列表底部收边线（播放列表这类纯队列视图用） */
  dense?: boolean;
  /**
   * 外层滚动容器：传入后本组件不再自带滚动区（去掉 overflow-y-auto），
   * 列表直接用外层容器做虚拟滚动的滚动源。嵌入别人家滚动页（如发现页
   * 的推荐分类）时必须传，否则内层会出现一个几乎不可滚的滚动容器，
   * 把触摸手势吃掉，外层页面划不动。
   */
  externalScrollRef?: React.RefObject<HTMLElement | null>;
  /** 增量展示（上滑加载）：首屏只渲染前 N 行，滚动到底部附近再补一批 */
  incrementalBatch?: number;
}

export function MusicPlaylistView({
  title,
  tracks,
  playlistId,
  onPlay,
  onRemove,
  onBatchRemove,
  onRename,
  onDelete,
  description,
  createdAt,
  currentTrackId,
  isPlaying,
  action,
  coverUrl,
  removeLabel,
  confirmRemove,
  icon,
  hideHeader,
  showTrackCover,
  headerRight,
  titleClassName = "text-base font-bold tracking-tight",
  compactHeader = false,
  dense = true,
  externalScrollRef,
  incrementalBatch,
}: MusicPlaylistViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isCoverDialogOpen, setIsCoverDialogOpen] = useState(false);
  const [isAddByUrlOpen, setIsAddByUrlOpen] = useState(false);
  const [coverUrlInput, setCoverUrlInput] = useState("");
  const [dedupeSelectedIds, setDedupeSelectedIds] = useState<
    Set<string> | undefined
  >();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 搜索框聚焦时，返回键＝清空内容并收起键盘（一步到位），不退出到桌面
  const dismissSearch = useCallback(() => {
    searchInputRef.current?.blur();
    setIsSearchFocused(false);
  }, []);
  useSearchBackClear({
    focused: isSearchFocused,
    value: searchQuery,
    onClear: () => setSearchQuery(""),
    onDismiss: dismissSearch,
  });

  const playlists = useMusicStore(useShallow((state) => state.playlists));
  const playlist = playlists.find((p) => p.id === playlistId);
  const isPersonalPlaylist = useMemo(() => {
    return !!playlist;
  }, [playlist]);

  const handleReorder = (newOrder: MusicTrack[]) => {
    if (playlistId && isPersonalPlaylist) {
      useMusicStore
        .getState()
        .replaceActivePlaylistTracks(playlistId, newOrder);
    }
  };

  const filteredTracks = useMemo(
    () => filterTracks(tracks, searchQuery),
    [tracks, searchQuery]
  );

  const handleDeduplicate = () => {
    if (!playlistId) return;

    const musicStore = useMusicStore.getState();
    const downloadStore = useDownloadStore.getState();

    const result = deduplicateTracks(
      tracks,
      (id) => musicStore.isFavorite(id),
      (track) =>
        downloadStore.hasRecord(buildDownloadKey(track.source, track.id))
    );

    if (result.removedCount === 0) {
      toastUtils.info("没有发现重复歌曲");
      return;
    }

    // 自动合并喜欢状态（元数据修正，非删除操作）
    if (result.tracksToLike.length > 0) {
      result.tracksToLike.forEach((track) => {
        musicStore.addToFavorites(track);
      });
      toast.success(`已合并 ${result.tracksToLike.length} 首歌曲的喜欢状态`);
    }

    setDedupeSelectedIds(new Set(result.trackIdsToDelete));
    toast.success(`发现 ${result.removedCount} 首重复歌曲，已自动选中`);
  };

  const handleSetCover = () => {
    setCoverUrlInput(coverUrl || "");
    setIsCoverDialogOpen(true);
  };

  const handleUseFirstTrackCover = async () => {
    const firstTrack = tracks[0];
    if (firstTrack?.pic_id) {
      try {
        // 传完整曲目：本地曲目要靠歌名/歌手在线反查封面，只给路径查不到
        const url = await musicApi.getPic(
          firstTrack.pic_id,
          firstTrack.source,
          800,
          firstTrack
        );
        if (url) {
          setCoverUrlInput(url);
        } else {
          toast.error("获取封面失败");
        }
      } catch (e) {
        logger.error("MusicPlaylistView", "Get cover failed", e, {
          playlistId,
          trackId: firstTrack.id,
          source: firstTrack.source,
        });
        toast.error("获取封面出错");
      }
    } else {
      toast.error("第一首歌曲没有封面");
    }
  };

  const handleSaveCover = () => {
    if (!playlistId) return;

    // 如果为空，则是清除封面
    if (coverUrlInput && !coverUrlInput.startsWith("http")) {
      toast.error("请输入有效的图片链接");
      return;
    }

    useMusicStore
      .getState()
      .updatePlaylist(playlistId, { coverUrl: coverUrlInput });
    setIsCoverDialogOpen(false);
    toast.success("封面设置成功");
  };

  const handleAddByUrl = (title: string, url: string, artist?: string) => {
    if (!playlistId) return;

    const track = createTrackFromUrl(title, url, artist);
    useMusicStore.getState().addToPlaylist(playlistId, track);
    toast.success("添加成功");
  };

  return (
    <div
      ref={scrollContainerRef}
      data-page-scroll={externalScrollRef ? undefined : ""}
      className={cn(
        "flex flex-col",
        // 有外层滚动容器时不再自己滚动（高度随内容生长），否则保持原有滚动区
        externalScrollRef ? "w-full" : "flex-1 min-h-0 overflow-y-auto"
      )}
    >
      {/* Header：默认与「喜欢」页一致；compactHeader 嵌在「歌单」tab 时去掉大图标，
          标题左边缘与「我的歌单」对齐（px-6 = 外层 px-5 + 标题行 px-1） */}
      {hideHeader ? null : (
        <div
          className={cn(
            "border-b bg-muted/10 relative",
            compactHeader ? "px-6 pt-1 pb-3" : "p-4 flex gap-4 items-end"
          )}
        >
          <div
            className={cn(
              "h-20 w-20 bg-primary/10 rounded-lg flex items-center justify-center shadow-sm border overflow-hidden shrink-0 flex-[0_0_80px] min-w-20 min-h-20",
              compactHeader && "hidden"
            )}
          >
            {playlist ? (
              <PlaylistCover
                playlist={playlist}
                className="h-full w-full"
                iconClassName="h-8 w-8 text-primary/80"
                fallbackIcon={icon}
              />
            ) : (
              <MusicCover
                src={coverUrl}
                alt={title}
                className="h-full w-full"
                iconClassName="h-8 w-8 text-primary/80"
                fallbackIcon={icon}
              />
            )}
          </div>
          <div
            className={cn(
              "flex-1 flex flex-col gap-1",
              compactHeader ? "" : "self-stretch justify-center"
            )}
          >
            <h2
              className={cn(
                titleClassName,
                "line-clamp-1",
                compactHeader &&
                  "text-base font-bold tracking-wide text-foreground",
                // 右上角有操作按钮时给标题让位，避免长标题压到按钮下面
                headerRight && "pr-24"
              )}
            >
              {t2s(title)}
            </h2>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <span>{tracks.length} 首歌曲</span>
              {createdAt && (
                <>
                  <span>•</span>
                  <span>{format(createdAt, "yyyy-MM-dd")}</span>
                </>
              )}
              {description && (
                <>
                  <span>•</span>
                  <span>{t2s(description)}</span>
                </>
              )}
            </div>
            <div className="pt-1 flex gap-2 items-center">
              <Button
                onClick={() => onPlay(null)}
                className="rounded-full px-3 h-7"
                size="sm"
              >
                <Play className="size-3 fill-current" />
              </Button>
              {action}
              {playlistId && (
                <PlaylistOperations
                  onRename={
                    onRename
                      ? () => {
                          const newName = window.prompt(
                            "请输入新歌单名称",
                            t2s(title)
                          );
                          if (newName && newName.trim()) {
                            onRename(playlistId, newName.trim());
                          }
                        }
                      : undefined
                  }
                  onDeduplicate={handleDeduplicate}
                  onExport={() => exportPlaylist(t2s(title), tracks)}
                  onDelete={
                    onDelete
                      ? async () => {
                          if (
                            await confirmDialog({
                              title: `确定删除歌单「${t2s(title)}」吗？`,
                              destructive: true,
                              confirmText: "删除",
                            })
                          ) {
                            onDelete(playlistId);
                          }
                        }
                      : undefined
                  }
                  onSetCover={handleSetCover}
                  onAddByUrl={
                    isPersonalPlaylist
                      ? () => setIsAddByUrlOpen(true)
                      : undefined
                  }
                />
              )}

              <div className="relative ml-auto flex-1 min-w-0">
                <Search className="absolute left-2 top-2.5 h-3 w-3 text-muted-foreground md:h-4 md:w-4 md:top-2" />
                <Input
                  ref={searchInputRef}
                  placeholder="搜索..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => setIsSearchFocused(false)}
                  className={cn(
                    "pl-8 h-8 text-xs md:h-9 md:text-sm w-full",
                    searchQuery && "pr-8"
                  )}
                />
                {/* 有内容时显示清除按钮，一键清空搜索词 */}
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                    aria-label="清除搜索"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-muted-foreground/20 text-muted-foreground hover:bg-muted-foreground/30 hover:text-foreground transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {headerRight && (
            <div className="absolute right-3 top-3 flex items-center gap-1">
              {headerRight}
            </div>
          )}
        </div>
      )}

      {/* List */}
      <div className={cn("flex-1 min-h-0", !hideHeader && "bg-background/50")}>
        <MusicTrackList
          dense={dense}
          tracks={filteredTracks}
          scrollContainerRef={externalScrollRef ?? scrollContainerRef}
          incrementalBatch={incrementalBatch}
          onPlay={(track) =>
            onPlay(
              track,
              tracks.findIndex((t) => t.id === track.id)
            )
          }
          playlistId={playlistId}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          onRemove={onRemove}
          onBatchRemove={onBatchRemove}
          removeLabel={removeLabel}
          confirmRemove={confirmRemove}
          onReorder={
            isPersonalPlaylist && !searchQuery ? handleReorder : undefined
          }
          preselectedIds={dedupeSelectedIds}
          showCover={showTrackCover}
          hideHeader={hideHeader}
          onSelectionModeChange={(active) => {
            if (!active) setDedupeSelectedIds(undefined);
          }}
        />
      </div>

      <Drawer open={isCoverDialogOpen} onOpenChange={setIsCoverDialogOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle>设置封面</DrawerTitle>
          </DrawerHeader>
          <div className="grid gap-4 px-4 pb-4">
            <div className="grid gap-2">
              <Label htmlFor="coverUrl">封面图片链接</Label>
              <Input
                id="coverUrl"
                value={coverUrlInput}
                onChange={(e) => setCoverUrlInput(e.target.value)}
                placeholder="请输入图片 URL"
              />
            </div>
            <Button
              variant="secondary"
              onClick={handleUseFirstTrackCover}
              disabled={tracks.length === 0}
            >
              从第一首歌曲获取
            </Button>
          </div>
          <DrawerFooter className="pt-0">
            <Button onClick={handleSaveCover} className="h-11">
              保存
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <AddByUrlDrawer
        isOpen={isAddByUrlOpen}
        onClose={() => setIsAddByUrlOpen(false)}
        onConfirm={handleAddByUrl}
      />
    </div>
  );
}
