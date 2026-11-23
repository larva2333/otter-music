import type {
  MusicSource,
  MusicTrack,
  SearchIntent,
  SearchPageResult,
  SongLyric,
} from "@/types/music";
import { IMusicProvider } from "../interface";
import { forceHttps } from "@otter-music/shared";
import { unzlibSync } from "fflate";
import { fetchWithTimeout, getProxyUrl, IS_NATIVE } from "@/lib/api/config";
import { logger } from "@/lib/logger";
import { decodeKuwoLrcx } from "@/lib/kuwo-lrcx";

/**
 * 酷我音乐搜索源。
 *
 * 取链不做：酷我官方 playUrl 接口现在需要 kw_token + csrf 签名，公共 API
 * （GD Studio）也已停服。这里的曲目靠用户导入的洛雪脚本（溯音/非常刀等）
 * 按 `kw` 平台、纯数字 rid 取链 —— 实测溯音 623ms 就能拿到完整 9MB 音轨，
 * 远快于 QQ 平台只能靠 fish 死等 20-45 秒。
 *
 * 搜索走酷我老接口 `search.kuwo.cn/r.s`，免签名、返回标准 JSON。
 */
const SEARCH_URL = "https://search.kuwo.cn/r.s";
const UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";
const NETWORK_TIMEOUT = 12000;

interface KuwoRawSong {
  MUSICRID?: string;
  NAME?: string;
  ARTIST?: string;
  ALBUM?: string;
  ALBUMID?: string;
  ARTISTID?: string;
  web_albumpic_short?: string;
  web_artistpic_short?: string;
  DURATION?: string;
}

interface KuwoSearchResp {
  abslist?: KuwoRawSong[];
  TOTAL?: string;
}

/** MUSIC_550531871 / kw_550531871 → 550531871 */
function toRid(musicrid?: string): string {
  if (!musicrid) return "";
  let rid = musicrid;
  if (rid.startsWith("MUSIC_")) rid = rid.slice(6);
  if (rid.startsWith("kw_")) rid = rid.slice(3);
  return rid;
}

/**
 * 搜索返回的 web_albumpic_short 是相对路径（如 120/s4s86/95/xxx.jpg），
 * 必须拼成 img1.kuwo.cn/star/albumcover/ 才是真图片。
 * 旧代码把它塞进 artistpicserver 的 rid= 参数，返回的是 HTML 不是图片。
 */
function toCoverPath(path?: string): string {
  if (!path) return "";
  const p = path.trim();
  if (/^https?:\/\//i.test(p)) return forceHttps(p);
  const big = p.replace(/^\d+\//, "500/");
  return `https://img1.kuwo.cn/star/albumcover/${big}`;
}

function toTrack(s: KuwoRawSong): MusicTrack | null {
  const rid = toRid(s.MUSICRID);
  if (!rid || !s.NAME) return null;
  const artist = s.ARTIST || "未知歌手";
  const cover = toCoverPath(s.web_albumpic_short || s.web_artistpic_short);
  return {
    id: `kw_${rid}`,
    name: s.NAME,
    artist: artist.split("&"),
    album: s.ALBUM || "",
    pic_id: cover,
    url_id: rid,
    lyric_id: rid,
    source: "kuwo",
    artist_ids: s.ARTISTID ? [s.ARTISTID] : undefined,
    album_id: s.ALBUMID,
  };
}

async function requestText(
  url: string,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    if (IS_NATIVE) {
      const { CapacitorHttp } = await import("@capacitor/core");
      const res = await CapacitorHttp.request({
        method: "GET",
        url,
        headers: { "User-Agent": UA },
        connectTimeout: NETWORK_TIMEOUT,
        readTimeout: NETWORK_TIMEOUT,
      });
      if (res.status >= 400) return null;
      return typeof res.data === "string" ? res.data : String(res.data ?? "");
    }
    const res = await fetchWithTimeout(
      getProxyUrl(url),
      { signal },
      NETWORK_TIMEOUT
    );
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return null;
    logger.warn("KuwoSearchProvider", `请求失败：${url}`, e as Error);
    return null;
  }
}

/**
 * 酷我歌词接口 mlyric.kuwo.cn 返回二进制：
 *   "TP=content\r\nlrcx=1\r\n\r\n" + zlib 压缩后的 base64 文本，
 * base64 解码后按字节流与 'yeelion' 循环异或，得到 UTF-8 的 LRC。
 */
const LYRIC_KEY = "yeelion";

async function requestBinary(url: string): Promise<Uint8Array | null> {
  try {
    if (IS_NATIVE) {
      const { CapacitorHttp } = await import("@capacitor/core");
      const res = await CapacitorHttp.request({
        method: "GET",
        url,
        headers: { "User-Agent": UA },
        responseType: "arraybuffer",
        connectTimeout: NETWORK_TIMEOUT,
        readTimeout: NETWORK_TIMEOUT,
      });
      if (res.status >= 400) return null;
      const data = res.data as unknown;
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      if (Array.isArray(data)) return Uint8Array.from(data as number[]);
      if (typeof data === "string") {
        try {
          const bin = atob(data);
          return Uint8Array.from(bin, (c) => c.charCodeAt(0));
        } catch {
          return null;
        }
      }
      return null;
    }
    const res = await fetchWithTimeout(getProxyUrl(url), {}, NETWORK_TIMEOUT);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return null;
    logger.warn("KuwoSearchProvider", `歌词请求失败：${url}`, e as Error);
    return null;
  }
}

function decodeKuwoLyric(raw: Uint8Array): string | null {
  try {
    const head = new TextDecoder().decode(raw.subarray(0, 10)).toLowerCase();
    if (!head.startsWith("tp=content")) return null;
    let sep = -1;
    for (let i = 0; i < raw.length - 3; i++) {
      if (
        raw[i] === 13 &&
        raw[i + 1] === 10 &&
        raw[i + 2] === 13 &&
        raw[i + 3] === 10
      ) {
        sep = i;
        break;
      }
    }
    if (sep < 0) return null;
    const inflated = unzlibSync(raw.subarray(sep + 4));
    const text = new TextDecoder().decode(inflated);
    // lrcx=1：解压后是 base64 文本，再按字节与 'yeelion' 循环异或
    if (!/\[\d{1,2}:\d{1,2}/.test(text)) {
      const bin = atob(text.trim());
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i) ^ LYRIC_KEY.charCodeAt(i % LYRIC_KEY.length);
      }
      return new TextDecoder().decode(out) || null;
    }
    return text;
  } catch (e) {
    logger.warn("KuwoSearchProvider", "歌词解密失败", e as Error);
    return null;
  }
}

