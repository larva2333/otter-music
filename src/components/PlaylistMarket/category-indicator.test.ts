import { describe, expect, it } from "vitest";
import { getCategoryIndicator } from "./category-indicator";

function makeBar(width: number, buttonWidth: number): HTMLElement {
  const bar = document.createElement("div");
  const btn = document.createElement("button");
  btn.dataset.categoryId = "recommend";
  bar.appendChild(btn);
  Object.defineProperty(bar, "clientWidth", { value: width });
  Object.defineProperty(btn, "offsetWidth", { value: buttonWidth });
  Object.defineProperty(btn, "offsetLeft", { value: 66 });
  Object.defineProperty(btn, "offsetTop", { value: 0 });
  return bar;
}

describe("getCategoryIndicator", () => {
  it("按钮可见时返回位置与宽度", () => {
    expect(getCategoryIndicator(makeBar(400, 50), "recommend")).toEqual({
      left: 66,
      top: 0,
      width: 50,
    });
  });

  it("页面隐藏、按钮宽度为 0 时返回 null，避免写入 0 宽胶囊", () => {
    expect(getCategoryIndicator(makeBar(0, 0), "recommend")).toBeNull();
  });

  it("按钮存在但选中项不存在时返回 null", () => {
    expect(getCategoryIndicator(makeBar(400, 50), "missing")).toBeNull();
  });
});
