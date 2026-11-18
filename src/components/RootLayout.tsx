import {
  Outlet,
  useLocation,
  useNavigate,
  useNavigationType,
} from "react-router-dom";
import { MusicLayout } from "@/components/MusicLayout";
import { MusicNowPlayingBar } from "@/components/MusicNowPlayingBar";
import { MusicTabBar } from "@/components/MusicTabBar";
import { GlobalMusicPlayer } from "@/components/GlobalMusicPlayer";
import { ConfirmDialogHost } from "@/components/ui/confirm-dialog";
import { useMusicStore } from "@/store/music-store";
import { cn } from "@/lib/utils";
import { useShallow } from "zustand/react/shallow";
import { useExitLayer } from "@/hooks/useExitLayer";
import { useTapTopToScrollTop } from "@/hooks/useTapTopToScrollTop";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { App as CapacitorApp } from "@capacitor/app";
import { useEffect, useCallback, useRef, lazy, Suspense } from "react";
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

  // 点顶栏回到列表顶部（全屏播放器有自己的滚动区，那里不接管）
  useTapTopToScrollTop(!isFullScreenPlayer);

  // 返回二级页时恢复上次的滚动位置（回收站 → 设置页等），前进/新开页面仍从顶部
  useScrollRestoration(location.pathname, navigationType);

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

    /** 等待队列就绪的清理函数，卸载时统一摘掉，避免组件已经走了还去改 store */
    const cleanups: Array<() => void> = [];

    const openPlayerIfMatched = (url?: string | null) => {
      if (!url || !url.startsWith(OPEN_PLAYER_URL)) return;

      const openIfHasQueue = () => {
        // 没有播放内容时打开播放页只会是个空壳，留在当前页
        if (useMusicStore.getState().queue.length === 0) return;
        setStoreFullScreen(true);
      };

      // 冷启动时队列还在从 IndexedDB 恢复，等 hydration 完成再判断，
      // 否则会把「有歌但还没读出来」误判成空队列，白白丢掉这次深链
      if (useMusicStore.persist.hasHydrated()) {
        openIfHasQueue();
        return;
      }
      // 回调必定在 hydration 之后触发，此时 unsubscribe 已赋值
      const unsubscribe = useMusicStore.persist.onFinishHydration(() => {
        unsubscribe();
        openIfHasQueue();
      });
      cleanups.push(unsubscribe);
    };

    // 冷启动：App 被回收后点通知，此时 WebView 刚起来，靠 launchUrl 拿深链
    CapacitorApp.getLaunchUrl()
      .then((result) => openPlayerIfMatched(result?.url))
      .catch(() => undefined);

    // 热启动：App 在后台，点通知走 onNewIntent → appUrlOpen
    const listener = CapacitorApp.addListener("appUrlOpen", (data) =>
      openPlayerIfMatched(data.url)
    );

    return () => {
      cleanups.forEach((fn) => fn());
      listener.then((l) => l.remove());
    };
  }, [setStoreFullScreen]);

  const isRootTabPath = useCallback((path: string) => {
    return ROOT_TAB_PATHS.includes(path as (typeof ROOT_TAB_PATHS)[number]);
  }, []);

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
        // 在主 tab 上返回 = 退出应用（最小化）。这里**故意不做任何复位**：
        // WebView 实例还在，热启动回来应当停在原地（这就是「热启动保留」）。
        // 冷启动才回到首页 / 第一个分类，由路由 "/" 的 Navigate 和 store
        // 的 merge 兜住，两条路径各管各的。
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

  const isTab = isRootTabPath(location.pathname);

  // 根 tab 间切换的进入动画：方向由导航方随 location.state 带来
  //（底部 tab 点击 / 跨 tab 滑动都会带 pageDir），二级页与同路由内的类别切换不带，不播放。
  const pageDir = (location.state as { pageDir?: string } | null)?.pageDir;
  const pageAnimClass =
    pageDir === "forward"
      ? "page-enter-forward"
      : pageDir === "back"
        ? "page-enter-back"
        : "";

  return (
    <>
      <MusicLayout
        hidePlayer={isFullScreenPlayer || !hasCurrentTrack}
        isTab={isTab}
        player={
          // 播放条全站统一胶囊形态：非 tab 页（歌单/专辑/歌手等）不再放大成全宽底栏，
          // 否则进二级页会突然变高变宽，位置也往下掉一截
          <MusicNowPlayingBar
            onOpenFullScreen={() => setStoreFullScreen(true)}
          />
        }
        tabBar={<MusicTabBar />}
      >
        <div key={location.pathname} className={cn("h-full", pageAnimClass)}>
          <Outlet />
        </div>
      </MusicLayout>

      <GlobalMusicPlayer />

      {/* 全应用唯一的确认框宿主，替代系统原生 confirm */}
      <ConfirmDialogHost />

      <Suspense fallback={null}>
        <FullScreenPlayer
          isFullScreen={isFullScreenPlayer}
          onClose={() => setStoreFullScreen(false)}
        />
      </Suspense>
    </>
  );
}
