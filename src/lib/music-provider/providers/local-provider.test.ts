import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalMusicPlugin } from "@/plugins/local-music";
import { useLocalMusicStore } from "@/store/local-music-store";
import type { MusicTrack } from "@/types/music";
import { LocalProvider } from "./local-provider";

const neteaseSearch = vi.fn();
const neteaseGetSongDetail = vi.fn();
const neteaseGetLyric = vi.fn();
const searchQqMusic = vi.fn();
const getQqMusicLyric = vi.fn();
const kuwoSearch = vi.fn();
const kuwoGetLyric = vi.fn();
const higequSearch = vi.fn();
const higequGetLyric = vi.fn();
const higequGetDetail = vi.fn();

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

vi.mock("@/lib/qqmusic/qqmusic-api", () => ({
  searchQqMusic: (...args: unknown[]) => searchQqMusic(...args),
  getQqMusicLyric: (...args: unknown[]) => getQqMusicLyric(...args),
}));

vi.mock("./kuwo-search-provider", () => ({
  KuwoSearchProvider: class {
    search = (...args: unknown[]) => kuwoSearch(...args);
    getLyric = (...args: unknown[]) => kuwoGetLyric(...args);
  },
}));

vi.mock("./higequ-provider", () => ({
  HigequProvider: class {
    search = (...args: unknown[]) => higequSearch(...args);
    getLyric = (...args: unknown[]) => higequGetLyric(...args);
  },
}));

