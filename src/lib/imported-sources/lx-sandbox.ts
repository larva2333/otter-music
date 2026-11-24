import { fetchWithTimeout, getProxyUrl, IS_NATIVE } from "@/lib/api/config";
import { unzlibSync, zlibSync } from "fflate";
import type { MusicTrack, SearchPageResult, SongLyric } from "@/types/music";
import { decodeLxScript } from "./lx-codec";

export { decodeLxScript } from "./lx-codec";

/**
 * 洛雪音乐脚本沙箱。
 *
 * 洛雪音源是 JS 脚本，运行时通过 globalThis.lx 拿到宿主 API：
 * - lx.request(url, options, callback) 发网络请求，回调 (err, resp)，resp.body 是解析后的 JSON
 * - lx.on(EVENT_NAMES.request, handler) 注册请求处理器
 * - handler({ action, source, info }) 返回对应数据
 *
 * 重要：洛雪自定义源**只能提供播放链路**，没有搜索能力。
 * 官方文档里 action 只有 musicUrl / lyric / pic（local 源才有后两个），
 * 搜索由客户端自己的平台接口完成。所以这里的脚本不能当搜索源用，
 * 只能在内置平台（QQ/网易云）搜到歌之后，拿它的 id 来换播放地址。
 *
 * 另一个坑：脚本内部请求的是各家没有 CORS 头的接口。洛雪客户端用原生
 * HTTP 发请求（不受跨域限制），WebView 的 fetch 会被直接拦成 Failed to fetch。
 * 所以原生端必须走 CapacitorHttp，不能走 fetch。
 */

type LxHandler = (payload: {
  action: string;
  source: string;
  info: Record<string, unknown>;
}) => unknown | Promise<unknown>;

interface LxSourceInfo {
  name?: string;
  type?: string;
  actions?: string[];
  qualitys?: string[];
}

export interface LxRuntime {
  handler: LxHandler | null;
  /** 传给脚本 handler 的平台代号（如 tx/wy），不是导入 id */
  sourceCode: string;
  /** 曲目 id 前缀，用导入 id 保证全局唯一 */
  idPrefix: string;
  /** 脚本 send(inited) 上报的能力 */
  inited: { sources?: Record<string, LxSourceInfo> } | null;
  /** 初始化异常，供检测/设置页展示 */
  initError?: string;
  /**
   * 等脚本发出 inited 事件。
   *
   * 官方语义（自定义源 API v2）：`inited` 之前抛出的任何未捕获错误都算
   * 初始化失败，事件本身不再需要 `status` 字段。脚本有可能在异步请求
   * 结束后才 send(inited)，所以不能只看同步执行完的瞬间。
   */
  waitInited: (timeoutMs?: number) => Promise<boolean>;
}

/** 脚本声明支持的音质，从高到低 */
const LX_QUALITY_ORDER = ["flac24bit", "flac", "320k", "128k"] as const;

const runtimes = new Map<string, LxRuntime>();

const EVENT_NAMES = {
  request: "request",
  dispose: "dispose",
  inited: "inited",
  updateAlert: "updateAlert",
};

/* ---------------- Buffer / 编码工具 ---------------- */

/**
 * 洛雪音源脚本有两种存储形态：明文 JS，或 `gz_` + base64(zlib deflate)。
 * 桌面端从「音源仓库/导出文件」导入时存的就是压缩形态，官方客户端会在
 * 注入前解压；不处理会让 `new Function(script)` 直接语法报错，脚本永远
 * 注册不上 handler —— 表现就是所有洛雪源「一条链接都拿不到」。
 */
