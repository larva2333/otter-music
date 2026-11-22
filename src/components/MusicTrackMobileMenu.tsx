import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import {
  Download,
  Heart,
  ListPlus,
  MoreVertical,
  Trash2,
  CornerDownRight,
  User,
  Disc,
  MessageSquareQuote,
  Link2,
  Check,
  Folder,
  Zap,
} from "lucide-react";
import { ReactNode, useEffect, useState, useMemo } from "react";
import { MusicCover } from "./MusicCover";
import { TrackSourceLabel } from "./TrackSourceLabel";
import { useMusicCover } from "@/hooks/useMusicCover";
import { MusicTrack, SearchIntent } from "@/types/music";
import { getSourceLabel } from "@/lib/imported-sources/labels";
import { useNavigate, useLocation } from "react-router-dom";
import { useMusicStore } from "@/store/music-store";
import {
  MusicProviderFactory,
  resolveFallbackSearchSource,
} from "@/lib/music-provider";
import { IS_NATIVE } from "@/lib/api/config";
import { MusicCommentsDrawer } from "./MusicCommentsDrawer";
import { handleAutoMatch } from "@/lib/audio-match";
import {
  EXCLUDED_FOR_SEARCH,
  getAllVisibleSourcesForSwitch,
} from "@/hooks/use-aggregated-sources";
import { parseAlistTrackId } from "@/lib/alist/alist-api";
import { resolveQqAlbumMid } from "@/lib/qqmusic/qqmusic-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildBilibiliSeriesAlbumId,
  buildBilibiliMultiPAlbumId,
  parseBilibiliTrackId,
} from "@otter-music/shared";
import { logger } from "@/lib/logger";
import { t2s, t2sArtists } from "@/lib/utils/t2s";
import { toast } from "react-hot-toast";
import { useExitLayer } from "@/hooks/useExitLayer";
import { useImportedSourcesStore } from "@/lib/imported-sources/store";
import type { ImportedSource } from "@/lib/imported-sources/types";
import {
  getLxPlatformForSource,
  getLxSourcePlatforms,
  resolveViaSpecificLxSource,
  setLxUrlOverride,
} from "@/lib/imported-sources/lx-playback";

interface MusicTrackMobileMenuProps {
  track: MusicTrack;
  playlistId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddToNextPlay?: () => void;
  onAddToPlaylist: () => void;
  onDownload?: () => void;
  onToggleLike?: () => void;
  isFavorite?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
  confirmRemove?: boolean;
  customActions?: ReactNode;
  triggerClassName?: string;
  onNavigate?: () => void;
}

const ActionButton = ({
  onClick,
  icon: Icon,
  children,
  className,
}: {
  onClick?: () => void;
  icon: React.ElementType;
  children: ReactNode;
  className?: string;
}) => (
  <Button
    variant="ghost"
    className={cn("justify-start w-full", className)}
    onClick={onClick}
  >
    <Icon className="mr-2 h-4 w-4 shrink-0" />
    <span className="truncate">{children}</span>
  </Button>
);

