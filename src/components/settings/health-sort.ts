import type { SourceHealthResult } from "@/lib/source-health";
import type { SourceConfig } from "@/types/music";

/**
 * 音源列表排序（只按健康状态，不受更新结果影响）：
 * 可用 → 未判定 → 不可用（含检测失败自动停用的源）→ 未检测，同档内启用优先、再按延迟升序。
 *
 * 不能再把「停用」单独做成一档：检测失败的源会被自动停用，
 * 那样它会和手动停用的源混在一起按延迟排，55ms 的失败源会插到 498ms 的未判定前面。
 */
function healthTier(
  config: SourceConfig,
  health: Record<string, SourceHealthResult>
): number {
  const status = health[config.source]?.status;
  if (status === "ok") return 0;
  if (status === "unknown") return 1;
  return 2;
}

export function compareByHealth(
  a: SourceConfig,
  b: SourceConfig,
  health: Record<string, SourceHealthResult>
): number {
  const latencyOf = (config: SourceConfig) =>
    health[config.source]?.latencyMs ?? Number.MAX_SAFE_INTEGER;
  return (
    healthTier(a, health) - healthTier(b, health) ||
    Number(b.enabled && b.visible) - Number(a.enabled && a.visible) ||
    latencyOf(a) - latencyOf(b)
  );
}

export function sortConfigsByHealth(
  configs: SourceConfig[],
  health: Record<string, SourceHealthResult>
): SourceConfig[] {
  return [...configs].sort((a, b) => compareByHealth(a, b, health));
}

/**
 * 洛雪列表：同时只会启用一个脚本，它必须固定排第一；
 * 其余脚本再按可用状态、延迟排序。
 */
export function sortLxConfigs(
  configs: SourceConfig[],
  health: Record<string, SourceHealthResult>
): SourceConfig[] {
  return [...configs].sort(
    (a, b) =>
      Number(b.enabled && b.visible) - Number(a.enabled && a.visible) ||
      compareByHealth(a, b, health)
  );
}
