import { cn } from "@/lib/utils";
import { downloadMusicTrack } from "@/lib/utils/download";
import { useMusicStore } from "@/store/music-store";
import { MusicTrack, sourceBadgeStyles } from "@/types/music";
import { getSourceLabel } from "@/lib/imported-sources/labels";
import { Layers, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toastUtils } from "@/lib/utils/toast";
import { t2s, t2sArtists } from "@/lib/utils/t2s";
import toast from "react-hot-toast";
import { useShallow } from "zustand/react/shallow";
import { AddToPlaylistDrawer } from "./AddToPlaylistDrawer";
import { MusicTrackMobileMenu } from "./MusicTrackMobileMenu";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";

interface MusicTrackVariantsProps {
  variants: MusicTrack[];
}

export function MusicTrackVariants({ variants }: MusicTrackVariantsProps) {
  const {
    addToFavorites,
    removeFromFavorites,
    isFavorite,
    playTrackAsNext,
    addToNextPlay,
    quality,
  } = useMusicStore(
    useShallow((state) => ({
      addToFavorites: state.addToFavorites,
      removeFromFavorites: state.removeFromFavorites,
      isFavorite: state.isFavorite,
      playTrackAsNext: state.playTrackAsNext,
      addToNextPlay: state.addToNextPlay,
      quality: state.quality,
    }))
  );

  const [isAddToPlaylistOpen, setIsAddToPlaylistOpen] = useState(false);
  const [activeTrack, setActiveTrack] = useState<MusicTrack | null>(null);
  const [mobileMenuOpenId, setMobileMenuOpenId] = useState<string | null>(null);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const popoverContentRef = useRef<HTMLDivElement>(null);

  // 列表一滚动就收起浮窗：它是定位到触发按钮的，不跟着列表走，
  // 滚动后就会悬在错位的行旁边。浮窗内部自己滚动不算（按事件源排除）。
  useEffect(() => {
    if (!variantsOpen) return;
    let attached = false;
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && popoverContentRef.current?.contains(target)) return;
      setVariantsOpen(false);
    };
    // 打开瞬间 Radix 可能为了让触发器可见而滚动，直接挂监听会「刚点开就关」，
    // 延迟一点再监听，把这次定位滚动放过去。
    const timer = window.setTimeout(() => {
      attached = true;
      window.addEventListener("scroll", onScroll, true);
    }, 300);
    return () => {
      window.clearTimeout(timer);
      if (attached) window.removeEventListener("scroll", onScroll, true);
    };
  }, [variantsOpen]);

  if (!variants || variants.length === 0) return null;

  return (
    <>
      <Popover open={variantsOpen} onOpenChange={setVariantsOpen}>
        <PopoverTrigger asChild>
          <Badge
            variant="secondary"
            className="shrink-0 text-2xs px-1 py-0 h-4 leading-none font-normal cursor-pointer hover:bg-secondary/80 gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Layers className="h-2.5 w-2.5" />+{variants.length}
          </Badge>
        </PopoverTrigger>
        <PopoverContent
          ref={popoverContentRef}
          className="w-80 p-0"
          align="start"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-2 bg-muted/50 border-b text-xs font-medium text-muted-foreground">
            更多版本 ({variants.length})
          </div>
          <div className="max-h-[300px] overflow-y-auto p-1">
            {variants.map((variant) => (
              <div
                key={`${variant.source}-${variant.id}`}
                className="flex items-center gap-2 p-2 hover:bg-secondary/30 rounded-sm group"
              >
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 text-2xs px-1 py-0 h-4 leading-none font-normal border",
                    sourceBadgeStyles[variant.source] ||
                      sourceBadgeStyles.default
                  )}
                >
                  {getSourceLabel(variant.source)}
                </Badge>
                <div className="flex-1 min-w-0 flex flex-col">
                  <span
                    className="text-sm font-medium truncate"
                    title={t2s(variant.name)}
                  >
                    {t2s(variant.name)}
                  </span>
                  <span
                    className="text-xs text-muted-foreground truncate"
                    title={
                      t2sArtists(variant.artist).join(" / ") +
                      (variant.album ? ` • ${t2s(variant.album)}` : "")
                    }
                  >
                    {t2sArtists(variant.artist).join(" / ")}
                    {variant.album && ` • ${t2s(variant.album)}`}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => {
                      playTrackAsNext(variant);
                    }}
                    title="播放"
                  >
                    <Play className="h-3 w-3" />
                  </Button>
                  <MusicTrackMobileMenu
                    track={variant}
                    open={
                      mobileMenuOpenId === `${variant.source}-${variant.id}`
                    }
                    onOpenChange={(open) =>
                      setMobileMenuOpenId(
                        open ? `${variant.source}-${variant.id}` : null
                      )
                    }
                    onAddToPlaylist={() => {
                      setActiveTrack(variant);
                      setIsAddToPlaylistOpen(true);
                    }}
                    onDownload={() =>
                      downloadMusicTrack(variant, parseInt(quality))
                    }
                    onAddToNextPlay={() => {
                      addToNextPlay(variant);
                      toast.success("已加入下一首播放");
                    }}
                    onToggleLike={() => {
                      if (isFavorite(variant.id)) {
                        removeFromFavorites(variant.id);
                        toast.success("已取消喜欢");
                      } else {
                        const error = addToFavorites(variant);
                        if (error) {
                          toastUtils.info(error);
                        } else {
                          toast.success("已喜欢");
                        }
                      }
                    }}
                    isFavorite={isFavorite(variant.id)}
                    triggerClassName="h-6 w-6"
                  />
                </div>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <AddToPlaylistDrawer
        open={isAddToPlaylistOpen}
        onOpenChange={setIsAddToPlaylistOpen}
        track={activeTrack || undefined}
      />
    </>
  );
}
