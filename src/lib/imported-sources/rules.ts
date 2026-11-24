/**
 * 音源管理规则：地址归一化、重复判定、洛雪脚本单启。
 *
 * 重复判定按「名称 / 地址 / 脚本内容」任一命中即视为重复——用户贴进来的
 * 地址经常套了一层代理（/proxy?url=... 或 ghproxy 前缀），只比原始字符串
 * 会把同一个源当成两个，所以地址先归一化再比较。
 */

import { normalizeSourceUrl } from "./probe";
import type { ImportedSource, ImportedSourceKind } from "./types";

const MAX_UNWRAP = 4;

/** 剥掉一层代理外壳，拿不到就返回 null */
function unwrapProxy(raw: string): string | null {
  try {
    const u = new URL(raw);
    // 自家后端代理：https://xxx/proxy?url=<encodeURIComponent(原始地址)>
    for (const key of ["url", "target", "u"]) {
      const value = u.searchParams.get(key);
      if (value && /^https?:\/\//i.test(value)) return value;
    }
    // 常见的 GitHub 前缀代理：https://ghproxy.net/https://raw.githubusercontent.com/...
    // 路径可能是明文，也可能整体被 encodeURIComponent
    let path = u.pathname.slice(1);
    try {
      path = decodeURIComponent(path);
    } catch {
      // 解码失败就按原路径试
    }
    if (/^https?:\/\//i.test(path)) return path;
  } catch {
    // 不是 URL（可能是粘贴的脚本内容）
  }
  return null;
}

/**
 * 地址归一化：解代理 → GitHub 文件页/gist 转 raw → 统一大小写与结尾斜杠。
 * 只用于「是不是同一个源」的比较，不用于实际请求。
 */
export function canonicalSourceUrl(input: string): string {
  let url = input.trim();
  if (!url) return "";
  if (!url.includes("://")) return url.toLowerCase();

  for (let i = 0; i < MAX_UNWRAP; i += 1) {
    const next = unwrapProxy(url);
    if (!next || next === url) break;
    url = next;
  }

  let normalized = normalizeSourceUrl(url);
  try {
    const u = new URL(normalized);
    // github.com/owner/repo/raw/branch/path 等价于 raw.githubusercontent.com/...
    if (u.hostname === "github.com") {
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/raw\/(.+)$/);
      if (m) {
        normalized = `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
      }
    }
    // cdn.jsdelivr.net/gh/owner/repo@ref/path → raw.githubusercontent
    if (/(^|\.)jsdelivr\.net$/i.test(u.hostname)) {
      const m = u.pathname.match(/^\/gh\/([^/]+)\/([^/@]+)@([^/]+)\/(.+)$/);
      if (m) {
        normalized = `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
      }
    }
  } catch {
    // 非标准地址按原样比较
  }

  try {
    const u = new URL(normalized);
    u.hash = "";
    normalized = u.toString();
  } catch {
    // 保持原样
  }
  return normalized.replace(/\/+$/, "").toLowerCase();
}

export type DuplicateReason = "name" | "url" | "script";

export interface DuplicateMatch {
  source: ImportedSource;
  reason: DuplicateReason;
}

/** 脚本正文比较用的轻量归一化：压缩/格式化、空白差异不算两个源 */
function normalizedScript(script?: string): string {
  return script ? script.replace(/\s+/g, "") : "";
}

/**
 * 在已有音源里找重复项；excludeId 用于更新场景（排除自己）。
 * candidate 只需要参与判定的字段，调用方不用先拼出完整的 ImportedSource。
 */
export function findDuplicateSource(
  existing: ImportedSource[],
  candidate: {
    name: string;
    url?: string;
    script?: string;
    kind?: ImportedSourceKind;
  },
  excludeId?: string
): DuplicateMatch | null {
  const name = candidate.name.trim().toLowerCase();
  const url = candidate.url ? canonicalSourceUrl(candidate.url) : "";
  const script = normalizedScript(candidate.script);

  for (const source of existing) {
    if (excludeId && source.id === excludeId) continue;
    if (url && source.url && canonicalSourceUrl(source.url) === url) {
      return { source, reason: "url" };
    }
    if (name && source.name.trim().toLowerCase() === name) {
      return { source, reason: "name" };
    }
    if (script && normalizedScript(source.script) === script) {
      return { source, reason: "script" };
    }
  }
  return null;
}

export function duplicateReasonText(reason: DuplicateReason): string {
  switch (reason) {
    case "url":
      return "地址相同";
    case "name":
      return "名称相同";
    case "script":
      return "脚本内容相同";
  }
}

/**
 * 洛雪脚本只允许一个启用：返回除 keepId（未传则取第一个）外需要停用的项。
 * 只处理 lx 类型，GD 音源和内置音源不受影响。
 */
export function extraEnabledLx<
  T extends { id: string; kind: ImportedSourceKind; enabled: boolean },
>(items: T[], keepId?: string): T[] {
  const enabledLx = items.filter((item) => item.kind === "lx" && item.enabled);
  if (enabledLx.length <= 1) return [];
  const keeper =
    (keepId && enabledLx.find((item) => item.id === keepId)) || enabledLx[0];
  return enabledLx.filter((item) => item.id !== keeper.id);
}
