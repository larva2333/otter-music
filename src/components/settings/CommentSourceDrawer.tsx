import { Check } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  COMMENT_SOURCE_OPTIONS,
  type CommentSourcePreference,
} from "@/lib/comments/options";
import { cn } from "@/lib/utils";
import { useMusicStore } from "@/store/music-store";

interface CommentSourceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 评论来源选择抽屉：播放页评论标题旁的按钮点开此组件 */
export function CommentSourceDrawer({
  open,
  onOpenChange,
}: CommentSourceDrawerProps) {
  const commentSource = useMusicStore((s) => s.commentSource);
  const setCommentSource = useMusicStore((s) => s.setCommentSource);

  const handleSelect = (value: CommentSourcePreference) => {
    setCommentSource(value);
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="rounded-t-3xl border-none bg-background/95 p-0 backdrop-blur-xl outline-none">
        <DrawerHeader className="px-6 pb-3 pt-5 text-left">
          <DrawerTitle className="text-lg font-semibold tracking-tight">
            评论来源
          </DrawerTitle>
          <p className="mt-1 text-xs text-muted-foreground/50">
            自动会依次尝试各个平台；指定平台后只从该平台获取
          </p>
        </DrawerHeader>
        <div className="flex flex-col gap-1 px-3 pb-10">
          {COMMENT_SOURCE_OPTIONS.map((option) => {
            const active = option.value === commentSource;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={cn(
                  "flex items-center justify-between rounded-xl px-4 py-3.5 text-left transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted"
                )}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{option.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground/60">
                    {option.description}
                  </p>
                </div>
                {active && <Check className="ml-3 h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
