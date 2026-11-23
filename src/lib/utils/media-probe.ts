import { fetchWithTimeout, IS_NATIVE } from "@/lib/api/config";

export type MediaProbeResult = "ok" | "fail" | "unknown";

export interface MediaProbeDetail {
  reachable: MediaProbeResult;
  /** Content-Range 里的文件总字节数；拿不到时为 null */
  totalBytes: number | null;
}

function pickHeader(
  headers: Record<string, unknown>,
  name: string
): string | null {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  if (!key) return null;
  const value = headers[key];
  return value == null ? null : String(value);
}

function readTotalBytes(
  headers: Record<string, unknown>,
  status: number
): number | null {
  // 206 响应里 Content-Length 只是本次请求的片段长度（4096），
  // 总长在 Content-Range 的分母里。200 响应则 Content-Length 就是总长。
  if (status === 206) {
    const range = pickHeader(headers, "content-range");
    const match = range?.match(/\/(\d+)\s*$/);
    if (match) return Number(match[1]);
    return null;
  }
  const length = pickHeader(headers, "content-length");
  if (length && /^\d+$/.test(length)) return Number(length);
  return null;
}

/**
 * 探测 URL 是否可播，并顺带读出音轨总字节数。
 *
 * 竞速取链时必须区分「完整音轨」和「试听片段」：不少源对付费曲会返回
 * 960KB 左右的试听链，探测也是 206，采纳后用户听半分钟就断。
 */
export async function probeMediaDetail(
  url: string,
  timeoutMs = 8000
): Promise<MediaProbeDetail> {
  const headers = { Range: "bytes=0-4095" };
  try {
    if (IS_NATIVE) {
      const { CapacitorHttp } = await import("@capacitor/core");
      const res = await CapacitorHttp.request({
        url,
        method: "GET",
        headers,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
        responseType: "arraybuffer",
      });
      const reachable: MediaProbeResult =
        res.status === 200 || res.status === 206
          ? res.data
            ? "ok"
            : "fail"
          : "fail";
      return {
        reachable,
        totalBytes: readTotalBytes(
          res.headers as Record<string, unknown>,
          res.status
        ),
      };
    }
    const res = await fetchWithTimeout(url, { headers }, timeoutMs);
    const reachable: MediaProbeResult =
      res.status === 200 || res.status === 206 ? "ok" : "fail";
    return {
      reachable,
      totalBytes: readTotalBytes(
        Object.fromEntries(res.headers ?? []),
        res.status
      ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 域名解析不了说明音源后端已下线，这是确定失效，不是网络抖动
    if (/resolve host|ENOTFOUND|Name or service not known/i.test(message)) {
      return { reachable: "fail", totalBytes: null };
    }
    return { reachable: "unknown", totalBytes: null };
  }
}

/**
 * 用 Range 请求真拉一小段，确认 URL 是能播的音频而不是死链/接口地址。
 *
 * 很多第三方音源会返回「中转接口 URL」或已经下线的代理地址，
 * 字符串非空但喂给播放器只会静默失败。检测和播放接管都用这个判断。
 */
export async function probeMediaReachable(
  url: string,
  timeoutMs = 8000
): Promise<MediaProbeResult> {
  return (await probeMediaDetail(url, timeoutMs)).reachable;
}
