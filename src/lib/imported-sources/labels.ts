import { sourceLabels, searchOptions } from "@/types/music";
import { useMusicStore } from "@/store/music-store";
import { useImportedSourcesStore } from "./store";

/**
 * 取音源显示名（优先级：用户别名 > 内置静态表 > 导入脚本里的名字 > 原始 id）
 */
export function getSourceLabel(source: string): string {
  const alias = useMusicStore
    .getState()
    .sourceConfigs.find((c) => c.source === source)
    ?.alias?.trim();
  if (alias) return alias;

  const builtin = sourceLabels[source] || searchOptions[source];
  if (builtin) return builtin;

  return (
    useImportedSourcesStore.getState().sources.find((s) => s.id === source)
      ?.name || source
  );
}
