import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/netease/netease-api", () => ({
  getArtistAlbums: vi.fn(),
  searchWeb: vi.fn(),
  searchSuggest: vi.fn(),
}));

import {
  getArtistAlbums,
  searchSuggest,
  searchWeb,
} from "@/lib/netease/netease-api";
import {
  fetchSearchCategories,
  fetchSearchCategoryPage,
} from "./search-categories";

describe("fetchSearchCategories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchWeb).mockImplementation(async (_keyword, type) => {
      if (type === 100) return { artists: [{ id: 1, name: "周杰伦" }] };
      if (type === 10) {
        return {
          albums: [{ id: 2, name: "叶惠美", artist: { name: "周杰伦" } }],
        };
      }
      return { playlists: [{ id: 3, name: "周杰伦热门" } as never] };
    });
    vi.mocked(getArtistAlbums).mockResolvedValue({
      hotAlbums: [],
      more: false,
    });
    vi.mocked(searchSuggest).mockResolvedValue({});
  });

  it("按歌手、专辑、歌单分别走 weapi 搜索", async () => {
    const result = await fetchSearchCategories("周杰伦");

    expect(searchWeb).toHaveBeenCalledWith("周杰伦", 100, 20, 0);
    expect(searchWeb).toHaveBeenCalledWith("周杰伦", 10, 20, 0);
    expect(searchWeb).toHaveBeenCalledWith("周杰伦", 1000, 20, 0);
    expect(searchSuggest).not.toHaveBeenCalled();
    expect(result).toEqual({
      artists: [{ id: "1", name: "周杰伦" }],
      albums: [{ id: "2", name: "叶惠美", artistName: "周杰伦" }],
      playlists: [{ id: "3", name: "周杰伦热门" }],
      hasMore: { artist: false, album: false, playlist: false },
    });
  });

  it("总数超过本页时标记还可以翻页，并按 offset 取下一页", async () => {
    vi.mocked(searchWeb).mockImplementation(
      async (_keyword, type, _limit, offset) => {
        if (type === 100) {
          return {
            artists: [
              {
                id: offset === 0 ? 1 : 2,
                name: offset === 0 ? "周杰伦" : "周杰伦.",
              },
            ],
            artistCount: 40,
          };
        }
        return {};
      }
    );

    const first = await fetchSearchCategoryPage("周杰伦", "artist", 0);
    const next = await fetchSearchCategoryPage("周杰伦", "artist", 20);

    expect(searchWeb).toHaveBeenCalledWith("周杰伦", 100, 20, 20);
    expect(first.hasMore).toBe(true);
    expect(next).toEqual({
      artists: [{ id: "2", name: "周杰伦." }],
      albums: [],
      playlists: [],
      hasMore: true,
    });
  });

  it("某一类失败时保留其它分类", async () => {
    vi.mocked(searchWeb).mockImplementation(async (_keyword, type) => {
      if (type === 100) throw new Error("down");
      if (type === 10) {
        return {
          albums: [{ id: 2, name: "叶惠美", artist: { name: "周杰伦" } }],
        };
      }
      return { playlists: [{ id: 3, name: "周杰伦热门" } as never] };
    });

    const result = await fetchSearchCategories("周杰伦");

    expect(result.artists).toEqual([]);
    expect(result.albums).toHaveLength(1);
    expect(result.playlists).toHaveLength(1);
  });

  it("类型搜索都为空时用搜索建议兜底", async () => {
    vi.mocked(searchWeb).mockResolvedValue({});
    vi.mocked(searchSuggest).mockResolvedValue({
      artists: [{ id: 1, name: "周杰伦", picUrl: "", alias: [] }],
      albums: [],
      playlists: [
        {
          id: 9,
          name: "周杰伦热门",
          coverImgUrl: "",
          creator: { nickname: "" },
          trackCount: 1,
          playCount: 1,
          bookCount: 0,
        },
      ],
    });

    const result = await fetchSearchCategories("周杰伦");

    expect(result.artists).toEqual([{ id: "1", name: "周杰伦" }]);
    expect(result.playlists).toEqual([{ id: "9", name: "周杰伦热门" }]);
    expect(result.hasMore).toEqual({
      artist: false,
      album: false,
      playlist: false,
    });
  });

  it("透传歌手、专辑与歌单封面字段", async () => {
    vi.mocked(searchWeb).mockImplementation(async (_keyword, type) => {
      if (type === 100) {
        return {
          artists: [
            { id: 12, name: "周杰伦", img1v1Url: "https://example.com/a2.jpg" },
          ],
        };
      }
      if (type === 10) {
        return {
          albums: [
            {
              id: 20,
              name: "范特西",
              picUrl: "https://example.com/album.jpg",
              artist: { name: "周杰伦" },
            },
          ],
        };
      }
      return {
        playlists: [
          {
            id: 30,
            name: "周杰伦精选",
            coverImgUrl: "https://example.com/pl.jpg",
          } as never,
        ],
      };
    });

    const result = await fetchSearchCategories("周杰伦");
    expect(result.artists[0].coverUrl).toBe("https://example.com/a2.jpg");
    expect(result.albums[0].coverUrl).toBe("https://example.com/album.jpg");
    expect(result.playlists[0].coverUrl).toBe("https://example.com/pl.jpg");
  });

  it("搜歌手时直接拉取该歌手的全部官方专辑且翻页沿用", async () => {
    vi.mocked(getArtistAlbums).mockResolvedValue({
      hotAlbums: [
        {
          id: 101,
          name: "范特西",
          picUrl: "https://example.com/101.jpg",
          artist: { name: "周杰伦" },
        } as never,
      ],
      more: true,
    });

    const first = await fetchSearchCategories("周杰伦");
    expect(getArtistAlbums).toHaveBeenCalledWith("1", 20, 0);
    expect(first.albums).toEqual([
      {
        id: "101",
        name: "范特西",
        artistName: "周杰伦",
        coverUrl: "https://example.com/101.jpg",
      },
    ]);
    expect(first.hasMore.album).toBe(true);

    vi.mocked(getArtistAlbums).mockResolvedValueOnce({
      hotAlbums: [
        {
          id: 102,
          name: "八度空间",
          picUrl: "https://example.com/102.jpg",
          artist: { name: "周杰伦" },
        } as never,
      ],
      more: false,
    });
    const next = await fetchSearchCategoryPage("周杰伦", "album", 20);
    expect(getArtistAlbums).toHaveBeenCalledWith("1", 20, 20);
    expect(next.albums).toEqual([
      {
        id: "102",
        name: "八度空间",
        artistName: "周杰伦",
        coverUrl: "https://example.com/102.jpg",
      },
    ]);
    expect(next.hasMore).toBe(false);
  });

  it("搜专辑名（与专辑同名）时不误判为歌手，保留专辑搜索结果", async () => {
    vi.mocked(searchWeb).mockImplementation(async (_keyword, type) => {
      if (type === 100) return { artists: [{ id: 99, name: "叶惠美粉丝" }] };
      if (type === 10) {
        return {
          albums: [{ id: 2, name: "叶惠美", artist: { name: "周杰伦" } }],
        };
      }
      return {};
    });

    const result = await fetchSearchCategories("叶惠美");
    expect(getArtistAlbums).not.toHaveBeenCalled();
    expect(result.albums).toEqual([
      { id: "2", name: "叶惠美", artistName: "周杰伦" },
    ]);
  });
});
