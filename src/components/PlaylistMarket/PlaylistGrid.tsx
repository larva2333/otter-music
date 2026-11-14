import { memo, type CSSProperties } from "react";
import { MarketPlaylist } from "@/lib/netease/netease-types";
import { CachedImage } from "@/components/CachedImage";

interface PlaylistGridProps {
  list: MarketPlaylist[];
  onClick: (id: string) => void;
}

const GRID_CLASS =
  "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-x-3 gap-y-4";

/** 按「行 + 列」错开扫光延迟，整片网格看起来是一道斜向的波浪，而不是一起忽明忽暗 */
const shimmerDelay = (index: number) =>
  ((index % 3) + Math.floor(index / 3)) * 70;

/**
 * memo：首页会把访问过的分类网格都保留在 DOM 里（只切换可见性），
 * 不 memo 的话每次父组件渲染都会重新 reconcile 几份网格。
 */
export const PlaylistGrid = memo(function PlaylistGrid({
  list,
  onClick,
}: PlaylistGridProps) {
  return (
    <div className={GRID_CLASS}>
      {list.map((item, index) => (
        <div
          key={item.id}
          className="group flex flex-col gap-2.5 transition-all hover:translate-y-[-4px]"
          onClick={() => onClick(item.id)}
        >
          <div className="relative aspect-square rounded-md overflow-hidden shadow-md ring-1 ring-black/5 hover:shadow-xl transition-shadow cursor-pointer bg-muted">
            <CachedImage
              src={item.coverUrl}
              alt={item.name}
              shimmerDelay={shimmerDelay(index)}
              className="transition-transform duration-500 group-hover:scale-110"
            />
          </div>
          <div className="px-0.5">
            <h3 className="text-[13px] font-medium leading-snug line-clamp-2 text-foreground/80 group-hover:text-primary transition-colors cursor-pointer">
              {item.name}
            </h3>
          </div>
        </div>
      ))}
    </div>
  );
});

/** 加载中的骨架网格：波浪式扫光代替整块脉冲，尺寸与真实卡片一致，加载完成不会跳版 */
export const PlaylistGridSkeleton = ({ count = 12 }: { count?: number }) => (
  <div className={`${GRID_CLASS} animate-in fade-in duration-300`}>
    {Array.from({ length: count }).map((_, index) => (
      <div key={index} className="flex flex-col gap-2.5">
        <div
          style={
            { "--shimmer-delay": `${shimmerDelay(index)}ms` } as CSSProperties
          }
          className="relative aspect-square rounded-md skeleton-shimmer"
        />
        <div className="px-0.5 space-y-1.5 py-0.5">
          {/* 文字占位不参与扫光：几十个动画元素同时跑会让 WebView 掉帧 */}
          <div className="h-3 w-full rounded-sm bg-muted/70" />
          <div className="h-3 w-2/3 rounded-sm bg-muted/70" />
        </div>
      </div>
    ))}
  </div>
);
