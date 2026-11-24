import { useMusicStore } from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageCircleMore } from "lucide-react";
import { SettingItem } from "./SettingItem";
import {
  COMMENT_SOURCE_OPTIONS,
  type CommentSourcePreference,
} from "@/lib/comments/options";

/** 设置页的评论来源选择，与播放页评论标题旁的按钮共用同一状态 */
export function CommentSourceSelect() {
  const { commentSource, setCommentSource } = useMusicStore(
    useShallow((state) => ({
      commentSource: state.commentSource,
      setCommentSource: state.setCommentSource,
    }))
  );

  return (
    <SettingItem
      icon={MessageCircleMore}
      title="评论来源"
      subtitle="自动会依次尝试网易云、QQ 音乐、酷我"
      action={
        <Select
          value={commentSource}
          onValueChange={(v) => setCommentSource(v as CommentSourcePreference)}
        >
          <SelectTrigger className="h-7 px-2 bg-transparent border-muted hover:bg-muted/20 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMMENT_SOURCE_OPTIONS.map(({ value, label }) => (
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
