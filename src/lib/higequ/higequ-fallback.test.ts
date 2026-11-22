import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicTrack } from "@/types/music";

const { search, getUrl, probeMediaReachable, warn } = vi.hoisted(() => ({
  search: vi.fn(),
  getUrl: vi.fn(),
  probeMediaReachable: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/music-api", () => ({
  musicApi: {
    search: (...args: unknown[]) => search(...args),
    getUrl: (...args: unknown[]) => getUrl(...args),
  },
}));

vi.mock("@/lib/utils/media-probe", () => ({
  probeMediaReachable: (...args: unknown[]) => probeMediaReachable(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: (...args: unknown[]) => warn(...args) },
}));

import { resolveViaHigequFallback } from "./higequ-fallback";

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

const matched: MusicTrack = {
  ...original,
  id: "higequ_228908",
  url_id: "228908",
  source: "higequ",
};

describe("resolveViaHigequFallback", () => {
  beforeEach(() => {
    search.mockReset();
    getUrl.mockReset();
    probeMediaReachable.mockReset();
    warn.mockReset();
    search.mockResolvedValue({ items: [matched] });
    getUrl.mockResolvedValue("https://cdn/x.mp3");
    probeMediaReachable.mockResolvedValue("ok");
  });

  it("按歌名+歌手搜同名曲，取链探活后返回直链", async () => {
    const result = await resolveViaHigequFallback(original, 4000);

    expect(result).toEqual({ url: "https://cdn/x.mp3", trackId: matched.id });
    expect(search).toHaveBeenCalledWith("晴天 周杰伦", "higequ", 1, 5);
    expect(getUrl).toHaveBeenCalledWith("228908", "higequ", 320);
    expect(probeMediaReachable).toHaveBeenCalledWith("https://cdn/x.mp3", 4000);
  });

  it("搜不到同名同歌手时不取链", async () => {
    search.mockResolvedValue({
      items: [{ ...matched, name: "晴天（翻唱）", artist: ["别人"] }],
    });

    const result = await resolveViaHigequFallback(original, 4000);

    expect(result).toBeNull();
    expect(getUrl).not.toHaveBeenCalled();
  });

  it("链接明确不可播时返回 null", async () => {
    probeMediaReachable.mockResolvedValue("fail");

    const result = await resolveViaHigequFallback(original, 4000);

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("探活不确定时仍放行，交给播放器实播判断", async () => {
    probeMediaReachable.mockResolvedValue("unknown");

    const result = await resolveViaHigequFallback(original, 4000);

    expect(result).toEqual({ url: "https://cdn/x.mp3", trackId: matched.id });
  });

  it("搜索抛错时返回 null 不向外抛", async () => {
    search.mockRejectedValue(new Error("network"));

    await expect(resolveViaHigequFallback(original, 4000)).resolves.toBeNull();
  });
});
