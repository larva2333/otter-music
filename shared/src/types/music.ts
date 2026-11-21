import type { NeteasePrivilege } from "./netease";

export interface SearchResult {
  code: number;
  data: MusicTrack[];
  error?: string;
}

export interface SongUrl {
  url: string;
  br: number;
  size: number;
}

export interface SongLyric {
  lyric: string;
  tlyric?: string;
}

export type MergedMusicTrack = MusicTrack & {
  variants?: MusicTrack[];
};

export type AudioFormat = "mp3" | "m4a" | "m4s" | "flv";

export interface SearchPageResult<T = MusicTrack> {
  items: T[];
  hasMore: boolean;
}

export const searchOptions: Record<string, string> = {
  all: "聚合搜索",
  joox: "Joox",
  netease: "网易云音乐",
  _netease: "Netease",
  kuwo: "酷我音乐",
  migu: "Migu",
  bilibili: "B站",
  qq: "QQ音乐",
  higequ: "Higequ",
  jamendo: "Jamendo",
};

export const sourceLabels: Record<string, string> = {
  joox: "Joox",
  netease: "网易",
  _netease: "Netease",
  kuwo: "酷我",
  migu: "Migu",
  bilibili: "B站",
  qq: "QQ",
  higequ: "Higequ",
  jamendo: "Jamendo",
  alist: "Alist",
};

export const aggregatedSourceOptions: {
  value: MusicSource;
  label: string;
  description: string;
}[] = [
  {
    value: "higequ",
    label: "Higequ",
    description: "Hi歌曲音乐网（仅标准音质）",
  },
  { value: "_netease", label: "Netease", description: "网易云官方，稳定高速" },
  {
    value: "qq",
    label: "QQ音乐",
    description: "QQ音乐官方",
  },
  {
    value: "bilibili",
    label: "B站",
    description: "Bilibili官方, 用户上传资源丰富",
  },
];

export const sourceBadgeStyles: Record<string, string> = {
  netease: "text-red-500/70 border-red-500/20 bg-red-500/5 hover:bg-red-500/10",
  _netease:
    "text-red-500/70 border-red-500/20 bg-red-500/5 hover:bg-red-500/10",
  kuwo: "text-amber-500/70 border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10",
  joox: "text-green-500/70 border-green-500/20 bg-green-500/5 hover:bg-green-500/10",

  qq: "text-yellow-500/70 border-yellow-500/20 bg-yellow-500/5 hover:bg-yellow-500/10",
  kugou: "text-sky-500/70 border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10",
  migu: "text-pink-500 border-pink-500/30 bg-pink-500/5 hover:bg-pink-500/10",
  bilibili:
    "text-pink-500/70 border-pink-500/20 bg-pink-500/5 hover:bg-pink-500/10",
  higequ:
    "text-violet-500/70 border-violet-500/20 bg-violet-500/5 hover:bg-violet-500/10",
  jamendo:
    "text-[#d84868]/70 border-[#d84868]/20 bg-[#d84868]/5 hover:bg-[#d84868]/10",
  default:
    "text-muted-foreground/70 border-border bg-muted/30 hover:bg-muted/50",
};

export interface SourceConfig {
  source: MusicSource;
  enabled: boolean;
  visible: boolean;
  /** 用户自定义的显示名（留空则用内置名/导入脚本里的名字） */
  alias?: string;
  /** 被「一键检测」判定不可用后自动停用；检测恢复正常会自动重新启用 */
  healthDisabled?: boolean;
}

export const DEFAULT_SOURCE_CONFIGS: SourceConfig[] = [
  { source: "higequ", enabled: true, visible: true },
  { source: "_netease", enabled: true, visible: true },
  { source: "qq", enabled: true, visible: true },
  { source: "bilibili", enabled: true, visible: true },
];

export type MusicSource =
  | "netease"
  | "_netease"
  | "joox"
  | "tencent"
  | "kugou"
  | "kuwo"
  | "bilibili"
  | "migu"
  | "qq"
  | "higequ"
  | "jamendo"
  | "fivesing"
  | "tk"
  | "wy"
  | "kg"
  | "kw"
  | "mg"
  | "qi"
  | "lizhi"
  | "qingting"
  | "ximalaya"
  | "xiaoyuzhou"
  | "podcast"
  | "tidal"
  | "spotify"
  | "ytmusic"
  | "qobuz"
  | "deezer"
  | "apple"
  | "all"
  | "local"
  | "alist";

export interface SearchIntent {
  type: "artist" | "album" | "playlist" | "";
  id?: string;
  name?: string;
  artist?: string;
}

export interface SearchSuggestionItem {
  id?: string;
  text: string;
  type: "song" | "artist" | "album" | "playlist";
  source?: MusicSource;
}

export interface MusicTrack {
  id: string;
  name: string;
  artist: string[];
  album: string;
  pic_id: string;
  url_id: string;
  lyric_id: string;
  source: MusicSource;
  update_time?: number;
  is_deleted?: boolean;
  privilege?: NeteasePrivilege;
  fee?: number; // 通用付费标识（0=免费, 1=VIP, 4=付费）
  artist_ids?: string[];
  album_id?: string;
  audioFormat?: AudioFormat;
}

export interface Playlist {
  id: string;
  name: string;
  tracks: MusicTrack[];
  createdAt: number;
  update_time?: number;
  is_deleted?: boolean;
  coverUrl?: string;
  description?: string;
}
