import { describe, expect, it } from "vitest";
import type { ImportedSource } from "./types";
import {
  canonicalSourceUrl,
  duplicateReasonText,
  extraEnabledLx,
  findDuplicateSource,
} from "./rules";

const RAW = "https://raw.githubusercontent.com/foo/bar/main/latest.js";

describe("canonicalSourceUrl — 代理前缀感知的地址归一化", () => {
  it("GitHub 文件页 / raw 路径 / jsdelivr 都收敛到同一个 raw 地址", () => {
    expect(canonicalSourceUrl(RAW)).toBe(RAW);
    expect(
      canonicalSourceUrl("https://github.com/foo/bar/blob/main/latest.js")
    ).toBe(RAW);
    expect(
      canonicalSourceUrl("https://github.com/foo/bar/raw/main/latest.js")
    ).toBe(RAW);
    expect(
      canonicalSourceUrl("https://cdn.jsdelivr.net/gh/foo/bar@main/latest.js")
    ).toBe(RAW);
  });

  it("自家 proxy?url= 外壳能剥掉，可嵌套多层", () => {
    const proxied = `https://otter-music.pages.dev/proxy?url=${encodeURIComponent(RAW)}`;
    expect(canonicalSourceUrl(proxied)).toBe(RAW);
    const nested = `https://a.example/proxy?url=${encodeURIComponent(proxied)}`;
    expect(canonicalSourceUrl(nested)).toBe(RAW);
  });

  it("ghproxy 前缀（明文或编码）能剥掉", () => {
    expect(canonicalSourceUrl(`https://ghproxy.net/${RAW}`)).toBe(RAW);
    expect(
      canonicalSourceUrl(`https://gh-proxy.com/${encodeURIComponent(RAW)}`)
    ).toBe(RAW);
  });

  it("不同文件仍是不同地址", () => {
    expect(canonicalSourceUrl(RAW)).not.toBe(
      canonicalSourceUrl(
        "https://raw.githubusercontent.com/foo/bar/main/other.js"
      )
    );
  });
});

const existing: ImportedSource[] = [
  {
    id: "imp_1",
    name: "测试音源",
    kind: "lx",
    url: RAW,
    script: "/* @name 测试音源 */ var a = 1;",
    enabled: true,
    visible: true,
    addedAt: 1,
  },
];

describe("findDuplicateSource — 名称/地址/内容任一命中", () => {
  it("代理地址不同但目标相同 → 地址重复", () => {
    const url = `https://ghproxy.net/${RAW}`;
    expect(
      findDuplicateSource(existing, { name: "别的名字", url })?.reason
    ).toBe("url");
  });

  it("名称相同 → 重复", () => {
    expect(
      findDuplicateSource(existing, {
        name: "测试音源",
        url: "https://other.example/x.js",
      })?.reason
    ).toBe("name");
  });

  it("镜像地址不同但脚本正文相同 → 内容重复（空白差异忽略）", () => {
    expect(
      findDuplicateSource(existing, {
        name: "镜像源",
        url: "https://mirror.example/latest.js",
        script: "/* @name 测试音源 */  var a=1;",
      })?.reason
    ).toBe("script");
  });

  it("三项都不同 → 不重复；更新时可排除自己", () => {
    expect(
      findDuplicateSource(existing, {
        name: "另一个源",
        url: "https://other.example/x.js",
        script: "var b = 2;",
      })
    ).toBeNull();
    expect(
      findDuplicateSource(
        existing,
        { name: "测试音源", url: RAW, script: existing[0].script },
        "imp_1"
      )
    ).toBeNull();
  });

  it("提示文案覆盖三种原因", () => {
    expect(duplicateReasonText("url")).toBe("地址相同");
    expect(duplicateReasonText("name")).toBe("名称相同");
    expect(duplicateReasonText("script")).toBe("脚本内容相同");
  });
});

describe("extraEnabledLx — 洛雪脚本单启", () => {
  const items = [
    { id: "a", kind: "lx" as const, enabled: true },
    { id: "b", kind: "lx" as const, enabled: true },
    { id: "g", kind: "gd" as const, enabled: true },
    { id: "c", kind: "lx" as const, enabled: false },
  ];

  it("默认保留第一个启用的洛雪脚本", () => {
    expect(extraEnabledLx(items).map((s) => s.id)).toEqual(["b"]);
  });

  it("指定 keepId 时保留它", () => {
    expect(extraEnabledLx(items, "b").map((s) => s.id)).toEqual(["a"]);
  });

  it("只有一个或没有启用项时无需处理", () => {
    expect(extraEnabledLx(items.slice(0, 1))).toEqual([]);
    expect(extraEnabledLx(items.slice(3))).toEqual([]);
  });
});
