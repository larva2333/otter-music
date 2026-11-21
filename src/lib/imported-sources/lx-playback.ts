import type { MusicTrack } from "@/types/music";
import { useImportedSourcesStore } from "./store";
import type { ImportedSource } from "./types";
import { getLxRuntime, lxGetUrl } from "./lx-sandbox";
import { probeMediaReachable } from "@/lib/utils/media-probe";
import { logger } from "@/lib/logger";
import { getSourceLabel } from "./labels";

/**
 * 洛雪源只能提供播放链接，不能搜索。
 *
 * 它的定位是「给内置平台搜到的歌换一条能播的地址」：内置 QQ / 网易云
 * 搜出曲目后，这里按曲目所属平台（tx / wy / kw / kg / mg）找声明了该平台
 * 的洛雪脚本，用曲目 id 换直链；换不到再回落到平台自身的接口。
 */

/** 项目音源 → 洛雪平台代号 */
const PLATFORM_BY_SOURCE: Partial<Record<string, string>> = {
  qq: "tx",
  tencent: "tx",
  _netease: "wy",
  netease: "wy",
  kugou: "kg",
  kuwo: "kw",
  migu: "mg",
  // 洛雪平台代号本身也可能作为音源 id 出现（历史数据）
  tx: "tx",
  wy: "wy",
  kg: "kg",
  kw: "kw",
  mg: "mg",
};

/** 平台代号 → 中文名，用于设置页说明这个脚本接管谁 */
export const LX_PLATFORM_LABELS: Record<string, string> = {
  tx: "QQ 音乐",
  wy: "网易云",
  kw: "酷我",
  kg: "酷狗",
  mg: "咪咕",
  qs: "汽水",
  local: "本地",
};

export function getLxPlatformForSource(source: string): string | null {
  return PLATFORM_BY_SOURCE[source] ?? null;
}

/** 是不是洛雪脚本导入源（没有搜索能力，只接管播放） */
export function isLxPlaybackSource(source: string): boolean {
  return useImportedSourcesStore
    .getState()
    .sources.some((s) => s.id === source && s.kind === "lx");
}

/**
 * 这些音乐 CDN 都已支持 HTTPS。
 *
 * 洛雪脚本返回的直链经常是 http://，而应用页面是 https://localhost，
 * WebView 的混合内容策略会把这类音频请求直接拦掉 —— 表现就是
 * 脚本明明取到了链接，audio 却 AUDIO_NOT_READY / 加载超时。
 * 对已知 CDN 直接升级到 https，比绕后端代理更快也更稳定。
 */
const HTTPS_CAPABLE_HOSTS = [
  "qqmusic.qq.com",
  "qqmusic.cn",
  "music.126.net",
  "126.net",
  "kugou.com",
  "kuwo.cn",
  "migu.cn",
  "bilivideo.com",
];

export function upgradeLxUrlToHttps(url: string): string {
  if (!url.startsWith("http://")) return url;
  try {
    const host = new URL(url).hostname;
    const capable = HTTPS_CAPABLE_HOSTS.some(
      (h) => host === h || host.endsWith(`.${h}`)
    );
    return capable ? `https://${url.slice("http://".length)}` : url;
  } catch {
    return url;
  }
}

/** 脚本声明了哪些平台。未上报 inited 时退回导入时探测到的那个 */
export function getLxSourcePlatforms(source: ImportedSource): string[] {
  if (source.kind !== "lx" || !source.script) return [];
  const runtime = getLxRuntime(
    source.id,
    source.script,
    source.sourceCode || "tx"
  );
  const declared = Object.keys(runtime.inited?.sources || {});
  if (declared.length > 0) return declared;
  return source.sourceCode ? [source.sourceCode] : [];
}

/** 找一个能接管该平台播放的洛雪源，按设置里的顺序 */
export function findLxSourceForPlatform(
  platform: string,
  options: { includeDisabled?: boolean } = {}
): ImportedSource | null {
  const sources = useImportedSourcesStore.getState().sources;
  return (
    sources.find((s) => {
      if (s.kind !== "lx" || !s.script) return false;
      if (!options.includeDisabled && !s.enabled) return false;
      return getLxSourcePlatforms(s).includes(platform);
    }) ?? null
  );
}

