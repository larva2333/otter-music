import {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import {
  getUserPlaylists,
  getSubscribedAlbums,
} from "@/lib/netease/netease-api";
import type { ArtistAlbum } from "@/lib/netease/netease-types";
import { MusicCover } from "@/components/MusicCover";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useMusicStore, type MusicState } from "@/store/music-store";
import { useMarketSession } from "@/store/session/market-session";
import { PlaylistGrid } from "./PlaylistGrid";
import { SubTabBar } from "./SubTabBar";
import { useNeteaseStore } from "@/store/netease-store";
import { logger } from "@/lib/logger";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { useTabReclick } from "@/hooks/use-tab-reclick";
import { PullRefreshIndicator } from "@/components/PullRefreshIndicator";
import { t2s } from "@/lib/utils/t2s";

interface MineTabConfig {
  id: MusicState["lastMineTab"];
  label: string;
  count?: number;
  content: React.ReactNode;
  action?: React.ReactNode;
}

function useMineData() {
  // 旧版本持久值（recommend/daily/radar）已迁出「我的」，回落到首个 tab
  const rawMineTab = useMusicStore((s) => s.lastMineTab) as string;
  const mineTab = (
    ["created", "subscribed", "albums"] as readonly string[]
  ).includes(rawMineTab)
    ? (rawMineTab as MusicState["lastMineTab"])
    : "created";
  const setMineTab = useMusicStore((s) => s.setLastMineTab);
  const { mineData, setMineData } = useMarketSession();
  const { cookie, user } = useNeteaseStore();
  const currentUserId = user?.userId ?? null;
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState(false);

  const handleRetry = useCallback(() => {
    setError(null);
    if (mineTab === "created" || mineTab === "subscribed")
      setMineData({ created: null, subscribed: null });
    else if (mineTab === "albums") setMineData({ albums: null });
  }, [mineTab, setMineData]);

  const loadMoreAlbums = async () => {
    if (!cookie || loadingMore || !mineData.hasMoreAlbums) return;

    try {
      setLoadMoreError(false);
      setLoadingMore(true);
      const limit = 50;
      const offset = mineData.albums?.length || 0;
      const newAlbums = await getSubscribedAlbums(limit, offset, cookie);

      setMineData((prev) => ({
        ...prev,
        albums: [...(prev.albums || []), ...newAlbums],
        hasMoreAlbums: newAlbums.length >= limit,
      }));
    } catch (err) {
      logger.error("MineSection", "Load more subscribed albums failed", err, {
        tab: mineTab,
        loadedCount: mineData.albums?.length ?? 0,
      });
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const fetchMineData = async () => {
      if (!cookie) return;

      if (
        (mineTab === "created" || mineTab === "subscribed") &&
        mineData.created
      )
        return;
      if (mineTab === "albums" && mineData.albums) return;

      try {
        setLoading(true);
        setError(null);

        if (
          (mineTab === "created" || mineTab === "subscribed") &&
          !mineData.created
        ) {
          if (!currentUserId) return;
          const userPlaylists = await getUserPlaylists(
            String(currentUserId),
            cookie
          );
          setMineData((prev) => ({
            ...prev,
            created: userPlaylists.filter(
              (p) => p.userId === String(currentUserId)
            ),
            subscribed: userPlaylists.filter(
              (p) => p.userId !== String(currentUserId)
            ),
          }));
        } else if (mineTab === "albums" && !mineData.albums) {
          const limit = 50;
          const albums = await getSubscribedAlbums(limit, 0, cookie);
          setMineData((prev) => ({
            ...prev,
            albums,
            hasMoreAlbums: albums.length >= limit,
          }));
        }
      } catch (err) {
        logger.error("MineSection", "Mine data load failed", err, {
          tab: mineTab,
          hasCookie: Boolean(cookie),
          currentUserId,
        });
        setError("加载失败，请重试");
      } finally {
        setLoading(false);
      }
    };

    fetchMineData();
  }, [
    mineTab,
    currentUserId,
    cookie,
    mineData.created,
    mineData.albums,
    setMineData,
  ]);

  return {
    mineTab,
    setMineTab,
    mineData,
    loading,
    loadingMore,
    loadMoreAlbums,
    currentUserId,
    error,
    loadMoreError,
    handleRetry,
  };
}

function LoginPrompt() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground space-y-4">
      <p className="text-sm">请先登录网易云账号以查看歌单</p>
      <Button variant="outline" size="sm" onClick={() => navigate("/settings")}>
        前往设置
      </Button>
    </div>
  );
}

function EmptyState({
  text = "空空如也~",
  action,
}: {
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground space-y-4">
      <p className={cn("text-sm", !action && "tracking-widest")}>{text}</p>
      {action}
    </div>
  );
}

