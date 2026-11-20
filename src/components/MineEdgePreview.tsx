import { ChevronRight, Heart, Settings, SlidersHorizontal } from "lucide-react";

/**
 * 歌单页滑到两端时，整页滑出后露出的相邻根 tab 预览。
 *
 * 真正跨路由的页面还没挂载，这里用「页面骨架」占位：有标题、有列表结构，
 * 滑出来时不会是一大块空白，跳转后真实内容再接管。
 */
export function MineEdgePreview({ side }: { side: "prev" | "next" }) {
  return side === "prev" ? <FavoritesPreview /> : <SettingsPreview />;
}

function PreviewFrame({
  left,
  title,
  icon,
  children,
}: {
  left: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden
      className="absolute inset-y-0 w-full overflow-hidden bg-background"
      style={{ left }}
    >
      <div className="flex items-center gap-2 px-5 pt-4 pb-3">
        {icon}
        <h2 className="text-base font-bold tracking-wide text-foreground">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

function SkeletonBar({ className }: { className: string }) {
  return <div className={`rounded-full bg-muted/80 ${className}`} />;
}

function FavoritesPreview() {
  return (
    <PreviewFrame
      left="-100%"
      title="我喜欢的音乐"
      icon={<Heart className="h-5 w-5 text-primary" />}
    >
      {/* 搜索框 */}
      <div className="px-5 pb-3">
        <div className="h-9 rounded-full bg-muted/60" />
      </div>
      <div className="px-4 space-y-1">
        {Array.from({ length: 9 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 p-2">
            <div className="h-12 w-12 shrink-0 rounded-lg bg-muted/70" />
            <div className="flex-1 min-w-0 space-y-2">
              <SkeletonBar
                className={index % 3 === 0 ? "h-3 w-3/5" : "h-3 w-4/5"}
              />
              <SkeletonBar className="h-2.5 w-2/5 opacity-70" />
            </div>
          </div>
        ))}
      </div>
    </PreviewFrame>
  );
}

function SettingsPreview() {
  const sections = [
    { rows: 4, hasSwitch: true },
    { rows: 3, hasSwitch: false },
    { rows: 2, hasSwitch: false },
  ];

  return (
    <PreviewFrame
      left="100%"
      title="设置"
      icon={<Settings className="h-5 w-5 text-muted-foreground" />}
    >
      <div className="px-5 space-y-5">
        {sections.map((section, sectionIndex) => (
          <div key={sectionIndex}>
            <SkeletonBar className="mb-2 h-3 w-16 opacity-70" />
            <div className="overflow-hidden rounded-xl border border-border/50 bg-card/50 divide-y divide-border/50">
              {Array.from({ length: section.rows }).map((_, rowIndex) => (
                <div
                  key={rowIndex}
                  className="flex items-center gap-3 px-3 py-3"
                >
                  <div className="h-8 w-8 shrink-0 rounded-lg bg-muted/70" />
                  <div className="flex-1 min-w-0">
                    <SkeletonBar
                      className={rowIndex % 2 ? "h-3 w-1/2" : "h-3 w-2/3"}
                    />
                  </div>
                  {section.hasSwitch ? (
                    <div className="h-5 w-9 shrink-0 rounded-full bg-muted/80" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/30" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground/40">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          更多设置
        </div>
      </div>
    </PreviewFrame>
  );
}
