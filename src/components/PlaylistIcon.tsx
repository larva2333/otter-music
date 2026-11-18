import type { SVGProps } from "react";

/**
 * 闭口歌单图标：圆角矩形外框包住三条横线。
 * 与其他 lucide 图标同为 24 视口、2px 描边，可直接套 h-full w-full 使用。
 *
 * 选中态由父级 group 的 data-state="active" 驱动：
 * - 外框保留 currentColor 描边，内部填主题色（fill-current）
 * - 内部三条横线反白（stroke-background），在主题色底上可见
 * 空态等没有 group[data-state] 的场合保持描边风格。
 */
export function PlaylistIcon({
  strokeWidth = 2,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      aria-hidden="true"
      {...props}
    >
      <rect
        x="2.5"
        y="3.5"
        width="19"
        height="17"
        rx="3"
        className="group-data-[state=active]:fill-current"
      />
      <path
        d="M6.5 7.5H17.5"
        className="group-data-[state=active]:stroke-background"
      />
      <path
        d="M6.5 12H17.5"
        className="group-data-[state=active]:stroke-background"
      />
      <path
        d="M6.5 16.5H17.5"
        className="group-data-[state=active]:stroke-background"
      />
    </svg>
  );
}
