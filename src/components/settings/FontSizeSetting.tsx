import { Type } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingItem } from "./SettingItem";
import {
  FONT_SCALE_OPTIONS,
  useUiPrefsStore,
  type FontScale,
} from "@/store/ui-prefs-store";

export function FontSizeSetting() {
  const fontScale = useUiPrefsStore((state) => state.fontScale);
  const setFontScale = useUiPrefsStore((state) => state.setFontScale);

  return (
    <SettingItem
      icon={Type}
      title="字体大小"
      subtitle="调整全站文字大小"
      action={
        <Select
          value={fontScale}
          onValueChange={(value) => setFontScale(value as FontScale)}
        >
          <SelectTrigger className="h-8 w-24 border-muted bg-transparent px-2.5 text-xs text-foreground hover:bg-muted/20">
            <SelectValue placeholder="字体大小" />
          </SelectTrigger>
          <SelectContent>
            {FONT_SCALE_OPTIONS.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}
