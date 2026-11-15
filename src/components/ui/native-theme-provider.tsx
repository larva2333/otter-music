"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from "next-themes";
import { App } from "@capacitor/app";
import { IS_NATIVE } from "@/lib/api/config";
import { applySystemBarsStyle } from "@/lib/system-bars";
import { LocalMusicPlugin } from "@/plugins/local-music";

type ThemePreference = "system" | "light" | "dark";

interface ThemePreferenceContextValue {
  themePref: ThemePreference;
  setThemePref: (pref: ThemePreference) => void;
}

const ThemePreferenceContext = createContext<ThemePreferenceContextValue>({
  themePref: "system",
  setThemePref: () => {},
});

export function useThemePreference() {
  return useContext(ThemePreferenceContext);
}

async function fetchSystemTheme(): Promise<"light" | "dark" | null> {
  try {
    const result = await LocalMusicPlugin.getSystemDarkMode();
    return result.isDarkMode ? "dark" : "light";
  } catch {
    return null;
  }
}

function getMatchMediaTheme(): "light" | "dark" | null {
  if (typeof window === "undefined") return null;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return null;
  }
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {}
  return "system";
}

/**
 * 原生平台主题 Provider
 *
 * 解决 Capacitor WebView 中 next-themes 无法正确检测系统主题的问题。
 * 通过原生插件 + matchMedia 双重监听，实现系统主题实时感知。
 * 当用户选择"跟随系统"时实时响应系统主题变更，无需退出重进。
 * 使用 next-themes 默认 localStorage key("theme")持久化用户选择。
 */
export function NativeThemeProvider({
  children,
  ...props
}: ThemeProviderProps) {
  const [systemTheme, setSystemTheme] = useState<"light" | "dark" | null>(
    !IS_NATIVE ? null : getMatchMediaTheme()
  );
  const [themePref, setThemePrefState] =
    useState<ThemePreference>(readStoredPreference);
  const [isReady, setIsReady] = useState(!IS_NATIVE);

  const setThemePref = useCallback((pref: ThemePreference) => {
    setThemePrefState(pref);
    try {
      localStorage.setItem("theme", pref);
    } catch {}
    // 同步给原生：冷启动时启动窗口/WebView 的底色由它决定，早于网页加载
    if (IS_NATIVE) {
      void LocalMusicPlugin.setStoredTheme({ value: pref }).catch(() => {});
    }
  }, []);

  // 首启时把当前偏好补写一份给原生（升级上来的用户 SharedPreferences 里还没有）
  useEffect(() => {
    if (!IS_NATIVE) return;
    void LocalMusicPlugin.setStoredTheme({ value: readStoredPreference() }).catch(
      () => {},
    );
  }, []);

  useEffect(() => {
    if (!IS_NATIVE) return;

    fetchSystemTheme().then((theme) => {
      if (theme) setSystemTheme(theme);
      setIsReady(true);
    });

    const handleResume = () => {
      fetchSystemTheme().then((theme) => {
        if (theme) setSystemTheme(theme);
      });
    };

    App.addListener("resume", handleResume);

    let darkModeListener: Awaited<
      ReturnType<typeof LocalMusicPlugin.addListener>
    > | null = null;
    LocalMusicPlugin.addListener("darkModeChange", (event) => {
      setSystemTheme(event.isDarkMode ? "dark" : "light");
    }).then((handle) => {
      darkModeListener = handle;
    });

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    mql.addEventListener("change", handleChange);

    return () => {
      App.removeAllListeners();
      darkModeListener?.remove();
      mql.removeEventListener("change", handleChange);
    };
  }, []);

  const forcedTheme: string | undefined =
    themePref === "system"
      ? IS_NATIVE
        ? (systemTheme ?? undefined)
        : undefined
      : themePref;

  const isDarkTheme =
    (themePref === "system" ? systemTheme : themePref) === "dark";
  const isDarkThemeRef = useRef(isDarkTheme);
  isDarkThemeRef.current = isDarkTheme;

  // 主题变化时同步系统栏图标明暗；等初始化完成再设，避免用默认浅色闪一下
  useEffect(() => {
    if (!IS_NATIVE || !isReady) return;
    void applySystemBarsStyle(isDarkTheme);
  }, [isDarkTheme, isReady]);

  // 首帧底色由 index.html 的内联脚本铺（读 localStorage），这里跟随主题变化保持一致，
  // 并把「实际解析出的主题」写回去，供下次冷启动的首帧使用。
  // 只改 backgroundColor，不写 color-scheme：WebView 会把根节点的 color-scheme
  // 同步成导航栏按钮颜色，并让部分输入框聚焦时弹不出输入法。
  useEffect(() => {
    if (!isReady) return;
    document.documentElement.style.backgroundColor = isDarkTheme
      ? "#0f151f"
      : "#fafcff";
    document.documentElement.style.colorScheme = "";
    try {
      localStorage.setItem("otter_resolved_theme", isDarkTheme ? "dark" : "light");
    } catch {}
  }, [isDarkTheme, isReady]);

  // 从后台/下拉通知栏回到 App 后，部分 ROM 会重置系统栏外观，重新应用一次
  useEffect(() => {
    if (!IS_NATIVE) return;
    const listener = App.addListener("resume", () => {
      void applySystemBarsStyle(isDarkThemeRef.current);
    });
    return () => {
      void listener.then((l) => l.remove());
    };
  }, []);

  if (IS_NATIVE && !isReady) {
    return <div style={{ visibility: "hidden" }}>{children}</div>;
  }

  return (
    <ThemePreferenceContext.Provider value={{ themePref, setThemePref }}>
      <NextThemesProvider {...props} forcedTheme={forcedTheme}>
        {children}
      </NextThemesProvider>
    </ThemePreferenceContext.Provider>
  );
}
