import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { MusicCover } from "@/components/MusicCover";
import { getArtistAlbums } from "@/lib/netease/netease-api";
import type { ArtistAlbum } from "@/lib/netease/netease-raw-types";
import { useAutoLoadMore } from "@/hooks/use-auto-load-more";
import { logger } from "@/lib/logger";

const PAGE_LIMIT = 30;

interface ArtistAlbumListProps {
  artistId: string;
  artistName?: string;
  /** 页面级滚动容器：专辑网格随页面一起滚动，上滑自动加载下一页 */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** 搜索关键词：按专辑名过滤（作用于已加载的专辑） */
  filter?: string;
}

/**
 * 歌手详情页内嵌的专辑网格（替代原来只能从抽屉打开的列表）。
 * 与抽屉共用 /artist/album 接口，点击进入 /netease-album/:id。
 */
export function ArtistAlbumList({
  artistId,
  artistName,
  scrollContainerRef,
  filter = "",
}: ArtistAlbumListProps) {
  const navigate = useNavigate();
  const [albums, setAlbums] = useState<ArtistAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  const reqIdRef = useRef(0);

  const load = useCallback(
    async (isLoadMore: boolean) => {
      const reqId = ++reqIdRef.current;
      const offset = isLoadMore ? offsetRef.current : 0;

      if (isLoadMore) setLoadingMore(true);
      else setLoading(true);

      try {
        const res = await getArtistAlbums(artistId, PAGE_LIMIT, offset);
        const list = res?.hotAlbums ?? [];
        if (reqId !== reqIdRef.current) return;

        setAlbums((prev) => {
          const merged = isLoadMore ? [...prev, ...list] : list;
          // 分页边界常出现重复专辑，按 id 去重
          return Array.from(new Map(merged.map((a) => [a.id, a])).values());
        });
        offsetRef.current = offset + PAGE_LIMIT;
        setHasMore(!!res?.more && list.length > 0);
      } catch (error) {
        if (reqId !== reqIdRef.current) return;
        logger.error("ArtistAlbumList", "Fetch albums failed:", error, {
          artistId,
          offset,
        });
        if (!isLoadMore) setAlbums([]);
        setHasMore(false);
      } finally {
        if (reqId === reqIdRef.current) {
          isLoadMore ? setLoadingMore(false) : setLoading(false);
        }
      }
    },
    [artistId]
  );

  // 切换歌手 / 首次挂载时重置并拉第一页
  useEffect(() => {
    offsetRef.current = 0;
    setHasMore(true);
    void load(false);
  }, [load]);

  useAutoLoadMore({
    containerRef: scrollContainerRef,
    hasMore,
    loading: loading || loadingMore,
    onLoadMore: () => void load(true),
    contentKey: albums.length,
  });

  const handleAlbumClick = (album: ArtistAlbum) => {
    navigate(`/netease-album/${album.id}`, {
      state: { albumFallback: { name: album.name, artist: artistName } },
    });
  };

  const keyword = filter.trim().toLowerCase();
  const visibleAlbums = keyword
    ? albums.filter((a) => a.name.toLowerCase().includes(keyword))
    : albums;

  // 搜索时自动补页：已加载的专辑里没匹配到就继续往后翻（最多 6 页，防止空关键词无限请求）
  const searchPagesRef = useRef(0);
  useEffect(() => {
    searchPagesRef.current = 0;
  }, [keyword]);
  useEffect(() => {
    if (!keyword || visibleAlbums.length > 0) return;
    if (!hasMore || loading || loadingMore) return;
    if (searchPagesRef.current >= 6) return;
    searchPagesRef.current += 1;
    void load(true);
  }, [keyword, visibleAlbums.length, hasMore, loading, loadingMore, load]);

  if (loading && albums.length === 0) {
    return (
      <div className="grid grid-cols-3 gap-x-3 gap-y-5 px-0 pb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="w-full aspect-square rounded-xl bg-secondary animate-pulse" />
            <div className="h-3 w-4/5 rounded bg-secondary animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (albums.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-16">
        暂无专辑数据
      </p>
    );
  }

  if (visibleAlbums.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 gap-2">
        {loadingMore ? (
          <>
            <Loader2 className="animate-spin h-5 w-5 text-primary/40" />
            <p className="text-sm text-muted-foreground">正在搜索更多专辑…</p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">没有匹配的专辑</p>
            {hasMore && (
              <p className="text-xs text-muted-foreground/60">
                继续上滑可加载更多专辑
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="pb-6">
      <div className="grid grid-cols-3 gap-x-3 gap-y-5">
        {visibleAlbums.map((album) => (
          <button
            key={album.id}
            type="button"
            onClick={() => handleAlbumClick(album)}
            className="group flex flex-col gap-2 text-left min-w-0"
          >
            <div className="relative w-full aspect-square overflow-hidden rounded-xl bg-secondary shadow-sm ring-1 ring-black/5 group-active:scale-95 transition-transform">
              <MusicCover
                src={album.picUrl}
                alt={album.name}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-foreground line-clamp-2 leading-tight">
                {album.name}
              </p>
              <p className="mt-0.5 text-2xs text-muted-foreground/60">
                {format(album.publishTime, "yyyy-MM-dd")}
              </p>
            </div>
          </button>
        ))}
      </div>

      {loadingMore && (
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin h-5 w-5 text-primary/40" />
        </div>
      )}
      {!hasMore && !loadingMore && (
        <p className="text-center text-xs font-medium tracking-[0.2em] text-muted-foreground/30 uppercase py-6">
          － End of Collection －
        </p>
      )}
    </div>
  );
}
