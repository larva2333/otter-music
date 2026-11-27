import type { RefObject } from "react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useMusicStore } from "@/store/music-store";
import { useMarketSession } from "@/store/session/market-session";
import { useTabReclick } from "@/hooks/use-tab-reclick";
import { SubTabBar } from "./SubTabBar";
import {
  BILLBOARD_CHARTS,
  BILLBOARD_GROUPS,
} from "@/lib/billboard/billboard-charts";
import { BillboardEntryGrid } from "./BillboardEntryGrid";
import { BillboardHistoryDrawer } from "./BillboardHistoryDrawer";

const SUB_TAB_HEIGHT = "h-8";

export function BillboardSection({
  scrollRef,
  isActive = true,
}: {
  scrollRef?: RefObject<HTMLElement | null>;
  isActive?: boolean;
} = {}) {
  const navigate = useNavigate();
  const billboardGroup = useMusicStore((s) => s.lastBillboardGroup);
  const setBillboardGroup = useMusicStore((s) => s.setLastBillboardGroup);
  const billboardDate = useMarketSession((s) => s.billboardDate);

  // 发现页「Billboard」激活时再次点击底部「发现」tab：循环切换子榜单分组
  useTabReclick("search", () => {
    if (!isActive) return;
    const idx = BILLBOARD_GROUPS.findIndex((g) => g.id === billboardGroup);
    const nextGroup = BILLBOARD_GROUPS[(idx + 1) % BILLBOARD_GROUPS.length];
    if (nextGroup) setBillboardGroup(nextGroup.id);
    scrollRef?.current?.scrollTo({ top: 0, behavior: "smooth" });
  });

  return (
    <div className="px-4 pb-bottom-stack">
      <div className="flex items-center -mx-4 px-5 h-[52px] pt-1 border-b mb-3">
        <h2 className="text-base font-bold text-foreground tracking-wide truncate">
          Billboard 榜单
        </h2>
      </div>
      <div className={cn("flex items-center gap-6 mb-4 px-1", SUB_TAB_HEIGHT)}>
        <SubTabBar
          tabs={BILLBOARD_GROUPS.map((g) => ({ id: g.id, label: g.name }))}
          activeId={billboardGroup}
          onChange={(id) =>
            setBillboardGroup(id as (typeof BILLBOARD_GROUPS)[number]["id"])
          }
        />
        <div className="ml-auto shrink-0">
          <BillboardHistoryDrawer />
        </div>
      </div>
      {billboardGroup === "songs" ? (
        <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-x-3 gap-y-4">
          {BILLBOARD_CHARTS.filter((c) => c.group === "songs").map((chart) => (
            <div
              key={chart.id}
              className="group flex flex-col gap-2.5 transition-all hover:translate-y-[-4px] cursor-pointer"
              onClick={() =>
                navigate(
                  `/billboard/${chart.id}${billboardDate ? `?date=${billboardDate}` : ""}`
                )
              }
            >
              <div
                className="relative aspect-square rounded-md overflow-hidden shadow-md ring-1 ring-black/5 hover:shadow-xl transition-shadow"
                style={{
                  backgroundImage: `linear-gradient(135deg, ${chart.colors[0]}, ${chart.colors[1]})`,
                }}
              >
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
                  <span className="text-white/60 font-black tracking-widest leading-none text-2xs uppercase">
                    Billboard
                  </span>
                  <span className="text-white font-black tracking-tight leading-tight mt-1.5 text-sm line-clamp-2">
                    {chart.name}
                  </span>
                </div>
              </div>
              <div className="px-0.5">
                <h3 className="text-sm font-medium leading-snug line-clamp-2 text-foreground/80 group-hover:text-primary transition-colors">
                  Billboard {chart.name}
                </h3>
              </div>
            </div>
          ))}
        </div>
      ) : billboardGroup === "albums" ? (
        <BillboardEntryGrid
          chartId="billboard-200"
          group="albums"
          date={billboardDate}
        />
      ) : (
        <BillboardEntryGrid
          chartId="artist-100"
          group="artists"
          date={billboardDate}
        />
      )}
    </div>
  );
}
