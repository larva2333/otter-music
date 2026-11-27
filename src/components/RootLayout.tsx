import {
  useLocation,
  useNavigate,
  useNavigationType,
  useOutlet,
} from "react-router-dom";
import { MusicLayout } from "@/components/MusicLayout";
import { MusicNowPlayingBar } from "@/components/MusicNowPlayingBar";
import { MusicTabBar } from "@/components/MusicTabBar";
import { GlobalMusicPlayer } from "@/components/GlobalMusicPlayer";
import { ConfirmDialogHost } from "@/components/ui/confirm-dialog";
import { useMusicStore } from "@/store/music-store";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { useShallow } from "zustand/react/shallow";
import { useExitLayer } from "@/hooks/useExitLayer";
import { useTapTopToScrollTop } from "@/hooks/useTapTopToScrollTop";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { readTranslateX } from "@/hooks/use-pager-swipe";
import {
  saveScrollPositions,
  restoreScrollPositions,
} from "@/lib/scroll-snapshot";
import {
  ROOT_TAB_ORDER,
  RootPagerContext,
  resolveRootNeighborPath,
  type RootPagerContextValue,
  type RootTabAligner,
  type RootTabId,
  type RootTabPath,
} from "@/hooks/use-root-pager";
import {
  SearchRoute,
  FavoritesRoute,
  MineRoute,
  SettingsRoute,
} from "@/routes/RouteWrappers";
import { App as CapacitorApp } from "@capacitor/app";
import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useState,
  lazy,
  Suspense,
  useMemo,
  type ReactNode,
} from "react";
import { IS_NATIVE } from "@/lib/api/config";

const FullScreenPlayer = lazy(() =>
  import("@/components/FullScreenPlayer").then((m) => ({
    default: m.FullScreenPlayer,
  }))
);

const ROOT_TAB_PATHS = [
  "/",
  "/search",
  "/favorites",
  "/mine",
  "/settings",
] as const;

/** 根轨道滑动提交后的平滑落位时长（ms） */
const ROOT_SETTLE_MS = 260;
const ROOT_SETTLE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
/** 空闲预挂载相邻根页面的延迟（ms） */
const PREMOUNT_IDLE_MS = 450;

/**
 * 通知栏点击时原生 contentIntent 带的深链（见 MediaSessionPlugin#buildContentIntent）。
 * 命中就展开全屏播放器，而不是停在用户上次停留的页面。
 */
const OPEN_PLAYER_URL = "ottermusic://player";

/**
 * 按系统返回键时直接最小化 App 的路径。
 * 设置虽然也是底部 tab，但视觉上是从「我的」下去的二级页，
 * 返回应该是回上一级，而不是退出应用。
 */
const BACK_MINIMIZE_PATHS = ["/", "/search", "/favorites", "/mine"] as const;

/**
 * 冷启动的落地页（第一个 tab「发现」）。
 * 由路由 "/" 的 <Navigate> 负责：进程被回收后重新打开，从首页开始；
 * 热启动（最小化后再进来）保持原页面，不做跳转。
 */
const HOME_PATH = "/search";

function isRootTabPathname(path: string) {
  return ROOT_TAB_PATHS.includes(path as (typeof ROOT_TAB_PATHS)[number]);
}

function asRootTabOrderPath(path: string): RootTabPath | null {
  const normalized = path === "/" ? "/search" : path;
  return ROOT_TAB_ORDER.includes(normalized as RootTabPath)
    ? (normalized as RootTabPath)
    : null;
}

function renderDefaultRootTab(path: RootTabPath): ReactNode {
  switch (path) {
    case "/search":
      return <SearchRoute />;
    case "/favorites":
      return <FavoritesRoute />;
    case "/mine":
      return <MineRoute />;
    case "/settings":
      return <SettingsRoute />;
  }
}

