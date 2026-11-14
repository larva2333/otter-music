import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MusicLayoutProps {
  children: ReactNode;
  player: ReactNode;
  tabBar: ReactNode;
  header?: ReactNode;
  hidePlayer?: boolean;
  className?: string;
  isTab?: boolean;
}

export function MusicLayout({
  children,
  player,
  tabBar,
  header,
  hidePlayer,
  className,
  isTab = true,
}: MusicLayoutProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col h-dvh overflow-hidden bg-background",
        // tab 页的顶部内边距由 --tab-bar-top-offset 独占（max(44px, 安全区)）。
        // 不能与 pt-safe 并列：两者都在 utilities layer、特异性相同，
        // 后出现的 .pt-safe 会覆盖前面的任意值类，导致 44px 兜底失效
        isTab ? "pt-[var(--tab-bar-top-offset)]" : "pt-safe",
        className
      )}
    >
      {/* Header */}
      {header && <div className="shrink-0 px-5 pb-3">{header}</div>}

      {/* Main Content */}
      <div className="flex-1 min-h-0 relative">
        <div
          data-page-scroll=""
          className={cn("h-full overflow-auto scrollbar-hide")}
        >
          {children}
        </div>
      </div>

      {/* Now Playing Bar (Floating Island) */}
      {!hidePlayer && (
        <div
          className={cn(
            "flex-none z-50 absolute left-0 right-0 transition-all duration-300",
            // tab 页在导航栏之上留 4px 空隙，让胶囊"浮"起来而不是贴在导航栏顶边
            isTab
              ? "bottom-[calc(var(--now-playing-safe-height)+4px)]"
              : "bottom-0"
          )}
        >
          {player}
        </div>
      )}

      {/* Tab Bar —— 导航栏底板只做到播放胶囊的垂直中线，上边界用渐变羽化，
          不画成一条硬线。底板本身保持不透明（半透明底会让滑动时忽明忽暗），
          羽化只发生在最上面那 48px，是纯透明→实色的遮罩，不做内容模糊。 */}
      {isTab && (
        <div className="relative flex-none z-40">
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 bg-background",
              hidePlayer
                ? "top-0"
                : // 高度 = 胶囊中线(nps + 27) 再往上 48px 的羽化带；
                  // 顶部 48px 从全透明渐到实色，所以"分界"正好落在胶囊中线附近的这段渐变里
                  "h-[calc(var(--now-playing-safe-height)+75px)] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0px,black_48px)] [mask-image:linear-gradient(to_bottom,transparent_0px,black_48px)]"
            )}
          />
          <div className="relative">{tabBar}</div>
        </div>
      )}
    </div>
  );
}
