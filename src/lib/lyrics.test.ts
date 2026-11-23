import { describe, expect, it } from "vitest";
import { findActiveLyricIndex, parseLrc, parseSimpleLrc } from "./lyrics";

describe("parseSimpleLrc", () => {
  it("解析时间戳并按时间升序排列", () => {
    expect(
      parseSimpleLrc("[00:03.00]第三\n[00:01.50]第一\n[00:02.00]第二")
    ).toEqual([
      { time: 1.5, text: "第一" },
      { time: 2, text: "第二" },
      { time: 3, text: "第三" },
    ]);
  });

  it("同一行有多个时间戳时展开成多行", () => {
    expect(parseSimpleLrc("[00:01.00][00:05.00]重复")).toEqual([
      { time: 1, text: "重复" },
      { time: 5, text: "重复" },
    ]);
  });

  it("三位小数按毫秒解析", () => {
    expect(parseSimpleLrc("[00:01.234]x")).toEqual([
      { time: 1.234, text: "x" },
    ]);
  });

  it("忽略无时间戳的行与空文本行", () => {
    expect(parseSimpleLrc("作词 : 某人\n[00:01.00]\n[00:02.00]正文")).toEqual([
      { time: 2, text: "正文" },
    ]);
  });
});

describe("parseLrc", () => {
  it("没有译文时只返回原文行", () => {
    expect(parseLrc("[00:01.00]hi")).toEqual([
      { time: 1, text: "hi", ttext: undefined },
    ]);
  });

  it("按时间容差把译文挂到原文行上", () => {
    expect(
      parseLrc("[00:01.00]hi\n[00:09.00]bye", "[00:01.02]你好\n[00:09.20]再见")
    ).toEqual([
      { time: 1, text: "hi", ttext: "你好" },
      { time: 9, text: "bye", ttext: "再见" },
    ]);
  });

  it("时间差超出容差时不挂译文", () => {
    const result = parseLrc("[00:01.00]hi", "[00:03.00]你好");

    expect(result[0].ttext).toBeUndefined();
  });
});

describe("逐字歌词", () => {
  it("解析 <start,duration> 成 words，text 仍是干净的逐行文本", () => {
    const [line] = parseLrc("[00:01.00]<0,165>海<165,156>风");

    expect(line.text).toBe("海风");
    expect(line.words).toEqual([
      { text: "海", start: 0, end: 165 },
      { text: "风", start: 165, end: 321 },
    ]);
  });

  it("一行多个时间戳时共用同一份逐字数据", () => {
    const lines = parseSimpleLrc("[00:01.00][00:05.00]<0,100>a<100,100>b");

    expect(lines).toHaveLength(2);
    expect(lines[0].words).toEqual(lines[1].words);
    expect(lines[1].text).toBe("ab");
  });

  it("普通 LRC 不产生 words 字段", () => {
    expect(parseLrc("[00:01.00]hi")[0].words).toBeUndefined();
  });

  it("纯空格 token 并入前字，不单独占高亮步", () => {
    const [line] = parseLrc("[00:01.00]<0,100>海<100,50> <150,100>风");

    expect(line.text).toBe("海 风");
    expect(line.words).toEqual([
      { text: "海 ", start: 0, end: 150 },
      { text: "风", start: 150, end: 250 },
    ]);
  });

  it("负时长标记被跳过，但文字不丢", () => {
    const [line] = parseLrc("[00:01.00]<0,-100>海<100,100>风");

    expect(line.text).toBe("海风");
    expect(line.words).toEqual([{ text: "风", start: 100, end: 200 }]);
  });
});

describe("findActiveLyricIndex", () => {
  const lines = parseSimpleLrc("[00:01.00]a\n[00:05.00]b\n[00:09.00]c");

  it("前奏早于第一行时返回 -1", () => {
    expect(findActiveLyricIndex(lines, 0.5)).toBe(-1);
  });

  it("返回最后一个已到达的行", () => {
    expect(findActiveLyricIndex(lines, 1)).toBe(0);
    expect(findActiveLyricIndex(lines, 4.99)).toBe(0);
    expect(findActiveLyricIndex(lines, 5)).toBe(1);
    expect(findActiveLyricIndex(lines, 100)).toBe(2);
  });

  it("与应用内歌词偏移口径一致", () => {
    expect(findActiveLyricIndex(lines, 4.5, -0.5)).toBe(1);
    expect(findActiveLyricIndex(lines, 1.3, 0.5)).toBe(-1);
  });

  it("空歌词返回 -1", () => {
    expect(findActiveLyricIndex([], 10)).toBe(-1);
  });
});
