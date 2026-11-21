import { fetchWithTimeout, getProxyUrl, IS_NATIVE } from "@/lib/api/config";
import type { ProbeResult } from "./types";

const GITHUB_API = "https://api.github.com";
const JSDELIVR_API = "https://data.jsdelivr.com/v1/packages/gh";
const JSDELIVR_CDN = "https://cdn.jsdelivr.net/gh";

/** 探测结果：比 ProbeResult 多带命中位置，仓库地址会展开成具体文件 */
export interface ProbeCandidate extends ProbeResult {
  /** 实际命中的直链 */
  url?: string;
  /** 仓库内的文件路径，用于区分同一仓库里的多个音源 */
  path?: string;
}

export type ProbeFailReason =
  | "empty"
  | "network"
  | "not-found"
  | "no-source"
  | "unrecognized";

export type ProbeOutcome =
  | { ok: true; candidates: ProbeCandidate[] }
  | { ok: false; reason: ProbeFailReason };

/** 生产 Web 走自家后端代理绕跨域；原生端和开发环境直连 */
function remote(url: string) {
  return !IS_NATIVE && import.meta.env.PROD ? getProxyUrl(url) : url;
}

function isLxScript(text: string) {
  return /globalThis\s*\.\s*lx/.test(text) || /EVENT_NAMES/.test(text);
}

/** 把 GitHub 仓库/文件页 URL 转成 raw 直链；其它 URL 原样返回 */
export function normalizeSourceUrl(input: string): string {
  const url = input.trim();
  try {
    const u = new URL(url);
    if (u.hostname === "github.com") {
      // https://github.com/owner/repo/blob/branch/path → raw.githubusercontent.com/owner/repo/branch/path
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
      if (m) {
        return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
      }
      // 仓库根目录：默认取 main 分支的 latest.js（洛雪脚本仓库的常见入口）
      const repo = u.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
      if (repo) {
        return `https://raw.githubusercontent.com/${repo[1]}/${repo[2]}/main/latest.js`;
      }
    }
    // gist
    if (u.hostname === "gist.github.com") {
      const m = u.pathname.match(/^\/(?:[^/]+\/)?([0-9a-f]+)$/);
      if (m) return `https://gist.githubusercontent.com/raw/${m[1]}`;
    }
  } catch {
    // 交给调用方报格式错误
  }
  return url;
}

/* ------------------------------------------------------------------ */
/* 网络                                                                */
/* ------------------------------------------------------------------ */

interface FetchTextResult {
  text: string | null;
  /** HTTP 状态码；0 表示网络层失败（DNS/超时/被拦截） */
  status: number;
}

async function fetchTextOnce(
  url: string,
  timeout = 10000
): Promise<FetchTextResult> {
  try {
    const res = await fetchWithTimeout(remote(url), {}, timeout);
    if (!res.ok) return { text: null, status: res.status };
    return { text: await res.text(), status: res.status };
  } catch {
    return { text: null, status: 0 };
  }
}

/** 依次尝试多个直链（raw → jsDelivr 镜像），返回第一个成功的 */
async function fetchTextAny(
  urls: string[],
  timeout = 10000
): Promise<FetchTextResult> {
  let last: FetchTextResult = { text: null, status: 0 };
  for (const url of urls) {
    const r = await fetchTextOnce(url, timeout);
    if (r.text) return r;
    last = r;
    // 404 说明镜像也不会更全，直接返回；网络失败才继续试下一个
    if (r.status === 404) return r;
  }
  return last;
}

async function fetchJson<T>(url: string, timeout = 8000): Promise<T | null> {
  const r = await fetchJsonWithStatus<T>(url, timeout);
  return r.data;
}

async function fetchJsonWithStatus<T>(
  url: string,
  timeout = 8000
): Promise<{ data: T | null; status: number }> {
  try {
    const res = await fetchWithTimeout(
      remote(url),
      { headers: { Accept: "application/json" } },
      timeout
    );
    if (!res.ok) return { data: null, status: res.status };
    return { data: (await res.json()) as T, status: res.status };
  } catch {
    return { data: null, status: 0 };
  }
}