const AlbumGrid = ({
  list,
  onClick,
}: {
  list: ArtistAlbum[];
  onClick: (id: string | number) => void;
}) => (
  <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-x-3 gap-y-4">
    {list.map((item) => (
      <div
        key={item.id}
        className="group flex flex-col gap-2.5 transition-all hover:translate-y-[-4px]"
        onClick={() => onClick(item.id)}
      >
        <div className="relative aspect-square rounded-md overflow-hidden shadow-md ring-1 ring-black/5 hover:shadow-xl transition-shadow cursor-pointer">
          <MusicCover
            src={item.picUrl}
            alt={item.name}
            className="transition-transform duration-500 group-hover:scale-110"
          />
        </div>
        <div className="px-0.5 flex flex-col gap-0.5">
          <h3 className="text-sm font-medium leading-snug line-clamp-2 text-foreground/80 group-hover:text-primary transition-colors cursor-pointer">
            {t2s(item.name)}
          </h3>
          <span className="text-xs text-muted-foreground/60 tracking-wider">
            {t2s(item.artist?.name)}
          </span>
        </div>
      </div>
    ))}
  </div>
);

export function MineSection({
  embedded = false,
  scrollRef: scrollRefProp,
  isActive = true,
}: {
  embedded?: boolean;
  /** 外层滚动容器；传入时在其上启用下拉刷新 */
  scrollRef?: RefObject<HTMLElement | null>;
  isActive?: boolean;
} = {}) {
  const navigate = useNavigate();
  const localScrollRef = useRef<HTMLElement>(null);
  const activeScrollRef = scrollRefProp ?? localScrollRef;
  const {
    mineTab,
    setMineTab,
    mineData,
    loading,
    loadingMore,
    loadMoreAlbums,
    currentUserId,
    error,
    loadMoreError,
    handleRetry,
  } = useMineData();

  // 下拉刷新：清空当前 tab 缓存触发重新拉取（未登录时无数据可刷，禁用）
  const { status: pullStatus, indicatorRef } = usePullToRefresh(
    activeScrollRef,
    {
      onRefresh: handleRetry,
      enabled: !!currentUserId,
    }
  );

  // Tab Configurations
  const tabs: MineTabConfig[] = useMemo(
    () => [
      {
        id: "created",
        label: "创建",
        count: mineData.created?.length,
        content: !currentUserId ? (
          <LoginPrompt />
        ) : mineData.created && mineData.created.length > 0 ? (
          <PlaylistGrid
            list={mineData.created}
            onClick={(id) => navigate(`/netease-playlist/${id}`)}
          />
        ) : (
          <EmptyState />
        ),
      },
      {
        id: "subscribed",
        label: "收藏",
        count: mineData.subscribed?.length,
        content: !currentUserId ? (
          <LoginPrompt />
        ) : mineData.subscribed && mineData.subscribed.length > 0 ? (
          <PlaylistGrid
            list={mineData.subscribed}
            onClick={(id) => navigate(`/netease-playlist/${id}`)}
          />
        ) : (
          <EmptyState />
        ),
      },
      {
        id: "albums",
        label: "专辑",
        count: mineData.albums?.length,
        content: !currentUserId ? (
          <LoginPrompt />
        ) : mineData.albums && mineData.albums.length > 0 ? (
          <div className="space-y-6">
            <AlbumGrid
              list={mineData.albums}
              onClick={(id) => navigate(`/netease-album/${id}`)}
            />
            {mineData.hasMoreAlbums && (
              <div className="flex justify-center py-4">
                <Button
                  variant="ghost"
                  onClick={loadMoreAlbums}
                  disabled={loadingMore}
                  className="w-full max-w-[200px]"
                >
                  {loadingMore ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : null}
                  {loadingMore
                    ? "加载中..."
                    : loadMoreError
                      ? "加载失败，点击重试"
                      : "加载更多"}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <EmptyState />
        ),
      },
    ],
    [
      mineData,
      currentUserId,
      navigate,
      loadingMore,
      loadMoreAlbums,
      loadMoreError,
    ]
  );

  const activeTabConfig = tabs.find((t) => t.id === mineTab) || tabs[0];
  const isDataReady = !!mineData[mineTab as keyof typeof mineData];

  // 发现页「我的」激活时再次点击底部「发现」tab：循环切换 创建 / 收藏 / 专辑
  useTabReclick("search", () => {
    if (embedded || !isActive) return;
    const idx = tabs.findIndex((t) => t.id === mineTab);
    const nextTab = tabs[(idx + 1) % tabs.length];
    if (nextTab) setMineTab(nextTab.id);
    activeScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  });

  return (
    <div
      className={cn(
        // embedded：嵌在「我的」页里时不再自带外边距，由父级控制节奏
        embedded ? "space-y-4" : "px-4 pb-bottom-stack"
      )}
    >
      <PullRefreshIndicator indicatorRef={indicatorRef} status={pullStatus} />
      {/* 与「推荐」页 tab 行同构并对齐底边线 */}
      <div
        className={cn(
          "flex items-center justify-between relative gap-4",
          embedded ? "h-10 mb-3 px-1" : "-mx-4 px-5 h-[52px] pt-1 border-b mb-4"
        )}
      >
        <SubTabBar
          tabs={tabs}
          activeId={mineTab}
          onChange={(id) => setMineTab(id as MusicState["lastMineTab"])}
          scrollable
        />
        {/* Action Button Area */}
        <div className="transition-opacity animate-in fade-in duration-200 shrink-0">
          {activeTabConfig.action}
        </div>
      </div>

      <div>
        {loading && !isDataReady ? (
          <div className="h-60 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <EmptyState
            text={error}
            action={
              <Button size="sm" onClick={handleRetry}>
                重试
              </Button>
            }
          />
        ) : (
          activeTabConfig.content
        )}
      </div>
    </div>
  );
}