function toBytes(
  input: string | ArrayBuffer | Uint8Array,
  encoding = "utf8"
): Uint8Array {
  if (typeof input === "string") {
    if (encoding === "hex") {
      const out = new Uint8Array(Math.floor(input.length / 2));
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(input.substr(i * 2, 2), 16);
      }
      return out;
    }
    if (encoding === "base64") {
      const bin = atob(input);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new TextEncoder().encode(input);
  }
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

function bytesToString(bytes: Uint8Array, format = "utf8"): string {
  if (format === "hex") {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  if (format === "base64") {
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  }
  return new TextDecoder().decode(bytes);
}

/** Uint8Array → forge 需要的 binary string（每字节一个字符） */
function bytesToBinary(bytes: Uint8Array): string {
  let out = "";
  bytes.forEach((b) => (out += String.fromCharCode(b)));
  return out;
}

/** 给 Uint8Array 补一个 Node 风格的 toString(format)，脚本里常用 */
type LxBufferLike = Omit<Uint8Array, "toString"> & {
  toString(format?: string): string;
};

function createBuffer(bytes: Uint8Array): LxBufferLike {
  const buf = bytes as unknown as LxBufferLike;
  buf.toString = (format = "utf8") => bytesToString(bytes, format);
  return buf;
}

function bufferFrom(
  input: string | ArrayBuffer | Uint8Array,
  encoding = "utf8"
): LxBufferLike {
  return createBuffer(toBytes(input, encoding));
}

/* ---------------- 原生 HTTP ---------------- */

interface LxResponse {
  body: unknown;
  status: number;
  statusCode: number;
  statusMessage?: string;
  headers?: Record<string, string>;
}

/**
 * 洛雪 request 的宿主实现。
 * 原生端走 CapacitorHttp（OkHttp）绕开 WebView 的跨域规则；
 * Web 生产环境走自家代理；开发环境直接 fetch。
 */
async function lxFetch(
  url: string,
  options: Record<string, unknown> = {}
): Promise<LxResponse> {
  const method = ((options.method as string) || "GET").toUpperCase();
  const headers = (options.headers as Record<string, string>) || {};
  const body = options.body as string | undefined;

  const parse = (data: unknown) => {
    if (typeof data !== "string") return data;
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  };

  if (IS_NATIVE) {
    const { CapacitorHttp } = await import("@capacitor/core");
    const res = await CapacitorHttp.request({
      url,
      method,
      headers,
      data: body,
      connectTimeout: 15000,
      readTimeout: 15000,
      responseType: "text",
    });
    return {
      body: parse(res.data),
      status: res.status,
      // 脚本普遍按洛雪协议读 resp.statusCode（不是 status），缺这个字段
      // 会让它们把每个 200 响应都当成失败，直接抛「接口状态 undefined」
      statusCode: res.status,
      headers: res.headers as Record<string, string>,
    };
  }

  const target = import.meta.env.PROD ? getProxyUrl(url) : url;
  const res = await fetchWithTimeout(target, { method, headers, body }, 15000);
  const text = await res.text();
  return {
    body: parse(text),
    status: res.status,
    statusCode: res.status,
    statusMessage: res.statusText,
  };
}

/* ---------------- 运行时 ---------------- */

function createUtils() {
  const digest = async (algorithm: "md5" | "sha1", str: string) => {
    const forge = (await import("node-forge")).default;
    const md =
      algorithm === "md5" ? forge.md.md5.create() : forge.md.sha1.create();
    md.update(str);
    return md.digest().toHex();
  };

  const aesEncrypt = async (
    data: string | Uint8Array,
    mode = "cbc",
    key: string | Uint8Array,
    iv?: string | Uint8Array
  ) => {
    const forge = (await import("node-forge")).default;
    // 脚本传的可能是 "aes-128-ecb"、"AES-CBC"、"ecb"，统一成 forge 认的名字
    const raw = String(mode || "cbc").toUpperCase();
    const algo = (raw.startsWith("AES-") ? raw : `AES-${raw}`).replace(
      /AES-\d+-/,
      "AES-"
    ) as "AES-CBC" | "AES-ECB" | "AES-CTR" | "AES-GCM" | "AES-OFB" | "AES-CFB";
    const cipher = forge.cipher.createCipher(
      algo,
      forge.util.createBuffer(bytesToBinary(toBytes(key)))
    );
    // ECB 不接受 iv
    if (algo === "AES-ECB") {
      cipher.start({});
    } else {
      cipher.start({
        iv: forge.util.createBuffer(
          bytesToBinary(toBytes(iv || new Uint8Array(16)))
        ),
      });
    }
    cipher.update(forge.util.createBuffer(bytesToBinary(toBytes(data))));
    cipher.finish();
    return createBuffer(toBytes(cipher.output.toHex(), "hex"));
  };

  const crypto = {
    md5: (str: string) => digest("md5", str),
    sha1: (str: string) => digest("sha1", str),
    randomBytes: (size = 16) => {
      const bytes = new Uint8Array(size);
      const webCrypto = globalThis.crypto;
      if (webCrypto?.getRandomValues) webCrypto.getRandomValues(bytes);
      else
        bytes.forEach((_, i) => (bytes[i] = Math.floor(Math.random() * 256)));
      return bytesToString(bytes, "hex");
    },
    aesEncrypt,
    rsaEncrypt: async () => {
      throw new Error("rsaEncrypt 未实现");
    },
  };

  return {
    // 老脚本直接取 utils.md5，新脚本取 utils.crypto.md5，两处都挂上
    md5: crypto.md5,
    buffer: {
      from: bufferFrom,
      bufToString: (buf: Uint8Array, format = "utf8") =>
        bytesToString(buf, format),
    },
    crypto,
    zlib: {
      // 参数可能是 Uint8Array，也可能是脚本自己造的 buffer 风格对象
      inflate: async (data: Uint8Array | string) => {
        const bytes =
          typeof data === "string" ? toBytes(data, "base64") : toBytes(data);
        return createBuffer(unzlibSync(bytes));
      },
      deflate: async (data: Uint8Array | string) => {
        const bytes =
          typeof data === "string" ? toBytes(data, "utf8") : toBytes(data);
        return createBuffer(zlibSync(bytes));
      },
    },
  };
}

/** 执行脚本，拿到注册的 handler。同一脚本只执行一次 */
export function getLxRuntime(
  sourceId: string,
  script: string,
  platformCode = "tx"
): LxRuntime {
  const cached = runtimes.get(sourceId);
  if (cached) return cached;

  const runtime: LxRuntime = {
    handler: null,
    sourceCode: platformCode,
    idPrefix: sourceId,
    inited: null,
    waitInited: () => Promise.resolve(false),
  };

  // 脚本可能在异步请求回来后才 send(inited)，这里留一个信号量给检测等待
  let resolveInited: ((ok: boolean) => void) | null = null;
  const initedSignal = new Promise<boolean>((resolve) => {
    resolveInited = resolve;
  });
  const signalInited = (ok: boolean) => {
    resolveInited?.(ok);
    resolveInited = null;
  };
  runtime.waitInited = (timeoutMs = 1000) => {
    if (runtime.initError) return Promise.resolve(false);
    if (runtime.inited) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      void initedSignal.then((ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
    });
  };

  const lx = {
    EVENT_NAMES,
    env: "mobile",
    // 与官方当前 API 对齐：v2 起 inited 不再带 status，抛错即初始化失败。
    // 有些脚本会按 lx.version 分支，报低了会走老的调用约定。
    version: "2.0.0",
    currentScriptInfo: { name: "", rawScript: script },
    request: (
      url: string,
      options: Record<string, unknown>,
      callback?: (err: Error | null, resp: LxResponse | null) => void
    ) => {
      const p = lxFetch(url, options);
      if (callback) {
        p.then((resp) => callback(null, resp)).catch((err) =>
          callback(err, null)
        );
        return () => undefined;
      }
      return p;
    },
    on: (event: string, handler: LxHandler) => {
      if (event === EVENT_NAMES.request) runtime.handler = handler;
    },
    send: (event: string, data: unknown) => {
      if (event !== EVENT_NAMES.inited) return;
      const payload = (data ?? {}) as {
        status?: boolean;
        message?: string;
      } & NonNullable<LxRuntime["inited"]>;
      // 老脚本（v1）用 status:false 表示初始化失败，仍要认；
      // 新脚本不带 status，能走到这里就算成功。
      if (payload.status === false) {
        runtime.initError = payload.message?.trim() || "脚本上报初始化失败";
        signalInited(false);
        return;
      }
      runtime.inited = payload;
      signalInited(true);
    },
    utils: createUtils(),
    console: {
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      info: () => undefined,
      debug: () => undefined,
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  try {
    // 用 Object.create 保留宿主全局（setTimeout 等），只额外挂 lx
    const sandboxGlobal = Object.create(globalThis);
    sandboxGlobal.lx = lx;
    const code = decodeLxScript(script);
    const fn = new Function("globalThis", "lx", `with(lx){ ${code} }`);
    fn(sandboxGlobal, lx);
  } catch (error) {
    // 官方语义：inited 之后抛的错不算初始化失败（脚本已经可用，属于运行期错误）
    if (!runtime.inited) {
      runtime.initError =
        error instanceof Error ? error.message : String(error);
      signalInited(false);
    }
  }

  // 初始化失败也缓存，避免反复执行坏脚本
  runtimes.set(sourceId, runtime);
  return runtime;
}

export function clearLxRuntime(sourceId: string) {
  runtimes.delete(sourceId);
}

/** 脚本上报了哪些平台能力；用于设置页/检测展示 */
export function getLxRuntimeSources(runtime: LxRuntime): string[] {
  return Object.keys(runtime.inited?.sources || {});
}

async function call(
  runtime: LxRuntime,
  action: string,
  info: Record<string, unknown>,
  platform?: string
): Promise<unknown> {
  if (!runtime.handler) throw new Error("音源脚本未注册请求处理器");
  return runtime.handler({
    action,
    source: platform || runtime.sourceCode,
    info,
  });
}

/**
 * 洛雪协议没有搜索，这里保留只是为了实现 IMusicProvider 接口。
 * 真正使用时搜索走内置平台，播放由 resolveViaLxPlayback 接管。
 */
export async function lxSearch(
  _runtime: LxRuntime,
  _query: string,
  _page: number,
  _count: number
): Promise<SearchPageResult<MusicTrack>> {
  return { items: [], hasMore: false };
}

/** 质量档位映射到洛雪协议值 */
function toLxQuality(br: number): string {
  if (br >= 999) return "flac24bit";
  if (br >= 900) return "flac";
  if (br >= 300) return "320k";
  return "128k";
}

/**
 * 官方只用脚本 inited 里声明的 qualitys 去请求（info.type）。
 * 声明里没有的档位会被脚本拒绝或查到空，所以这里夹到最接近的可用档：
 * 先往低档退，再往高档找。
 */
export function pickLxQuality(
  declared: string[] | undefined,
  br: number
): string {
  const wanted = toLxQuality(br);
  if (!declared || declared.length === 0) return wanted;
  if (declared.includes(wanted)) return wanted;

  const start = LX_QUALITY_ORDER.indexOf(
    wanted as (typeof LX_QUALITY_ORDER)[number]
  );
  if (start === -1) return declared[0];
  for (let i = start + 1; i < LX_QUALITY_ORDER.length; i += 1) {
    if (declared.includes(LX_QUALITY_ORDER[i])) return LX_QUALITY_ORDER[i];
  }
  for (let i = start - 1; i >= 0; i -= 1) {
    if (declared.includes(LX_QUALITY_ORDER[i])) return LX_QUALITY_ORDER[i];
  }
  return declared[0];
}

export async function lxGetUrl(
  runtime: LxRuntime,
  track: MusicTrack,
  br: number,
  platform?: string
): Promise<string | null> {
  try {
    const platformCode = platform || runtime.sourceCode;
    // QQ 的媒体 id 与 songmid 不同，部分脚本要 strMediaMid/media_mid
    const extra = track as MusicTrack & {
      strMediaMid?: string;
      media_mid?: string;
      copyrightId?: string;
    };
    const musicInfo = {
      id: track.url_id,
      songmid: track.url_id,
      songId: track.url_id,
      hash: track.url_id,
      strMediaMid: extra.strMediaMid || extra.media_mid || track.url_id,
      media_mid: extra.media_mid || extra.strMediaMid || track.url_id,
      copyrightId: extra.copyrightId || track.url_id,
      name: track.name,
      singer: track.artist.join("/"),
      albumName: track.album,
    };
    const res = await call(
      runtime,
      "musicUrl",
      {
        type: pickLxQuality(
          runtime.inited?.sources?.[platformCode]?.qualitys,
          br
        ),
        musicInfo,
      },
      platform
    );
    const url =
      (res as { url?: string })?.url ?? (typeof res === "string" ? res : null);
    return url || null;
  } catch {
    return null;
  }
}

export async function lxGetLyric(
  runtime: LxRuntime,
  track: MusicTrack
): Promise<SongLyric | null> {
  try {
    const res = await call(runtime, "lyric", {
      musicInfo: {
        id: track.lyric_id,
        songmid: track.lyric_id,
        hash: track.lyric_id,
        name: track.name,
        singer: track.artist.join("/"),
      },
    });
    const obj = res as { lyric?: string; tlyric?: string };
    return obj?.lyric !== undefined
      ? { lyric: obj.lyric, tlyric: obj.tlyric }
      : null;
  } catch {
    return null;
  }
}

export async function lxGetPic(
  runtime: LxRuntime,
  track: MusicTrack
): Promise<string | null> {
  return track.pic_id?.startsWith("http") ? track.pic_id : null;
}