/* ------------------------------------------------------------------ */
/* GitHub 仓库解析                                                      */
/* ------------------------------------------------------------------ */

interface GithubTarget {
  owner: string;
  repo: string;
  /** 分支 / commit；仓库根地址时为空，需要查默认分支 */
  ref?: string;
  /** 仓库内的目录；空串表示根目录 */
  path: string;
  isFile: boolean;
}

function parseGithubInput(input: string): GithubTarget | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }

  if (u.hostname === "raw.githubusercontent.com") {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    if (!m) return null;
    return { owner: m[1], repo: m[2], ref: m[3], path: m[4], isFile: true };
  }

  if (u.hostname !== "github.com") return null;

  const parts = u.pathname.split("/").filter(Boolean);
  const [owner, rawRepo, mode, ref, ...rest] = parts;
  if (!owner || !rawRepo) return null;
  const repo = rawRepo.replace(/\.git$/, "");

  if (mode === "blob" && ref && rest.length) {
    return { owner, repo, ref, path: rest.join("/"), isFile: true };
  }
  if (mode === "tree" && ref) {
    return { owner, repo, ref, path: rest.join("/"), isFile: false };
  }
  // 只有 /owner/repo（可带尾部斜杠）
  if (!mode) return { owner, repo, path: "", isFile: false };
  // issues / releases / commits 等页面不是音源
  return null;
}

function rawUrlOf(
  t: { owner: string; repo: string },
  ref: string,
  path: string
) {
  return `https://raw.githubusercontent.com/${t.owner}/${t.repo}/${ref}/${path}`;
}

function cdnUrlOf(
  t: { owner: string; repo: string },
  ref: string,
  path: string
) {
  return `${JSDELIVR_CDN}/${t.owner}/${t.repo}@${ref}/${path}`;
}

interface RepoScriptFile {
  path: string;
  rawUrl: string;
  cdnUrl: string;
}

/**
 * 列出仓库里的脚本文件。优先 GitHub API（能拿到默认分支），
 * 不通时退回 jsDelivr 的数据接口（国内通常可达）。
 */
