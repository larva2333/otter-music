import { musicApi } from "@/lib/music-api";
import type { MusicSource, MusicTrack } from "@/types/music";
import { getImportedSource } from "@/lib/imported-sources/store";
import { probeMediaReachable } from "@/lib/utils/media-probe";
import { getLxRuntime } from "@/lib/imported-sources/lx-sandbox";
import { resolveViaSpecificLxSource } from "@/lib/imported-sources/lx-playback";

export type SourceHealthStatus = "ok" | "fail" | "unknown";

export interface SourceHealthResult {
  source: MusicSource;
  status: SourceHealthStatus;
  /** 失败原因，供设置页展示 */
  reason?: string;
  /**
   * 本次检测耗时（毫秒）。
   *
   * - 内置源 / GD API：一次搜索请求的往返时间
   * - 洛雪脚本：初始化 + 换链 + 探活的总耗时
   *
   * 设置页用它显示「延迟」并在检测完成后按升序重排音源。
   */
  latencyMs?: number;
}

/**
 * 探测用的关键词：先用中文常用歌手，搜不到再试一个英文词。
 * 中文源（网易/QQ/酷我/B站/嗨歌曲）第一个词就该有结果，
 * 国外源（jamendo 等）用中文往往为空，靠第二个词兜住。
 */
const PROBE_KEYWORDS = ["周杰伦", "love"];

/** 单次请求超时。嗨歌曲实测一次要 8~13 秒，给足 15 秒再判失败 */
const DEFAULT_TIMEOUT = 15_000;

/** 等脚本发出 inited 的时间。慢脚本要先异步取配置/签名，5 秒太紧容易误杀 */
const LX_INIT_WAIT = 10_000;

/** 洛雪平台代号 → 项目里能搜出该平台曲目的音源 */
const LX_PROBE_SEARCH_SOURCE: Partial<Record<string, MusicSource>> = {
  tx: "qq",
  wy: "_netease",
  kg: "kugou",
  kw: "kuwo",
  mg: "migu",
};

/** 同一平台只搜一次，多个洛雪源共用同一首探测曲目 */
const probeTrackCache = new Map<MusicSource, MusicTrack | null>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function getProbeTrack(source: MusicSource): Promise<MusicTrack | null> {
  if (probeTrackCache.has(source)) return probeTrackCache.get(source) ?? null;
  try {
    const res = await withTimeout(
      musicApi.search("晴天", source, 1, 3),
      DEFAULT_TIMEOUT
    );
    const track = res.items?.[0] ?? null;
    probeTrackCache.set(source, track);
    return track;
  } catch {
    probeTrackCache.set(source, null);
    return null;
  }
}

/**
 * 洛雪源检测：**不能靠搜索**（协议里根本没有 search），
 * 也不能只看脚本有没有返回字符串。
 *
 * 方法对齐官方（移动端 userApi 的原生沙箱）：
 *   1. 脚本能执行完并发出 inited —— API v2 起，inited 之前的任何未捕获
 *      错误（老脚本用 status:false + message）都算初始化失败；
 *   2. inited.sources[平台].actions 里必须有 musicUrl，否则拿不到播放链接；
 *   3. 官方不做网络实测，但「能初始化」不等于上游没挂（幻音那种域名已
 *      失效的源照样能初始化），所以再拿对应平台的真实曲目换一次链接并
 *      拉一小段，确认真的能播。音质由脚本声明的 qualitys 决定，不写死。
 */
