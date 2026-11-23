import { describe, expect, it, vi } from "vitest";
import { strToU8, zlibSync } from "fflate";
import type { MusicTrack } from "@/types/music";

// mock 网络层：让 search 走可控的假响应（vi.mock 会被提升，mock 函数需 hoisted）
const { requestTextMock } = vi.hoisted(() => ({
  requestTextMock: vi.fn(),
}));
vi.mock("@/lib/api/config", () => ({
  IS_NATIVE: false,
  getProxyUrl: (u: string) => `proxy:${u}`,
  fetchWithTimeout: requestTextMock,
}));

import { KuwoSearchProvider } from "./kuwo-search-provider";

const sample = {
  TOTAL: "2",
  abslist: [
    {
      MUSICRID: "MUSIC_550531871",
      NAME: "西西里",
      ARTIST: "周杰伦",
      ALBUM: "太阳之子",
      ALBUMID: "87758985",
      ARTISTID: "336",
      web_albumpic_short: "324/s4s96/19/xxx.jpg",
    },
    {
      MUSICRID: "MUSIC_123456",
      NAME: "稻香",
      ARTIST: "周杰伦&费玉清",
      ALBUM: "魔杰座",
    },
    { NAME: "无 rid 的坏数据" },
  ],
};

function mockResponse(text: string | null, ok = true) {
  requestTextMock.mockResolvedValue({
    ok,
    text: async () => text ?? "",
  });
}

/** 构造酷我歌词接口的加密响应：header + zlib(base64(XOR(LRC, 'yeelion'))) */
function makeLyricResponse(lrc: string): ArrayBuffer {
  const key = "yeelion";
  const bytes = strToU8(lrc);
  const xored = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    xored[i] = bytes[i] ^ key.charCodeAt(i % key.length);
  }
  let bin = "";
  for (const b of xored) bin += String.fromCharCode(b);
  const header = strToU8("TP=content\r\nlrcx=1\r\n\r\n");
  const compressed = zlibSync(strToU8(btoa(bin)));
  const all = new Uint8Array(header.length + compressed.length);
  all.set(header);
  all.set(compressed, header.length);
  return all.buffer;
}

function mockBinaryResponse(buf: ArrayBuffer | null, ok = true) {
  requestTextMock.mockResolvedValue({
    ok,
    arrayBuffer: async () => buf ?? new ArrayBuffer(0),
  });
}

describe("KuwoSearchProvider", () => {
  it("搜索结果映射：rid 去 MUSIC_ 前缀、多歌手拆分、封面/专辑保留", async () => {
    mockResponse(JSON.stringify(sample));
    const res = await new KuwoSearchProvider().search("西西里", 1, 20);
    expect(res.items).toHaveLength(2);
    const first = res.items[0];
    expect(first.source).toBe("kuwo");
    expect(first.url_id).toBe("550531871");
    expect(first.id).toBe("kw_550531871");
    expect(first.name).toBe("西西里");
    expect(first.artist).toEqual(["周杰伦"]);
    expect(first.album).toBe("太阳之子");
    expect(first.pic_id).toBe(
      "https://img1.kuwo.cn/star/albumcover/500/s4s96/19/xxx.jpg"
    );
    expect(first.artist_ids).toEqual(["336"]);
    expect(res.hasMore).toBe(false);
    expect(requestTextMock.mock.calls[0][0]).toContain("search.kuwo.cn/r.s");
  });

  it("多歌手用 & 拆分", async () => {
    mockResponse(JSON.stringify(sample));
    const res = await new KuwoSearchProvider().search("稻香", 1, 20);
    expect(res.items[1].artist).toEqual(["周杰伦", "费玉清"]);
  });

  it("hasMore 按总数和页码判断", async () => {
    mockResponse(JSON.stringify({ ...sample, TOTAL: "100" }));
    const res = await new KuwoSearchProvider().search("test", 1, 20);
    expect(res.hasMore).toBe(true);
  });

  it("非法 JSON / 网络失败返回空，不抛异常", async () => {
    mockResponse("not json");
    expect((await new KuwoSearchProvider().search("x", 1, 20)).items).toEqual(
      []
    );
    requestTextMock.mockResolvedValue(null);
    expect((await new KuwoSearchProvider().search("x", 1, 20)).items).toEqual(
      []
    );
  });

  it("getUrl 返回 null（取链交给洛雪脚本按 kw 平台接管）", async () => {
    expect(await new KuwoSearchProvider().getUrl({} as never)).toBeNull();
  });

  it("getLyric: 解密酷我加密 LRC，rid 兼容 kw_ 前缀", async () => {
    const lrc = "[ti:西西里]\n[ar:周杰伦]\n[00:01.00]海风刮过了 无人的街道\n";
    mockBinaryResponse(makeLyricResponse(lrc));
    const track = {
      id: "kw_550531871",
      lyric_id: "kw_550531871",
      source: "kuwo",
    } as MusicTrack;
    const res = await new KuwoSearchProvider().getLyric(track);
    expect(res?.lyric).toContain("海风刮过了 无人的街道");
    expect(res?.tlyric).toBe("");
    const url = String(requestTextMock.mock.calls.at(-1)?.[0]);
    expect(url).toContain("mlyric.kuwo.cn");
    expect(url).toContain("rid=550531871");
  });

  it("getLyric: 把酷我逐字编码解码成标准 <start,duration>，不再剥掉", async () => {
    const lrc = "[kuwo:140]\n[00:01.00]<990,-990>海<2421,549>风\n";
    mockBinaryResponse(makeLyricResponse(lrc));
    const res = await new KuwoSearchProvider().getLyric({
      lyric_id: "550531871",
    } as MusicTrack);
    expect(res?.lyric).toBe("[kuwo:140]\n[00:01.00]<0,165>海<165,156>风\n");
  });

  it("getLyric: 无 rid / 响应非歌词格式时返回 null，不抛异常", async () => {
    expect(
      await new KuwoSearchProvider().getLyric({} as MusicTrack)
    ).toBeNull();
    mockBinaryResponse(makeLyricResponse("no timestamp here"));
    expect(
      await new KuwoSearchProvider().getLyric({ lyric_id: "123" } as MusicTrack)
    ).toBeNull();
  });
});
