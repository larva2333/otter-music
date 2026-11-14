import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { MusicLayout } from "@/components/MusicLayout";
import { MusicNowPlayingBar } from "@/components/MusicNowPlayingBar";
import { MusicTabBar } from "@/components/MusicTabBar";
import { GlobalMusicPlayer } from "@/components/GlobalMusicPlayer";
import { useMusicStore } from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import { useExitLayer } from "@/hooks/useExitLayer";
import { useTapTopToScrollTop } from "@/hooks/useTapTopToScrollTop";
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

export function RootLayout() {
  const location = useLocation();
  const navigate = useNavigate();
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
        await CapacitorApp.minimizeApp();
      }
      return;
    }

    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) {
      navigate(-1);
      return;
    }

    navigate("/search", { replace: true });
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

  return (
    <>
      <MusicLayout
        hidePlayer={isFullScreenPlayer || !hasCurrentTrack}
        isTab={isTab}
        player={
          <MusicNowPlayingBar
            onOpenFullScreen={() => setStoreFullScreen(true)}
            isTab={isTab}
          />
        }
        tabBar={<MusicTabBar />}
      >
        <Outlet />
      </MusicLayout>

      <GlobalMusicPlayer />

      <Suspense fallback={null}>
        <FullScreenPlayer
          isFullScreen={isFullScreenPlayer}
          onClose={() => setStoreFullScreen(false)}
        />
      </Suspense>
    </>
  );
}
