"use client";

import { Moon, Sun, Smartphone, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useThemePreference } from "@/components/ui/native-theme-provider";

type ThemePref = "system" | "light" | "dark";

interface ThemeOption {
  value: ThemePref;
  label: string;
  icon: LucideIcon;
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: "system", label: "系统", icon: Smartphone },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
];

/**
 * 主题切换：平铺分段控件，不再用下拉框。
 *
 * 只有三个互斥选项，下拉要先点开再选，是两步操作；平铺一遍扫完，
 * 当前值也直接可见（下拉收起来后只剩一个词）。
 */
export function ThemeToggle() {
  const { themePref, setThemePref } = useThemePreference();

  return (
    <div
      role="radiogroup"
      aria-label="主题切换"
      className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5"
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = themePref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setThemePref(value)}
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-1.5 text-xs transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {/* 低版本 WebView 对 SVG 的 flex-shrink 支持有 bug，缩到 0 像素，
                尺寸与 shrink 都加在外层 div 上 */}
            <div className="h-3.5 w-3.5 shrink-0 flex-[0_0_14px] min-w-3.5 min-h-3.5">
              <Icon size={14} className="h-full w-full" />
            </div>
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
