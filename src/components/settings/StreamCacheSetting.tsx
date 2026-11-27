import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { SettingItem } from "./SettingItem";
import {
  HardDrive,
  Trash2,
  Music2,
  ListMusic,
  Image,
  Link2,
  Database,
  Globe2,
  ListChecks,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  formatBytes,
  getStorageUsage,
  clearAudioCache,
} from "@/lib/cache-stats";
import {
  getCacheDetails,
  clearCacheCategory,
  type CacheCategory,
  type CacheDetail,
} from "@/lib/cache-details";
import { toastUtils } from "@/lib/utils/toast";
import { useOfflineStore } from "@/store/offline-store";
import { useUrlCacheStore } from "@/store/url-cache-store";

const CATEGORY_ICONS: Record<CacheCategory, typeof Music2> = {
  audio: Music2,
  offline: ListChecks,
  lyric: ListMusic,
  cover: Image,
  links: Link2,
  api: Database,
  webview: Globe2,
};

function cacheAmount(item: CacheDetail): string {
  if (item.category === "webview")
    return item.size > 0 ? formatBytes(item.size) : "—";
  const size = item.size > 0 ? ` · ${formatBytes(item.size)}` : "";
  return `${item.count} 项${size}`;
}

export function StreamCacheSetting() {
  const [expanded, setExpanded] = useState(false);
  const [usage, setUsage] = useState(0);
  const [details, setDetails] = useState<CacheDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<CacheCategory | "all" | null>(null);
  const offlineCount = useOfflineStore(
    (state) => Object.keys(state.records ?? {}).length
  );
  const urlCacheCount = useUrlCacheStore(
    (state) => Object.keys(state.urlMap).length
  );
  const hasCache =
    usage > 0 ||
    offlineCount > 0 ||
    urlCacheCount > 0 ||
    details.some((item) => item.count > 0 || item.size > 0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bytes, items] = await Promise.all([
        getStorageUsage(),
        getCacheDetails(),
      ]);
      setUsage(bytes);
      setDetails(items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (expanded) void load();
  }, [expanded, load]);

  const handleClearCategory = async (item: CacheDetail) => {
    if (busy) return;
    const ok = await confirmDialog({
      title: `清空${item.label}？`,
      description: item.description,
      destructive: true,
      confirmText: "清空",
    });
    if (!ok) return;
    setBusy(item.category);
    try {
      await clearCacheCategory(item.category);
      await load();
      toastUtils.info(`${item.label}已清空`);
    } finally {
      setBusy(null);
    }
  };

  const handleClearAll = async () => {
    if (busy) return;
    const ok = await confirmDialog({
      title: "确定要清空所有缓存吗？",
      description: "此操作不可恢复。",
      destructive: true,
      confirmText: "清空",
    });
    if (!ok) return;
    setBusy("all");
    try {
      await clearAudioCache();
      useOfflineStore.getState().clear();
      useUrlCacheStore.getState().clear();
      await load();
      toastUtils.info("缓存已清空");
    } finally {
      setBusy(null);
    }
  };

  const visibleDetails = details.filter((item) =>
    item.category === "webview" ? item.size > 0 : item.count > 0
  );

  return (
    <SettingItem
      icon={HardDrive}
      title="缓存管理"
      subtitle="查看占用与清理"
      onClick={() => setExpanded(!expanded)}
      showChevron
      isExpanded={expanded}
      expandedContent={
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="px-1 text-xs text-muted-foreground">
              缓存明细 · 可单独清理
            </p>
            {loading && visibleDetails.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                <div className="h-4 w-4 shrink-0 flex-[0_0_16px] min-w-4 min-h-4">
                  <Loader2 className="h-full w-full animate-spin" />
                </div>
                <span>正在统计缓存...</span>
              </div>
            ) : visibleDetails.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                暂无缓存
              </p>
            ) : (
              visibleDetails.map((item) => {
                const Icon = CATEGORY_ICONS[item.category];
                return (
                  <div
                    key={item.category}
                    className="rounded-lg border border-border/60 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 shrink-0 flex-[0_0_16px] min-w-4 min-h-4 text-muted-foreground">
                        <Icon size={16} className="h-full w-full" />
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {item.label}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {cacheAmount(item)}
                      </span>
                      <button
                        type="button"
                        disabled={busy !== null}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                        aria-label={`清空${item.label}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleClearCategory(item);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {item.samples.length > 0 && (
                      <p className="mt-1 truncate pl-6 text-[11px] text-muted-foreground">
                        {item.samples.join("、")}
                        {item.count > item.samples.length &&
                          ` 等 ${item.count} 项`}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full border-destructive/30 text-destructive hover:bg-destructive/10"
            disabled={busy !== null || !hasCache}
            onClick={(e) => {
              e.stopPropagation();
              void handleClearAll();
            }}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            {busy === "all" ? "正在清空…" : "清空全部缓存"}
          </Button>
        </div>
      }
    />
  );
}