async function listRepoScripts(
  target: GithubTarget
): Promise<{ files: RepoScriptFile[]; reachable: boolean; notFound: boolean }> {
  let reachable = false;
  let notFound = false;
  let ref = target.ref;
  let paths: string[] = [];

  const info = await fetchJsonWithStatus<{ default_branch?: string }>(
    `${GITHUB_API}/repos/${target.owner}/${target.repo}`
  );
  if (info.data) {
    reachable = true;
    if (!ref) ref = info.data.default_branch || "main";
  } else if (info.status === 404) {
    notFound = true;
  }

  if (ref) {
    const tree = await fetchJson<{
      tree?: Array<{ path: string; type: string }>;
    }>(
      `${GITHUB_API}/repos/${target.owner}/${target.repo}/git/trees/${encodeURIComponent(
        ref
      )}?recursive=1`
    );
    if (tree?.tree?.length) {
      reachable = true;
      paths = tree.tree.filter((x) => x.type === "blob").map((x) => x.path);
    }
  }

  if (paths.length === 0) {
    const branches = [ref, "main", "master"].filter(Boolean) as string[];
    for (const branch of branches) {
      const data = await fetchJson<{ files?: Array<{ name: string }> }>(
        `${JSDELIVR_API}/${target.owner}/${target.repo}@${branch}?structure=flat`
      );
      if (data?.files?.length) {
        reachable = true;
        ref = branch;
        paths = data.files.map((f) => f.name.replace(/^\//, ""));
        break;
      }
    }
  }

  if (!ref || paths.length === 0) return { files: [], reachable, notFound };

  const dir = target.path.replace(/^\/|\/$/g, "");
  const inDir = paths.filter(
    (p) =>
      p.endsWith(".js") &&
      (!dir || p === dir || p.startsWith(`${dir}/`)) &&
      p !== dir
  );
  // 排除构建产物和与音源无关的目录
  const clean = inDir.filter(
    (p) => !/(^|\/)(node_modules|\.github|dist|build|docs?)\//i.test(p)
  );

  // 音源仓库惯例是每个源一个目录，入口为 latest.js；
  // 有 latest.js 就只取它，避免把历史版本全列出来。
  const latest = clean.filter((p) => /(^|\/)latest\.js$/i.test(p));
  const picked = (latest.length > 0 ? latest : clean).slice(0, 40);

  return {
    files: picked.map((p) => ({
      path: p,
      rawUrl: rawUrlOf(target, ref as string, p),
      cdnUrl: cdnUrlOf(target, ref as string, p),
    })),
    reachable,
    notFound,
  };
}

/** 并发受限的 map，避免一次打几十个请求被限流/卡住 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/* ------------------------------------------------------------------ */
/* 脚本解析                                                            */
/* ------------------------------------------------------------------ */

const ACTIONS = [
  "musicUrl",
  "musicInfo",
  "lyric",
  "pic",
  "album",
  "artist",
  "playlist",
];

/** 解析洛雪脚本头部注释里的 @name / @version，以及支持的 action */
function parseLxScript(script: string): ProbeResult | null {
  if (!isLxScript(script)) return null;

  const nameMatch = script.match(
    /@name\s+(?:[\u4e00-\u9fa5A-Za-z0-9_\-. ]+?)(?:\s|$)/
  );

  // 真实脚本大多被压缩过，action 常写成对象方法简写（musicUrl(r,e){...}）
  // 或带引号的字符串，两种都要认。
  const capabilities: string[] = [];
  for (const action of ACTIONS) {
    const re = new RegExp(`['"\`]${action}['"\`]|\\b${action}\\s*\\(`);
    if (re.test(script)) capabilities.push(action);
  }
  // 至少实现了搜索或取链，才算能用的播放音源
  if (
    !capabilities.includes("musicInfo") &&
    !capabilities.includes("musicUrl")
  ) {
    return null;
  }

  return {
    kind: "lx",
    name: nameMatch?.[0]?.replace(/^@name\s+/, "").trim() || "洛雪音源",
    script,
    capabilities,
    sourceCode: detectSourceCode(script),
  };
}

/** 从脚本里找平台代号：MUSIC_QUALITY = { tx: ... } 或 sources: { kg: { ... } } */
function detectSourceCode(script: string): string {
  const quality = script.match(/MUSIC_QUALITY\s*=\s*\{([^}]+)\}/);
  if (quality) {
    const key = quality[1].match(/([A-Za-z]{2})\s*:/);
    if (key) return key[1];
  }
  const sources = script.match(/\bsources\s*:\s*\{\s*([A-Za-z]{2})\s*:/);
  if (sources) return sources[1];
  const byName = script.match(/\bname\s*:\s*["']([A-Za-z]{2})["']/);
  if (byName) return byName[1];
  return "tx";
}

/** 仓库里没有 @name 时，用目录名当显示名 */
function nameFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1
    ? parts[parts.length - 2]
    : parts[0]?.replace(/\.js$/i, "") || "洛雪音源";
}

/* ------------------------------------------------------------------ */
/* 对外探测                                                            */
/* ------------------------------------------------------------------ */

/** 探测 GD Studio 兼容的 api.php：types=search 返回数组 */
async function probeGdApi(baseUrl: string, attempt = 0): Promise<boolean> {
  try {
    const u = new URL(baseUrl);
    u.searchParams.set("types", "search");
    u.searchParams.set("name", "test");
    u.searchParams.set("count", "1");
    u.searchParams.set("pages", "1");
    const res = await fetchWithTimeout(remote(u.toString()), {}, 10000);
    if (!res.ok) return false;
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      // 偶发被网关拦截返回 HTML（限流页），稍等再试一次
      if (attempt < 1) {
        await new Promise((r) => setTimeout(r, 400));
        return probeGdApi(baseUrl, attempt + 1);
      }
      return false;
    }
    if (!Array.isArray(data)) return false;
    if (data.length === 0) return true;
    const first = data[0];
    return typeof first === "object" && first !== null && "url_id" in first;
  } catch {
    return false;
  }
}

function guessNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const file = u.pathname.split("/").pop() || u.hostname;
    return file.replace(/\.(js|json|php)$/i, "").slice(0, 24) || u.hostname;
  } catch {
    return "自定义音源";
  }
}

