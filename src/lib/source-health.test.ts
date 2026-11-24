import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  search,
  getImportedSource,
  getLxRuntime,
  resolveViaSpecificLxSource,
  fetchWithTimeout,
} = vi.hoisted(() => ({
  search: vi.fn(),
  getImportedSource: vi.fn(),
  getLxRuntime: vi.fn(),
  resolveViaSpecificLxSource: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

vi.mock("@/lib/api/config", () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
  IS_NATIVE: false,
}));

vi.mock("@/lib/music-api", () => ({
  musicApi: { search: (...args: unknown[]) => search(...args) },
}));

vi.mock("@/lib/imported-sources/store", () => ({
  getImportedSource: (...args: unknown[]) => getImportedSource(...args),
}));

vi.mock("@/lib/imported-sources/lx-sandbox", () => ({
  getLxRuntime: (...args: unknown[]) => getLxRuntime(...args),
}));

vi.mock("@/lib/imported-sources/lx-playback", () => ({
  resolveViaSpecificLxSource: (...args: unknown[]) =>
    resolveViaSpecificLxSource(...args),
}));

import { checkSourceHealth } from "./source-health";

/** 构造一个「像官方那样初始化成功」的运行时 */
function lxRuntime(over: Record<string, unknown> = {}) {
  return {
    handler: () => undefined,
    sourceCode: "tx",
    idPrefix: "imp_lx",
    inited: {
      sources: {
        tx: {
          name: "QQ音乐",
          type: "music",
          actions: ["musicUrl"],
          qualitys: ["320k"],
        },
      },
    },
    waitInited: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

const LX_SOURCE = {
  id: "imp_lx",
  kind: "lx",
  script: "x",
  enabled: true,
  sourceCode: "tx",
};

const TRACK_RESULT = {
  items: [{ id: "qq_1", source: "qq", url_id: "0039MnYb0qxYhV" }],
};

describe("checkSourceHealth", () => {
  beforeEach(() => {
    search.mockReset();
    getImportedSource.mockReset();
    getLxRuntime.mockReset();
    resolveViaSpecificLxSource.mockReset();
    getImportedSource.mockReturnValue(undefined);
    fetchWithTimeout.mockReset();
    fetchWithTimeout.mockResolvedValue({ status: 206 });
  });

  it("第一个关键词就有结果时直接判可用", async () => {
    search.mockResolvedValueOnce({ items: [{ id: "1" }] });

    const result = await checkSourceHealth("qq" as never);
    expect(result.source).toBe("qq");
    expect(result.status).toBe("ok");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("中文关键词为空时用第二个关键词重试", async () => {
    search
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ id: "1" }] });

    const result = await checkSourceHealth("jamendo" as never);

    expect(result.status).toBe("ok");
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("两个关键词都没有结果时判为不可用", async () => {
    search.mockResolvedValue({ items: [] });

    const result = await checkSourceHealth("imp_demo" as never);

    expect(result.status).toBe("fail");
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("请求抛错时判为不可用", async () => {
    search.mockRejectedValue(new Error("HTTP 400"));

    const result = await checkSourceHealth("kuwo" as never);

    expect(result.status).toBe("fail");
  });

  it("单个音源超过总时限就返回未判定，不再无限等待", async () => {
    vi.useFakeTimers();
    try {
      // 探测请求永不返回；内部每一步的超时加起来会远超总时限
      search.mockImplementation(() => new Promise(() => {}));
      const pending = checkSourceHealth("slow" as never, 25);
      await vi.advanceTimersByTimeAsync(30);
      const result = await pending;

      expect(result.status).toBe("unknown");
      expect(result.reason).toBe("检测超时");
      expect(result.latencyMs).toBeLessThan(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it("洛雪源用换播放链接判定，不靠搜索", async () => {
    getImportedSource.mockReturnValue(LX_SOURCE);
    getLxRuntime.mockReturnValue(lxRuntime());
    search.mockResolvedValue(TRACK_RESULT);
    resolveViaSpecificLxSource.mockResolvedValue("https://cdn/x.mp3");

    const result = await checkSourceHealth("imp_lx" as never);

    expect(result.status).toBe("ok");
    // 只用搜索拿探测曲目，不用搜索结果本身判断可用性
    expect(search).toHaveBeenCalledTimes(1);
    expect(resolveViaSpecificLxSource).toHaveBeenCalledTimes(1);
    // 还要真拉一小段，确认不是死链
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it("脚本初始化抛错时直接判为不可用，不再联网探测", async () => {
    getImportedSource.mockReturnValue(LX_SOURCE);
    getLxRuntime.mockReturnValue(
      lxRuntime({
        inited: null,
        initError: "Cannot read properties of undefined (reading 'vkey')",
        waitInited: vi.fn().mockResolvedValue(false),
      })
    );

    const result = await checkSourceHealth("imp_lx" as never);

    expect(result.status).toBe("fail");
    expect(result.reason).toContain("初始化失败");
    expect(search).not.toHaveBeenCalled();
    expect(resolveViaSpecificLxSource).not.toHaveBeenCalled();
  });

  it("脚本跑完却没发 inited 时判为不可用", async () => {
    getImportedSource.mockReturnValue(LX_SOURCE);
    getLxRuntime.mockReturnValue(
      lxRuntime({
        inited: null,
        waitInited: vi.fn().mockResolvedValue(false),
      })
    );

    const result = await checkSourceHealth("imp_lx" as never);

    expect(result.status).toBe("fail");
    expect(result.reason).toContain("初始化事件");
    expect(resolveViaSpecificLxSource).not.toHaveBeenCalled();
  });

  it("脚本没注册请求处理器时判为不可用", async () => {
    getImportedSource.mockReturnValue(LX_SOURCE);
    getLxRuntime.mockReturnValue(lxRuntime({ handler: null }));

    const result = await checkSourceHealth("imp_lx" as never);

    expect(result.status).toBe("fail");
    expect(result.reason).toContain("请求处理器");
    expect(resolveViaSpecificLxSource).not.toHaveBeenCalled();
  });

  it("脚本只声明了歌词能力（没有 musicUrl）时判为不可用", async () => {
    getImportedSource.mockReturnValue(LX_SOURCE);
    getLxRuntime.mockReturnValue(
      lxRuntime({
        inited: {
          sources: {
            tx: { name: "QQ音乐", type: "music", actions: ["lyric"] },
          },
        },
      })
    );

    const result = await checkSourceHealth("imp_lx" as never);

    expect(result.status).toBe("fail");
    expect(result.reason).toContain("播放链接");
    expect(resolveViaSpecificLxSource).not.toHaveBeenCalled();
  });

  it("脚本声明了多个平台时，任一平台能播即判可用", async () => {
    getImportedSource.mockReturnValue(LX_SOURCE);
    getLxRuntime.mockReturnValue(
      lxRuntime({
        inited: {
          sources: {
            wy: {
              name: "网易云",
              type: "music",
              actions: ["musicUrl"],
              qualitys: ["128k"],
            },
            tx: {
              name: "QQ音乐",
              type: "music",
              actions: ["musicUrl"],
              qualitys: ["320k"],
            },
          },
        },
      })
    );
    search.mockResolvedValue(TRACK_RESULT);
    resolveViaSpecificLxSource
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("https://cdn/x.mp3");

    const result = await checkSourceHealth("imp_lx" as never);

    expect(result.status).toBe("ok");
    expect(resolveViaSpecificLxSource).toHaveBeenCalledTimes(2);
  });

  it("脚本给的链接已失效时判为未知，不自动停用", async () => {
    getImportedSource.mockReturnValue(LX_SOURCE);
    getLxRuntime.mockReturnValue(lxRuntime());
    search.mockResolvedValue(TRACK_RESULT);
    resolveViaSpecificLxSource.mockResolvedValue("https://dead/x.mp3");
    fetchWithTimeout.mockRejectedValue(
      new Error('Unable to resolve host "music-dl.sayqz.com"')
    );

    const result = await checkSourceHealth("imp_lx" as never);

    // 上游 CDN 域名下线是上游的问题，不是脚本失效；判 unknown 保留源，
    // 换链阶段会按平台挑下一个脚本继续试
    expect(result.status).toBe("unknown");
  });

  it("链接请求超时时判为未知，不武断停用", async () => {
    getImportedSource.mockReturnValue(LX_SOURCE);
    getLxRuntime.mockReturnValue(lxRuntime());
    search.mockResolvedValue(TRACK_RESULT);
    resolveViaSpecificLxSource.mockResolvedValue("https://slow/x.mp3");
    fetchWithTimeout.mockRejectedValue(new Error("timeout"));

    const result = await checkSourceHealth("imp_lx" as never);

    expect(result.status).toBe("unknown");
  });

  it("洛雪源本轮换不到链接时判为未知，不自动停用", async () => {
    getImportedSource.mockReturnValue(LX_SOURCE);
    getLxRuntime.mockReturnValue(lxRuntime());
    search.mockResolvedValue(TRACK_RESULT);
    resolveViaSpecificLxSource.mockResolvedValue(null);

    const result = await checkSourceHealth("imp_lx" as never);

    // 探测曲目搜不到 / 上游限流都会让这一轮换链落空，不等于脚本坏了。
    // 判 unknown 才不会被一键检测停用，否则几轮后洛雪源只剩一两个
    expect(result.status).toBe("unknown");
  });

  it("洛雪源没有可验证平台时判为未知，不武断停用", async () => {
    getImportedSource.mockReturnValue(LX_SOURCE);
    getLxRuntime.mockReturnValue(
      lxRuntime({
        inited: {
          sources: {
            qs: {
              name: "汽水",
              type: "music",
              actions: ["musicUrl"],
              qualitys: ["320k"],
            },
          },
        },
      })
    );

    const result = await checkSourceHealth("imp_lx" as never);

    expect(result.status).toBe("unknown");
  });
});
