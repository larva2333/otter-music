import { ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { bindKeyboardViewport } from "@/lib/keyboard-viewport";

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
  const shellRef = useRef<HTMLDivElement>(null);

  // 键盘弹出时系统会把页面上推，搜索历史挂在输入框下面，会被顶出屏幕。
  // 这里把壳层钉回可视区域，历史面板留在搜索框和键盘之间。
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    return bindKeyboardViewport(shell);
  }, []);

  return (
    <div
      ref={shellRef}
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
          // overflow-x-clip：根 tab 切换时整页会横向平移 56px 做进入动画，
          // 平移出来的那部分会撑大 scrollWidth（实测 400→456），
          // 手指在页面上横滑就能把整页拖歪。clip 只裁剪、不产生横向滚动容器，
          // 纵向滚动（overflow-y-auto）不受影响。
          className={cn(
            "h-full overflow-y-auto overflow-x-clip scrollbar-hide"
          )}
        >
          {children}
        </div>
      </div>

      {/* Now Playing Bar (Floating Island)
          两种页面都用同一颗胶囊：tab 页浮在导航栏上方，二级页贴安全区上方。
          不要在这里换宽度/封面尺寸，否则进歌单页会突然"放大"。
          位置统一锚在二级页的 bottom，tab 页靠 translateY 上抬 68px。
          用 transform 而不是切 bottom：bottom 过渡走的是布局，WebView 上每帧重排，
          tab ↔ 二级页切换时会掉帧、看起来"跳"一下；transform 走合成层，稳得多。
          叠加 --kb-lift：键盘弹出时壳层会被缩到键盘上方（Android 15+ 是脚本手动缩壳层，
          低版本是 adjustResize 缩窗口），胶囊下移同样的高度，视觉上钉在屏幕原位
          （被键盘盖住），而不是跟着壳层底边被顶到键盘上方。 */}
      {/* 播放条常驻挂载：进入全屏播放时只隐藏，不卸载。
          卸载会让 MusicNowPlayingBar 里的取色 state 全部丢失，返回时重新
          加载封面 + 跑 k-means，胶囊会先白一下再刷上颜色（用户反馈的"重新绘制"）。 */}
      <div
        aria-hidden={hidePlayer || undefined}
        className={cn(
          "flex-none z-50 absolute left-0 right-0 will-change-transform",
          "bottom-[calc(var(--safe-area-bottom)+8px)]",
          "transition-transform ease-[cubic-bezier(0.32,0.72,0,1)]",
          hidePlayer && "invisible pointer-events-none",
          // 68px = 原 tab 页位置(72+安全区+4) 减去 二级页位置(安全区+8)
          isTab
            ? "translate-y-[calc(var(--kb-lift,0px)-68px)]"
            : "translate-y-[var(--kb-lift,0px)]"
        )}
        // 键盘开合那一刻（--kb-anim 为 0ms）不能走过渡，否则胶囊会先弹到键盘上沿
        // 再滑回去；平时保持 320ms，tab ↔ 二级页的 68px 位移才平滑
        style={{ transitionDuration: "var(--kb-anim, 320ms)" }}
      >
        {player}
      </div>

      {/* 二级页没有 tab bar 底板，胶囊两侧会露出滚动内容；补一层底部羽化，
          保证文字在胶囊附近渐隐，而不是硬切到胶囊边缘 */}
      {!isTab && !hidePlayer && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-40 h-[calc(var(--safe-area-bottom)+76px)] translate-y-[var(--kb-lift,0px)] bg-background [-webkit-mask-image:linear-gradient(to_bottom,transparent_0px,black_32px)] [mask-image:linear-gradient(to_bottom,transparent_0px,black_32px)]"
        />
      )}

      {/* Tab Bar —— 导航栏底板只做到播放胶囊的垂直中线，上边界用渐变羽化，
          不画成一条硬线。底板本身保持不透明（半透明底会让滑动时忽明忽暗），
          羽化只发生在最上面那 48px，是纯透明→实色的遮罩，不做内容模糊。 */}
      {isTab && (
        <div
          className="relative flex-none z-40 translate-y-[var(--kb-lift,0px)] transition-transform"
          style={{ transitionDuration: "var(--kb-anim, 300ms)" }}
        >
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
