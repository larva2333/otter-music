"use client";

import type { ComponentType, SVGProps } from "react";
import { Search, Heart, Settings } from "lucide-react";
import { PlaylistIcon } from "./PlaylistIcon";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "react-router-dom";
import { emitTabReclick } from "@/hooks/use-tab-reclick";

export type TabId = "search" | "favorites" | "mine" | "settings";

/** 底部导航 tab 顺序，页面级左右滑切 tab 时共用 */
export const TAB_IDS: TabId[] = ["search", "favorites", "mine", "settings"];

interface TabItem {
  id: TabId;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  path: string;
}

const tabs: TabItem[] = [
  { id: "search", label: "发现", icon: Search, path: "/search" },
  { id: "favorites", label: "喜欢", icon: Heart, path: "/favorites" },
  { id: "mine", label: "歌单", icon: PlaylistIcon, path: "/mine" },
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

    // 歌单 (Mine)
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
    <nav className="flex min-h-(--tab-bar-safe-height) items-start justify-around px-2 pt-2 pb-[calc(0.5rem+var(--safe-area-bottom))]">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.id}
            to={tab.path}
            replace={isActive}
            onClick={(event) => {
              if (!isActive) return;
              // 已经在当前 tab 上：只派发「再次点击」事件（页面据此回到顶部 / 切分类），
              // 不再重导航。重导航会把 location.state 换成新的 pageDir，页面进入动画
              // 会重播一次（方向还会从 forward 翻成 back），看起来就是「晃一下」；
              // 顺带避免把 /mine?type=xxx 这类带查询参数的地址冲掉。
              event.preventDefault();
              emitTabReclick(tab.id);
            }}
            state={{
              pageDir:
                TAB_IDS.indexOf(tab.id) > TAB_IDS.indexOf(activeTab)
                  ? "forward"
                  : "back",
            }}
            className={cn(
              "group flex min-h-11 min-w-[56px] flex-col items-center justify-center gap-0.5 px-3 py-1 transition-colors",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
            data-state={isActive ? "active" : "inactive"}
            aria-label={tab.label}
          >
            <div className="h-5 w-5 shrink-0 flex-[0_0_20px] min-w-5 min-h-5">
              <Icon
                className={cn(
                  "h-full w-full transition-all",
                  tab.id !== "mine" && "group-data-[state=active]:fill-current",
                  tab.id === "settings" &&
                    "group-data-[state=active]:[&_circle]:fill-background group-data-[state=active]:[&_circle]:stroke-background"
                )}
                strokeWidth={2}
              />
            </div>
            <span className="text-2xs font-medium">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
