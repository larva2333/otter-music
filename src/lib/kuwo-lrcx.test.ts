import { describe, expect, it } from "vitest";
import { decodeKuwoLrcx } from "./kuwo-lrcx";

describe("decodeKuwoLrcx", () => {
  it("按 [kuwo] 八进制 offset 把编码还原成相对行起点的毫秒", () => {
    const lrc = "[kuwo:140]\n[00:00.610]<990,-990>西<2421,549>西<3249,2529>里";
    // 140(八进制)=96 → offset=9, offset2=6
    expect(decodeKuwoLrcx(lrc)).toBe(
      "[kuwo:140]\n[00:00.610]<0,165>西<165,156>西<321,60>里"
    );
  });

  it("当前字起点早于上个字终点时截断上个字，避免重叠", () => {
    const lrc = "[kuwo:140]\n[00:01.00]<990,-990>海<2421,549>风<2000,100>刮";
    expect(decodeKuwoLrcx(lrc)).toBe(
      "[kuwo:140]\n[00:01.00]<0,165>海<116,0>风<116,158>刮"
    );
  });

  it("普通 LRC 原样返回，不动没有字级标记的行", () => {
    const lrc = "[ti:西西里]\n[00:01.00]海风刮过";
    expect(decodeKuwoLrcx(lrc)).toBe(lrc);
  });

  it("解不出 offset 时剥掉字级标记，退回普通逐行歌词", () => {
    const lrc = "[kuwo:50]\n[00:01.00]<990,-990>海<2421,549>风";
    // 50(八进制)=40 → offset2=0，无法解码
    expect(decodeKuwoLrcx(lrc)).toBe("[kuwo:50]\n[00:01.00]海风");
  });
});
