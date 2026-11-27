import { describe, expect, it } from "vitest";
import type { LocalMusicFile } from "@/plugins/local-music";
import {
  DEFAULT_SCAN_FILTER,
  filterScannedFiles,
  getAudioExtension,
  type AudioExtension,
} from "./local-audio-filter";

const makeFile = (overrides: Partial<LocalMusicFile>): LocalMusicFile => ({
  id: "1",
  name: "歌",
  artist: null,
  album: null,
  duration: 200,
  localPath: "/sdcard/Music/歌.mp3",
  fileSize: 5 * 1024 * 1024,
  ...overrides,
});

const set = (...xs: AudioExtension[]) => new Set<AudioExtension>(xs);

describe("getAudioExtension", () => {
  it("prefers fileName and lowercases", () => {
    expect(
      getAudioExtension(
        makeFile({ fileName: "Song.FLAC", localPath: "/sdcard/a.mp3" })
      )
    ).toBe("flac");
  });

  it("falls back to localPath and strips query", () => {
    expect(
      getAudioExtension(makeFile({ localPath: "/sdcard/a.m4a?x=1" }))
    ).toBe("m4a");
  });

  it("returns empty string when no extension", () => {
    expect(getAudioExtension(makeFile({ localPath: "/sdcard/noext" }))).toBe(
      ""
    );
  });
});

describe("filterScannedFiles", () => {
  const files = [
    makeFile({ id: "mp3", localPath: "/sdcard/Music/歌.mp3" }),
    makeFile({
      id: "flac",
      fileName: "歌.flac",
      localPath: "/sdcard/Music/歌.flac",
    }),
    makeFile({ id: "wav", localPath: "/sdcard/录音.wav", fileSize: 40 * 1024 }),
    makeFile({ id: "m4a", localPath: "/sdcard/Music/歌.m4a" }),
  ];

  it("defaults to mp3 + flac", () => {
    expect(DEFAULT_SCAN_FILTER.extensions.has("mp3")).toBe(true);
    expect(DEFAULT_SCAN_FILTER.extensions.has("flac")).toBe(true);
    expect(
      filterScannedFiles(files, DEFAULT_SCAN_FILTER).map((f) => f.id)
    ).toEqual(["mp3", "flac"]);
  });

  it("empty extension set means no restriction", () => {
    expect(
      filterScannedFiles(files, { extensions: set(), minSize: 0 })
    ).toHaveLength(4);
  });

  it("filters by arbitrary extension", () => {
    expect(
      filterScannedFiles(files, { extensions: set("wav"), minSize: 0 }).map(
        (f) => f.id
      )
    ).toEqual(["wav"]);
  });

  it("combines extension and min size", () => {
    expect(
      filterScannedFiles(files, {
        extensions: set("mp3", "flac", "wav"),
        minSize: 1024 * 1024,
      }).map((f) => f.id)
    ).toEqual(["mp3", "flac"]);
  });
});
