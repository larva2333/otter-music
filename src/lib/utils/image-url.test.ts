import { describe, expect, it } from "vitest";
import { withImageSize } from "./image-url";

const NET_EASE = "https://p1.music.126.net/abc==/109951174111254293.jpg";

describe("withImageSize", () => {
  it("网易云图床追加 param 缩略图参数", () => {
    expect(withImageSize(NET_EASE, 350)).toBe(
      "https://p1.music.126.net/abc==/109951174111254293.jpg?param=350y350"
    );
  });

  it("已有的 param 会被替换，不会叠加", () => {
    expect(withImageSize(`${NET_EASE}?param=1000y1000`, 350)).toBe(
      `${NET_EASE}?param=350y350`
    );
  });

  it("非网易云域名保持原样（加参数可能 404）", () => {
    const other = "https://cdn.example.com/cover.jpg";
    expect(withImageSize(other, 350)).toBe(other);
    expect(withImageSize("https://alist.example.com/p.jpg?a=1", 350)).toBe(
      "https://alist.example.com/p.jpg?a=1"
    );
  });

  it("不传 size 或空 URL 时原样返回", () => {
    expect(withImageSize(NET_EASE)).toBe(NET_EASE);
    expect(withImageSize(null, 350)).toBeNull();
    expect(withImageSize(undefined, 350)).toBeNull();
    expect(withImageSize("", 350)).toBeNull();
  });

  it("size 取整，避免出现 param=350.4y350.4", () => {
    expect(withImageSize(NET_EASE, 349.6)).toBe(`${NET_EASE}?param=350y350`);
  });
});
