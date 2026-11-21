import { describe, expect, it } from "vitest";
import { upgradeLxUrlToHttps } from "./lx-playback";

describe("upgradeLxUrlToHttps", () => {
  it("把 QQ 音乐 CDN 的 http 直链升级为 https", () => {
    expect(
      upgradeLxUrlToHttps(
        "http://ws.stream.qqmusic.qq.com/F000002A6j2q1tdUUP.flac?vkey=abc"
      )
    ).toBe("https://ws.stream.qqmusic.qq.com/F000002A6j2q1tdUUP.flac?vkey=abc");
  });

  it("覆盖网易云、酷狗、酷我、咪咕等已知 CDN", () => {
    expect(upgradeLxUrlToHttps("http://m701.music.126.net/a.mp3")).toBe(
      "https://m701.music.126.net/a.mp3"
    );
    expect(upgradeLxUrlToHttps("http://trackercdn.kugou.com/b.mp3")).toBe(
      "https://trackercdn.kugou.com/b.mp3"
    );
    expect(upgradeLxUrlToHttps("http://sycdn.kuwo.cn/c.mp3")).toBe(
      "https://sycdn.kuwo.cn/c.mp3"
    );
    expect(upgradeLxUrlToHttps("http://freetyst.nf.migu.cn/d.mp3")).toBe(
      "https://freetyst.nf.migu.cn/d.mp3"
    );
  });

  it("未知域名保持原样，避免把不支持 https 的源升级后打死", () => {
    expect(upgradeLxUrlToHttps("http://music.example.com/a.mp3")).toBe(
      "http://music.example.com/a.mp3"
    );
  });

  it("https 与非法地址原样返回", () => {
    expect(upgradeLxUrlToHttps("https://ws.stream.qqmusic.qq.com/a.mp3")).toBe(
      "https://ws.stream.qqmusic.qq.com/a.mp3"
    );
    expect(upgradeLxUrlToHttps("not a url")).toBe("not a url");
  });
});
