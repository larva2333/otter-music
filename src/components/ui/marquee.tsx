import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface MarqueeProps {
  children: React.ReactNode;
  className?: string;
  speed?: number; // px/s
  gap?: number; // px
  pauseOnHover?: boolean;
  alwaysScroll?: boolean;
  play?: boolean;
  /** 超出滚动时给容器左右边缘加柔光遮罩，避免文字在边界硬切 */
  fadeEdges?: boolean;
  /** 仅在这些 key 变化时强制重测（其余尺寸变动由 ResizeObserver 自动响应） */
  resetKey?: string | number;
}

export const Marquee: React.FC<MarqueeProps> = ({
  children,
  className,
  speed = 30,
  gap = 40,
  pauseOnHover = true,
  alwaysScroll = false,
  play = true, // 核心控制参数
  fadeEdges = false,
  resetKey,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const [contentWidth, setContentWidth] = useState(0);

  useEffect(() => {
    const calculate = () => {
      if (!containerRef.current || !contentRef.current) return;
      const containerW = containerRef.current.getBoundingClientRect().width;
      const contentW = contentRef.current.getBoundingClientRect().width;
      setContentWidth(contentW);
      // 预留 1px 容差，避免亚像素舍入导致未溢出文本误滚动
      setShouldAnimate(
        alwaysScroll || (containerW > 0 && contentW > containerW + 1)
      );
    };

    calculate();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(calculate);
    if (containerRef.current) observer.observe(containerRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [alwaysScroll, resetKey]);

  const isScrolling = shouldAnimate && play;
  const duration = Math.max((contentWidth + gap) / speed, 2);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex overflow-hidden whitespace-nowrap select-none min-w-0",
        fadeEdges &&
          isScrolling &&
          "[-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_6px,black_calc(100%-12px),transparent_100%)] [mask-image:linear-gradient(to_right,transparent_0%,black_6px,black_calc(100%-12px),transparent_100%)]",
        className
      )}
    >
      <div
        data-testid="marquee-track"
        className={cn("flex w-max shrink-0 items-center", {
          // 只有当 shouldAnimate 为 true 且 play 为 true 时才添加动画类
          "animate-marquee": isScrolling,
          "hover:paused": pauseOnHover && isScrolling,
        })}
        style={
          isScrolling
            ? ({ "--duration": `${duration}s` } as React.CSSProperties)
            : undefined
        }
      >
        <div
          className="shrink-0 flex items-center"
          style={{ paddingRight: isScrolling ? `${gap}px` : 0 }}
        >
          <span
            ref={contentRef}
            className="inline-flex items-baseline whitespace-nowrap"
          >
            {children}
          </span>
        </div>

        {/* 只有在动画激活时才渲染副本，节省性能并保持逻辑一致 */}
        {isScrolling && (
          <div
            aria-hidden
            className="shrink-0 flex items-center"
            style={{ paddingRight: `${gap}px` }}
          >
            <span className="inline-flex items-baseline whitespace-nowrap">
              {children}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
