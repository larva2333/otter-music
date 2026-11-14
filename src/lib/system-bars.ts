import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { IS_NATIVE } from "@/lib/api/config";
import { logger } from "@/lib/logger";

/**
 * 页面级强制覆盖系统栏明暗。
 *
 * `null` 表示不覆盖、跟随应用主题；`true`/`false` 表示正文是深/浅背景，
 * 系统栏图标相应地用浅色/深色。
 */
let styleOverride: boolean | null = null;

function themeIsDarkNow(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

/**
 * 同步原生系统栏（状态栏的时间/电量/图标、三键导航栏按钮）的明暗。
 *
 * 必须显式指定而不能用 DEFAULT：SystemBars 的 DEFAULT 只看系统 uiMode，
 * 而 App 的深色主题是 next-themes 加在 <html> 上的 .dark 类，两者可以不一致
 * （系统浅色 + App 内手动深色，就是状态栏时间看不见的那一档）。
 *
 * @param themeIsDark 应用主题是否为深色；存在页面级覆盖时以覆盖为准
 */
export async function applySystemBarsStyle(themeIsDark: boolean) {
  if (!IS_NATIVE) return;
  const isDarkContent = styleOverride ?? themeIsDark;
  try {
    await SystemBars.setStyle({
      style: isDarkContent ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    });
  } catch (error) {
    logger.warn("NativeTheme", "同步系统栏明暗失败", error as Error);
  }
}

/**
 * 设置临时覆盖（例如全屏播放器背景恒为深色，必须用浅色图标）。
 *
 * 传 `null` 取消覆盖，并按当前应用主题立即重新应用一次。
 * 覆盖是模块级状态而非组件状态，这样从后台回到前台时 NativeThemeProvider
 * 的 resume 重设也会尊重它，不会被主题值覆盖回去。
 */
export function setSystemBarsStyleOverride(override: boolean | null) {
  styleOverride = override;
  void applySystemBarsStyle(themeIsDarkNow());
}
