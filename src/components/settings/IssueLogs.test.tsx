import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IssueLogs } from "./IssueLogs";
import { logger } from "@/lib/logger";

vi.mock("@/lib/clipboard", () => ({
  writeClipboardText: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/utils/toast", () => ({
  toastUtils: { success: vi.fn(), error: vi.fn() },
}));

describe("IssueLogs 级别筛选", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    logger.clear();
    logger.info("probe", "info-msg");
    logger.error("probe", "error-msg");
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    document.body.innerHTML = "";
    logger.clear();
    root = undefined;
    container = undefined;
  });

  const render = () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<IssueLogs />));
  };

  const clickText = (text: string) => {
    const el = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === text
    );
    expect(el).toBeTruthy();
    act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  };

  const textareaValue = () => document.querySelector("textarea")?.value ?? "";

  it("默认显示全部级别，可逐项取消筛选", () => {
    render();

    // 打开诊断日志抽屉
    const entry = Array.from(document.querySelectorAll("div")).find(
      (el) =>
        String(el.className).includes("px-4 py-3") &&
        el.textContent?.includes("诊断日志")
    );
    expect(entry).toBeTruthy();
    act(() => entry!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(textareaValue()).toContain("info-msg");
    expect(textareaValue()).toContain("error-msg");

    clickText("info");
    expect(textareaValue()).not.toContain("info-msg");
    expect(textareaValue()).toContain("error-msg");

    clickText("error");
    expect(textareaValue()).toBe("暂无日志记录");
  });
});
