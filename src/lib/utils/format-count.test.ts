import { describe, expect, it } from "vitest";
import { formatCount } from "./format-count";

describe("formatCount 数量缩写", () => {
  it("小于 1000 显示原数", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1)).toBe("1");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(999.9)).toBe("999");
  });

  it("1000 ~ 9999 显示 K", () => {
    expect(formatCount(1000)).toBe("1K");
    expect(formatCount(1500)).toBe("1.5K");
    expect(formatCount(1234)).toBe("1.2K");
    expect(formatCount(9999)).toBe("10K");
  });

  it("10000 及以上显示 W", () => {
    expect(formatCount(10000)).toBe("1W");
    expect(formatCount(12345)).toBe("1.2W");
    expect(formatCount(99999)).toBe("10W");
    expect(formatCount(150000)).toBe("15W");
  });

  it("异常值兜底为 0", () => {
    expect(formatCount(null)).toBe("0");
    expect(formatCount(undefined)).toBe("0");
    expect(formatCount(NaN)).toBe("0");
    expect(formatCount(-5)).toBe("0");
  });
});
