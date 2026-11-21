import type { IMusicProvider } from "@/lib/music-provider/interface";
import type { MusicTrack, SearchPageResult, SongLyric } from "@/types/music";
import { normalizeTrack } from "@/lib/music-provider/utils";
import type { RawApiTrack } from "@/lib/music-provider/types";
import { fetchWithTimeout, getProxyUrl, IS_NATIVE } from "@/lib/api/config";
import type { ImportedSource } from "./types";
import {
  getLxRuntime,
  lxSearch,
  lxGetUrl,
  lxGetLyric,
  lxGetPic,
} from "./lx-sandbox";

/** GD Studio 兼容协议的用户导入音源 */
export class ImportedGdProvider implements IMusicProvider {
  source: string;

  constructor(private config: ImportedSource) {
    this.source = config.id;
  }

  private async api<T>(params: Record<string, string | number>): Promise<T> {
    const u = new URL(this.config.url);
    Object.entries(params).forEach(([k, v]) =>
      u.searchParams.set(k, String(v))
    );
    const target =
      !IS_NATIVE && import.meta.env.PROD
        ? getProxyUrl(u.toString())
        : u.toString();
    const res = await fetchWithTimeout(target, {}, 15000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async search(
    query: string,
    page: number,
    count: number
  ): Promise<SearchPageResult<MusicTrack>> {
    try {
      const data = await this.api<RawApiTrack[]>({
        types: "search",
        name: query,
        count,
        pages: page,
      });
      const items = data.map((t) =>
        normalizeTrack(t, this.source as MusicTrack["source"])
      );
      return { items, hasMore: items.length === count };
    } catch {
      return { items: [], hasMore: false };
    }
  }

  async getUrl(track: MusicTrack, br = 192): Promise<string | null> {
    try {
      const res = await this.api<{ url?: string }>({
        types: "url",
        id: track.url_id,
        br,
      });
      return res.url || null;
    } catch {
      return null;
    }
  }

  async getPic(track: MusicTrack, size = 800): Promise<string | null> {
    try {
      const res = await this.api<{ url?: string }>({
        types: "pic",
        id: track.pic_id,
        size,
      });
      return res.url || null;
    } catch {
      return null;
    }
  }

  async getLyric(track: MusicTrack): Promise<SongLyric | null> {
    try {
      const res = await this.api<{ lyric?: string; tlyric?: string }>({
        types: "lyric",
        id: track.lyric_id,
      });
      return { lyric: res.lyric ?? "", tlyric: res.tlyric ?? "" };
    } catch {
      return null;
    }
  }
}

/** 洛雪 JS 脚本的用户导入音源 */
export class ImportedLxProvider implements IMusicProvider {
  source: string;
  private runtime;

  constructor(private config: ImportedSource) {
    this.source = config.id;
    this.runtime = getLxRuntime(
      config.id,
      config.script || "",
      config.sourceCode || "tx"
    );
  }

  search(
    query: string,
    page: number,
    count: number
  ): Promise<SearchPageResult<MusicTrack>> {
    return lxSearch(this.runtime, query, page, count);
  }

  getUrl(track: MusicTrack, br = 192): Promise<string | null> {
    return lxGetUrl(this.runtime, track, br);
  }

  getPic(track: MusicTrack): Promise<string | null> {
    return lxGetPic(this.runtime, track);
  }

  getLyric(track: MusicTrack): Promise<SongLyric | null> {
    return lxGetLyric(this.runtime, track);
  }

  searchArtist(query: string, page: number, count: number) {
    return this.search(query, page, count);
  }
  searchAlbum(query: string, page: number, count: number) {
    return this.search(query, page, count);
  }
}

export function createImportedProvider(config: ImportedSource): IMusicProvider {
  return config.kind === "gd"
    ? new ImportedGdProvider(config)
    : new ImportedLxProvider(config);
}
