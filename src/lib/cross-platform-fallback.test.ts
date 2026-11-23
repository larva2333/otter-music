import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicTrack } from "@/types/music";

const {
  search,
  getUrl,
  probeMediaDetail,
  getAggregatedSourcesForMatch,
  logInfo,
  logWarn,
} = vi.hoisted(() => ({
  search: vi.fn(),
  getUrl: vi.fn(),
  probeMediaDetail: vi.fn(),
  getAggregatedSourcesForMatch: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/lib/music-api", () => ({
  musicApi: {
    search: (...args: unknown[]) => search(...args),
    getUrl: (...args: unknown[]) => getUrl(...args),
  },
}));

vi.mock("@/hooks/use-aggregated-sources", () => ({
  getAggregatedSourcesForMatch: () => getAggregatedSourcesForMatch(),
}));

vi.mock("@/lib/utils/media-probe", () => ({
  probeMediaDetail: (...args: unknown[]) => probeMediaDetail(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: (...args: unknown[]) => logInfo(...args),
    warn: (...args: unknown[]) => logWarn(...args),
  },
}));

import { isSameSong, resolveViaCrossPlatform } from "./cross-platform-fallback";

const original: MusicTrack = {
  id: "qq_1",
  name: "晴天",
  artist: ["周杰伦"],
  album: "叶惠美",
  pic_id: "p1",
  url_id: "u1",
  lyric_id: "l1",
  source: "qq",
};

function candidate(overrides: Partial<MusicTrack> = {}): MusicTrack {
  return {
    id: "wy_2",
    name: "晴天",
    artist: ["周杰伦"],
    album: "叶惠美",
    pic_id: "p2",
    url_id: "u2",
    lyric_id: "l2",
    source: "_netease",
    ...overrides,
  };
}

describe("isSameSong", () => {
  it("歌名歌手专辑一致判为同曲", () => {
    expect(isSameSong(original, candidate())).toBe(true);
  });

  it("专辑不同判为翻唱，不匹配", () => {
    expect(isSameSong(original, candidate({ album: "某翻唱专辑" }))).toBe(
      false
    );
  });

  it("歌手不同不匹配", () => {
    expect(isSameSong(original, candidate({ artist: ["张学友"] }))).toBe(false);
  });

  it("歌名不同不匹配", () => {
    expect(isSameSong(original, candidate({ name: "稻香" }))).toBe(false);
  });

  it("缺专辑时放行（老数据没专辑字段）", () => {
    expect(isSameSong(original, candidate({ album: "" }))).toBe(true);
  });

  it("简繁体歌名仍判为同曲", () => {
    expect(isSameSong(original, candidate({ name: "晴天" }))).toBe(true);
  });
});

describe("resolveViaCrossPlatform", () => {
  beforeEach(() => {
    search.mockReset();
    getUrl.mockReset();
    probeMediaDetail.mockReset();
    getAggregatedSourcesForMatch.mockReset();
    logInfo.mockReset();
    logWarn.mockReset();
    getAggregatedSourcesForMatch.mockReturnValue([
      "qq",
      "_netease",
      "kugou",
      "kuwo",
    ]);
    search.mockResolvedValue({ items: [candidate()] });
    getUrl.mockResolvedValue("https://cdn/x.mp3");
    probeMediaDetail.mockResolvedValue({
      reachable: "ok",
      totalBytes: 5_000_000,
    });
  });

  it("排除当前源后并发搜索，命中同曲取链探活后返回直链", async () => {
    const result = await resolveViaCrossPlatform(original, 320);

    expect(result).toEqual({
      url: "https://cdn/x.mp3",
      track: expect.objectContaining({ source: "_netease" }),
    });
    // 并发搜了 3 个平台（当前 qq 被排除）
    expect(search).toHaveBeenCalledTimes(3);
    expect(search).toHaveBeenCalledWith("晴天 周杰伦", "_netease", 1, 10);
    expect(getUrl).toHaveBeenCalledWith("u2", "_netease", 320);
  });

  it("严格校验失败（翻唱专辑）时返回 null，不取链", async () => {
    search.mockResolvedValue({
      items: [candidate({ album: "翻唱集" })],
    });

    const result = await resolveViaCrossPlatform(original, 320);

    expect(result).toBeNull();
    expect(getUrl).not.toHaveBeenCalled();
  });

  it("探活只给试听片段（<1MB）时不采纳", async () => {
    probeMediaDetail.mockResolvedValue({
      reachable: "ok",
      totalBytes: 960_887,
    });

    const result = await resolveViaCrossPlatform(original, 320);

    expect(result).toBeNull();
  });

  it("死链（reachable=fail）不采纳", async () => {
    probeMediaDetail.mockResolvedValue({
      reachable: "fail",
      totalBytes: null,
    });

    const result = await resolveViaCrossPlatform(original, 320);

    expect(result).toBeNull();
  });

  it("多平台并发取链，快的完整链胜出", async () => {
    const slow = candidate({ id: "kg_3", url_id: "u3", source: "kugou" });
    const fast = candidate({
      id: "kw_4",
      url_id: "u4",
      source: "kuwo",
    });
    search.mockImplementation(async (_q, source) => ({
      items: source === "kuwo" ? [fast] : source === "kugou" ? [slow] : [],
    }));
    getUrl.mockImplementation(async (id: string) => {
      // 酷我慢，酷狗快；但酷狗的是试听片段，应被排除，最终酷我胜出
      if (id === "u3") {
        await new Promise((r) => setTimeout(r, 20));
        return "https://cdn/full.mp3";
      }
      if (id === "u4") return "https://cdn/sample.mp3";
      return null;
    });
    probeMediaDetail.mockImplementation(async (url: string) => ({
      reachable: "ok",
      totalBytes: url.includes("sample") ? 960_887 : 5_000_000,
    }));

    const result = await resolveViaCrossPlatform(original, 320);

    expect(result?.url).toBe("https://cdn/full.mp3");
    expect(result?.track.source).toBe("kugou");
  });

  it("所有平台都取不到链时返回 null", async () => {
    getUrl.mockResolvedValue(null);

    const result = await resolveViaCrossPlatform(original, 320);

    expect(result).toBeNull();
  });

  it("没有可用搜索源时直接返回 null", async () => {
    getAggregatedSourcesForMatch.mockReturnValue(["qq"]);

    const result = await resolveViaCrossPlatform(original, 320);

    expect(result).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });
});
