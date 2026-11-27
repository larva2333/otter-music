import { cn } from "@/lib/utils";
import { buildDownloadKey, downloadMusicTrack } from "@/lib/utils/download";
import { useMusicStore } from "@/store/music-store";
import { MusicTrack, MergedMusicTrack, sourceBadgeStyles } from "@/types/music";
import { useRef, useState } from "react";
import { toastUtils } from "@/lib/utils/toast";
import toast from "react-hot-toast";
import { useShallow } from "zustand/react/shallow";
import { AddToPlaylistDrawer } from "./AddToPlaylistDrawer";
import { MusicTrackMobileMenu } from "./MusicTrackMobileMenu";
import { MusicTrackVariants } from "./MusicTrackVariants";
import { TrackSourceLabel } from "./TrackSourceLabel";
import { Checkbox } from "./ui/checkbox";
import { Badge } from "./ui/badge";
import {
  DatabaseZap,
  DollarSign,
  Gem,
  GripVertical,
  Pause,
  Play,
} from "lucide-react";
import { useDownloadStore } from "@/store/download-store";
import { CachedImage } from "./CachedImage";
import { useMusicCover } from "@/hooks/useMusicCover";
import { t2s, t2sArtists } from "@/lib/utils/t2s";

// 预定义 Badge 样式，避免每次渲染都重新计算
const PRIVILEGE_BADGES = {
  1: {
    label: "VIP",
    icon: Gem,
    className: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  },
  4: {
    label: "付费",
    icon: DollarSign,
    className: "text-rose-500 bg-rose-500/10 border-rose-500/20",
  },
} as const;

function getPrivilegeBadge(track: MusicTrack) {
  // 网易云：沿用原有逻辑（需要 pl 判断可播放性）
  if (track.source === "netease" || track.source === "_netease") {
    const p = track.privilege;
    if (!p || p.pl > 0) return null; // 可完整播放则不显示任何标记
    if (p.fee === 1) return PRIVILEGE_BADGES[1];
    if (p.fee === 4) return PRIVILEGE_BADGES[4];
    return null;
  }

  // QQ / 咪咕：直接读 fee
  if (track.source === "qq" || track.source === "migu") {
    if (track.fee === 1) return PRIVILEGE_BADGES[1];
    if (track.fee === 4) return PRIVILEGE_BADGES[4];
  }

  return null;
}

/**
 * 行首封面（列表「带封面」模式下代替序号）。
 *
 * 曲目只带 `pic_id`，真正的图片地址要按音源换（网易云 / QQ / 本地反查 …），
 * 所以这里按行懒解析：`musicApi.getPic` 自带内存 + 磁盘缓存，同一首不会重复请求。
 * 图片本身交给 CachedImage：等 decode 完成再显示，不会出现半张图逐行刷出来。
 */
function TrackCoverThumb({
  track,
  isCurrent,
  isPlaying,
  size = "md",
}: {
  track: MusicTrack | MergedMusicTrack;
  isCurrent?: boolean;
  isPlaying?: boolean;
  size?: "sm" | "md";
}) {
  // 复用 useMusicCover：已缓存封面在挂载首帧即可由 getSyncPic 同步直出，
  // 避免虚拟列表上下滑动重建节点时先闪出空白占位再重新加载。
  const src = useMusicCover(track as MusicTrack, true, 120);

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-md bg-muted",
        size === "sm" ? "h-9 w-9" : "h-10 w-10"
      )}
    >
      <CachedImage src={src} alt={track.name} size={80} />
      {isCurrent && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          {isPlaying ? (
            <Pause className="h-3.5 w-3.5 fill-current text-white" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current text-white" />
          )}
        </div>
      )}
    </div>
  );
}

interface MusicTrackItemProps {
  track: MusicTrack | MergedMusicTrack;
  playlistId?: string;
  index: number;
  isCurrent?: boolean;
  isPlaying?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
  showCheckbox?: boolean;
  /** 长按整行：用于进入多选。未传则不启用长按。 */
  onLongPress?: () => void;
  onPlay: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  confirmRemove?: boolean;
  isDownloaded?: boolean; // 可选，未传则从 store 按需读取
  quality?: string;
  showSourceBadge?: boolean;
  /** 行首显示封面（代替序号）。推荐流这类「无表头」列表用 */
  showCover?: boolean;
  /** 第二列信息左侧显示小封面（保留第一列序号），对齐「我的歌单」列表样式 */
  showInlineCover?: boolean;
  className?: string;
  style?: React.CSSProperties;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  isSortable?: boolean;
}

