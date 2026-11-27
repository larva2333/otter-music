import { v4 as uuidv4 } from "uuid";
import type { LocalMusicFile } from "@/plugins/local-music";
import type { MusicTrack, Playlist } from "@/types/music";
import { convertToMusicTrack } from "@/lib/utils/download";
import { cleanTrack } from "@/lib/utils/music";
import { t2s } from "@/lib/utils/t2s";
import { logger } from "@/lib/logger";
import { useMusicStore } from "@/store/music-store";
import {
  useLocalMusicStore,
  whenLocalMusicHydrated,
} from "@/store/local-music-store";
import { useDownloadStore, type DownloadRecord } from "@/store/download-store";

export const LOCAL_ARTIST_PLAYLISTS_SEEDED_KEY =
  "otter-local-artist-playlists-seeded-v1";

function getTrackIdentityKey(track: MusicTrack): string {
  return `${track.source}:${track.url_id || track.id}`;
}

/** 提取主歌手名称（统一繁转简，空值归为「未知艺术家」） */
export function resolvePrimaryArtistName(track: MusicTrack): string {
  const firstArtist = track.artist?.[0];
  const normalized = firstArtist ? t2s(firstArtist).trim() : "";
  return normalized || "未知艺术家";
}

/**
 * 合并本地扫描文件与已下载记录，得到完整的「本地音乐」曲目列表
 */
export function buildLocalAndDownloadedTracks(
  files: LocalMusicFile[],
  downloadRecords: Record<string, DownloadRecord | string>
): MusicTrack[] {
  const localTracks = files
    .map((file, index) => ({ file, index }))
    .sort(
      (a, b) =>
        (b.file.modifiedTime ?? -Infinity) -
          (a.file.modifiedTime ?? -Infinity) || a.index - b.index
    )
    .map(({ file }) => convertToMusicTrack(file));

  const downloadedTracks: MusicTrack[] = [];
  for (const [key, raw] of Object.entries(downloadRecords)) {
    const sep = key.indexOf(":");
    if (sep === -1) continue;
    const source = key.slice(0, sep);
    const id = key.slice(sep + 1);
    const rec = typeof raw === "string" ? null : raw;
    downloadedTracks.push({
      id,
      source: (rec?.trackSource ?? source) as MusicTrack["source"],
      name: rec?.name || `${source}:${id}`,
      artist: rec?.artist?.length ? rec.artist : ["未知艺术家"],
      album: rec?.album ?? "",
      url_id: rec?.url_id || id,
      pic_id: rec?.pic_id || "",
      lyric_id: rec?.lyric_id || "",
    });
  }

  return [...downloadedTracks, ...localTracks];
}

export interface ArtistTrackGroup {
  artistName: string;
  tracks: MusicTrack[];
}

/**
 * 按主歌手分组并组内去重，按曲数从多到少排序
 */
export function groupTracksByArtist(tracks: MusicTrack[]): ArtistTrackGroup[] {
  const groups = new Map<
    string,
    { artistName: string; tracks: MusicTrack[]; seen: Set<string> }
  >();

  for (const track of tracks) {
    if (track.is_deleted) continue;
    const artistName = resolvePrimaryArtistName(track);
    const normalizedKey = artistName.toLowerCase();
    let group = groups.get(normalizedKey);
    if (!group) {
      group = { artistName, tracks: [], seen: new Set() };
      groups.set(normalizedKey, group);
    }
    const trackKey = getTrackIdentityKey(track);
    if (group.seen.has(trackKey)) continue;
    group.seen.add(trackKey);
    group.tracks.push(cleanTrack(track));
  }

  return Array.from(groups.values())
    .map(({ artistName, tracks: groupTracks }) => ({
      artistName,
      tracks: groupTracks,
    }))
    .sort((a, b) => b.tracks.length - a.tracks.length);
}

export interface MergeArtistPlaylistsResult {
  playlists: Playlist[];
  created: number;
  updated: number;
  artistCount: number;
  totalTracks: number;
}

/**
 * 将本地音乐按歌手合并进现有歌单列表（纯函数）
 * - 已有未软删除同名歌单时，仅追加缺失曲目（不重复建单）
 * - 新建歌单按歌曲数从多到少前置到歌单列表头部
 */
