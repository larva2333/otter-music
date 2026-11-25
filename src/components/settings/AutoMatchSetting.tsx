import { Wand2 } from "lucide-react";
import { useMusicStore } from "@/store/music-store";
import { Switch } from "@/components/ui/switch";
import { SettingItem } from "./SettingItem";

export function AutoMatchSetting() {
  const enableAutoMatch = useMusicStore((s) => s.enableAutoMatch);
  const setEnableAutoMatch = useMusicStore((s) => s.setEnableAutoMatch);

  return (
    <SettingItem
      icon={Wand2}
      title="自动换源"
      subtitle={
        enableAutoMatch
          ? "播放失败时并发搜索并播放可替代音源"
          : "已关闭：播放失败不再搜索替代音源"
      }
      action={
        <Switch
          checked={enableAutoMatch}
          onCheckedChange={setEnableAutoMatch}
        />
      }
    />
  );
}
