"use client";

import { Moon, Sun, Smartphone, type LucideIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useThemePreference } from "@/components/ui/native-theme-provider";

type ThemePref = "system" | "light" | "dark";

interface ThemeOption {
  value: ThemePref;
  label: string;
  icon: LucideIcon;
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: "system", label: "跟随系统", icon: Smartphone },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
];

export function ThemeToggle() {
  const { themePref, setThemePref } = useThemePreference();

  return (
    <Select
      value={themePref}
      onValueChange={(value) => setThemePref(value as ThemePref)}
    >
      <SelectTrigger className="h-8 w-32 border-muted bg-transparent px-2.5 text-xs text-foreground hover:bg-muted/20">
        <SelectValue placeholder="主题" />
      </SelectTrigger>
      <SelectContent>
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <SelectItem key={value} value={value}>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 shrink-0 flex-[0_0_16px] min-w-4 min-h-4">
                <Icon size={16} className="h-full w-full" />
              </div>
              <span>{label}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