export function mergeArtistPlaylists(
  existingPlaylists: Playlist[],
  localTracks: MusicTrack[],
  now = Date.now(),
  generateId: () => string = uuidv4
): MergeArtistPlaylistsResult {
  const groups = groupTracksByArtist(localTracks);
  if (groups.length === 0) {
    return {
      playlists: existingPlaylists,
      created: 0,
      updated: 0,
      artistCount: 0,
      totalTracks: 0,
    };
  }

  const nextPlaylists = existingPlaylists.map((playlist) => ({ ...playlist }));
  const activeByName = new Map<string, number>();
  nextPlaylists.forEach((playlist, index) => {
    if (playlist.is_deleted) return;
    const key = t2s(playlist.name).trim().toLowerCase();
    if (!activeByName.has(key)) {
      activeByName.set(key, index);
    }
  });

  const newlyCreated: Playlist[] = [];
  let updated = 0;

  for (const group of groups) {
    const nameKey = group.artistName.trim().toLowerCase();
    const existingIndex = activeByName.get(nameKey);

    if (existingIndex !== undefined) {
      const target = nextPlaylists[existingIndex];
      const existingKeys = new Set(
        target.tracks
          .filter((track) => track.is_deleted !== true)
          .map(getTrackIdentityKey)
      );
      const missingTracks = group.tracks.filter(
        (track) => !existingKeys.has(getTrackIdentityKey(track))
      );
      if (missingTracks.length > 0) {
        nextPlaylists[existingIndex] = {
          ...target,
          tracks: [...target.tracks, ...missingTracks],
          update_time: now,
        };
        updated++;
      }
      continue;
    }

    newlyCreated.push({
      id: generateId(),
      name: group.artistName,
      tracks: group.tracks,
      createdAt: now,
      update_time: now,
      is_deleted: false,
    });
  }

  const created = newlyCreated.length;
  const totalTracks = groups.reduce((sum, g) => sum + g.tracks.length, 0);

  if (created === 0 && updated === 0) {
    return {
      playlists: existingPlaylists,
      created: 0,
      updated: 0,
      artistCount: groups.length,
      totalTracks,
    };
  }

  return {
    playlists: [...newlyCreated, ...nextPlaylists],
    created,
    updated,
    artistCount: groups.length,
    totalTracks,
  };
}

function whenMusicStoreHydrated(timeoutMs = 1500): Promise<void> {
  if (useMusicStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    // eslint-disable-next-line prefer-const
    let unsub: (() => void) | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub?.();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    unsub = useMusicStore.persist.onFinishHydration(finish);
  });
}

/**
 * 读取当前本地音乐与已下载记录，按歌手创建或增量更新歌单
 */
export function syncLocalArtistPlaylists(): MergeArtistPlaylistsResult {
  const files = useLocalMusicStore.getState().files;
  const records = useDownloadStore.getState().records;
  const localTracks = buildLocalAndDownloadedTracks(files, records);
  const currentPlaylists = useMusicStore.getState().playlists;
  const result = mergeArtistPlaylists(currentPlaylists, localTracks);

  if (result.created > 0 || result.updated > 0) {
    useMusicStore.setState({ playlists: result.playlists });
    logger.info("local-artist-playlists", "已按歌手同步本地歌单", {
      created: result.created,
      updated: result.updated,
      artistCount: result.artistCount,
      totalTracks: result.totalTracks,
    });
  }

  return result;
}

/**
 * 启动时一次性自动为已有本地音乐按歌手创建歌单；
 * 生成成功后写入本地标记，避免用户后续手动删除歌单后被重新创建。
 */
export async function ensureLocalArtistPlaylistsSeededOnce(
  waitForExtra?: Promise<unknown>
): Promise<MergeArtistPlaylistsResult | null> {
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(LOCAL_ARTIST_PLAYLISTS_SEEDED_KEY) === "1"
  ) {
    return null;
  }

  await Promise.all([
    whenLocalMusicHydrated(),
    whenMusicStoreHydrated(),
    waitForExtra ?? Promise.resolve(),
  ]);

  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(LOCAL_ARTIST_PLAYLISTS_SEEDED_KEY) === "1"
  ) {
    return null;
  }

  const files = useLocalMusicStore.getState().files;
  const records = useDownloadStore.getState().records;
  const tracks = buildLocalAndDownloadedTracks(files, records);
  if (tracks.length === 0) {
    return null;
  }

  const result = syncLocalArtistPlaylists();
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LOCAL_ARTIST_PLAYLISTS_SEEDED_KEY, "1");
  }
  return result;
}
