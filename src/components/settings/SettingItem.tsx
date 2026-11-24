import { LucideIcon, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface SettingItemProps {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode; // 用于标题下方的描述
  action?: ReactNode; // 右侧的主要交互区域或显示区域
  showChevron?: boolean; // 是否显示右侧箭头
  /** 箭头位置：默认跟在标题后；"end" 时放到整行最右（action 旁边） */
  chevronPosition?: "title" | "end";
  /**
   * action 只是展示（如聚合音源的已选摘要）时，点它也应触发展开。
   * 默认 false：action 自己是开关/下拉等交互件，点击要拦住不冒泡到整行。
   */
  actionPassThrough?: boolean;
  expandedContent?: ReactNode; // 展开区域内容
  isExpanded?: boolean; // 展开状态
  className?: string;
  onClick?: () => void;
  children?: ReactNode; // 其他隐藏内容 (如 file input)
}

export function SettingItem({
  icon: Icon,
  title,
  subtitle,
  action,
  showChevron,
  chevronPosition = "title",
  actionPassThrough = false,
  expandedContent,
  isExpanded,
  className,
  onClick,
  children,
}: SettingItemProps) {
  // 既有右侧控件（开关/摘要）又能展开时，箭头跟着标题走：
  // 放在最右边会被开关挤成一个孤立符号，看不出它属于「展开」。
  // 但聚合音源这类摘要可能很长、需要占满右侧，箭头放行尾更自然。
  const inlineChevron =
    Boolean(showChevron && expandedContent && action) &&
    chevronPosition === "title";

  return (
    <div
      onClick={onClick}
      className={cn(
        "px-4 py-3 transition-colors",
        onClick && "cursor-pointer hover:bg-muted/20",
        className
      )}
    >
      <div className="flex items-center justify-between min-h-7">
        <div className="flex items-center gap-3 flex-1 overflow-hidden">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 flex-[0_0_36px] min-w-9 min-h-9">
            <div className="h-4 w-4 shrink-0 flex-[0_0_16px] min-w-4 min-h-4">
              <Icon size={16} className="h-full w-full text-primary" />
            </div>
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-sm text-foreground truncate">{title}</span>
              {inlineChevron && (
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                    isExpanded && "rotate-90"
                  )}
                />
              )}
            </div>
            {subtitle && (
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {subtitle}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-muted-foreground shrink-0 ml-2">
          {/* 右侧控件是交互件（开关/下拉）时自己消费点击，避免点它把整行收起；
              action 只是展示（actionPassThrough）时放行点击，整行都可展开 */}
          {action &&
            (actionPassThrough ? (
              action
            ) : (
              <div onClick={(e) => e.stopPropagation()}>{action}</div>
            ))}
          {showChevron && !inlineChevron && (
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                isExpanded && "rotate-90"
              )}
            />
          )}
        </div>
      </div>

      {/* 展开内容区域 */}
      <div
        className={cn(
          "grid transition-all duration-200 ease-in-out",
          isExpanded
            ? "grid-rows-[1fr] opacity-100 mt-3 pt-3 border-t border-border/50"
            : // 收起时内层仍有 -my-2/py-2 的 16px 不可见高度，且它 stopPropagation，
              // 会吃掉行底部（和下一行顶部）的点击。pointer-events-none 让这片区域
              // 彻底不参与命中测试，整行任意位置都能触发展开。
              "grid-rows-[0fr] opacity-0 pointer-events-none"
        )}
      >
        {/* 点里面的任何子选项都不收起父项（子项自己的 onClick 照常执行）。
            -mx-3 px-3 / -my-2 py-2：裁切边界往外放（横向 12px、纵向 8px），
            滑块的圆形把手贴到轨道两端、或滑块处在展开区最后一行时，
            不会被 overflow-hidden 切掉半个，外占位不变 */}
        <div
          className="overflow-hidden -mx-3 px-3 -my-2 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          {expandedContent}
        </div>
      </div>

      {children}
    </div>
  );
}
