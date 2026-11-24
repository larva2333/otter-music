import { describe, expect, it, vi } from "vitest";
import { isNeteaseTrack } from "./comment-source";
import type { MusicTrack } from "@/types/music";

vi.mock("./netease-api", () => ({
  search: vi.fn(async () => ({ data: { result: { songs: [] } } })),
}));

const track = (source: string): MusicTrack => ({
  id: "123",
  name: "test",
  artist: ["test"],
  album: "",
  pic_id: "",
  url_id: "",
  lyric_id: "",
  source: source as MusicTrack["source"],
});

describe("评论曲目来源判定", () => {
  it("网易云系音源直接作为评论源", () => {
    expect(isNeteaseTrack(track("netease"))).toBe(true);
    expect(isNeteaseTrack(track("_netease"))).toBe(true);
    expect(isNeteaseTrack(track("wy"))).toBe(true);
  });

  it("其它音源需要反查网易云 id", () => {
    expect(isNeteaseTrack(track("kuwo"))).toBe(false);
    expect(isNeteaseTrack(track("qq"))).toBe(false);
    expect(isNeteaseTrack(track("kugou"))).toBe(false);
    expect(isNeteaseTrack(track("bilibili"))).toBe(false);
  });
});
