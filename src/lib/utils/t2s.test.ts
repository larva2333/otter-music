import { describe, expect, it } from "vitest";
import { t2s, t2sArtists } from "./t2s";

describe("t2s 显示层繁转简", () => {
  it("单字按词表转换", () => {
    expect(t2s("周杰倫")).toBe("周杰伦");
    expect(t2s("陳奕迅 - 富士山下")).toBe("陈奕迅 - 富士山下");
    expect(t2s("愛情的模樣")).toBe("爱情的模样");
  });

  it("已经是简体时原样返回", () => {
    expect(t2s("晴天")).toBe("晴天");
    expect(t2s("")).toBe("");
  });

  it("短语优先，避免单字消歧错误", () => {
    // 「乾」单字映射到「干」，但「乾隆」必须保持原样
    expect(t2s("乾隆")).toBe("乾隆");
  });

  it("日文新字体也转成简体", () => {
    expect(t2s("聴いて")).toBe("听いて");
  });

  it("中英混排只动汉字", () => {
    expect(t2s("Love Story 愛的故事")).toBe("Love Story 爱的故事");
  });

  it("歌手数组逐项转换，无变化时返回原引用", () => {
    const unchanged = ["周杰伦"];
    expect(t2sArtists(unchanged)).toBe(unchanged);
    expect(t2sArtists(["周杰倫", "費玉清"])).toEqual(["周杰伦", "费玉清"]);
    expect(t2sArtists(undefined)).toEqual([]);
  });
});
