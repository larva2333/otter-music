"use client";

import { cn } from "@/lib/utils";
import { MusicCover } from "./MusicCover";

interface VinylCoverProps {
  src?: string | null;
  alt?: string;
  isPlaying?: boolean;
  className?: string;
  iconClassName?: string;
  /** 封面自带白边的裁切缩放，透传给中心封面的 <img> */
  imgStyle?: React.CSSProperties;
  previewOpen?: boolean;
  onPreviewOpenChange?: (open: boolean) => void;
  /** 盘面颜色；"transparent" 表示透明，透出播放器背景 */
  discColor?: string;
}

const DEFAULT_DISC_COLOR = "#0A0A0A";

/**
 * 网易云风格的黑胶唱片封面。
 *
 * 比例按网易真机截图还原（不是凭感觉）：
 * - 唱片盘面直径约为容器 82%，靠下放，上方留出唱臂基座的位置；
 * - 中心封面直径约为盘面的 2/3（inset 17%）；
 * - 唱臂基座在盘外正上方，臂是弯的，唱头落在盘面右上的沟槽上。
 *
 * 盘面旋转时用 animationPlayState 暂停，不能移除动画否则会跳回 0°；
 * 唱臂绕基座做落下/抬起动画，播放时落到沟槽、暂停时抬离盘面。
 * 中心封面复用 MusicCover，两种播放风格都保留预览大图能力。
 */
export function VinylCover({
  src,
  alt,
  isPlaying = false,
  className,
  iconClassName,
  imgStyle,
  previewOpen,
  onPreviewOpenChange,
  discColor = DEFAULT_DISC_COLOR,
}: VinylCoverProps) {
  const transparent = discColor.toLowerCase() === "transparent";
  return (
    // 标记整块黑胶（含盘面空白区）：轻点这里走播放/暂停，点周围空白才切歌词
    <div
      data-vinyl-cover
      className={cn("relative h-full w-full select-none", className)}
    >
      {/* 盘外那圈浅灰托盘边（网易的黑胶盘不是直接贴在背景上） */}
      <div className="absolute left-[5%] top-[13%] h-[90%] w-[90%] rounded-full bg-linear-to-br from-white/12 to-white/2 ring-1 ring-white/5" />

      {/* 唱片盘面 */}
      <div
        data-testid="vinyl-disc-face"
        className="absolute left-[7%] top-[15%] h-[86%] w-[86%] overflow-hidden rounded-full ring-1 ring-white/10"
        style={{ backgroundColor: transparent ? "transparent" : discColor }}
      >
        {/* 旋转体 */}
        <div
          data-testid="vinyl-disc"
          className="vinyl-spin absolute inset-0 rounded-full"
          style={{ animationPlayState: isPlaying ? "running" : "paused" }}
        >
          <div
            className="absolute inset-[3%] rounded-full"
            style={{
              backgroundImage:
                "repeating-radial-gradient(circle at center, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 4px)",
            }}
          />
          {/* 中心封面：网易真机量得约占盘面直径 2/3 */}
          <div
            data-testid="vinyl-label"
            className="absolute inset-[17%] overflow-hidden rounded-full shadow-[0_0_0_2px_rgba(255,255,255,0.08)]"
          >
            <MusicCover
              src={src}
              alt={alt}
              className="h-full w-full object-cover dark"
              imgStyle={imgStyle}
              iconClassName={iconClassName}
              previewOpen={previewOpen}
              onPreviewOpenChange={onPreviewOpenChange}
            />
          </div>
          {/* 主轴 */}
          <div className="absolute left-1/2 top-1/2 h-[2.6%] w-[2.6%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-linear-to-br from-neutral-200 to-neutral-500 shadow-[0_0_0_2px_rgba(0,0,0,0.6)]" />
        </div>

        {/* 固定高光，不跟盘转 */}
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 200deg, transparent 0deg, rgba(255,255,255,0.10) 32deg, transparent 70deg, transparent 180deg, rgba(255,255,255,0.06) 215deg, transparent 255deg)",
          }}
        />
      </div>

      {/* 唱臂：基座在盘外正上方，折线（竖直段→圆角拐弯→斜段），唱头落在黑胶沟槽带中间 */}
      <div className="pointer-events-none absolute inset-0">
        {/* 基座：干净的白色圆点 + 浅灰轴心，z-10 盖住唱臂根部（臂从圆盘底下伸出） */}
        <div className="absolute left-1/2 top-[-9%] z-10 h-[6%] w-[6%] -translate-x-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.3)]">
          <div className="absolute inset-[38%] rounded-full bg-neutral-300" />
        </div>
        <svg
          data-testid="vinyl-tonearm"
          viewBox="0 0 100 100"
          className="absolute inset-0 h-full w-full overflow-visible"
          style={{
            transform: isPlaying ? "rotate(-4deg)" : "rotate(-40deg)",
            transformOrigin: "50% -6%",
            transition: "transform 350ms ease-out",
          }}
        >
          {/* 两段直线 + 拐点小圆角：切点前竖直段、切点后斜段各约 14，Q 控制点即尖角顶点 */}
          <path
            d="M 50 -4 L 50 10 Q 50 13 52 15 L 62 25"
            fill="none"
            stroke="rgba(0,0,0,0.16)"
            strokeWidth="3.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M 50 -4 L 50 10 Q 50 13 52 15 L 62 25"
            fill="none"
            stroke="#fafbfc"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* 唱头：白色圆角方盒 + 两道浅灰凹槽 + 小连接节，落在盘面沟槽带中间。
              两段等长（各约 17）、斜段保持 45°，连接节贴住臂末端 (62,25) 不错位。 */}
          <g
            data-testid="vinyl-head-group"
            transform="translate(62 25) rotate(45)"
          >
            {/* 臂管与盒体之间的合页连接节：从臂末端顺出 */}
            <rect
              x="-1.2"
              y="-1.3"
              width="3.4"
              height="2.6"
              rx="0.7"
              fill="#f4f5f7"
            />
            <line
              x1="0.2"
              y1="-1.1"
              x2="0.2"
              y2="1.1"
              stroke="#b9bfc7"
              strokeWidth="0.5"
            />
            {/* 盒体：接近方形、圆角、无黑边，靠形状而不是描边出轮廓 */}
            <rect
              data-testid="vinyl-head-body"
              x="0.4"
              y="-2.9"
              width="6.8"
              height="5.8"
              rx="1.5"
              fill="#fcfcfd"
            />
            {/* 两道浅灰凹槽，沿长轴平行 */}
            <line
              data-testid="vinyl-head-groove"
              x1="2"
              y1="-1.4"
              x2="6.1"
              y2="-1.4"
              stroke="#b9bfc7"
              strokeWidth="0.7"
              strokeLinecap="round"
            />
            <line
              data-testid="vinyl-head-groove"
              x1="2"
              y1="1.4"
              x2="6.1"
              y2="1.4"
              stroke="#b9bfc7"
              strokeWidth="0.7"
              strokeLinecap="round"
            />
          </g>
        </svg>
      </div>
    </div>
  );
}