export function MusicTrackItem({
  track,
  playlistId,
  index,
  isCurrent,
  isPlaying,
  isSelected,
  onSelect,
  showCheckbox,
  onLongPress,
  onPlay,
  onRemove,
  removeLabel,
  confirmRemove,
  isDownloaded,
  quality = "192",
  showSourceBadge = true,
  showCover,
  showInlineCover,
  className,
  style,
  dragHandleProps,
  isSortable,
}: MusicTrackItemProps) {
  const { addToFavorites, removeFromFavorites, isFavorite, addToNextPlay } =
    useMusicStore(
      useShallow((state) => ({
        addToFavorites: state.addToFavorites,
        removeFromFavorites: state.removeFromFavorites,
        isFavorite: state.isFavorite,
        addToNextPlay: state.addToNextPlay,
      }))
    );
  // 按需读取下载状态（虚拟列表保证活跃 Item 极少，按需 selector 远比父组件全量 map 高效）
  const downloadKey = buildDownloadKey(track.source, track.id);
  const isDownloadedFromStore = useDownloadStore(
    (s) => !!s.records[downloadKey]
  );
  const isDownloadedFinal = isDownloaded ?? isDownloadedFromStore;

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAddToPlaylistOpen, setIsAddToPlaylistOpen] = useState(false);

  /**
   * 长按进入多选。
   *
   * 用 touch 事件自己计时，不用 contextmenu：Android WebView 里长按会先弹
   * 文字选择/系统菜单，时序不可控。450ms 是系统长按的常见阈值，
   * 手指移动超过 8px 立即取消，避免和列表滚动打架。
   */
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  };

  const handleRowTouchStart = (e: React.TouchEvent) => {
    // 多选态下也允许长按：随时可以按住某行继续滑动多选，不必先退出再长按
    if (!onLongPress) return;
    const touch = e.touches[0];
    if (!touch) return;
    longPressFiredRef.current = false;
    longPressStartRef.current = { x: touch.clientX, y: touch.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressFiredRef.current = true;
      onLongPress();
      // 兜底：万一抬手位置跑到元素外、浏览器没补发 click，标志不会一直挂着
      // 把下一次正常点击吞掉。1s 远大于 touchend→click 的间隔。
      window.setTimeout(() => {
        longPressFiredRef.current = false;
      }, 1000);
    }, 450);
  };

  const handleRowTouchMove = (e: React.TouchEvent) => {
    const start = longPressStartRef.current;
    const touch = e.touches[0];
    if (!start || !touch) return;
    if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 8) {
      cancelLongPress();
    }
  };

  const handleRowClick = () => {
    // 长按已经进入多选，抬手补发的这次 click 只吞掉，别再播放
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    if (showCheckbox) onSelect?.();
    else onPlay();
  };

  const variants = (track as MergedMusicTrack).variants || [];
  const badge = getPrivilegeBadge(track);

  return (
    <div
      data-track-id={track.id}
      style={style}
      className={cn(
        "group grid items-center px-4 py-2.5 transition-all text-sm cursor-pointer",
        showCover
          ? "gap-3 grid-cols-[2.5rem_1fr_auto]"
          : "gap-4 grid-cols-[1.75rem_1fr_auto]",
        isSelected && showCheckbox
          ? "bg-primary/10"
          : isCurrent
            ? "bg-primary/10"
            : "hover:bg-muted/50",
        className
      )}
    >
      <div
        className={cn(
          "col-span-2 grid items-center",
          showCover
            ? "gap-3 grid-cols-[2.5rem_1fr]"
            : "gap-4 grid-cols-[1.75rem_1fr]"
        )}
        onClick={handleRowClick}
        onTouchStart={handleRowTouchStart}
        onTouchMove={handleRowTouchMove}
        onTouchEnd={cancelLongPress}
        onTouchCancel={cancelLongPress}
        // 长按已经由上面的计时器接管，别再让 WebView 弹"选择文字/复制"菜单
        onContextMenu={onLongPress ? (e) => e.preventDefault() : undefined}
      >
        <div className="flex justify-center shrink-0">
          {showCheckbox ? (
            <Checkbox
              checked={isSelected}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={() => onSelect?.()}
            />
          ) : showCover ? (
            <TrackCoverThumb
              key={`${track.source}:${track.id}:${track.pic_id ?? ""}`}
              track={track}
              isCurrent={isCurrent}
              isPlaying={isPlaying}
            />
          ) : (
            <div className="relative w-4 h-4 flex items-center justify-center">
              {isCurrent && isPlaying ? (
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                </span>
              ) : (
                <span
                  className={cn(
                    "font-mono text-muted-foreground opacity-70",
                    isCurrent && "text-primary opacity-100"
                  )}
                >
                  {index + 1}
                </span>
              )}
            </div>
          )}
        </div>

        <div
          className={cn(
            "min-w-0",
            showInlineCover
              ? "flex items-center gap-2.5"
              : "flex flex-col gap-0.5"
          )}
        >
          {showInlineCover && (
            <TrackCoverThumb
              key={`${track.source}:${track.id}:${track.pic_id ?? ""}`}
              track={track}
              size="sm"
            />
          )}
          <div
            className={cn(
              "min-w-0 flex flex-col gap-0.5",
              showInlineCover && "flex-1"
            )}
          >
            <div
              className={cn(
                "font-medium flex items-center gap-1.5",
                isCurrent && "text-primary"
              )}
            >
              <span className="truncate" title={t2s(track.name)}>
                {t2s(track.name)}
              </span>

              {showSourceBadge && (
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 text-2xs px-1 py-0 h-3.5 leading-none font-normal",
                    sourceBadgeStyles[track.source] || sourceBadgeStyles.default
                  )}
                >
                  <TrackSourceLabel track={track} />
                </Badge>
              )}

              {badge && (
                <Badge
                  variant="secondary"
                  className={cn(
                    "h-3.5 px-1 text-2xs gap-0.5 flex items-center leading-none font-bold border",
                    badge.className
                  )}
                >
                  <badge.icon className="h-2.5 w-2.5" />
                  {badge.label}
                </Badge>
              )}

              {isDownloadedFinal && (
                <DatabaseZap className="h-3.5 w-3.5 text-muted-foreground/60" />
              )}
              <MusicTrackVariants variants={variants} />
            </div>
            <div className="text-xs text-muted-foreground truncate opacity-70">
              {t2sArtists(track.artist).join(" / ")}
              {track.album && ` • ${t2s(track.album)}`}
            </div>
          </div>
        </div>
      </div>

      {/* Column 3: Actions */}
      <div className="flex items-center justify-end gap-1">
        {isSortable && (
          <div
            {...dragHandleProps}
            className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground/50 hover:text-foreground transition-colors touch-none mr-1"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}
        <MusicTrackMobileMenu
          track={track}
          playlistId={playlistId}
          open={isMobileMenuOpen}
          onOpenChange={(open) => {
            setIsMobileMenuOpen(open);
          }}
          onAddToNextPlay={() => {
            addToNextPlay(track);
            toast.success("已添加到下一首播放");
          }}
          onAddToPlaylist={() => {
            setIsAddToPlaylistOpen(true);
          }}
          onDownload={() => {
            downloadMusicTrack(track, parseInt(quality));
          }}
          onToggleLike={() => {
            if (isFavorite(track.id)) {
              removeFromFavorites(track.id);
              toast.success("已取消喜欢");
            } else {
              const error = addToFavorites(track);
              if (error) {
                toastUtils.info(error);
              } else {
                toast.success("已喜欢");
              }
            }
          }}
          isFavorite={isFavorite(track.id)}
          onRemove={onRemove}
          removeLabel={removeLabel}
          confirmRemove={confirmRemove}
        />

        <AddToPlaylistDrawer
          open={isAddToPlaylistOpen}
          onOpenChange={setIsAddToPlaylistOpen}
          track={track}
        />
      </div>
    </div>
  );
}
