import { NativeThemeProvider } from "@/components/ui/native-theme-provider";
import { useEffect, type PropsWithChildren } from "react";
import { Toaster } from "react-hot-toast";
import { applyFontScale, useUiPrefsStore } from "@/store/ui-prefs-store";

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
        gutter={12}
        containerStyle={{
          top: "calc(24px + var(--safe-area-top))",
        }}
        toastOptions={{
          duration: 2000,
          style: {
            padding: "12px 16px",
            fontSize: "var(--text-sm)",
            borderRadius: "8px",
            maxWidth: "90%",
            margin: "0 auto",
          },
        }}
      />
    </NativeThemeProvider>
  );
}
