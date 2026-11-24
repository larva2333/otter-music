import { CapacitorHttp } from "@capacitor/core";
import { getProxyUrl, IS_NATIVE, fetchWithTimeout } from "@/lib/api/config";

/**
 * 评论接口用的跨平台 HTTP 请求。
 * - 原生端：CapacitorHttp 直连（不受 WebView 跨域限制）
 * - Web 生产：走自家 /proxy（后端代理）
 * - Web 开发：直接 fetch
 */
export async function commentRequest(
  url: string,
  options: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    /** POST 表单（application/x-www-form-urlencoded） */
    form?: Record<string, string | number>;
    /** POST JSON */
    body?: Record<string, unknown>;
    timeout?: number;
  } = {}
): Promise<unknown> {
  const method = options.method || "GET";
  const headers = { ...(options.headers || {}) };
  let payload: string | undefined;

  if (options.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(
      Object.entries(options.form).map(([k, v]) => [k, String(v)])
    ).toString();
  } else if (options.body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(options.body);
  }

  if (IS_NATIVE) {
    const res = await CapacitorHttp.request({
      url,
      method,
      headers,
      data: payload,
      connectTimeout: options.timeout ?? 12000,
      readTimeout: options.timeout ?? 12000,
      responseType: "text",
    });
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    const raw = res.data;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }

  const target = import.meta.env.PROD ? getProxyUrl(url) : url;
  // 后端 /proxy 只支持 GET，POST 场景在生产环境无法走代理，直接抛出
  if (import.meta.env.PROD && method === "POST") {
    throw new Error("生产环境不支持代理 POST 请求");
  }
  const res = await fetchWithTimeout(
    target,
    {
      method,
      headers,
      body: payload,
    },
    options.timeout ?? 12000
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
