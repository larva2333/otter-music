import { useEffect } from "react";
import { setScrimActive } from "@/lib/system-bars";

/**
 * 全屏遮罩（Dialog / Sheet / Drawer 的黑色蒙层）存在期间，把状态栏图标切成浅色。
 *
 * 遮罩会一直铺到状态栏下面，浅色主题下原本的深色时间/电量落在这层半透明黑上
 * 基本看不清。按层数计数，叠多层遮罩时最后一层关掉才还原。
 *
 * @param active 遮罩是否真的可见，默认 true（组件挂载即生效）
 */
export function useScrimSystemBars(active = true) {
  useEffect(() => {
    if (!active) return;
    setScrimActive(true);
    return () => setScrimActive(false);
  }, [active]);
}
