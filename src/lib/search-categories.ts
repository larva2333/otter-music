import { searchSuggest, searchWeb } from "@/lib/netease/netease-api";
import { logger } from "@/lib/logger";

export type SearchResultTab = "artist" | "song" | "album" | "playlist";

export const SEARCH_RESULT_TABS: { id: SearchResultTab; label: string }[] = [
  { id: "artist", label: "歌手" },
  { id: "song", label: "歌曲" },
  { id: "album", label: "专辑" },
  { id: "playlist", label: "歌单" },
];

export interface SearchCategoryGroups {
  artists: { id: string; name: string }[];
  albums: { id: string; name: string; artistName: string }[];
  playlists: { id: string; name: string }[];
}

export const EMPTY_SEARCH_CATEGORIES: SearchCategoryGroups = {
  artists: [],
  albums: [],
  playlists: [],
};

export const SEARCH_CATEGORY_PAGE_SIZE = 20;

export type SearchCategoryKind = Exclude<SearchResultTab, "song">;

export interface SearchCategoryPagingState {
  offset: number;
  hasMore: boolean;
}

export type SearchCategoryPaging = Record<
  SearchCategoryKind,
  SearchCategoryPagingState
>;

export const EMPTY_SEARCH_CATEGORY_PAGING: SearchCategoryPaging = {
  artist: { offset: 0, hasMore: false },
  album: { offset: 0, hasMore: false },
  playlist: { offset: 0, hasMore: false },
};

const CATEGORY_TYPE: Record<SearchCategoryKind, number> = {
  artist: 100,
  album: 10,
  playlist: 1000,
};

export interface SearchCategoryPage extends SearchCategoryGroups {
  hasMore: boolean;
}

export interface SearchCategoryFirstPage extends SearchCategoryGroups {
  hasMore: Record<SearchCategoryKind, boolean>;
}

export function hasSearchCategoryHits(
  categories: SearchCategoryGroups | null
): categories is SearchCategoryGroups {
  return (
    !!categories &&
    (categories.artists.length > 0 ||
      categories.albums.length > 0 ||
      categories.playlists.length > 0)
  );
}

function pageHasMore(received: number, offset: number, total?: number) {
  if (typeof total === "number" && total >= 0) return offset + received < total;
  return received >= SEARCH_CATEGORY_PAGE_SIZE;
}

function mapArtists(items: { id?: string | number; name?: string }[] = []) {
  return items
    .filter((item) => item?.id && item.name)
    .map((item) => ({ id: String(item.id), name: item.name ?? "" }));
}

function mapAlbums(
  items: {
    id?: string | number;
    name?: string;
    artist?: { name?: string };
  }[] = []
) {
  return items
    .filter((item) => item?.id && item.name)
    .map((item) => ({
      id: String(item.id),
      name: item.name ?? "",
      artistName: item.artist?.name ?? "",
    }));
}

function mapPlaylists(items: { id?: string | number; name?: string }[] = []) {
  return items
    .filter((item) => item?.id && item.name)
    .map((item) => ({ id: String(item.id), name: item.name ?? "" }));
}

const EMPTY_PAGE: SearchCategoryPage = {
  ...EMPTY_SEARCH_CATEGORIES,
  hasMore: false,
};

const EMPTY_FIRST_PAGE: SearchCategoryFirstPage = {
  ...EMPTY_SEARCH_CATEGORIES,
  hasMore: { artist: false, album: false, playlist: false },
};

/** 某一类的一页。offset 从 0 起，每页 SEARCH_CATEGORY_PAGE_SIZE 条。 */
export async function fetchSearchCategoryPage(
  query: string,
  kind: SearchCategoryKind,
  offset = 0
): Promise<SearchCategoryPage> {
  const keyword = query.trim();
  if (!keyword) return EMPTY_PAGE;

  const result = await searchWeb(
    keyword,
    CATEGORY_TYPE[kind],
    SEARCH_CATEGORY_PAGE_SIZE,
    offset
  );
  const artists = kind === "artist" ? mapArtists(result.artists) : [];
  const albums = kind === "album" ? mapAlbums(result.albums) : [];
  const playlists = kind === "playlist" ? mapPlaylists(result.playlists) : [];
  const received =
    kind === "artist"
      ? artists.length
      : kind === "album"
        ? albums.length
        : playlists.length;
  const total =
    kind === "artist"
      ? result.artistCount
      : kind === "album"
        ? result.albumCount
        : result.playlistCount;

  return {
    artists,
    albums,
    playlists,
    hasMore: pageHasMore(received, offset, total),
  };
}

/** 网易云按类型各搜第一页：歌手 type=100、专辑 type=10、歌单 type=1000。歌曲仍走原搜索。 */
export async function fetchSearchCategories(
  query: string
): Promise<SearchCategoryFirstPage> {
  const keyword = query.trim();
  if (!keyword) return EMPTY_FIRST_PAGE;

  const [artistPage, albumPage, playlistPage] = await Promise.all([
    fetchSearchCategoryPage(keyword, "artist", 0).catch((e) => {
      logger.warn("search-categories", "歌手搜索失败", e);
      return EMPTY_PAGE;
    }),
    fetchSearchCategoryPage(keyword, "album", 0).catch((e) => {
      logger.warn("search-categories", "专辑搜索失败", e);
      return EMPTY_PAGE;
    }),
    fetchSearchCategoryPage(keyword, "playlist", 0).catch((e) => {
      logger.warn("search-categories", "歌单搜索失败", e);
      return EMPTY_PAGE;
    }),
  ]);

  const grouped: SearchCategoryFirstPage = {
    artists: artistPage.artists,
    albums: albumPage.albums,
    playlists: playlistPage.playlists,
    hasMore: {
      artist: artistPage.hasMore,
      album: albumPage.hasMore,
      playlist: playlistPage.hasMore,
    },
  };

  if (
    grouped.artists.length > 0 ||
    grouped.albums.length > 0 ||
    grouped.playlists.length > 0
  ) {
    return grouped;
  }

  // 类型搜索失败时，用搜索建议里的歌手/专辑/歌单兜底，避免结果页只剩歌曲。
  try {
    const suggest = await searchSuggest(keyword);
    if (!suggest) return EMPTY_FIRST_PAGE;
    return {
      artists: (suggest.artists ?? []).map((item) => ({
        id: String(item.id),
        name: item.name,
      })),
      albums: (suggest.albums ?? []).map((item) => ({
        id: String(item.id),
        name: item.name,
        artistName: item.artist?.name ?? "",
      })),
      playlists: (suggest.playlists ?? []).map((item) => ({
        id: String(item.id),
        name: item.name,
      })),
      hasMore: { artist: false, album: false, playlist: false },
    };
  } catch (e) {
    logger.warn("search-categories", "搜索建议兜底失败", e);
    return EMPTY_FIRST_PAGE;
  }
}
