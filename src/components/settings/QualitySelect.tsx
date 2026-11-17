import { useMusicStore } from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Music } from "lucide-react";
import { SettingItem } from "./SettingItem";
import { QUALITY_OPTIONS } from "@/lib/utils/quality";

/** 收起态只显示音质档位，完整带宽写在展开列表里 */
const SHORT_LABELS: Record<string, string> = {
  "128": "标准",
  "192": "高品",
  "320": "极高",
  "999": "无损",
};

export function QualitySelect() {
  const { quality, setQuality } = useMusicStore(
    useShallow((state) => ({
      quality: state.quality,
      setQuality: state.setQuality,
    }))
  );

  return (
    <SettingItem
      icon={Music}
      title="音质设置"
      action={
        <Select value={quality} onValueChange={setQuality}>
          <SelectTrigger className="h-7 px-2 bg-transparent border-muted hover:bg-muted/20 w-20">
            <SelectValue>{SHORT_LABELS[quality] ?? "音质"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {QUALITY_OPTIONS.map(({ value, label }) => (
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
