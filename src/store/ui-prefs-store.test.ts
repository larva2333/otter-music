import { afterEach, describe, expect, it } from "vitest";
import { applyFontScale, isFontScale, useUiPrefsStore } from "./ui-prefs-store";
import { storeKey } from "./store-keys";

describe("ui-prefs-store", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-font-scale");
    localStorage.clear();
    useUiPrefsStore.setState({ fontScale: "standard" });
  });

  it("标准档不写 data-font-scale（用 CSS 默认字号）", () => {
    document.documentElement.setAttribute("data-font-scale", "large");
    applyFontScale("standard");
    expect(document.documentElement.hasAttribute("data-font-scale")).toBe(
      false
    );
  });

  it("小/大档写入对应的 data-font-scale", () => {
    applyFontScale("small");
    expect(document.documentElement.getAttribute("data-font-scale")).toBe(
      "small"
    );

    applyFontScale("large");
    expect(document.documentElement.getAttribute("data-font-scale")).toBe(
      "large"
    );
  });

  it("setFontScale 立即改 DOM 并持久化到 localStorage", () => {
    useUiPrefsStore.getState().setFontScale("large");

    expect(useUiPrefsStore.getState().fontScale).toBe("large");
    expect(document.documentElement.getAttribute("data-font-scale")).toBe(
      "large"
    );

    const raw = localStorage.getItem(storeKey.UiPrefsStore);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.fontScale).toBe("large");
  });

  it("isFontScale 只认三个合法档位", () => {
    expect(isFontScale("small")).toBe(true);
    expect(isFontScale("standard")).toBe(true);
    expect(isFontScale("large")).toBe(true);
    expect(isFontScale("huge")).toBe(false);
    expect(isFontScale(null)).toBe(false);
  });
});
