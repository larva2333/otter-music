/**
 * 数量缩写：用于评论点赞数、评论总数等。
 *
 * - 小于 1000：原样显示
 * - 1000 ~ 9999：显示几点几 K（如 1500 → 1.5K）
 * - 10000 及以上：显示几点几 W（如 12345 → 1.2W）
 */
export function formatCount(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "0";

  if (n < 1000) return String(Math.floor(n));

  if (n < 10000) {
    const k = n / 1000;
    // 保留一位小数，去掉多余的 .0（如 2000 → 2K）
    return `${Number(k.toFixed(1))}K`;
  }

  const w = n / 10000;
  return `${Number(w.toFixed(1))}W`;
}
