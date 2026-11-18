import type { RefObject } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PullStatus } from "@/hooks/use-pull-to-refresh";

/**
 * 下拉刷新指示器：挂在滚动容器的第一个子元素，高度由 usePullToRefresh
 * 通过 ref 直接写入，内容居中固定在顶部，不被压缩。
 */
export function PullRefreshIndicator({
  indicatorRef,
  status,
  className,
}: {
  indicatorRef: RefObject<HTMLDivElement | null>;
  status: PullStatus;
  className?: string;
}) {
  return (
    <div
      ref={indicatorRef}
      aria-hidden
      className={cn(
        "shrink-0 overflow-hidden flex items-start justify-center",
        className
      )}
      style={{ height: 0 }}
    >
      <div className="h-10 flex items-center gap-2 text-xs text-muted-foreground">
        {status === "refreshing" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ArrowDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              status === "release" && "rotate-180"
            )}
          />
        )}
        {status === "refreshing"
          ? "刷新中..."
          : status === "release"
            ? "释放刷新"
            : "下拉刷新"}
      </div>
    </div>
  );
}