export function MusicTrackMobileMenu({
  track,
  open,
  onOpenChange,
  onAddToNextPlay,
  onAddToPlaylist,
  onDownload,
  onToggleLike,
  isFavorite,
  onRemove,
  removeLabel = "删除",
  confirmRemove = true,
  customActions,
  triggerClassName,
  onNavigate,
}: MusicTrackMobileMenuProps) {
  const coverUrl = useMusicCover(track, open);
  const navigate = useNavigate();
  const location = useLocation();
  const [showArtistSelection, setShowArtistSelection] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showSourceSwitch, setShowSourceSwitch] = useState(false);
  const { push: pushExitLayer, pop: popExitLayer } = useExitLayer();

  // 「切换音源」是套在菜单里的二级弹窗：Android 返回键走的是 Capacitor
  // 原生事件（RootLayout 的层级栈），弹窗自己收不到。给它单独挂一层，
  // 返回时先关它，而不是把菜单或页面一起关掉。
  useEffect(() => {
    if (!showSourceSwitch) return;
    const id = pushExitLayer({ close: () => setShowSourceSwitch(false) });
    return () => popExitLayer(id);
  }, [showSourceSwitch, pushExitLayer, popExitLayer]);

  // 菜单整体关掉时清掉子弹窗状态，避免这一层残留在返回键层级栈上
  const handleMenuOpenChange = (next: boolean) => {
    if (!next) setShowSourceSwitch(false);
    onOpenChange(next);
  };
  /** 脚本 inited 是异步的，回来后再算一次平台，避免首次渲染把多平台脚本误标为不支持 */
  const [lxTick, setLxTick] = useState(0);

  const sourceConfigs = useMusicStore((s) => s.sourceConfigs);
  const quality = useMusicStore((s) => s.quality);
  const importedSources = useImportedSourcesStore((s) => s.sources);

  const trackLxPlatform = useMemo(
    () => getLxPlatformForSource(track.source),
    [track.source]
  );

  /**
   * 能接管当前曲目平台的洛雪源。
   * 洛雪协议没有 search，所以它不出现在「切换音源」的搜索列表里，
   * 只能在这里按平台手动选来给当前这首换一条直链。
   * 列出全部已启用的洛雪源：平台不匹配的置灰，避免用户以为「开关开了却没生效」。
   */
  const lxSwitchTargets = useMemo(() => {
    void lxTick;
    const isOn = (id: string) => {
      const cfg = sourceConfigs.find((c) => c.source === id);
      if (!cfg) {
        // 配置里还没补上条目时，用导入记录自身的开关兜底
        const s = importedSources.find((x) => x.id === id);
        return Boolean(s?.enabled && s?.visible);
      }
      return cfg.enabled && cfg.visible;
    };
    return importedSources
      .filter((s) => s.kind === "lx" && !!s.script && isOn(s.id))
      .map((source) => ({
        source,
        supported:
          Boolean(trackLxPlatform) &&
          getLxSourcePlatforms(source).includes(trackLxPlatform as string),
      }))
      .sort((a, b) => Number(b.supported) - Number(a.supported));
  }, [trackLxPlatform, sourceConfigs, importedSources, lxTick]);

  // 打开菜单时预热洛雪运行时（脚本会异步 send inited），回来后重算平台
  useEffect(() => {
    if (!open) return;
    const lxSources = importedSources.filter(
      (s) => s.kind === "lx" && !!s.script
    );
    if (lxSources.length === 0) return;
    lxSources.forEach((s) => getLxSourcePlatforms(s));
    const timer = setTimeout(() => setLxTick((v) => v + 1), 1500);
    return () => clearTimeout(timer);
  }, [open, importedSources]);

  const playWithLxSource = async (source: ImportedSource) => {
    const br = parseInt(quality, 10) || 320;
    toast.loading(`正在用「${source.name}」取链…`, { id: "lx-switch" });
    try {
      const url = await Promise.race([
        resolveViaSpecificLxSource(source, track, br),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
      ]);
      if (!url) {
        toast.error(`「${source.name}」取不到播放链接`, { id: "lx-switch" });
        return;
      }
      // 先落直链再让加载器重载：resolveTrackUrl 会优先用这条，
      // 避免它又走官方接口、又失败、又自动跳下一首
      setLxUrlOverride({
        trackId: track.id,
        trackSource: track.source,
        sourceId: source.id,
        url,
      });
      setShowSourceSwitch(false);
      onOpenChange(false);
      useMusicStore.getState().incrementUrlRecoveryKey();
      toast.success(`已用「${source.name}」取链播放`, { id: "lx-switch" });
    } catch {
      toast.error("洛雪源取链失败", { id: "lx-switch" });
    }
  };

  // Zustand Store
  const setSearchQuery = useMusicStore((s) => s.setSearchQuery);
  const setSearchResults = useMusicStore((s) => s.setSearchResults);
  const setSearchIntent = useMusicStore((s) => s.setSearchIntent);
  const setSearchSource = useMusicStore((s) => s.setSearchSource);

  // 历史/歌单里可能留着已删除的导入音源记录，取不到时给 null，别让整页崩掉
  const provider = MusicProviderFactory.tryGetProvider(track.source);

  // 音源切换可用性：仅本地/播客/Alist 这类无搜索能力的音源不可换源
  const canSwitchSource = useMemo(
    () => !EXCLUDED_FOR_SEARCH.includes(track.source),
    [track.source]
  );

  const handleSearch = async (
    keyword: string,
    type: SearchIntent["type"] = "",
    artist?: string,
    id?: string
  ) => {
    // 如果支持详情查询，但没有 ID，尝试获取详情
    if (
      provider &&
      (provider.getArtistDetail || provider.getAlbumDetail) &&
      (!id || id === "0") &&
      provider.getSongDetail
    ) {
      try {
        const detail = await provider.getSongDetail(track.id);
        if (detail) {
          if (type === "artist" && detail.ar?.[0]?.id) {
            id = String(detail.ar[0].id);
          } else if (type === "album" && detail.al?.id) {
            id = String(detail.al.id);
          }

          // B站音源：歌手取 UP 的 mid
          if (type === "artist" && track.source === "bilibili") {
            if (track.artist_ids?.[0]) {
              id = track.artist_ids[0];
            } else if (detail.owner?.mid) {
              id = String(detail.owner.mid);
            }
          }

          // B站音源：从详情中提取合集/分P 信息
          if (type === "album" && track.source === "bilibili") {
            // 优先使用已有的 album_id
            if (track.album_id?.startsWith("bilibili_")) {
              id = track.album_id;
            } else if (detail.ugc_season?.id) {
              // 从 ugc_season 构建专辑 ID
              const ownerMid = detail.owner?.mid;
              id = buildBilibiliSeriesAlbumId(detail.ugc_season.id, ownerMid);
            } else if (detail.pages && detail.pages.length > 1) {
              // 多分P 视频，构建分P 专辑 ID
              const parsed = parseBilibiliTrackId(track.id);
              if (parsed?.bvid) {
                id = buildBilibiliMultiPAlbumId(parsed.bvid);
              }
            }
          }
        }
      } catch (e) {
        logger.error("MusicTrackMobileMenu", "Failed to get song detail", e);
      }
    }

    if (
      provider &&
      (provider.getArtistDetail || provider.getAlbumDetail) &&
      id &&
      id !== "0"
    ) {
      if (type === "artist" && provider.getArtistDetail) {
        // B站音源：仅原生端支持 UP 主页，Web 端走搜索回退
        if (track.source === "bilibili" && !IS_NATIVE) {
          // fallthrough to search
        } else {
          const targetPath =
            track.source === "bilibili"
              ? `/bilibili-artist/${id}`
              : `/netease-artist/${id}`;
          navigate(targetPath);
          onOpenChange(false);
          setShowArtistSelection(false);
          onNavigate?.();
          return;
        }
      }
      if (type === "album" && provider.getAlbumDetail) {
        const isBilibiliAlbum =
          track.source === "bilibili" &&
          (id?.startsWith("bilibili_S_") ||
            id?.startsWith("bilibili_O_") ||
            id?.startsWith("bilibili_V_"));
        const isQqAlbum = track.source === "qq";
        const targetPath = isBilibiliAlbum
          ? `/bilibili-collection/${id}`
          : isQqAlbum
            ? `/qq-album/${id}`
            : `/netease-album/${id}`;
        // 带上专辑名与歌手，供网易云专辑页加载失败时回退到 QQ 音乐
        navigate(
          targetPath,
          isBilibiliAlbum || isQqAlbum
            ? undefined
            : { state: { albumFallback: { name: keyword, artist } } }
        );
        onOpenChange(false);
        onNavigate?.();
        return;
      }
    }

    // 网易云专辑跳转失败（缺专辑 ID 或详情获取异常）、
    // 或 QQ 歌曲缺少专辑 mid（旧数据）：用专辑名解析 albummid 后进 QQ 专辑页；
    // 解析不到时继续走默认的单音源搜索
    if (
      type === "album" &&
      (track.source === "netease" ||
        track.source === "_netease" ||
        track.source === "qq")
    ) {
      const qqAlbumMid = await resolveQqAlbumMid(keyword, artist);
      if (qqAlbumMid) {
        navigate(`/qq-album/${qqAlbumMid}`);
        onOpenChange(false);
        onNavigate?.();
        return;
      }
    }

    let searchKeyword = keyword;
    if (type === "album" && artist) {
      searchKeyword = `${artist} ${keyword}`;
    }

    setSearchQuery(searchKeyword);
    if (type) {
      setSearchIntent({
        type: type as SearchIntent["type"],
        artist,
        id,
        name: keyword,
      });
    } else {
      setSearchIntent(null);
    }
    // 回退搜索锁定单音源，避免聚合搜索等待全部音源返回
    setSearchSource(resolveFallbackSearchSource(track.source));
    setSearchResults([]);
    navigate("/search");
    onOpenChange(false);
    setShowArtistSelection(false);
    onNavigate?.();
  };

  return (
    <div>
      <Drawer open={open} onOpenChange={handleMenuOpenChange}>
        <DrawerTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className={cn("h-8 w-8", triggerClassName)}
            onClick={(e) => e.stopPropagation()}
            title="更多"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DrawerTrigger>
        <DrawerContent onClick={(e) => e.stopPropagation()}>
          <DrawerTitle className="sr-only">歌曲菜单</DrawerTitle>
          <div className="flex items-center gap-4 px-6 py-4">
            <MusicCover
              src={coverUrl}
              alt={track.name}
              className="h-16 w-16 rounded-lg shadow-md"
              iconClassName="h-8 w-8"
            />
            <div className="min-w-0">
              <div className="font-bold line-clamp-2 text-base">
                {t2s(track.name)}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {t2sArtists(track.artist).join(" / ")}
                {track.album && ` • ${t2s(track.album)}`}
              </div>
            </div>
          </div>
          <div className="p-4 flex flex-col gap-2">
            {onToggleLike && (
              <ActionButton
                icon={Heart}
                onClick={() => {
                  onToggleLike();
                  onOpenChange(false);
                }}
                className={
                  isFavorite ? "text-primary [&>svg]:fill-primary" : ""
                }
              >
                {isFavorite ? "取消喜欢" : "喜欢"}
              </ActionButton>
            )}
            {onDownload && (
              <ActionButton
                icon={Download}
                onClick={() => {
                  onDownload();
                  onOpenChange(false);
                }}
              >
                下载
              </ActionButton>
            )}
            {onAddToPlaylist && (
              <ActionButton
                icon={ListPlus}
                onClick={() => {
                  onAddToPlaylist();
                  onOpenChange(false);
                }}
              >
                添加到歌单
              </ActionButton>
            )}
            {onAddToNextPlay && (
              <ActionButton
                icon={CornerDownRight}
                onClick={() => {
                  onAddToNextPlay();
                  onOpenChange(false);
                }}
              >
                下一首播放
              </ActionButton>
            )}

            {/* 如果支持评论，显示评论入口 */}
            {provider?.getComments && (
              <ActionButton
                icon={MessageSquareQuote}
                onClick={() => {
                  onOpenChange(false);
                  setShowComments(true);
                }}
              >
                评论
              </ActionButton>
            )}

            {/* 除播客/Alist 外，有歌手即显示歌手入口 */}
            {track.source !== "podcast" &&
              track.source !== "alist" &&
              track.artist?.length > 0 && (
                <ActionButton
                  icon={User}
                  onClick={() => {
                    if (track.artist.length > 1) {
                      setShowArtistSelection(true);
                    } else {
                      handleSearch(
                        track.artist[0],
                        "artist",
                        undefined,
                        track.artist_ids?.[0]
                      );
                    }
                  }}
                >
                  歌手：{t2sArtists(track.artist).join(" / ")}
                </ActionButton>
              )}

            {/* 除播客/Alist 外，有专辑即显示专辑入口 */}
            {track.source !== "podcast" &&
              track.source !== "alist" &&
              track.album && (
                <ActionButton
                  icon={Disc}
                  onClick={() => {
                    handleSearch(
                      track.album!,
                      "album",
                      track.artist[0],
                      track.album_id
                    );
                  }}
                >
                  专辑：{track.album}
                </ActionButton>
              )}

            {/* Alist 音源：专辑入口跳转到所在目录 */}
            {track.source === "alist" && track.album && (
              <ActionButton
                icon={Folder}
                onClick={() => {
                  const parsed = parseAlistTrackId(track.id);
                  if (!parsed) return;
                  onOpenChange(false);
                  onNavigate?.();
                  navigate(
                    `/alist/${parsed.serverId}?path=${encodeURIComponent(
                      track.album
                    )}`
                  );
                }}
              >
                目录：
                {track.album.split("/").filter(Boolean).pop() || track.album}
              </ActionButton>
            )}

            {/* 音源显示：local/podcast/alist 无搜索能力，不可切换 */}
            <Button
              variant="ghost"
              className="justify-start w-full"
              disabled={!canSwitchSource}
              onClick={() => setShowSourceSwitch(true)}
            >
              <Link2 className="mr-2 h-4 w-4 shrink-0" />
              <span className="flex min-w-0 items-center gap-1 truncate">
                音源：
                <TrackSourceLabel track={track} />
              </span>
            </Button>

            {onRemove && (
              <ActionButton
                icon={Trash2}
                className="text-destructive hover:text-destructive"
                onClick={async () => {
                  onOpenChange(false);
                  if (
                    !confirmRemove ||
                    (await confirmDialog({
                      title: `确定${removeLabel}《${t2s(track.name)}》吗？`,
                      destructive: true,
                      confirmText: removeLabel,
                    }))
                  ) {
                    onRemove();
                  }
                }}
              >
                {removeLabel}
              </ActionButton>
            )}

            {customActions && (
              <div className="flex flex-col gap-2">{customActions}</div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      <Dialog open={showArtistSelection} onOpenChange={setShowArtistSelection}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>选择歌手</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {track.artist.map((artist, index) => (
              <Button
                key={artist}
                variant="ghost"
                className="justify-start w-full"
                onClick={() =>
                  handleSearch(
                    artist,
                    "artist",
                    undefined,
                    track.artist_ids?.[index]
                  )
                }
              >
                <User className="mr-2 h-4 w-4" />
                {artist}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSourceSwitch} onOpenChange={setShowSourceSwitch}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>切换音源</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {getAllVisibleSourcesForSwitch().map((source) => {
              const isCurrent = source === track.source;
              return (
                <Button
                  key={source}
                  variant="ghost"
                  className={cn(
                    "justify-start w-full",
                    isCurrent && "text-primary"
                  )}
                  disabled={isCurrent}
                  onClick={async () => {
                    setShowSourceSwitch(false);
                    onOpenChange(false);
                    // 换源后立即播放：不在队列时插入当前列表，已在队列时定位播放
                    await handleAutoMatch(
                      track,
                      source,
                      location.pathname,
                      undefined,
                      true
                    );
                  }}
                >
                  {isCurrent ? (
                    <Check className="mr-2 h-4 w-4" />
                  ) : (
                    <Link2 className="mr-2 h-4 w-4" />
                  )}
                  {getSourceLabel(source)}
                </Button>
              );
            })}

            {lxSwitchTargets.length > 0 && (
              <>
                <div className="pt-2 text-xs text-muted-foreground">
                  洛雪源取链 · 给当前这首换一条直链
                </div>
                {!trackLxPlatform && (
                  <div className="px-1 pb-1 text-xs text-muted-foreground">
                    当前曲目来源（{getSourceLabel(track.source)}
                    ）没有对应的洛雪平台
                  </div>
                )}
                {lxSwitchTargets.map(({ source, supported }) => (
                  <Button
                    key={source.id}
                    variant="ghost"
                    className="justify-start w-full"
                    disabled={!supported}
                    onClick={() => playWithLxSource(source)}
                  >
                    <Zap className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {getSourceLabel(source.id)}
                    </span>
                    {!supported && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        不支持当前平台
                      </span>
                    )}
                  </Button>
                ))}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <MusicCommentsDrawer
        track={track}
        open={showComments}
        onOpenChange={setShowComments}
      />
    </div>
  );
}