export interface LxPlaybackResult {
  url: string;
  /** 实际接管播放的洛雪源显示名，播放界面要显示「当前用的音源」 */
  sourceName: string;
}

/**
 * 用洛雪源解析播放地址。
 * 依次尝试所有支持该平台的已启用源，第一个返回 http(s) 直链的胜出。
 */
export async function resolveViaLxPlayback(
  track: MusicTrack,
  br = 320
): Promise<LxPlaybackResult | null> {
  const platform = getLxPlatformForSource(track.source);
  if (!platform) return null;

  const candidates = useImportedSourcesStore
    .getState()
    .sources.filter(
      (s) =>
        s.kind === "lx" &&
        s.enabled &&
        !!s.script &&
        getLxSourcePlatforms(s).includes(platform)
    );

  // 串行试太多源会让首播等待变长，最多试前 3 个
  for (const source of candidates.slice(0, 3)) {
    const runtime = getLxRuntime(
      source.id,
      source.script as string,
      source.sourceCode || platform
    );
    if (!runtime.handler) continue;
    const url = await lxGetUrl(runtime, track, br, platform);
    if (!url || !/^https?:\/\//.test(url)) continue;
    const playable = upgradeLxUrlToHttps(url);
    // 有的脚本会返回已下线的中转地址，先确认能拉到数据
    const reachable = await probeMediaReachable(playable, 4000);
    if (reachable === "fail") {
      // logger 的双字符串参数会被当成 (source, message)，这里拼成一条，
      // 否则 platform / url 会被吞掉，排查时看不到到底是哪条链接死了
      logger.warn(
        `洛雪源返回的链接不可播：${source.name} ${platform} ${playable.slice(0, 160)}`
      );
      continue;
    }
    logger.info(
      `洛雪接管播放：${source.name} ${platform} ${
        reachable === "unknown" ? "（未确认可达）" : ""
      }${playable.slice(0, 160)}`
    );
    return { url: playable, sourceName: getSourceLabel(source.id) };
  }
  return null;
}

/**
 * 用指定洛雪源解析，供一键检测 / 手动选源使用。
 * 不走 enabled 过滤，检测本身要能验证已关闭的源。
 */
export async function resolveViaSpecificLxSource(
  source: ImportedSource,
  track: MusicTrack,
  br = 320
): Promise<string | null> {
  const platform = getLxPlatformForSource(track.source);
  if (!platform || !source.script) return null;
  if (!getLxSourcePlatforms(source).includes(platform)) return null;
  const runtime = getLxRuntime(
    source.id,
    source.script,
    source.sourceCode || platform
  );
  if (!runtime.handler) return null;
  const url = await lxGetUrl(runtime, track, br, platform);
  return url && /^https?:\/\//.test(url) ? upgradeLxUrlToHttps(url) : null;
}

/* ---------------- 手动指定取链源 ---------------- */

/** 手动选源后，给这一次播放准备的直链（带 TTL，避免过期链接被反复使用） */
const OVERRIDE_TTL = 5 * 60 * 1000;

let urlOverride: {
  trackId: string;
  trackSource: string;
  sourceId: string;
  url: string;
  at: number;
} | null = null;

export function setLxUrlOverride(next: {
  trackId: string;
  trackSource: string;
  sourceId: string;
  url: string;
}): void {
  urlOverride = { ...next, at: Date.now() };
}

export function clearLxUrlOverride(): void {
  urlOverride = null;
}

/** 当前曲目是否有手动选的洛雪直链（含是哪个源，供播放界面显示） */
export function getLxUrlOverride(track: {
  id: string;
  source: string;
}): { url: string; sourceId: string } | null {
  if (!urlOverride) return null;
  if (urlOverride.trackId !== track.id) return null;
  if (urlOverride.trackSource !== track.source) return null;
  if (Date.now() - urlOverride.at > OVERRIDE_TTL) {
    urlOverride = null;
    return null;
  }
  return { url: urlOverride.url, sourceId: urlOverride.sourceId };
}
