import { useEffect, useMemo, useRef } from "react";
import { useTabIndicatorSync } from "@/hooks/use-tab-indicator-sync";
import { cn } from "@/lib/utils";

export interface SubTabItem {
  id: string;
  label: string;
  count?: number;
}

interface SubTabBarProps {
  tabs: readonly SubTabItem[];
  activeId: string;
  onChange: (id: string) => void;
  /** 是否允许横向滚动（tab 较多时开启） */
  scrollable?: boolean;
  className?: string;
}

/**
 * 发现页 / 我的页共用的子 tab 栏：
 * 选中项下方带一根随切换平滑滚动的圆角滑块。
 */
export function SubTabBar({
  tabs,
  activeId,
  onChange,
  scrollable = false,
  className,
}: SubTabBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => tabs.map((t) => t.id), [tabs]);
  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeId)
  );

  const { indicatorRef, hasIndicator, initialRect, handleTrackSettle } =
    useTabIndicatorSync({
      barRef,
      activeIndex,
      ids,
      attrName: "data-subtab-id",
      autoScrollBar: scrollable,
    });

  // 切换选中 tab 时显式触发一次平滑落位，让滑块与滚动条同步滑动
  const prevIndexRef = useRef(activeIndex);
  useEffect(() => {
    if (prevIndexRef.current !== activeIndex) {
      prevIndexRef.current = activeIndex;
      handleTrackSettle(activeIndex, true);
    }
  }, [activeIndex, handleTrackSettle]);

  return (
    <div
      ref={barRef}
      className={cn(
        "relative flex h-full items-center gap-6",
        scrollable && "min-w-0 flex-1 overflow-x-auto no-scrollbar",
        className
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            data-subtab-id={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              "inline-flex h-full shrink-0 items-center whitespace-nowrap text-base font-medium transition-colors",
              isActive
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1 text-xs opacity-60">{tab.count}</span>
            )}
          </button>
        );
      })}

      {hasIndicator && initialRect && (
        <div
          ref={indicatorRef}
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-[2.5px] rounded-full bg-primary"
          style={{
            transform: `translate3d(${initialRect.left}px, ${initialRect.top}px, 0)`,
            width: initialRect.width,
          }}
        />
      )}
    </div>
  );
}
