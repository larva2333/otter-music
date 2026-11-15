import { NativeThemeProvider } from "@/components/ui/native-theme-provider";
import { useEffect, type PropsWithChildren } from "react";
import { Toaster } from "react-hot-toast";
import { applyFontScale, useUiPrefsStore } from "@/store/ui-prefs-store";

// 胶囊固定浅色品牌绿。对勾的圆是库画的，用深色主题那档更亮的绿，
// 两种模式都能从胶囊上看出来。错误圆固定浅色红。
const TOAST_GREEN = "hsl(156 71% 39%)";
const TOAST_CHECK = "hsl(159 45% 56%)";
const TOAST_RED = "hsl(359 71% 55%)";

export default function RootLayout({ children }: PropsWithChildren) {
  const fontScale = useUiPrefsStore((state) => state.fontScale);

  // 持久化恢复是异步的，这里兜一次，确保切换后立刻生效
  useEffect(() => {
    applyFontScale(fontScale);
  }, [fontScale]);

  return (
    <NativeThemeProvider
      attribute="class"
      enableSystem
      disableTransitionOnChange
    >
      {children}

      <Toaster
        position="top-center"
        gutter={8}
        containerStyle={{
          top: "calc(16px + var(--safe-area-top))",
        }}
        toastOptions={{
          duration: 2000,
          // 深色主题把 --primary-foreground 配成近黑，胶囊上会看不清。
          // 字固定白色，底用浅色主题那档品牌绿，两种模式都能读清。
          style: {
            padding: "10px 18px",
            fontSize: "var(--text-sm)",
            lineHeight: 1.4,
            borderRadius: "999px",
            maxWidth: "88vw",
            margin: "0 auto",
            color: "#fff",
            background: TOAST_GREEN,
            boxShadow: "0 6px 20px hsla(156, 71%, 39%, 0.28)",
          },
          success: {
            iconTheme: { primary: TOAST_CHECK, secondary: "#fff" },
          },
          error: {
            iconTheme: { primary: TOAST_RED, secondary: "#fff" },
          },
          loading: {
            iconTheme: { primary: "#fff", secondary: "rgba(255,255,255,0.35)" },
          },
        }}
      />
    </NativeThemeProvider>
  );
}
