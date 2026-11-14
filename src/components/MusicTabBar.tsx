"use client";

import { Search, Heart, User, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "react-router-dom";

export type TabId = "search" | "favorites" | "mine" | "settings";

interface TabItem {
  id: TabId;
  label: string;
  icon: typeof Search;
  path: string;
}

const tabs: TabItem[] = [
  { id: "search", label: "发现", icon: Search, path: "/search" },
  { id: "favorites", label: "喜欢", icon: Heart, path: "/favorites" },
  { id: "mine", label: "我的", icon: User, path: "/mine" },
  { id: "settings", label: "设置", icon: Settings, path: "/settings" },
];

export function MusicTabBar() {
  const location = useLocation();

  // Determine active tab based on current path
  const getActiveTab = (pathname: string): TabId => {
    // 发现 (Search) - 默认 Tab
    if (pathname.startsWith("/search")) {
      return "search";
    }

    // 喜欢 (Favorites)
    if (pathname.startsWith("/favorites")) {
      return "favorites";
    }

    // 我的 (Mine)
    if (pathname.startsWith("/mine")) {
      return "mine";
    }

    // 设置 (Settings)
    if (pathname.startsWith("/settings")) {
      return "settings";
    }

    return "search"; // Default
  };

  const activeTab = getActiveTab(location.pathname);

  return (
    <nav className="flex min-h-(--tab-bar-safe-height) items-start justify-around bg-card/95 backdrop-blur-xl border-t border-border/50 px-2 pt-2 pb-[calc(0.5rem+var(--safe-area-bottom))]">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.id}
            to={tab.path}
            replace={isActive}
            className={cn(
              "flex min-h-11 min-w-[56px] flex-col items-center justify-center gap-0.5 px-3 py-1 transition-colors",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
            aria-label={tab.label}
          >
            <span
              className={cn(
                "flex h-8 w-12 items-center justify-center rounded-full transition-colors",
                isActive ? "bg-primary text-primary-foreground" : ""
              )}
            >
              <div className="h-5 w-5 shrink-0 flex-[0_0_20px] min-w-5 min-h-5">
                <Icon
                  className={cn(
                    "h-full w-full transition-all",
                    isActive
                      ? "text-primary-foreground"
                      : "text-muted-foreground"
                  )}
                  strokeWidth={isActive ? 2.5 : 2}
                />
              </div>
            </span>
            <span className="text-[10px] font-medium">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
