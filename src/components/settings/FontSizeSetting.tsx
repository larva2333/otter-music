import { Type } from "lucide-react";
import { cn } from "@/lib/utils";
import { SettingItem } from "./SettingItem";
import {
  FONT_SCALE_OPTIONS,
  useUiPrefsStore,
  type FontScale,
} from "@/store/ui-prefs-store";

/**
 * 字体大小：平铺分段控件，与主题切换一致。
 *
 * 只有三档，下拉要先展开再选，等于两步；平铺一眼看到全部档位和当前值。
 */
export function FontSizeSetting() {
  const fontScale = useUiPrefsStore((state) => state.fontScale);
  const setFontScale = useUiPrefsStore((state) => state.setFontScale);

  return (
    <SettingItem
      icon={Type}
      title="字体大小"
      subtitle="调整全站文字大小"
      action={
        <div
          role="radiogroup"
          aria-label="字体大小"
          className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5"
        >
          {FONT_SCALE_OPTIONS.map(({ value, label }) => {
            const active = fontScale === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setFontScale(value as FontScale)}
                className={cn(
                  "h-7 rounded-md px-2 text-xs transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      }
    />
  );
}
