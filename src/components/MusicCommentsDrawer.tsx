import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MusicTrack } from "@/types/music";
import { useCallback, useEffect, useRef, useState } from "react";
import { getTrackComments, type CommentTab } from "@/lib/comments";
import type { FormattedComment } from "@/lib/netease/comment-format";
import { MusicCover } from "./MusicCover";
import { Heart, Loader2, MessageCircleMore } from "lucide-react";
import { logger } from "@/lib/logger";
import { t2s } from "@/lib/utils/t2s";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/utils/format-count";
import { usePagerSwipe } from "@/hooks/use-pager-swipe";
import {
  COMMENT_SOURCE_LABEL,
  getCommentSourceShort,
} from "@/lib/comments/options";
import { useMusicStore } from "@/store/music-store";
import { CommentSourceDrawer } from "./settings/CommentSourceDrawer";

interface MusicCommentsDrawerProps {
  track: MusicTrack | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TABS = ["hot", "new"] as const;
/** 每页条数：首屏要快，20 条足够 */
const PAGE_SIZE = 20;

interface TabState {
  comments: FormattedComment[];
  total: number;
  source: string | null;
  page: number;
  hasMore: boolean;
  /** 首屏加载中 */
  loading: boolean;
  /** 加载下一页中 */
  loadingMore: boolean;
}

const emptyTab = (): TabState => ({
  comments: [],
  total: 0,
  source: null,
  page: 0,
  hasMore: true,
  loading: false,
  loadingMore: false,
});

function CommentsTabPane({
  tab,
  open,
  active,
  state,
  onLoadMore,
}: {
  tab: CommentTab;
  open: boolean;
  active: boolean;
  state: TabState;
  onLoadMore: (tab: CommentTab, nextPage: number) => void;
}) {
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const root = scrollViewportRef.current;
    const sentinel = sentinelRef.current;
    if (!open || !active || !root || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        const s = stateRef.current;
        if (!s.hasMore || s.loading || s.loadingMore) return;
        onLoadMore(tab, s.page + 1);
      },
      { root, rootMargin: "120px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    open,
    active,
    tab,
    state.hasMore,
    state.comments.length,
    state.loading,
    onLoadMore,
  ]);