vi.mock("@/lib/higequ/higequ-api", () => ({
  getHigequSongDetail: (...args: unknown[]) => higequGetDetail(...args),
  parseHigequRid: (value: string) =>
    String(value || "").replace(/^higequ_/, ""),
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
    useLocalMusicStore.setState({
      files: [
        {
          id: "1",
          name: "Song",
          artist: "Artist",
          album: "Album",
          duration: 200,
          localPath: localTrack.pic_id,
          fileSize: 1024,
        },
      ],
    });
    neteaseSearch.mockResolvedValue({
      data: {
        code: 200,
        result: {
          songs: [{ id: 12345, name: "Song", ar: [{ name: "Artist" }] }],
        },
      },
    });
    searchQqMusic.mockResolvedValue({ items: [], hasMore: false });
    getQqMusicLyric.mockResolvedValue(null);
    kuwoSearch.mockResolvedValue({ items: [], hasMore: false });
    kuwoGetLyric.mockResolvedValue(null);
    higequSearch.mockResolvedValue({ items: [], hasMore: false });
    higequGetLyric.mockResolvedValue(null);
    higequGetDetail.mockResolvedValue(null);
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

  it("writes online-matched cover and lyric back to local music store", async () => {
    vi.mocked(LocalMusicPlugin.getEmbeddedCover).mockResolvedValue({
      success: false,
    });
    vi.mocked(LocalMusicPlugin.getEmbeddedLyrics).mockResolvedValue({
      success: false,
    });
    neteaseGetSongDetail.mockResolvedValue({
      al: { picUrl: "https://img.example.com/cover.jpg" },
    });
    neteaseGetLyric.mockResolvedValue({
      data: { lrc: { lyric: "[00:00.00]词" }, tlyric: { lyric: "译" } },
    });

    const provider = new LocalProvider();
    await provider.getPic(localTrack, 400);
    await provider.getLyric(localTrack);

    const saved = useLocalMusicStore
      .getState()
      .files.find((f) => f.localPath === localTrack.pic_id);
    expect(saved?.matchedCoverUrl).toBe(
      "https://img.example.com/cover.jpg?param=400y400"
    );
    expect(saved?.matchedLyric).toBe("[00:00.00]词");
    expect(saved?.matchedTlyric).toBe("译");
  });

  it("reuses store-matched meta without going online again", async () => {
    useLocalMusicStore.setState((s) => ({
      files: s.files.map((f) => ({
        ...f,
        matchedCoverUrl: "https://img.example.com/saved.jpg",
        matchedLyric: "[00:00.00]已存",
      })),
    }));
    vi.mocked(LocalMusicPlugin.getEmbeddedCover).mockResolvedValue({
      success: false,
    });
    vi.mocked(LocalMusicPlugin.getEmbeddedLyrics).mockResolvedValue({
      success: false,
    });

    const provider = new LocalProvider();
    await expect(provider.getPic(localTrack)).resolves.toBe(
      "https://img.example.com/saved.jpg"
    );
    await expect(provider.getLyric(localTrack)).resolves.toEqual({
      lyric: "[00:00.00]已存",
      tlyric: "",
    });
    expect(neteaseSearch).not.toHaveBeenCalled();
    expect(neteaseGetLyric).not.toHaveBeenCalled();
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

  it("matches variant traditional characters like 妳 against 简体 你", async () => {
    vi.mocked(LocalMusicPlugin.getEmbeddedCover).mockResolvedValue({
      success: false,
      error: "empty",
    });
    neteaseSearch.mockResolvedValue({
      data: {
        code: 200,
        result: {
          songs: [{ id: 888, name: "你听得到", ar: [{ name: "周杰伦" }] }],
        },
      },
    });
    neteaseGetSongDetail.mockResolvedValue({
      al: { picUrl: "https://x/ni.jpg" },
    });

    await expect(
      new LocalProvider().getPic({
        ...localTrack,
        name: "妳听得到",
        artist: ["周杰伦"],
      })
    ).resolves.toBe("https://x/ni.jpg?param=800y800");
  });

  it("falls back to QQ cover and lyric when NetEase is rate limited", async () => {
    vi.mocked(LocalMusicPlugin.getEmbeddedCover).mockResolvedValue({
      success: false,
    });
    vi.mocked(LocalMusicPlugin.getEmbeddedLyrics).mockResolvedValue({
      success: false,
    });
    neteaseSearch.mockResolvedValue({
      data: { code: 405, msg: "操作频繁，请稍候再试" },
    });
    searchQqMusic.mockResolvedValue({
      items: [
        {
          id: "qq_1",
          name: "Song",
          artist: ["Artist"],
          album: "",
          pic_id: "https://y.qq.com/cover.jpg",
          url_id: "qqmid1",
          lyric_id: "qqmid1",
          source: "qq",
        },
      ],
      hasMore: false,
    });
    getQqMusicLyric.mockResolvedValue({
      lyric: "[00:00.00]QQ 歌词",
      tlyric: "",
    });

    const provider = new LocalProvider();
    await expect(provider.getPic(localTrack, 400)).resolves.toBe(
      "https://y.qq.com/cover.jpg"
    );
    await expect(provider.getLyric(localTrack)).resolves.toEqual({
      lyric: "[00:00.00]QQ 歌词",
      tlyric: "",
    });
    expect(getQqMusicLyric).toHaveBeenCalledWith("qqmid1");

    const saved = useLocalMusicStore
      .getState()
      .files.find((f) => f.localPath === localTrack.pic_id);
    expect(saved?.matchedCoverUrl).toBe("https://y.qq.com/cover.jpg");
    expect(saved?.matchedLyric).toBe("[00:00.00]QQ 歌词");
  });

  it("falls back to Kuwo when QQ has no match", async () => {
    vi.mocked(LocalMusicPlugin.getEmbeddedCover).mockResolvedValue({
      success: false,
    });
    vi.mocked(LocalMusicPlugin.getEmbeddedLyrics).mockResolvedValue({
      success: false,
    });
    neteaseSearch.mockResolvedValue({ data: { code: 405, msg: "操作频繁" } });
    kuwoSearch.mockResolvedValue({
      items: [
        {
          id: "kw_550531871",
          name: "Song",
          artist: ["Artist"],
          album: "",
          pic_id: "https://img1.kuwo.cn/cover.jpg",
          url_id: "550531871",
          lyric_id: "550531871",
          source: "kuwo",
        },
      ],
      hasMore: false,
    });
    kuwoGetLyric.mockResolvedValue({
      lyric: "[00:00.00]酷我歌词",
      tlyric: "",
    });

    const provider = new LocalProvider();
    await expect(provider.getPic(localTrack, 400)).resolves.toBe(
      "https://img1.kuwo.cn/cover.jpg"
    );
    await expect(provider.getLyric(localTrack)).resolves.toEqual({
      lyric: "[00:00.00]酷我歌词",
      tlyric: "",
    });
    expect(kuwoGetLyric).toHaveBeenCalledWith(
      expect.objectContaining({ lyric_id: "550531871" })
    );
  });

  it("falls back to Higequ when QQ and Kuwo have no match", async () => {
    vi.mocked(LocalMusicPlugin.getEmbeddedCover).mockResolvedValue({
      success: false,
    });
    vi.mocked(LocalMusicPlugin.getEmbeddedLyrics).mockResolvedValue({
      success: false,
    });
    neteaseSearch.mockResolvedValue({ data: { code: 405, msg: "操作频繁" } });
    higequSearch.mockResolvedValue({
      items: [
        {
          id: "higequ_42",
          name: "Song",
          artist: ["Artist"],
          album: "",
          pic_id: "higequ_42",
          url_id: "42",
          lyric_id: "higequ_42",
          source: "higequ",
        },
      ],
      hasMore: false,
    });
    higequGetDetail.mockResolvedValue({
      coverUrl: "https://higequ.example/cover.jpg",
    });
    higequGetLyric.mockResolvedValue({
      lyric: "[00:00.00]嗨歌曲歌词",
      tlyric: "",
    });

    const provider = new LocalProvider();
    await expect(provider.getPic(localTrack, 400)).resolves.toBe(
      "https://higequ.example/cover.jpg"
    );
    await expect(provider.getLyric(localTrack)).resolves.toEqual({
      lyric: "[00:00.00]嗨歌曲歌词",
      tlyric: "",
    });
    expect(higequGetDetail).toHaveBeenCalledWith("42");
  });

  // 放最后：限流会触发模块级 60 秒退避，影响后续用例
  it("does not treat NetEase rate limiting as a missing match", async () => {
    vi.mocked(LocalMusicPlugin.getEmbeddedCover).mockResolvedValue({
      success: false,
    });
    vi.mocked(LocalMusicPlugin.getEmbeddedLyrics).mockResolvedValue({
      success: false,
    });
    neteaseSearch.mockResolvedValue({
      data: { code: 405, msg: "操作频繁，请稍候再试" },
    });

    const provider = new LocalProvider();
    await expect(provider.getPic(localTrack)).resolves.toBeNull();
    await expect(provider.getLyric(localTrack)).resolves.toBeNull();

    const saved = useLocalMusicStore
      .getState()
      .files.find((f) => f.localPath === localTrack.pic_id);
    expect(saved?.matchedCoverUrl).toBeUndefined();
    expect(saved?.matchedLyric).toBeUndefined();
  });
});