export function RootLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const { isFullScreenPlayer, setIsFullScreenPlayer: setStoreFullScreen } =
    useMusicStore(
      useShallow((state) => ({
        isFullScreenPlayer: state.isFullScreenPlayer,
        setIsFullScreenPlayer: state.setIsFullScreenPlayer,
      }))
    );
  const { handleExit: handleExitLayer, push, pop } = useExitLayer();

  // 点顶栏 / 点系统状态栏回到滚动区顶部。
  useTapTopToScrollTop();

  const isTab = isRootTabPathname(location.pathname);

  // 二级页返回时恢复列表位置；根 tab 页本身保活，由 scroll-snapshot 单帧还原，
  // 不在这里跑 30 帧 rAF 循环抢占滑动帧率。
  useScrollRestoration(location.pathname, navigationType, false, !isTab);

  // Back Button Logic
  const locationRef = useRef(location);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    if (!isFullScreenPlayer) return;
    const id = push({
      close: () => setStoreFullScreen(false),
    });
    return () => {
      pop(id);
    };
  }, [isFullScreenPlayer, setStoreFullScreen, push, pop]);

  useEffect(() => {
    if (!IS_NATIVE) return;

    const cleanups: Array<() => void> = [];

    const openPlayerIfMatched = (url?: string | null) => {
      if (!url || !url.startsWith(OPEN_PLAYER_URL)) return;

      const openIfHasQueue = () => {
        if (useMusicStore.getState().queue.length === 0) return;
        setStoreFullScreen(true);
      };

      if (useMusicStore.persist.hasHydrated()) {
        openIfHasQueue();
        return;
      }
      const unsubscribe = useMusicStore.persist.onFinishHydration(() => {
        unsubscribe();
        openIfHasQueue();
      });
      cleanups.push(unsubscribe);
    };

    CapacitorApp.getLaunchUrl()
      .then((result) => openPlayerIfMatched(result?.url))
      .catch(() => undefined);

    const listener = CapacitorApp.addListener("appUrlOpen", (data) =>
      openPlayerIfMatched(data.url)
    );

    return () => {
      cleanups.forEach((fn) => fn());
      listener.then((l) => l.remove());
    };
  }, [setStoreFullScreen]);

  const shouldMinimizeOnBack = useCallback((path: string) => {
    return BACK_MINIMIZE_PATHS.includes(
      path as (typeof BACK_MINIMIZE_PATHS)[number]
    );
  }, []);

  const handleBackAction = useCallback(async () => {
    if (handleExitLayer()) return;

    const path = locationRef.current.pathname;

    if (shouldMinimizeOnBack(path)) {
      if (IS_NATIVE) {
        await CapacitorApp.minimizeApp();
      }
      return;
    }

    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) {
      navigate(-1);
      return;
    }

    navigate(HOME_PATH, { replace: true });
  }, [handleExitLayer, shouldMinimizeOnBack, navigate]);

  useEffect(() => {
    if (!IS_NATIVE) return;

    const listener = CapacitorApp.addListener("backButton", handleBackAction);

    return () => {
      listener.then((l) => l.remove());
    };
  }, [handleBackAction]);

  useEffect(() => {
    if (IS_NATIVE) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;

      const handled = handleExitLayer();
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleExitLayer]);

  const hasCurrentTrack = useMusicStore(
    (s) => s.queue.length > 0 && s.currentIndex >= 0
  );

  // 根 tab 间切换的进入动画（仅在点击底部 TabBar 等非跟手滑动触发时播放）
  const pageAnimClass = useMemo(() => {
    if (location.pathname === "/settings") return "";
    const state = location.state as {
      pageDir?: string;
      fromSwipe?: boolean;
    } | null;
    if (state?.fromSwipe) return "";
    if (state?.pageDir === "forward") return "page-enter-forward";
    if (state?.pageDir === "back") return "page-enter-back";
    return "";
    // 故意只依赖 pathname：同路径 replace 导航不应触发动画重播
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  /* ---------------- 根 tab 保活与横向联动轨道 ---------------- */
  const outlet = useOutlet();
  const tabPagesRef = useRef<Map<RootTabPath, ReactNode>>(new Map());
  const activeTabPath = asRootTabOrderPath(location.pathname);
  const [lastTabPath, setLastTabPath] = useState<RootTabPath>(
    activeTabPath ?? "/search"
  );
  if (activeTabPath && lastTabPath !== activeTabPath) {
    setLastTabPath(activeTabPath);
  }
  useEffect(() => {
    if (activeTabPath && outlet) {
      tabPagesRef.current.set(activeTabPath, outlet);
    }
  }, [activeTabPath, outlet]);
  const currentTabPath = activeTabPath ?? lastTabPath;
  const currentTabIndex = Math.max(0, ROOT_TAB_ORDER.indexOf(currentTabPath));

  // 已挂载过的根 tab 集合（初始仅包含当前路由，避免冷启动卡顿）
  const [mountedTabs, setMountedTabs] = useState<Set<RootTabPath>>(
    () => new Set<RootTabPath>(activeTabPath ? [activeTabPath] : [])
  );
  if (activeTabPath && !mountedTabs.has(activeTabPath)) {
    setMountedTabs((prev) => new Set(prev).add(activeTabPath));
  }

  // 空闲时预挂载当前页的左右直接相邻音乐根页，确保首次滑动即真实呈现相邻内容；
  // /settings 节点较多（1000+），不在进入 /mine 时抢占主线程预挂载，留到滑动意向或切换时再挂载。
  useEffect(() => {
    if (!activeTabPath) return;
    const idx = ROOT_TAB_ORDER.indexOf(activeTabPath);
    const neighbors = [ROOT_TAB_ORDER[idx - 1], ROOT_TAB_ORDER[idx + 1]].filter(
      (p): p is RootTabPath => Boolean(p) && p !== "/settings"
    );
    if (neighbors.every((p) => mountedTabs.has(p))) return;

    const mountNeighbors = () => {
      setMountedTabs((prev) => {
        if (neighbors.every((p) => prev.has(p))) return prev;
        const next = new Set(prev);
        neighbors.forEach((p) => next.add(p));
        return next;
      });
    };

    const win = window as Window & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number }
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === "function") {
      const idleId = win.requestIdleCallback(mountNeighbors, {
        timeout: PREMOUNT_IDLE_MS,
      });
      return () => win.cancelIdleCallback?.(idleId);
    }
    const timer = window.setTimeout(mountNeighbors, PREMOUNT_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [activeTabPath, mountedTabs]);

  const rootViewportRef = useRef<HTMLDivElement>(null);
  const rootTrackRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<Partial<Record<RootTabPath, HTMLDivElement | null>>>(
    {}
  );
  const alignersRef = useRef<Partial<Record<RootTabPath, RootTabAligner>>>({});
  const alignedTargetRef = useRef<RootTabPath | null>(null);
  const draggingRef = useRef(false);
  const widthRef = useRef(0);
  const animatingUntilRef = useRef(0);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommitRef = useRef<{
    target: RootTabPath;
    dir: "next" | "prev";
  } | null>(null);

  const settleCleanupRef = useRef<(() => void) | null>(null);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (settleCleanupRef.current) {
      settleCleanupRef.current();
      settleCleanupRef.current = null;
    }
  }, []);

  const getViewportWidth = useCallback(() => {
    const w =
      widthRef.current ||
      rootViewportRef.current?.clientWidth ||
      window.innerWidth ||
      0;
    if (w) widthRef.current = w;
    return w;
  }, []);

  // 将非激活的根槽位用 display:none 移出渲染/绘制树，仅在拖动或过渡露出时临时打开，
  // 同时用 scroll-snapshot 保存/还原各槽位内部的 scrollTop，兼顾极高帧率与滚动保活。
  const showSlotTemporarily = useCallback((path: RootTabPath) => {
    const el = slotRefs.current[path];
    if (!el) return;
    if (el.classList.contains("hidden") && el.style.display !== "block") {
      el.style.display = "block";
      restoreScrollPositions(el);
    }
    if (el.style.visibility !== "visible") el.style.visibility = "visible";
    if (el.style.pointerEvents !== "") el.style.pointerEvents = "";
  }, []);

  // 后台预热相邻槽位：保持 display:block + visibility:visible + pointer-events:none
  // （由外层 rootViewport 的 overflow-hidden 裁剪），提前跑完虚拟列表测量与 GPU 光栅化，
  // 滑动露出时 0 重排、0 首次光栅化掉帧。
  const warmSlotHidden = useCallback((path: RootTabPath) => {
    const el = slotRefs.current[path];
    if (!el) return;
    if (el.classList.contains("hidden") && el.style.display !== "block") {
      el.style.display = "block";
      restoreScrollPositions(el);
    }
    if (el.style.visibility !== "visible") el.style.visibility = "visible";
    if (el.style.pointerEvents !== "none") el.style.pointerEvents = "none";
  }, []);

  const resetSlotVisibilities = useCallback((keepPath: RootTabPath) => {
    const keepIdx = ROOT_TAB_ORDER.indexOf(keepPath);
    for (let i = 0; i < ROOT_TAB_ORDER.length; i++) {
      const path = ROOT_TAB_ORDER[i];
      if (path === keepPath) continue;
      const el = slotRefs.current[path];
      if (!el) continue;

      const isNeighbor = keepIdx !== -1 && Math.abs(i - keepIdx) === 1;
      if (isNeighbor && el.style.display === "block") {
        // 直接相邻页若已展开，保持后台预热态，避免切页后反复 display:none <-> block 震荡重排
        if (el.style.visibility !== "visible") el.style.visibility = "visible";
        if (el.style.pointerEvents !== "none") el.style.pointerEvents = "none";
        continue;
      }

      if (el.style.display || el.style.visibility || el.style.pointerEvents) {
        saveScrollPositions(el);
        el.style.display = "";
        el.style.visibility = "";
        el.style.pointerEvents = "";
      }
    }
  }, []);

  const applyRootTrack = useCallback((offset: number, animate: boolean) => {
    const track = rootTrackRef.current;
    if (!track) return;
    animatingUntilRef.current = animate ? Date.now() + ROOT_SETTLE_MS : 0;
    track.style.transition = animate
      ? `transform ${ROOT_SETTLE_MS}ms ${ROOT_SETTLE_EASING}`
      : "none";
    track.style.transform = `translate3d(${offset}px, 0, 0)`;
  }, []);

  const flushPendingCommit = useCallback(() => {
    const pending = pendingCommitRef.current;
    if (!pending) return;
    pendingCommitRef.current = null;
    clearSettleTimer();
    if (alignedTargetRef.current === pending.target) {
      alignersRef.current[pending.target]?.commitAlign();
      alignedTargetRef.current = null;
    }
    if (pending.target === "/settings") {
      useAppStore.getState().autoOpenUpdateDialogOnce();
    }
    navigate(pending.target, {
      state: {
        pageDir: pending.dir === "next" ? "forward" : "back",
        fromSwipe: true,
      },
    });
  }, [clearSettleTimer, navigate]);

  // 路由切换或从二级页返回根页时，同步对齐根轨道并还原当前槽位滚动位置
  const prevIsTabRef = useRef(isTab);
  const prevTabPathRef = useRef<RootTabPath>(currentTabPath);
  useLayoutEffect(() => {
    const wasTab = prevIsTabRef.current;
    const prevPath = prevTabPathRef.current;
    prevIsTabRef.current = isTab;
    prevTabPathRef.current = currentTabPath;

    if (wasTab && !isTab) {
      saveScrollPositions(slotRefs.current[prevPath]);
      return;
    }
    if (!isTab) return;

    if (!wasTab || prevPath !== currentTabPath) {
      if (prevPath !== currentTabPath) {
        saveScrollPositions(slotRefs.current[prevPath]);
      }
      restoreScrollPositions(slotRefs.current[currentTabPath]);
    }

    const viewport = rootViewportRef.current;
    const track = rootTrackRef.current;
    if (!viewport || !track) return;

    const width = viewport.clientWidth || window.innerWidth;
    if (!width) return;
    widthRef.current = width;

    clearSettleTimer();
    const isFromSwipe = Boolean(
      (location.state as { fromSwipe?: boolean } | null)?.fromSwipe
    );
    if (!isFromSwipe && alignedTargetRef.current) {
      // 点击底部 TabBar 等非滑动导航切走前，恢复曾为滑动预热对齐的后台页状态
      const aligned = alignedTargetRef.current;
      alignedTargetRef.current = null;
      if (aligned !== currentTabPath) {
        alignersRef.current[aligned]?.cancelAlign();
      } else {
        alignersRef.current[aligned]?.cancelAlign();
      }
    }
    resetSlotVisibilities(currentTabPath);
    if (currentTabPath === "/settings" && mountedTabs.has("/mine")) {
      warmSlotHidden("/mine");
    }
    const activeEl = slotRefs.current[currentTabPath];
    if (activeEl) {
      activeEl.style.display = "";
      activeEl.style.visibility = "";
      activeEl.style.pointerEvents = "";
    }
    applyRootTrack(-currentTabIndex * width, false);
  }, [
    isTab,
    currentTabIndex,
    currentTabPath,
    location.state,
    mountedTabs,
    applyRootTrack,
    clearSettleTimer,
    resetSlotVisibilities,
    warmSlotHidden,
  ]);

  // 进入根页后空闲预热：在后台把直接相邻的根页提前展开布局（visibility:hidden），
  // 并在需要首尾对齐的页面提前对齐对应端，侧滑瞬间 0 卡顿。
  useEffect(() => {
    if (!isTab || !activeTabPath) return;

    const timer = window.setTimeout(() => {
      if (draggingRef.current || pendingCommitRef.current) return;
      if (activeTabPath === "/settings") {
        if (mountedTabs.has("/mine")) {
          warmSlotHidden("/mine");
          alignedTargetRef.current = "/mine";
          alignersRef.current["/mine"]?.previewAlign("end");
        }
      } else if (activeTabPath === "/mine") {
        if (mountedTabs.has("/favorites")) {
          warmSlotHidden("/favorites");
        }
        if (mountedTabs.has("/settings")) {
          warmSlotHidden("/settings");
        }
      } else if (activeTabPath === "/favorites") {
        if (mountedTabs.has("/mine")) {
          warmSlotHidden("/mine");
          alignedTargetRef.current = "/mine";
          alignersRef.current["/mine"]?.previewAlign("start");
        }
        if (mountedTabs.has("/search")) {
          warmSlotHidden("/search");
        }
      } else if (activeTabPath === "/search") {
        if (mountedTabs.has("/favorites")) {
          warmSlotHidden("/favorites");
        }
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [isTab, activeTabPath, mountedTabs, warmSlotHidden]);

  useLayoutEffect(() => {
    if (!isTab) return;
    const viewport = rootViewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (draggingRef.current) return;
      const width = viewport.clientWidth || window.innerWidth;
      if (!width) return;
      widthRef.current = width;
      applyRootTrack(-currentTabIndex * width, false);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [isTab, currentTabIndex, applyRootTrack]);

  useEffect(() => clearSettleTimer, [clearSettleTimer]);

  const rootPagerValue = useMemo<RootPagerContextValue>(
    () => ({
      activePath: activeTabPath,
      canSlideEdge: (fromTab, dir) =>
        resolveRootNeighborPath(fromTab, dir) !== null,
      getViewportWidth,
      prepareEdgeNeighbor: (fromTab, dir) => {
        flushPendingCommit();
        const target = resolveRootNeighborPath(fromTab, dir);
        if (!target) return null;

        clearSettleTimer();
        if (alignedTargetRef.current && alignedTargetRef.current !== target) {
          alignersRef.current[alignedTargetRef.current]?.cancelAlign();
          alignedTargetRef.current = null;
        }

        setMountedTabs((prev) =>
          prev.has(target) ? prev : new Set(prev).add(target)
        );
        showSlotTemporarily(target);

        const alignEdge = dir === "next" ? "start" : "end";
        if (alignedTargetRef.current !== target) {
          alignedTargetRef.current = target;
          alignersRef.current[target]?.previewAlign(alignEdge);
        }
        return target;
      },
      dragRootBy: (deltaX) => {
        clearSettleTimer();
        draggingRef.current = true;
        const width = getViewportWidth();
        const fromPath = ROOT_TAB_ORDER[currentTabIndex];
        if (deltaX < 0) {
          const next = ROOT_TAB_ORDER[currentTabIndex + 1];
          if (next) showSlotTemporarily(next);
        } else if (deltaX > 0) {
          const prev = ROOT_TAB_ORDER[currentTabIndex - 1];
          if (prev) showSlotTemporarily(prev);
        }
        if (fromPath) showSlotTemporarily(fromPath);
        applyRootTrack(-currentTabIndex * width + deltaX, false);
      },
      getRootDragOffset: () => {
        if (pendingCommitRef.current) {
          flushPendingCommit();
          return 0;
        }
        const track = rootTrackRef.current;
        if (!track || Date.now() >= animatingUntilRef.current) return 0;
        const width = getViewportWidth();
        return readTranslateX(track) + currentTabIndex * width;
      },
      cancelRootDrag: (animate) => {
        draggingRef.current = false;
        clearSettleTimer();
        const width = getViewportWidth();
        applyRootTrack(-currentTabIndex * width, animate);
        const aligned = alignedTargetRef.current;
        alignedTargetRef.current = null;
        if (animate) {
          settleTimerRef.current = setTimeout(() => {
            settleTimerRef.current = null;
            if (rootTrackRef.current)
              rootTrackRef.current.style.transition = "none";
            resetSlotVisibilities(currentTabPath);
            if (aligned) alignersRef.current[aligned]?.cancelAlign();
          }, ROOT_SETTLE_MS + 20);
        } else {
          resetSlotVisibilities(currentTabPath);
          if (aligned) alignersRef.current[aligned]?.cancelAlign();
        }
      },
      commitRootEdge: (fromTab: RootTabId, dir) => {
        draggingRef.current = false;
        const target = resolveRootNeighborPath(fromTab, dir);
        if (!target) return;
        const targetIndex = ROOT_TAB_ORDER.indexOf(target);
        const width = getViewportWidth();

        showSlotTemporarily(target);
        clearSettleTimer();
        pendingCommitRef.current = { target, dir };
        // 先在纯 GPU 合成层跑完 260ms 滑行过渡，等 transitionend 真正到达终点后再切换路由，避免提前截断最后一帧
        applyRootTrack(-targetIndex * width, true);
        const track = rootTrackRef.current;
        const finish = () => {
          clearSettleTimer();
          if (rootTrackRef.current) {
            rootTrackRef.current.style.transition = "none";
          }
          flushPendingCommit();
        };
        if (track) {
          const onTransitionEnd = (e: TransitionEvent) => {
            if (e.target !== track || e.propertyName !== "transform") return;
            finish();
          };
          track.addEventListener("transitionend", onTransitionEnd);
          settleCleanupRef.current = () => {
            track.removeEventListener("transitionend", onTransitionEnd);
          };
        }
        settleTimerRef.current = setTimeout(finish, ROOT_SETTLE_MS + 60);
      },
      registerAligner: (path, aligner) => {
        alignersRef.current[path] = aligner;
        return () => {
          if (alignersRef.current[path] === aligner) {
            delete alignersRef.current[path];
          }
        };
      },
    }),
    [
      activeTabPath,
      currentTabIndex,
      currentTabPath,
      getViewportWidth,
      clearSettleTimer,
      showSlotTemporarily,
      resetSlotVisibilities,
      applyRootTrack,
      flushPendingCommit,
    ]
  );

  return (
    <RootPagerContext.Provider value={rootPagerValue}>
      <MusicLayout
        hidePlayer={isFullScreenPlayer || !hasCurrentTrack}
        isTab={isTab}
        player={
          <MusicNowPlayingBar
            onOpenFullScreen={() => setStoreFullScreen(true)}
          />
        }
        tabBar={<MusicTabBar />}
      >
        {/* 根级 Tab 滑动轨道：处于二级页时整轨 hidden 保活 */}
        <div
          ref={rootViewportRef}
          data-root-pager-viewport
          className={cn(
            "relative h-full w-full overflow-hidden",
            !isTab && "hidden"
          )}
        >
          <div
            ref={rootTrackRef}
            data-root-pager-track
            className="flex h-full w-full will-change-transform"
          >
            {ROOT_TAB_ORDER.map((path, idx) => {
              const active = isTab && path === currentTabPath;
              const isMounted = mountedTabs.has(path);
              // 生产环境中 4 个根 Tab 与 renderDefaultRootTab 一一对应，始终复用同一组件实例，
              // 避免从预挂载组件切换成 Router outlet（RenderedRoute）时整棵树卸载重建。
              const useTestOutlet = Boolean(import.meta.env.VITEST);
              const content = isMounted
                ? useTestOutlet
                  ? path === activeTabPath && outlet
                    ? outlet
                    : (tabPagesRef.current.get(path) ??
                      renderDefaultRootTab(path))
                  : (tabPagesRef.current.get(path) ??
                    (() => {
                      const node = renderDefaultRootTab(path);
                      tabPagesRef.current.set(path, node);
                      return node;
                    })())
                : null;
              return (
                <div
                  key={path}
                  data-root-slot-shell={path}
                  className={cn(
                    "relative h-full w-full shrink-0",
                    // 滑动衔接时在相邻页面接缝处提供细微边界线与边缘阴影，
                    // 将两页区分为独立画布，避免不同高度的横线直接视觉碰撞
                    idx > 0 &&
                      "before:pointer-events-none before:absolute before:inset-y-0 before:-left-3 before:z-30 before:w-3 before:bg-gradient-to-l before:from-black/[0.06] before:to-transparent dark:before:from-black/30 after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:z-30 after:w-px after:bg-border/50"
                  )}
                >
                  <div
                    ref={(node) => {
                      slotRefs.current[path] = node;
                    }}
                    data-page-route={path}
                    data-page-active={active ? "true" : "false"}
                    aria-hidden={!active || undefined}
                    className={cn(
                      "h-full w-full will-change-transform [contain:layout_style_paint]",
                      !active && "hidden",
                      active && pageAnimClass
                    )}
                  >
                    {content}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 二级页直接渲染在独立槽位中 */}
        {!isTab && outlet && (
          <div
            key={location.pathname}
            data-page-route={location.pathname}
            data-page-active="true"
            className="h-full"
          >
            {outlet}
          </div>
        )}
      </MusicLayout>

      <GlobalMusicPlayer />

      <ConfirmDialogHost />

      <Suspense fallback={null}>
        <FullScreenPlayer
          isFullScreen={isFullScreenPlayer}
          onClose={() => setStoreFullScreen(false)}
        />
      </Suspense>
    </RootPagerContext.Provider>
  );
}
