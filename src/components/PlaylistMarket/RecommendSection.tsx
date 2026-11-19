import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type RefObject,
} from "react";
import {
  getDailyRecommendSongs,
  getShuffledRecommendSongs,
  getRecommendPlaylists,
} from "@/lib/netease/netease-api";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useMusicStore } from "@/store/music-store";
import { useMarketSession } from "@/store/session/market-session";
import { useNeteaseStore } from "@/store/netease-store";
import { PlaylistGrid } from "./PlaylistGrid";
import { MusicPlaylistView } from "@/components/MusicPlaylistView";
import { usePlayContextHandler } from "@/hooks/usePlayContextHandler";
import { logger } from "@/lib/logger";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { PullRefreshIndicator } from "@/components/PullRefreshIndicator";
import type { MusicTrack } from "@/types/music";

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

/**
 * 发现页「推荐」分类：单曲推荐（每日日推，下拉换一批）+ 歌单推荐（个性化推荐歌单）。
 */
export function RecommendSection({
  scrollRef: scrollRefProp,
}: {
  /** 外层滚动容器；传入时在其上启用下拉刷新 */
  scrollRef?: RefObject<HTMLElement | null>;
}) {
  const navigate = useNavigate();
  const cookie = useNeteaseStore((s) => s.cookie);
  const currentTrackId = useMusicStore((s) => s.queue[s.currentIndex]?.id);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const { mineData, setMineData } = useMarketSession();

  // 单曲推荐：cachedFetch 有 1h 磁盘缓存；下拉刷新走「换一批」（随机推荐歌单）
  const [dailyTracks, setDailyTracks] = useState<MusicTrack[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [dailyShuffled, setDailyShuffled] = useState(false);

  const loadDailySongs = useCallback(async () => {
    setDailyError(null);
    setDailyLoading(true);
    try {
      const tracks = await getDailyRecommendSongs(cookie);
      setDailyTracks(tracks);
      setDailyShuffled(false);
    } catch (err) {
      logger.error(
        "RecommendSection",
        "Daily recommend songs load failed",
        err
      );
      setDailyError("加载失败，请重试");
    } finally {
      setDailyLoading(false);
    }
  }, [cookie]);

  // 换一批：随机推荐歌单的歌曲。失败时回落到日推缓存
  const shuffleDailySongs = useCallback(async () => {
    setDailyError(null);
    setDailyLoading(true);
    try {
      const tracks = await getShuffledRecommendSongs(cookie);
      if (tracks.length === 0) throw new Error("no tracks");
      setDailyTracks(tracks);
      setDailyShuffled(true);
    } catch (err) {
      logger.warn("RecommendSection", "Shuffle recommend songs failed", err);
      try {
        const tracks = await getDailyRecommendSongs(cookie);
        setDailyTracks(tracks);
        setDailyShuffled(false);
      } catch {
        setDailyError("加载失败，请重试");
      }
    } finally {
      setDailyLoading(false);
    }
  }, [cookie]);

  // 歌单推荐：复用 market session 缓存；游客也能拉（resolveRequestCookie 兜底游客 cookie）
  const recommendPlaylists = mineData.recommend;
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState(false);

  const fetchPlaylists = useCallback(async () => {
    setPlaylistsError(false);
    setPlaylistsLoading(true);
    try {
      const list = await getRecommendPlaylists(cookie);
      setMineData({ recommend: list });
    } catch (err) {
      logger.error("RecommendSection", "Recommend playlists load failed", err);
      setPlaylistsError(true);
    } finally {
      setPlaylistsLoading(false);
    }
  }, [cookie, setMineData]);

  useEffect(() => {
    if (dailyTracks.length === 0 && !dailyLoading && !dailyError) {
      loadDailySongs();
    }
    if (!mineData.recommend) fetchPlaylists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadDailySongs, fetchPlaylists]);

  const dailyOnPlay = usePlayContextHandler(dailyTracks, "daily-recommend");

  // 并列子 tab：单曲推荐 | 歌单推荐
  const [activeTab, setActiveTab] = useState<"songs" | "playlists">("songs");

  // 下拉刷新：当前 tab 的数据重新拉取（单曲推荐 = 换一批）
  const localScrollRef = useRef<HTMLElement>(null);
  const activeScrollRef = scrollRefProp ?? localScrollRef;
  const { status: pullStatus, indicatorRef } = usePullToRefresh(
    activeScrollRef,
    {
      onRefresh: async () => {
        if (activeTab === "songs") {
          await shuffleDailySongs();
        } else {
          setMineData({ recommend: null });
          await fetchPlaylists();
        }
      },
    }
  );

  // 外层不再统一 p-4：单曲推荐是「无界」列表，要顶到屏幕两边，
  // 内边距交给各自的分区（tab 行 px-5、歌单推荐 px-4）。
  return (
    <div className="pb-bottom-stack">
      <PullRefreshIndicator indicatorRef={indicatorRef} status={pullStatus} />

      {/* 并列子 tab 行，样式与「我的」页 tab 行对齐 */}
      <div className="flex items-center gap-6 px-5 pt-4 pb-3">
        {(
          [
            { id: "songs", label: "单曲推荐" },
            { id: "playlists", label: "歌单推荐" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "text-base transition-all",
              activeTab === tab.id
                ? "font-bold text-foreground tracking-wide"
                : "font-medium text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "songs" ? (
        <section>
          {dailyLoading && dailyTracks.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : dailyError ? (
            <EmptyState
              text={dailyError}
              action={
                <Button size="sm" onClick={loadDailySongs}>
                  重试
                </Button>
              }
            />
          ) : (
            /* 单曲推荐：不要表头（封面 / 标题 / 播放 / 搜索都是多余的），
               列表直接铺满整宽，每行前面带歌曲封面 */
            <MusicPlaylistView
              title={dailyShuffled ? "换一批推荐" : "单曲推荐"}
              tracks={dailyTracks}
              onPlay={dailyOnPlay}
              currentTrackId={currentTrackId}
              isPlaying={isPlaying}
              hideHeader
              showTrackCover
            />
          )}
        </section>
      ) : (
        <section className="space-y-4 px-4">
          {playlistsLoading && !recommendPlaylists ? (
            <div className="h-60 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : playlistsError ? (
            <EmptyState
              text="加载失败，请重试"
              action={
                <Button size="sm" onClick={fetchPlaylists}>
                  重试
                </Button>
              }
            />
          ) : recommendPlaylists && recommendPlaylists.length > 0 ? (
            <PlaylistGrid
              list={recommendPlaylists}
              onClick={(id) => navigate(`/netease-playlist/${id}`)}
            />
          ) : (
            <EmptyState />
          )}
        </section>
      )}
    </div>
  );
}
