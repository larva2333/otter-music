import { useEffect, useState } from "react";

/**
 * 当前是否深色主题。
 *
 * 直接盯根节点的 class（next-themes 的 attribute="class"）而不是 useTheme()：
 * 项目用的是自定义 provider，主题偏好最终以 forcedTheme 形式落到 class 上，
 * useTheme() 的 resolvedTheme 在切换时可能滞后一拍，导致依赖它的取色模式不更新。
 * class 是渲染的最终依据，监听它最可靠。
 */
export function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(() =>
    typeof document === "undefined"
      ? false
      : document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
