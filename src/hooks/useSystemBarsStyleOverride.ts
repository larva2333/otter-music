import { useEffect } from "react";
import { IS_NATIVE } from "@/lib/api/config";
import { setSystemBarsStyleOverride } from "@/lib/system-bars";

/**
 * 页面级覆盖系统栏图标明暗。
 *
 * 用于背景恒为深色的页面（全屏播放器、横屏播放器）：这类页面在浅色主题下
 * 会被主题算成「深色图标」，落在深色背景上就是黑底黑图标，完全看不清。
 * 打开时强制浅色图标，关闭时交还给应用主题。
 *
 * @param isDarkContent 页面背景是否为深色（true → 系统栏用浅色内容）
 * @param active 是否生效，默认 true
 * @param delayMs 生效延迟，默认 0。全屏播放器有 500ms 的展开动画，若在动画开始时
 *   就切系统栏，状态栏会先跳一次颜色、此时播放页还没盖到顶部，观感是颜色先变页面后到。
 *   只延迟「生效」这一侧：收起时页面是向下滑走的，状态栏区域几乎立刻露出浅色页面，
 *   还原再延迟就会白图标压白底。
 */
export function useSystemBarsStyleOverride(
  isDarkContent: boolean,
  active = true,
  delayMs = 0
) {
  useEffect(() => {
    if (!IS_NATIVE) return;

    // 取消覆盖必须立刻生效，否则会有一段时间图标明暗和背景相反
    if (!active) {
      setSystemBarsStyleOverride(null);
      return;
    }

    if (delayMs <= 0) {
      setSystemBarsStyleOverride(isDarkContent);
      return () => setSystemBarsStyleOverride(null);
    }

    const timer = setTimeout(
      () => setSystemBarsStyleOverride(isDarkContent),
      delayMs
    );
    return () => clearTimeout(timer);
  }, [isDarkContent, active, delayMs]);

  // 组件卸载后覆盖值会留在模块级状态里，必须还原，否则其他页面系统栏会一直是错的
  useEffect(() => {
    return () => {
      if (IS_NATIVE) setSystemBarsStyleOverride(null);
    };
  }, []);
}