  return (
    <div
      aria-hidden={!active || undefined}
      className="h-full w-full shrink-0 overflow-hidden"
    >
      <ScrollArea className="h-full px-6" viewportRef={scrollViewportRef}>
        <div className="flex flex-col pb-12">
          {state.loading ? (
            <div className="flex flex-col gap-6 pt-4 animate-pulse">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <div className="h-9 w-9 shrink-0 rounded-full bg-muted/60" />
                  <div className="flex-1 space-y-3">
                    <div className="h-3 w-20 bg-muted/60 rounded-full" />
                    <div className="h-4 w-full bg-muted/60 rounded-md" />
                    <div className="h-4 w-2/3 bg-muted/60 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          ) : state.comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/40">
              <MessageCircleMore
                className="w-10 h-10 mb-4 opacity-20"
                strokeWidth={1.2}
              />
              <p className="text-sm tracking-widest font-light">暂无评论</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {state.comments.map((comment, i) => (
                <CommentRow key={`${comment.id}-${i}`} comment={comment} />
              ))}
              {/* 触底哨兵：进入视口即加载下一页 */}
              {state.hasMore && <div ref={sentinelRef} className="h-px" />}
              {/* 分页状态提示 */}
              <div className="py-5 text-center text-xs text-muted-foreground/40">
                {state.loadingMore ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载中
                  </span>
                ) : state.hasMore ? (
                  <button
                    type="button"
                    onClick={() => onLoadMore(tab, state.page + 1)}
                    className="px-3 py-1.5 rounded-full border border-border/30 hover:bg-muted/40"
                  >
                    加载更多
                  </button>
                ) : (
                  <span>
                    已加载全部 {formatCount(state.comments.length)} 条
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function MusicCommentsDrawer({
  track,
  open,
  onOpenChange,
}: MusicCommentsDrawerProps) {
  const [tab, setTab] = useState<CommentTab>("hot");
  const [hot, setHot] = useState<TabState>(emptyTab);
  const [fresh, setFresh] = useState<TabState>(emptyTab);
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const commentSource = useMusicStore((s) => s.commentSource);

  const pagerViewportRef = useRef<HTMLDivElement>(null);
  const pagerTrackRef = useRef<HTMLDivElement>(null);

  const state = tab === "hot" ? hot : fresh;
  const hotRef = useRef(hot);
  const freshRef = useRef(fresh);
  useEffect(() => {
    hotRef.current = hot;
    freshRef.current = fresh;
  }, [hot, fresh]);

  // 评论总数：热门接口的 total 只是热评条数，最新接口的 total 是全部评论数。
  const totalCount = Math.max(hot.total, fresh.total);

  const fetchPage = useCallback(
    async (which: CommentTab, page: number, append: boolean) => {
      if (!track) return;
      const setStateFor = which === "hot" ? setHot : setFresh;
      const current = which === "hot" ? hotRef.current : freshRef.current;

      if (append) {
        if (current.loadingMore || !current.hasMore) return;
        setStateFor((s) => ({ ...s, loadingMore: true }));
      } else {
        setStateFor((s) => ({ ...s, loading: true }));
      }

      try {
        const res = await getTrackComments(
          track,
          which,
          PAGE_SIZE,
          page,
          commentSource
        );
        if (append) {
          setStateFor((s) => {
            const seen = new Set(s.comments.map((c) => String(c.id)));
            const added = res.comments.filter((c) => !seen.has(String(c.id)));
            const total = res.total || s.total;
            const loaded = s.comments.length + added.length;
            return {
              comments: [...s.comments, ...added],
              total,
              source: res.source ?? s.source,
              page,
              hasMore: added.length > 0 && loaded < total,
              loadingMore: false,
              loading: false,
            };
          });
        } else {
          setStateFor({
            comments: res.comments,
            total: res.total,
            source: res.source,
            page,
            hasMore:
              res.comments.length > 0 && res.comments.length < (res.total || 0),
            loading: false,
            loadingMore: false,
          });
        }
      } catch (err) {
        logger.error("MusicCommentsDrawer", "Fetch comments failed", err, {
          trackId: track.id,
          source: track.source,
          which,
          page,
        });
        setStateFor((s) => ({
          ...s,
          loading: false,
          loadingMore: false,
          hasMore: false,
        }));
      }
    },
    [track, commentSource]
  );

  // 打开抽屉 / 切歌时重置两页，并行拉两页首页
  useEffect(() => {
    if (!open || !track) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setHot(emptyTab());
      setFresh(emptyTab());
      fetchPage("hot", 0, false);
      fetchPage("new", 0, false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, track, fetchPage]);

  const handleTabChange = useCallback((next: CommentTab) => setTab(next), []);
  const handleLoadMore = useCallback(
    (which: CommentTab, nextPage: number) => {
      void fetchPage(which, nextPage, true);
    },
    [fetchPage]
  );

  const activeIndex = TABS.indexOf(tab);
  usePagerSwipe(
    { viewportRef: pagerViewportRef, trackRef: pagerTrackRef },
    {
      count: TABS.length,
      index: activeIndex,
      onChange: (idx) => {
        const next = TABS[idx];
        if (next) setTab(next);
      },
      enabled: open,
    }
  );

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[85vh] flex flex-col p-0 gap-0 rounded-t-3xl border-none bg-background/95 backdrop-blur-xl outline-none">
          <DrawerHeader className="px-6 py-5 pb-2 border-none text-left">
            <div className="flex items-baseline gap-2">
              <DrawerTitle className="text-lg font-semibold tracking-tight">
                {track?.name ? `${t2s(track.name)} · 评论` : "评论"}
              </DrawerTitle>
              {totalCount > 0 && (
                <span className="text-xs text-muted-foreground/50 font-light">
                  {formatCount(totalCount)} 条
                </span>
              )}
              <button
                type="button"
                onClick={() => setSourceDrawerOpen(true)}
                className="ml-auto -my-1 rounded-full px-2.5 py-1 text-xs text-muted-foreground/60 transition-colors hover:bg-muted/40 hover:text-foreground"
                aria-label="切换评论来源"
                title="切换评论来源"
              >
                {commentSource === "auto"
                  ? `自动${state.source ? ` · ${COMMENT_SOURCE_LABEL[state.source] ?? state.source}` : ""}`
                  : getCommentSourceShort(commentSource)}
              </button>
            </div>
            {/* 热门 / 最新切换；左右跟手滑动可见另一侧内容 */}
            <div className="mt-4 flex gap-5 border-b border-border/30">
              {(
                [
                  { key: "hot", label: "热门评论" },
                  { key: "new", label: "最新评论" },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleTabChange(key)}
                  className={cn(
                    "relative pb-2.5 text-sm transition-colors",
                    tab === key
                      ? "font-medium text-foreground"
                      : "text-muted-foreground/60 hover:text-muted-foreground"
                  )}
                >
                  {label}
                  {tab === key && (
                    <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>
          </DrawerHeader>

          <div
            ref={pagerViewportRef}
            className="relative flex-1 min-h-0 w-full overflow-hidden"
            style={{ touchAction: "pan-y" }}
          >
            <div
              ref={pagerTrackRef}
              className="flex h-full will-change-transform"
            >
              <CommentsTabPane
                tab="hot"
                open={open}
                active={tab === "hot"}
                state={hot}
                onLoadMore={handleLoadMore}
              />
              <CommentsTabPane
                tab="new"
                open={open}
                active={tab === "new"}
                state={fresh}
                onLoadMore={handleLoadMore}
              />
            </div>
          </div>
        </DrawerContent>
      </Drawer>
      <CommentSourceDrawer
        open={sourceDrawerOpen}
        onOpenChange={setSourceDrawerOpen}
      />
    </>
  );
}

function CommentRow({ comment }: { comment: FormattedComment }) {
  return (
    <div className="flex gap-3 py-3.5 px-0.5 border-b border-border/20 last:border-0">
      <MusicCover
        src={comment.avatar}
        alt={comment.userName}
        className="h-9 w-9 shrink-0 flex-[0_0_36px] min-w-9 min-h-9 rounded-full"
        iconClassName="h-5 w-5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate text-foreground/70">
            {comment.userName}
          </span>
          {comment.timeStr ? (
            <span className="shrink-0 text-xs text-muted-foreground/40 font-light">
              {comment.timeStr}
            </span>
          ) : null}
        </div>

        {comment.reply && (
          <p className="mt-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground wrap-break-word">
            <span className="text-foreground/70">
              @{comment.reply.userName}：
            </span>
            {comment.reply.text}
          </p>
        )}

        <p className="mt-1.5 text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap wrap-break-word font-normal">
          {comment.text}
        </p>

        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground/50">
          {comment.likedCount > 0 && (
            <span className="flex items-center gap-1">
              <Heart className="h-3.5 w-3.5" />
              {formatCount(comment.likedCount)}
            </span>
          )}
          {comment.location && <span>{comment.location}</span>}
        </div>
      </div>
    </div>
  );
}
