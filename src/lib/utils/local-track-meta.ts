import { LocalMusicFile } from "@/plugins/local-music";
import { STORAGE_CONFIG } from "@/lib/storage-manager";

/**
 * 本地文件的标签并不可靠：下载器会把自己的名字写进 TITLE/ARTIST/ALBUM
 * （典型是酷我的 FLAC，三个字段全是 "kuwo"），MediaStore 也会在标签缺失时
 * 把 "<unknown>" 当 artist、把完整文件名当 title、把目录名当 album。
 *
 * 这里只做显示层兜底：标签不可用时从文件名反推歌手/歌名，不改任何文件。
 */

/** 下载器/音乐平台占位词，出现在标签里等于没写 */
const SOURCE_TAG_VALUES = new Set([
  "kuwo",
  "kugou",
  "qqmusic",
  "qq music",
  "netease",
  "netease music",
  "cloudmusic",
  "migu",
  "xiami",
  "bilibili",
  "youtube",
  "ncm",
  "酷我",
  "酷我音乐",
  "酷狗",
  "酷狗音乐",
  "网易云",
  "网易云音乐",
  "qq音乐",
  "咪咕",
  "咪咕音乐",
  "虾米",
  "虾米音乐",
]);

/** MediaStore / 标签里表示“没有”的值 */
const UNKNOWN_TAG_VALUES = new Set([
  "<unknown>",
  "unknown",
  "unknown artist",
  "unknown album",
  "未知",
  "未知歌手",
  "未知艺术家",
  "未知专辑",
]);

/** 标签整体缺失时，这些“专辑名”只是目录名，显示出来没有意义 */
const UNRELIABLE_ALBUM_VALUES = new Set([
  "music",
  "download",
  "downloads",
  "audio",
  "sdcard",
  "?",
  "-",
]);

const AUDIO_EXT_RE =
  /\.(mp3|flac|m4a|aac|wav|ogg|oga|opus|wma|ape|dsf|dff|alac|mp4|m4s|3gp|amr|wv)$/i;

export interface LocalTrackMeta {
  name: string;
  artist: string;
  album: string;
}

export interface LocalTrackMetaInput {
  name?: string | null;
  artist?: string | null;
  album?: string | null;
  /** 扫描时拿到的真实文件名；localPath 可能是 content:// 无法反推名字 */
  fileName?: string | null;
  localPath?: string | null;
  /** otter-music 自己下载的文件名是「歌名 - 歌手」，其余默认「歌手 - 歌名」 */
  isOtterPath?: boolean;
}

function normalized(value?: string | null): string {
  return (value ?? "").trim();
}

function basenameOf(path?: string | null): string {
  if (!path) return "";
  const withoutScheme = path.replace(/^file:\/\//, "");
  const parts = withoutScheme.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function stripAudioExt(fileName: string): string {
  return fileName.replace(AUDIO_EXT_RE, "");
}

function isSourceTag(value: string): boolean {
  return SOURCE_TAG_VALUES.has(value.toLowerCase());
}

function isMissingTag(value: string): boolean {
  if (!value) return true;
  return (
    SOURCE_TAG_VALUES.has(value.toLowerCase()) ||
    UNKNOWN_TAG_VALUES.has(value.toLowerCase())
  );
}

/** 按分隔符切「A - B」，fromEnd 用于 otter 的「歌名 - 歌手」命名 */
function splitDash(
  value: string,
  fromEnd: boolean
): { left: string; right: string } | null {
  const index = fromEnd ? value.lastIndexOf(" - ") : value.indexOf(" - ");
  if (index <= 0 || index >= value.length - 3) return null;
  const left = value.slice(0, index).trim();
  const right = value.slice(index + 3).trim();
  if (!left || !right) return null;
  return { left, right };
}

/**
 * 从文件名解析歌手与歌名。
 * otter 下载的文件名是 `buildFileName` 生成的「歌名 - 歌手」，
 * 第三方下载器（酷我、网易云等）通常是「歌手 - 歌名」。
 */
export function parseFileName(
  fileName: string | null | undefined,
  isOtterPath: boolean
): { name: string; artist: string } | null {
  const base = stripAudioExt(normalized(fileName));
  if (!base) return null;

  const parts = splitDash(base, isOtterPath);
  if (!parts) return { name: base, artist: "" };

  return isOtterPath
    ? { name: parts.left, artist: parts.right }
    : { name: parts.right, artist: parts.left };
}

export function parseNameFromPath(
  localPath: string | null | undefined,
  isOtterPath: boolean
): { name: string; artist: string } | null {
  return parseFileName(basenameOf(localPath), isOtterPath);
}

/**
 * 解析一首本地歌曲用于展示的歌名/歌手/专辑。
 * 纯函数且幂等：解析过的结果再传一次不会继续变化。
 */
export function resolveLocalTrackMeta(
  input: LocalTrackMetaInput
): LocalTrackMeta {
  const rawName = normalized(input.name);
  const rawArtist = normalized(input.artist);
  const rawAlbum = normalized(input.album);

  const fileName = normalized(input.fileName) || basenameOf(input.localPath);
  const base = stripAudioExt(fileName);
  const nameIsFileName = !!base && rawName === base;

  const nameMissing = isMissingTag(rawName);
  const artistMissing = isMissingTag(rawArtist);
  // 标签整体不可信时，album 大概率只是目录名（Music / Download）
  const tagsUnreliable = nameMissing || artistMissing || nameIsFileName;

  const parsed = parseFileName(fileName, !!input.isOtterPath);

  let name = rawName;
  let artist = rawArtist;
  let album = rawAlbum;

  if (parsed) {
    if ((nameMissing || nameIsFileName) && parsed.name) name = parsed.name;
    if (artistMissing && parsed.artist) artist = parsed.artist;
  }

  if (nameMissing && !name) name = base;

  if (
    album &&
    (isMissingTag(album) ||
      (tagsUnreliable && UNRELIABLE_ALBUM_VALUES.has(album.toLowerCase())))
  ) {
    album = "";
  }

  // artist 留空交给调用方回落「未知艺术家」，不要把歌名当歌手
  if (isSourceTag(artist)) artist = "";

  return { name, artist, album };
}

/**
 * 批量规范化扫描结果。没有任何字段变化时返回原数组引用，
 * 方便调用方用引用比较判断是否需要回写 store。
 */
export function normalizeLocalMusicFiles(
  files: LocalMusicFile[]
): LocalMusicFile[] {
  let changed = false;
  const next = files.map((file) => {
    const meta = resolveLocalTrackMeta({
      name: file.name,
      artist: file.artist,
      album: file.album,
      fileName: file.fileName,
      localPath: file.localPath,
      isOtterPath: !!file.localPath?.includes(STORAGE_CONFIG.ROOT),
    });
    if (
      meta.name === (file.name ?? "") &&
      meta.artist === (file.artist ?? "") &&
      meta.album === (file.album ?? "")
    ) {
      return file;
    }
    changed = true;
    return {
      ...file,
      name: meta.name || file.name,
      artist: meta.artist || null,
      album: meta.album || null,
    };
  });
  return changed ? next : files;
}
