import type { MusicTrack } from "@/types/music";
import { useImportedSourcesStore } from "./store";
import type { ImportedSource } from "./types";
import { getLxRuntime, lxGetUrl } from "./lx-sandbox";
import { probeMediaDetail } from "@/lib/utils/media-probe";
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
 * 单个源的取链预算。
 * 脚本冷启动要先换 token、拉自己的域名列表，真机 WebView 上 fish_music
 * 实测超过 12s（Node 里快得多）。12s 会把「慢但能播」的源误杀，给 20s。
 */
const PER_SOURCE_TIMEOUT = 20000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

/**
 * 试听片段的字节数上限。
 * QQ 付费曲的试听链固定 960887 字节（≈60 秒），完整音轨 3 分钟以上 2.8MB+。
 * 竞速时用它挡掉星澜/杰翔那种「快但只有 60 秒」的链，否则点歌秒开、
 * 听半分钟就断，比慢一点更糟。留足余量，避免误杀 1 分半的短歌。
 */
const MIN_FULL_TRACK_BYTES = 1_000_000;

/**
 * 用洛雪源解析播放地址：所有候选源并发取链，谁先给出**可播的完整音轨**谁胜出。
 *
 * 不同源补集很强：fish 曲库全但慢（新歌只有它有），非常刀/星澜对老歌几百毫秒
 * 就返回。串行试会先死等 fish 20 秒，把快源的优势全吃掉。并发后快源先冲线，
 * fish 慢就让它慢慢跑不阻塞——大不了这批没它，等下一曲。
 */
export async function resolveViaLxPlayback(
  track: MusicTrack,
  br = 320
): Promise<LxPlaybackResult | null> {
  const platform = getLxPlatformForSource(track.source);
  if (!platform) return null;

  const all = useImportedSourcesStore
    .getState()
    .sources.filter((s) => s.kind === "lx" && s.enabled && !!s.script);

  // 很多脚本的 inited 是异步的（要先请求自己的服务端拿 token/域名）。
  // 不等它，getLxSourcePlatforms 只能退回导入时猜的 sourceCode，
  // 于是「支持 wy 的源」会被误判成只支持 tx 而从不尝试。
  await Promise.all(
    all.map((s) =>
      withTimeout(
        getLxRuntime(
          s.id,
          s.script as string,
          s.sourceCode || platform
        ).waitInited(1500),
        1500
      )
    )
  );

  const candidates = all.filter((s) =>
    getLxSourcePlatforms(s).includes(platform)
  );
  if (candidates.length === 0) return null;

  // 并发竞速：每个源独立取链 + 探测，第一个拿到完整可播直链的立即胜出。
  // 已胜出后其余源的结果直接丢弃（请求还在跑，但不会再改结果）。
  return new Promise((resolve) => {
    let settled = false;
    let pending = candidates.length;

    const finish = (result: LxPlaybackResult | null) => {
      if (settled) return;
      if (result) {
        settled = true;
        resolve(result);
        return;
      }
      pending -= 1;
      if (pending === 0) {
        settled = true;
        resolve(null);
      }
    };

    for (const source of candidates) {
      void (async () => {
        const runtime = getLxRuntime(
          source.id,
          source.script as string,
          source.sourceCode || platform
        );
        if (!runtime.handler) {
          finish(null);
          return;
        }
        let url: string | null = null;
        try {
          url = await withTimeout(
            lxGetUrl(runtime, track, br, platform),
            PER_SOURCE_TIMEOUT
          );
        } catch (error) {
          logger.warn(`洛雪源取链抛错：${source.name} ${String(error)}`);
        }
        if (!url || !/^https?:\/\//.test(url) || settled) {
          finish(null);
          return;
        }
        const playable = upgradeLxUrlToHttps(url);
        const detail = await probeMediaDetail(playable, 4000);
        if (settled) {
          finish(null);
          return;
        }
        if (detail.reachable !== "ok") {
          logger.warn(
            `洛雪源返回的链接不可播(${detail.reachable})：${source.name} ${platform} ${playable.slice(0, 120)}`
          );
          finish(null);
          return;
        }
        // 能连通但只有试听片段：不能让它抢先，等其余源给完整版
        if (
          detail.totalBytes !== null &&
          detail.totalBytes < MIN_FULL_TRACK_BYTES
        ) {
          logger.warn(
            `洛雪源返回试听片段(${detail.totalBytes}B)：${source.name} ${platform}`
          );
          finish(null);
          return;
        }
        logger.info(
          `洛雪竞速胜出：${source.name} ${platform} ${
            detail.totalBytes
              ? `${(detail.totalBytes / 1048576).toFixed(1)}MB`
              : ""
          } ${playable.slice(0, 120)}`
        );
        finish({ url: playable, sourceName: getSourceLabel(source.id) });
      })();
    }
  });
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
  const runtime = getLxRuntime(
    source.id,
    source.script,
    source.sourceCode || platform
  );
  // 异步 inited 的脚本要先等它声明平台，否则会被判成「不支持该平台」
  if (!runtime.inited) await runtime.waitInited(1500);
  if (!getLxSourcePlatforms(source).includes(platform)) return null;
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