export class KuwoSearchProvider implements IMusicProvider {
  source: MusicSource = "kuwo";

  async search(
    query: string,
    page: number,
    count: number,
    signal?: AbortSignal,
    _intent?: SearchIntent | null
  ): Promise<SearchPageResult<MusicTrack>> {
    const params = new URLSearchParams({
      client: "kt",
      all: query,
      pn: String(Math.max(0, page - 1)),
      rn: String(count),
      uid: "794762570",
      ver: "kwplayer_ar_9.2.2.1",
      vipver: "1",
      show_copyright_off: "1",
      newver: "1",
      ft: "music",
      cluster: "0",
      strategy: "2012",
      encoding: "utf8",
      rformat: "json",
      vermerge: "1",
      mobi: "1",
      issubtitle: "1",
    });
    const text = await requestText(
      `${SEARCH_URL}?${params.toString()}`,
      signal
    );
    if (!text) return { items: [], hasMore: false };

    let json: KuwoSearchResp;
    try {
      json = JSON.parse(text) as KuwoSearchResp;
    } catch {
      logger.warn("KuwoSearchProvider", "搜索响应不是合法 JSON");
      return { items: [], hasMore: false };
    }
    const items = (json.abslist ?? [])
      .map(toTrack)
      .filter((t): t is MusicTrack => !!t);
    const total = Number(json.TOTAL ?? 0);
    return { items, hasMore: total > page * count };
  }

  /** 酷我官方取链要签名，交给洛雪脚本按 kw 平台接管 */
  async getUrl(_track: MusicTrack, _br?: number): Promise<string | null> {
    return null;
  }

  async getPic(track: MusicTrack, _size?: number): Promise<string | null> {
    return forceHttps(track.pic_id) || null;
  }

  async getLyric(track: MusicTrack): Promise<SongLyric | null> {
    const rid = toRid(track.lyric_id || track.url_id || track.id);
    if (!rid) return null;
    const url = `http://mlyric.kuwo.cn/mobi.s?f=web&type=lyric&lrcx=1&rid=${encodeURIComponent(rid)}&encode=utf8`;
    const raw = await requestBinary(url);
    if (!raw) return null;
    const lyric = decodeKuwoLyric(raw);
    if (!lyric || !/\[\d{1,2}:\d{1,2}/.test(lyric)) return null;
    // 酷我 lrcx=1 的 <a,b> 是编码值，解码成标准 <start,duration> 后交给
    // parseLrc 提取逐字数据；没有字级标记时 decode 原样返回，行为不变。
    return {
      lyric: decodeKuwoLrcx(lyric),
      tlyric: "",
    };
  }

  async searchArtist(
    query: string,
    page: number,
    count: number
  ): Promise<SearchPageResult<MusicTrack>> {
    return this.search(query, page, count);
  }

  async searchAlbum(
    query: string,
    page: number,
    count: number
  ): Promise<SearchPageResult<MusicTrack>> {
    return this.search(query, page, count);
  }
}