async function checkLxSource(
  id: MusicSource,
  timeoutMs: number
): Promise<SourceHealthResult> {
  const started = Date.now();
  /** 所有出口都带上本次检测耗时，设置页据此显示延迟并排序 */
  const done = (result: SourceHealthResult): SourceHealthResult => ({
    ...result,
    latencyMs: Date.now() - started,
  });

  const imported = getImportedSource(id);
  if (!imported?.script) {
    return done({ source: id, status: "fail", reason: "脚本为空" });
  }

  const runtime = getLxRuntime(
    id,
    imported.script,
    imported.sourceCode || "tx"
  );
  const inited = await runtime.waitInited(LX_INIT_WAIT);
  if (runtime.initError) {
    return done({
      source: id,
      status: "fail",
      reason: `脚本初始化失败：${runtime.initError}`,
    });
  }
  if (!inited || !runtime.inited) {
    return done({
      source: id,
      status: "fail",
      reason: "脚本没有发出初始化事件",
    });
  }
  if (!runtime.handler) {
    return done({
      source: id,
      status: "fail",
      reason: "脚本没有注册请求处理器",
    });
  }

  const declared = runtime.inited.sources ?? {};
  const platforms = Object.keys(declared);
  if (platforms.length === 0) {
    return done({ source: id, status: "fail", reason: "脚本没有声明任何平台" });
  }
  // 官方只会调用 actions 里声明过的操作；没有 musicUrl 就是纯歌词源之类
  const playable = platforms.filter((p) => {
    const actions = declared[p]?.actions;
    return !actions || actions.includes("musicUrl");
  });
  if (playable.length === 0) {
    return done({
      source: id,
      status: "fail",
      reason: "脚本不支持取播放链接",
    });
  }

  const testable = playable.filter((p) => LX_PROBE_SEARCH_SOURCE[p]);
  if (testable.length === 0) {
    return done({
      source: id,
      status: "unknown",
      reason: "缺少可验证的平台曲目",
    });
  }

  let inconclusive = false;
  for (const platform of testable) {
    const searchSource = LX_PROBE_SEARCH_SOURCE[platform] as MusicSource;
    const track = await getProbeTrack(searchSource);
    if (!track) continue;
    let url: string | null = null;
    try {
      url = await withTimeout(
        resolveViaSpecificLxSource(imported, track, 320),
        timeoutMs
      );
    } catch {
      inconclusive = true;
      continue;
    }
    if (!url) continue;
    const reachable = await probeMediaReachable(url, timeoutMs);
    if (reachable === "ok") return done({ source: id, status: "ok" });
    if (reachable === "unknown") inconclusive = true;
  }

  // 「换不到链接」不等于脚本坏了：探测曲目（晴天）在部分平台搜不到、
  // 上游临时限流/风控、CDN 域名变动都会让这一轮换链落空。判成 fail
  // 会被一键检测自动停用，几轮下来洛雪源只剩一两个还能用。这类不确定
  // 结果统一判 unknown——只提示、不停用，把是否禁用交回给用户。
  return done({
    source: id,
    status: "unknown",
    reason: inconclusive ? "播放链接未响应" : "本轮未换到可播放的链接",
  });
}

/** GD 兼容 API 检测：搜索有结果即视为可用 */
async function checkGdSource(
  source: MusicSource,
  timeoutMs: number
): Promise<SourceHealthResult> {
  const started = Date.now();
  for (const keyword of PROBE_KEYWORDS) {
    // 延迟只算「真正返回结果的那次请求」：第一个关键词超时 15 秒后
    // 第二个才命中，记成 18 秒就没有参考价值了。
    const attemptAt = Date.now();
    try {
      const res = await withTimeout(
        musicApi.search(keyword, source, 1, 5),
        timeoutMs
      );
      if ((res.items?.length ?? 0) > 0) {
        return {
          source,
          status: "ok",
          latencyMs: Date.now() - attemptAt,
        };
      }
    } catch {
      // 换下一个关键词再试一次
    }
  }
  return {
    source,
    status: "fail",
    reason: "搜索无结果",
    latencyMs: Date.now() - started,
  };
}

/**
 * 检测单个音源是否还能用。
 *
 * - 导入的洛雪脚本：拿真实曲目换播放链接（它没有搜索能力）
 * - GD API / 内置源：任一探测关键词返回至少 1 条结果
 */
export async function checkSourceHealth(
  source: MusicSource,
  timeoutMs = DEFAULT_TIMEOUT
): Promise<SourceHealthResult> {
  const imported = getImportedSource(source);
  if (imported?.kind === "lx") {
    return checkLxSource(source, timeoutMs);
  }
  return checkGdSource(source, timeoutMs);
}

/**
 * 批量检测。默认 3 并发，避免同时打太多上游接口被限流
 * （部分 GD API 在突发请求下会返回 HTML 限流页）。
 */
export async function checkSourcesHealth(
  sources: MusicSource[],
  options: {
    concurrency?: number;
    timeoutMs?: number;
    onProgress?: (
      done: number,
      total: number,
      result: SourceHealthResult
    ) => void;
  } = {}
): Promise<SourceHealthResult[]> {
  const { concurrency = 3, timeoutMs = DEFAULT_TIMEOUT, onProgress } = options;

  probeTrackCache.clear();

  const results: SourceHealthResult[] = [];
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    while (cursor < sources.length) {
      const source = sources[cursor++];
      const result = await checkSourceHealth(source, timeoutMs);
      results.push(result);
      done += 1;
      onProgress?.(done, sources.length, result);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, sources.length) }, worker)
  );

  return results;
}
