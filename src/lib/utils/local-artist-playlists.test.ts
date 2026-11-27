import { describe, it, expect } from "vitest";
import type { MusicTrack, Playlist } from "@/types/music";
import {
  buildLocalAndDownloadedTracks,
  groupTracksByArtist,
  mergeArtistPlaylists,
  resolvePrimaryArtistName,
} from "./local-artist-playlists";

function makeTrack(overrides: Partial<MusicTrack> = {}): MusicTrack {
  return {
    id: overrides.id ?? "1",
    name: overrides.name ?? "Song",
    artist: overrides.artist ?? ["周杰伦"],
    album: overrides.album ?? "Album",
    pic_id: overrides.pic_id ?? "",
    url_id: overrides.url_id ?? overrides.id ?? "1",
    lyric_id: overrides.lyric_id ?? "",
    source: overrides.source ?? "local",
    ...overrides,
  };
}

describe("local-artist-playlists", () => {
  it("extracts primary artist name with simplified Chinese normalization and fallback", () => {
    expect(resolvePrimaryArtistName(makeTrack({ artist: [" 周杰倫 "] }))).toBe(
      "周杰伦"
    );
    expect(resolvePrimaryArtistName(makeTrack({ artist: [] }))).toBe(
      "未知艺术家"
    );
    expect(resolvePrimaryArtistName(makeTrack({ artist: ["   "] }))).toBe(
      "未知艺术家"
    );
  });

  it("groups tracks by artist, deduplicates by identity, and sorts by track count desc", () => {
    const tracks = [
      makeTrack({ id: "l1", url_id: "/a.mp3", artist: ["陈奕迅"] }),
      makeTrack({ id: "l2", url_id: "/b.mp3", artist: ["周杰伦"] }),
      makeTrack({ id: "l3", url_id: "/c.mp3", artist: ["周杰倫"] }),
      // 同一首重复歌曲应去重
      makeTrack({ id: "l2-dup", url_id: "/b.mp3", artist: ["周杰伦"] }),
      // 已软删除曲目应跳过
      makeTrack({
        id: "l4",
        url_id: "/d.mp3",
        artist: ["林俊杰"],
        is_deleted: true,
      }),
    ];

    const groups = groupTracksByArtist(tracks);
    expect(groups.map((g) => [g.artistName, g.tracks.length])).toEqual([
      ["周杰伦", 2],
      ["陈奕迅", 1],
    ]);
  });

  it("creates new playlists for new artists and merges missing tracks into existing active playlists", () => {
    const existing: Playlist[] = [
      {
        id: "p-jay",
        name: "周杰伦",
        tracks: [makeTrack({ id: "l2", url_id: "/b.mp3", artist: ["周杰伦"] })],
        createdAt: 100,
        update_time: 100,
        is_deleted: false,
      },
      // 已删除的同名歌单不应拦截重建
      {
        id: "p-eason-deleted",
        name: "陈奕迅",
        tracks: [],
        createdAt: 90,
        update_time: 90,
        is_deleted: true,
      },
    ];

    const localTracks = [
      makeTrack({ id: "l2", url_id: "/b.mp3", artist: ["周杰伦"] }),
      makeTrack({ id: "l3", url_id: "/c.mp3", artist: ["周杰伦"] }),
      makeTrack({ id: "l1", url_id: "/a.mp3", artist: ["陈奕迅"] }),
    ];

    let counter = 0;
    const result = mergeArtistPlaylists(
      existing,
      localTracks,
      5000,
      () => `gen-${++counter}`
    );

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.playlists.map((p) => p.name)).toEqual([
      "陈奕迅",
      "周杰伦",
      "陈奕迅",
    ]);
    expect(result.playlists[0]).toMatchObject({
      id: "gen-1",
      name: "陈奕迅",
      is_deleted: false,
    });
    expect(result.playlists[0].tracks).toHaveLength(1);
    expect(result.playlists[1].tracks.map((t) => t.id)).toEqual(["l2", "l3"]);
    expect(result.playlists[1].update_time).toBe(5000);
  });

  it("returns original array reference when all artist playlists are already up to date", () => {
    const existing: Playlist[] = [
      {
        id: "p1",
        name: "周杰伦",
        tracks: [makeTrack({ id: "l2", url_id: "/b.mp3", artist: ["周杰伦"] })],
        createdAt: 100,
        update_time: 100,
        is_deleted: false,
      },
    ];
    const result = mergeArtistPlaylists(existing, [
      makeTrack({ id: "l2", url_id: "/b.mp3", artist: ["周杰伦"] }),
    ]);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.playlists).toBe(existing);
  });

  it("combines scanned local files and download records", () => {
    const tracks = buildLocalAndDownloadedTracks(
      [
        {
          id: "file-1",
          name: "晴天",
          artist: "周杰伦",
          album: "叶惠美",
          localPath: "/music/qt.mp3",
          duration: 269,
          fileSize: 1000,
          modifiedTime: 200,
        },
      ],
      {
        "netease:123": {
          uri: "file:///dl/123.mp3",
          cachedAt: 100,
          name: "十年",
          artist: ["陈奕迅"],
          album: "黑白灰",
          trackSource: "netease",
          url_id: "123",
          pic_id: "123",
          lyric_id: "123",
        },
      }
    );

    expect(tracks).toHaveLength(2);
    expect(tracks[0].name).toBe("十年");
    expect(tracks[1].name).toBe("晴天");
  });
});