/** 探测单个直链：先 GD API，再洛雪脚本 */
async function probeSingleUrl(
  url: string,
  candidates: string[]
): Promise<ProbeOutcome> {
  if (await probeGdApi(url)) {
    return {
      ok: true,
      candidates: [{ kind: "gd", name: guessNameFromUrl(url), url }],
    };
  }

  const r = await fetchTextAny(candidates);
  if (r.text) {
    const parsed = parseLxScript(r.text);
    if (parsed) {
      const generic = parsed.name === "洛雪音源";
      return {
        ok: true,
        candidates: [
          {
            ...parsed,
            name: generic ? guessNameFromUrl(url) : parsed.name,
            url,
          },
        ],
      };
    }
    return { ok: false, reason: "unrecognized" };
  }
  // 0 = 网络层失败；4xx/5xx 说明地址本身不对
  return { ok: false, reason: r.status === 0 ? "network" : "unrecognized" };
}

/**
 * 探测输入（仓库地址 / 文件直链 / 脚本内容），返回所有可用音源。
 * 仓库里通常有多个音源，交给调用方让用户挑一个。
 */
export async function probeSourceCandidates(
  input: string,
  onProgress?: (done: number, total: number) => void
): Promise<ProbeOutcome> {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "empty" };

  // 直接粘贴了脚本内容
  if (raw.length > 80 && isLxScript(raw)) {
    const parsed = parseLxScript(raw);
    return parsed
      ? { ok: true, candidates: [parsed] }
      : { ok: false, reason: "unrecognized" };
  }

  const gh = parseGithubInput(raw);

  // 仓库 / 目录：列出里面的脚本，逐个解析
  if (gh && !gh.isFile) {
    const { files, reachable, notFound } = await listRepoScripts(gh);
    if (files.length === 0) {
      return {
        ok: false,
        reason: notFound ? "not-found" : reachable ? "no-source" : "network",
      };
    }

    let done = 0;
    const parsed = await mapLimit(files, 5, async (file) => {
      const r = await fetchTextAny([file.rawUrl, file.cdnUrl], 8000);
      done += 1;
      onProgress?.(done, files.length);
      if (!r.text) return null;
      const res = parseLxScript(r.text);
      if (!res) return null;
      return {
        ...res,
        name: res.name === "洛雪音源" ? nameFromPath(file.path) : res.name,
        url: file.rawUrl,
        path: file.path,
      } as ProbeCandidate;
    });

    const found = parsed.filter((x): x is ProbeCandidate => Boolean(x));
    if (found.length === 0) {
      return { ok: false, reason: reachable ? "no-source" : "network" };
    }

    // 同名音源加上目录区分，避免导入后分不清
    const nameCount = new Map<string, number>();
    found.forEach((c) =>
      nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1)
    );
    const candidates = found.map((c) =>
      (nameCount.get(c.name) ?? 0) > 1 && c.path
        ? { ...c, name: `${c.name}（${nameFromPath(c.path)}）` }
        : c
    );

    return { ok: true, candidates };
  }

  // 单个文件 / 任意 URL
  const url = normalizeSourceUrl(raw);
  const mirrors = gh?.isFile
    ? [url, cdnUrlOf(gh, gh.ref as string, gh.path)]
    : [url];
  return probeSingleUrl(url, mirrors);
}

/** 兼容旧调用：只取第一个可用结果 */
export async function probeSource(
  input: string
): Promise<ProbeCandidate | null> {
  const outcome = await probeSourceCandidates(input);
  if (!outcome.ok) return null;
  return outcome.candidates[0] ?? null;
}
