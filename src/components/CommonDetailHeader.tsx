import { useState, memo, useCallback, useRef } from "react";
import { MusicCover } from "@/components/MusicCover";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Search, X } from "lucide-react";
import { useSearchBackClear } from "@/hooks/useSearchBackClear";
import type { MusicTrack } from "@/types/music";

export interface CommonDetailHeaderProps {
  title: string;
  coverUrl: string;
  description?: string;
  creator?: string;
  publishTime?: number;
  countDesc?: string;
  fallbackIcon?: React.ReactNode;
  onPlayTrack?: (track: MusicTrack) => void;
  isShuffle?: boolean;
  tracks?: MusicTrack[];
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  /**
   * 替换默认的「播放全部」按钮（歌手页用来做「热门歌曲 / 查看专辑」视图切换）。
   * 传入时不再播放全部。
   */
  primaryAction?: {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
  };
  /** 隐藏搜索框（专辑视图下搜索歌曲无意义） */
  hideSearch?: boolean;
}

export const CommonDetailHeader = memo(function CommonDetailHeader({
  title,
  coverUrl,
  description,
  creator,
  publishTime,
  countDesc,
  fallbackIcon,
  onPlayTrack,
  isShuffle,
  tracks,
  searchQuery = "",
  onSearchChange,
  primaryAction,
  hideSearch,
}: CommonDetailHeaderProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 搜索框聚焦时，返回键＝清空内容并收起键盘（一步到位），不退出详情页
  useSearchBackClear({
    focused: isSearchFocused,
    value: searchQuery,
    onClear: () => onSearchChange?.(""),
    onDismiss: () => {
      searchInputRef.current?.blur();
      setIsSearchFocused(false);
    },
  });

  const hasDesc = !!description;
  const hasTracks = !!(onPlayTrack && tracks && tracks.length > 0);
  /** 有自定义主按钮时，即使列表还没数据也要显示按钮栏 */
  const showBar = hasTracks || !!primaryAction;

  const handlePlay = useCallback(() => {
    if (!hasTracks) return;
    const index = isShuffle ? Math.floor(Math.random() * tracks!.length) : 0;
    onPlayTrack!(tracks![index]);
  }, [isShuffle, tracks, onPlayTrack, hasTracks]);

  // 根据是否有描述，动态映射样式配置，避免在 JSX 中写死大量三元运算符
  // hasDesc 分支：「播放全部」按钮与封面等宽（w-24 = size-24），搜索框占满剩余空间
  const styles = {
    bar: hasDesc
      ? "mt-3 pb-5 flex items-center gap-2 w-full"
      : "mt-auto flex items-center gap-2",
    btn: hasDesc
      ? "rounded-full px-1.5 h-9 w-24 justify-center shrink-0 text-xs"
      : "rounded-full px-3 h-8 md:h-9 gap-1.5 min-w-0 shrink",
    searchWrapper: hasDesc
      ? "relative flex-1 min-w-0"
      : "relative flex-1 min-w-0",
    searchIcon: hasDesc
      ? "absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60"
      : "absolute left-2 top-2.5 h-3 w-3 text-muted-foreground md:h-4 md:w-4 md:top-2",
    input: hasDesc
      ? "pl-9 h-9 rounded-md text-xs bg-muted/50 border-none focus-visible:ring-1 focus-visible:ring-primary/50 w-full"
      : "pl-8 h-8 text-xs w-full md:h-9 md:text-sm",
  };

  const playSearchBar = showBar && (
    <div className={styles.bar}>
      {primaryAction ? (
        <Button
          size="sm"
          className={styles.btn}
          onClick={primaryAction.onClick}
        >
          {primaryAction.icon}
          {hasDesc && <span className="truncate">{primaryAction.label}</span>}
        </Button>
      ) : (
        <Button size="sm" className={styles.btn} onClick={handlePlay}>
          <Play className="h-3 w-3 fill-current" />
          {hasDesc && <span>播放全部</span>}
        </Button>
      )}

      {onSearchChange && !hideSearch && (
        <div className={styles.searchWrapper}>
          <Search className={styles.searchIcon} />
          <Input
            ref={searchInputRef}
            placeholder="搜索..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            className={cn(styles.input, searchQuery && "pr-8")}
          />
          {/* 有内容时显示清除按钮，一键清空搜索词 */}
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                onSearchChange("");
                searchInputRef.current?.focus();
              }}
              aria-label="清除搜索"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-muted-foreground/20 text-muted-foreground hover:bg-muted-foreground/30 hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        "w-full shrink-0 p-5 flex items-start",
        hasDesc ? "flex-col pb-0" : "flex-row items-stretch"
      )}
    >
      {/* items-stretch：右侧列拉伸至封面高度，无描述时播放栏的 mt-auto 才能贴底 */}
      <div className="flex gap-4 items-stretch w-full">
        <MusicCover
          src={coverUrl}
          alt={title}
          previewable
          className="shrink-0 size-24 rounded-xl shadow-md ring-1 ring-white/10 object-cover"
          fallbackIcon={fallbackIcon}
        />
        <div className="flex-1 min-w-0 flex flex-col gap-1 py-0.5">
          <h2
            className="text-base font-bold text-foreground/90 line-clamp-2"
            title={title}
          >
            {title}
          </h2>

          <div className="flex items-center flex-wrap gap-x-3 text-xs text-muted-foreground/80">
            {creator && (
              <span className="truncate max-w-[140px]">{creator}</span>
            )}
            {countDesc && <span>{countDesc}</span>}
            {publishTime && <span>{format(publishTime, "yyyy-MM-dd")}</span>}
          </div>

          {hasDesc && (
            <p
              onClick={() => setIsExpanded(!isExpanded)}
              className={cn(
                "mt-1 text-xs leading-relaxed transition-colors cursor-pointer text-muted-foreground/60 hover:text-muted-foreground/90",
                isExpanded ? "whitespace-pre-line" : "line-clamp-2"
              )}
            >
              {description}
            </p>
          )}

          {/* 当没有描述时，播放栏嵌套在右侧文本下方 */}
          {!hasDesc && playSearchBar}
        </div>
      </div>

      {/* 当有描述时，播放栏渲染在底部（独占一行） */}
      {hasDesc && playSearchBar}
    </div>
  );
});
