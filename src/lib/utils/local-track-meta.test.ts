import {
  parseNameFromPath,
  resolveLocalTrackMeta,
  normalizeLocalMusicFiles,
} from "./local-track-meta";
import type { LocalMusicFile } from "@/plugins/local-music";

const NETEASE_DIR = "/storage/emulated/0/Download/netease/cloudmusic/Music";
const OTTER_DIR = "/storage/emulated/0/Download/OtterMusic";

function fileOf(overrides: Partial<LocalMusicFile>): LocalMusicFile {
  return {
    id: "1",
    name: "Song",
    artist: "Artist",
    album: "Album",
    duration: 180000,
    localPath: `${NETEASE_DIR}/Song.mp3`,
    fileSize: 1024,
    ...overrides,
  };
}

describe("parseNameFromPath", () => {
  it("第三方下载器按「歌手 - 歌名」解析", () => {
    expect(
      parseNameFromPath(`${NETEASE_DIR}/陈奕迅 - 我们.FLAC`, false)
    ).toEqual({ name: "我们", artist: "陈奕迅" });
  });

  it("otter 自己的下载按「歌名 - 歌手」解析", () => {
    expect(parseNameFromPath(`${OTTER_DIR}/我们 - 陈奕迅.flac`, true)).toEqual({
      name: "我们",
      artist: "陈奕迅",
    });
  });

  it("没有分隔符时整段作为歌名", () => {
    expect(parseNameFromPath(`${NETEASE_DIR}/我们.flac`, false)).toEqual({
      name: "我们",
      artist: "",
    });
  });
});

describe("resolveLocalTrackMeta", () => {
  it("酷我写入的 kuwo 占位标签用文件名替换", () => {
    const meta = resolveLocalTrackMeta({
      name: "kuwo",
      artist: "kuwo",
      album: "kuwo",
      localPath: `${NETEASE_DIR}/陈奕迅 - 我们.FLAC`,
    });

    expect(meta).toEqual({ name: "我们", artist: "陈奕迅", album: "" });
  });

  it("MediaStore 的 <unknown> 与完整文件名标题会拆成歌手和歌名", () => {
    const meta = resolveLocalTrackMeta({
      name: "陈奕迅 - 让我留在你身边",
      artist: "<unknown>",
      album: "Music",
      localPath: `${NETEASE_DIR}/陈奕迅 - 让我留在你身边.FLAC`,
    });

    expect(meta).toEqual({
      name: "让我留在你身边",
      artist: "陈奕迅",
      album: "",
    });
  });

  it("artist 正常但 title 仍是完整文件名时只拆歌名", () => {
    const meta = resolveLocalTrackMeta({
      name: "陈奕迅 张敬轩 - 追 (Live)",
      artist: "陈奕迅/张敬轩",
      album: "热门华语237",
      localPath: `${NETEASE_DIR}/陈奕迅 张敬轩 - 追 (Live).mp3`,
    });

    expect(meta.name).toBe("追 (Live)");
    expect(meta.artist).toBe("陈奕迅/张敬轩");
    expect(meta.album).toBe("热门华语237");
  });

  it("正常标签原样保留", () => {
    const meta = resolveLocalTrackMeta({
      name: "关键词",
      artist: "林俊杰",
      album: "和自己对话 From M.E. To Myself",
      localPath: `${NETEASE_DIR}/林俊杰 - 关键词.FLAC`,
    });

    expect(meta).toEqual({
      name: "关键词",
      artist: "林俊杰",
      album: "和自己对话 From M.E. To Myself",
    });
  });

  it("标签正常时不会误清 album=Music", () => {
    const meta = resolveLocalTrackMeta({
      name: "关键词",
      artist: "林俊杰",
      album: "Music",
      localPath: `${NETEASE_DIR}/林俊杰 - 关键词.FLAC`,
    });

    expect(meta.album).toBe("Music");
  });

  it("localPath 是 content:// 时用 fileName 解析", () => {
    const meta = resolveLocalTrackMeta({
      name: "陈奕迅 - Life Goes On",
      artist: "<unknown>",
      album: "Music",
      fileName: "陈奕迅 - Life Goes On.FLAC",
      localPath: "content://media/external/audio/media/1000011626",
    });

    expect(meta).toEqual({
      name: "Life Goes On",
      artist: "陈奕迅",
      album: "",
    });
  });

  it("多次调用结果稳定", () => {
    const once = resolveLocalTrackMeta({
      name: "kuwo",
      artist: "kuwo",
      album: "kuwo",
      localPath: `${NETEASE_DIR}/陈奕迅 - 我们.FLAC`,
    });
    const twice = resolveLocalTrackMeta({ ...once, artist: once.artist });

    expect(twice).toEqual(once);
  });
});

describe("normalizeLocalMusicFiles", () => {
  it("没有需要修复的条目时返回原数组", () => {
    const files = [
      fileOf({ name: "关键词", artist: "林俊杰", album: "和自己对话" }),
    ];
    expect(normalizeLocalMusicFiles(files)).toBe(files);
  });

  it("修复脏标签并保留其余字段", () => {
    const files = [
      fileOf({
        id: "9",
        name: "kuwo",
        artist: "kuwo",
        album: "kuwo",
        localPath: `${NETEASE_DIR}/陈奕迅 - 我们.FLAC`,
        fileSize: 12345,
      }),
    ];

    const [fixed] = normalizeLocalMusicFiles(files);
    expect(fixed.name).toBe("我们");
    expect(fixed.artist).toBe("陈奕迅");
    expect(fixed.album).toBeNull();
    expect(fixed.id).toBe("9");
    expect(fixed.fileSize).toBe(12345);
  });
});
