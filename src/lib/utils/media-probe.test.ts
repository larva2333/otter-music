import { describe, expect, it, vi } from "vitest";

// 记录传给 fetchWithTimeout 的 Range 头，模拟不同响应
const fetchMock = vi.fn();
vi.mock("@/lib/api/config", () => ({
  IS_NATIVE: false,
  fetchWithTimeout: (...args: unknown[]) => fetchMock(...args),
  getProxyUrl: (u: string) => u,
}));

import { probeMediaDetail } from "./media-probe";

function resp(status: number, headers: Record<string, string>) {
  return {
    status,
    statusText: status === 206 ? "Partial Content" : "OK",
    headers: new Headers(headers),
  };
}

describe("probeMediaDetail", () => {
  it("试听片段（960KB）读出总字节数，供竞速排除", async () => {
    fetchMock.mockResolvedValueOnce(
      resp(206, {
        "content-range": "bytes 0-4095/960887",
        "content-length": "4096",
      })
    );
    const r = await probeMediaDetail("https://cdn/x.mp3", 1000);
    expect(r.reachable).toBe("ok");
    expect(r.totalBytes).toBe(960887);
    expect(r.totalBytes!).toBeLessThan(1_000_000);
  });

  it("完整音轨（3MB）总字节数正确", async () => {
    fetchMock.mockResolvedValueOnce(
      resp(206, {
        "content-range": "bytes 0-4095/3145728",
        "content-length": "4096",
      })
    );
    const r = await probeMediaDetail("https://cdn/x.mp3", 1000);
    expect(r.reachable).toBe("ok");
    expect(r.totalBytes).toBe(3145728);
    expect(r.totalBytes!).toBeGreaterThan(1_000_000);
  });

  it("404 判为不可播，竞速会排除", async () => {
    fetchMock.mockResolvedValueOnce(resp(404, {}));
    const r = await probeMediaDetail("https://cdn/missing.mp3", 1000);
    expect(r.reachable).toBe("fail");
  });

  it("200 响应用 Content-Length 当总长（不能被误判成试听）", async () => {
    fetchMock.mockResolvedValueOnce(resp(200, { "content-length": "5242880" }));
    const r = await probeMediaDetail("https://cdn/x.mp3", 1000);
    expect(r.reachable).toBe("ok");
    expect(r.totalBytes).toBe(5242880);
  });
});
