import { fetchWithTimeout, IS_NATIVE } from "@/lib/api/config";

export type MediaProbeResult = "ok" | "fail" | "unknown";

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
      if (res.status === 200 || res.status === 206) {
        return res.data ? "ok" : "fail";
      }
      return "fail";
    }
    const res = await fetchWithTimeout(url, { headers }, timeoutMs);
    return res.status === 200 || res.status === 206 ? "ok" : "fail";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 域名解析不了说明音源后端已下线，这是确定失效，不是网络抖动
    if (/resolve host|ENOTFOUND|Name or service not known/i.test(message)) {
      return "fail";
    }
    return "unknown";
  }
}
