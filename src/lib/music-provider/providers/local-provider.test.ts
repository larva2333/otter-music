import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalMusicPlugin } from "@/plugins/local-music";
import type { MusicTrack } from "@/types/music";
import { LocalProvider } from "./local-provider";

const neteaseSearch = vi.fn();
const neteaseGetSongDetail = vi.fn();
const neteaseGetLyric = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    convertFileSrc: (value: string) => `converted:${value}`,
  },
  registerPlugin: () => ({
    getLocalFileUrl: vi.fn(),
    getEmbeddedCover: vi.fn(),
    getEmbeddedLyrics: vi.fn(),
    readSidecarLyric: vi.fn(),
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// 测试环境没有 CacheStorage，缓存层直接透传 fetcher
vi.mock("@/lib/utils/cache", () => ({
  cachedFetch: async (
    _key: string,
    fetcher: () => Promise<unknown>
  ): Promise<unknown> => fetcher(),
}));

vi.mock("@/lib/netease/netease-api", () => ({
  search: (...args: unknown[]) => neteaseSearch(...args),
  getSongDetail: (...args: unknown[]) => neteaseGetSongDetail(...args),
  getLyric: (...args: unknown[]) => neteaseGetLyric(...args),
}));

const localTrack: MusicTrack = {
  id: "local-1",
  name: "Song",
  artist: ["Artist"],
  album: "Album",
  pic_id: "/storage/emulated/0/Music/song.mp3",
  url_id: "/storage/emulated/0/Music/song.mp3",
  lyric_id: "/storage/emulated/0/Music/song.mp3",
  source: "local",
};

describe("LocalProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    neteaseSearch.mockResolvedValue({
      data: {
        result: {
          songs: [{ id: 12345, name: "Song", ar: [{ name: "Artist" }] }],
        },
      },
    });
  });

  it("loads embedded cover from the native local music plugin", async () => {
    vi.mocked(LocalMusicPlugin.getEmbeddedCover).mockResolvedValue({
      success: true,
      dataUrl: "data:image/jpeg;base64,abc",
    });

    await expect(new LocalProvider().getPic(localTrack)).resolves.toBe(
      "data:image/jpeg;base64,abc"
    );
    expect(LocalMusicPlugin.getEmbeddedCover).toHaveBeenCalledWith({
      localPath: localTrack.pic_id,
    });
    // 有内嵌封面时不应触发在线匹配
    expect(neteaseSearch).not.toHaveBeenCalled();
  });

  it("falls back to online cover when the file has none", async () => {
    vi.mocked(LocalMusicPlugin.getEmbeddedCover).mockResolvedValue({
      success: false,
      error: "empty",
    });
    neteaseGetSongDetail.mockResolvedValue({
      al: { picUrl: "https://img.example.com/cover.jpg" },
    });

    await expect(new LocalProvider().getPic(localTrack, 400)).resolves.toBe(
      "https://img.example.com/cover.jpg?param=400y400"
    );
    expect(neteaseGetSongDetail).toHaveBeenCalledWith("12345");
  });

  it("loads embedded lyrics from the native local music plugin", async () => {
    vi.mocked(LocalMusicPlugin.getEmbeddedLyrics).mockResolvedValue({
      success: true,
      lyric: "[00:00.00]歌词",
    });

    await expect(new LocalProvider().getLyric(localTrack)).resolves.toEqual({
      lyric: "[00:00.00]歌词",
      tlyric: "",
    });
    expect(LocalMusicPlugin.getEmbeddedLyrics).toHaveBeenCalledWith({
      localPath: localTrack.lyric_id,
    });
    // 内嵌歌词优先，不应读同名 lrc
    expect(LocalMusicPlugin.readSidecarLyric).not.toHaveBeenCalled();
  });

  it("goes online directly instead of reading a sidecar .lrc", async () => {
    vi.mocked(LocalMusicPlugin.getEmbeddedLyrics).mockResolvedValue({
      success: false,
      error: "none",
    });
    neteaseGetLyric.mockResolvedValue({
      data: {
        lrc: { lyric: "[00:00.00]online" },
        tlyric: { lyric: "" },
      },
    });

    await expect(new LocalProvider().getLyric(localTrack)).resolves.toEqual({
      lyric: "[00:00.00]online",
      tlyric: "",
    });
    expect(LocalMusicPlugin.readSidecarLyric).not.toHaveBeenCalled();
  });

  it("falls back to online lyrics when nothing is embedded", async () => {
    vi.mocked(LocalMusicPlugin.getEmbeddedLyrics).mockResolvedValue({
      success: false,
      error: "none",
    });
    neteaseGetLyric.mockResolvedValue({
      data: {
        lrc: { lyric: "[00:00.00]online" },
        tlyric: { lyric: "" },
      },
    });

    await expect(new LocalProvider().getLyric(localTrack)).resolves.toEqual({
      lyric: "[00:00.00]online",
      tlyric: "",
    });
    expect(neteaseGetLyric).toHaveBeenCalledWith("12345");
  });

  it("returns null when nothing local or online is available", async () => {
    vi.mocked(LocalMusicPlugin.getEmbeddedCover).mockResolvedValue({
      success: false,
      error: "empty",
    });
    vi.mocked(LocalMusicPlugin.getEmbeddedLyrics).mockResolvedValue({
      success: true,
      lyric: "",
    });
    // 在线搜不到同名歌曲
    neteaseSearch.mockResolvedValue({
      data: { result: { songs: [{ id: 1, name: "别的歌", ar: [] }] } },
    });

    const provider = new LocalProvider();

    await expect(provider.getPic(localTrack)).resolves.toBeNull();
    await expect(provider.getLyric(localTrack)).resolves.toBeNull();
  });

  it("ignores placeholder artists when matching online", async () => {
    vi.mocked(LocalMusicPlugin.getEmbeddedCover).mockResolvedValue({
      success: false,
      error: "empty",
    });
    neteaseGetSongDetail.mockResolvedValue({
      al: { picUrl: "https://x/cover.jpg" },
    });

    // 扫描出的标签是「未知艺术家」时，不能当成真实歌手去比对，否则结果全被筛掉
    await expect(
      new LocalProvider().getPic({
        ...localTrack,
        artist: ["未知艺术家"],
      })
    ).resolves.toBe("https://x/cover.jpg?param=800y800");
  });

  it("treats bracketed suffixes as the same song", async () => {
    vi.mocked(LocalMusicPlugin.getEmbeddedCover).mockResolvedValue({
      success: false,
      error: "empty",
    });
    neteaseSearch.mockResolvedValue({
      data: {
        result: {
          songs: [{ id: 999, name: "Song (Live)", ar: [{ name: "Artist" }] }],
        },
      },
    });
    neteaseGetSongDetail.mockResolvedValue({
      al: { picUrl: "https://x/y.jpg" },
    });

    await expect(new LocalProvider().getPic(localTrack)).resolves.toBe(
      "https://x/y.jpg?param=800y800"
    );
  });
});
