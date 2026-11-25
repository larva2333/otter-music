import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { MusicTabBar } from "./MusicTabBar";
import { useAppStore } from "@/store/app-store";

vi.mock("@/lib/storage-adapter", () => ({
  idbStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

describe("MusicTabBar", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState({
      hasUpdate: false,
      updateDialogRequested: false,
      updateDialogAutoShown: false,
    });
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  const renderBar = (initialPath = "/search") => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <MemoryRouter initialEntries={[initialPath]}>
          <MusicTabBar />
        </MemoryRouter>
      );
    });
  };

  it("有新版本时点击设置 tab 同步请求打开弹窗，同会话关闭后再次点击不再请求", () => {
    useAppStore.setState({ hasUpdate: true });
    renderBar("/search");

    const settingsLink = container!.querySelector('a[aria-label="设置"]');
    expect(settingsLink).toBeTruthy();

    act(() => {
      settingsLink!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useAppStore.getState().updateDialogRequested).toBe(true);
    expect(useAppStore.getState().updateDialogAutoShown).toBe(true);

    // 模拟关掉弹窗并切回发现页后，再次点设置
    act(() => {
      useAppStore.getState().consumeUpdateDialogRequest();
    });
    act(() => root?.unmount());
    root = undefined;
    container?.remove();
    renderBar("/search");

    const settingsLinkAgain = container!.querySelector('a[aria-label="设置"]');
    act(() => {
      settingsLinkAgain!.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(useAppStore.getState().updateDialogRequested).toBe(false);
  });

  it("没有新版本时点击设置 tab 不请求打开弹窗", () => {
    useAppStore.setState({ hasUpdate: false });
    renderBar("/search");

    const settingsLink = container!.querySelector('a[aria-label="设置"]');
    act(() => {
      settingsLink!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useAppStore.getState().updateDialogRequested).toBe(false);
  });
});
