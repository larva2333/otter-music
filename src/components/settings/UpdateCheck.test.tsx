import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UpdateCheck } from "./UpdateCheck";
import { useAppStore } from "@/store/app-store";

vi.mock("@/lib/storage-adapter", () => ({
  idbStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock("@/lib/api/update", () => ({
  checkUpdate: vi.fn(),
}));

vi.mock("@/lib/apk-update", () => ({
  downloadAndInstallApk: vi.fn(),
}));

vi.mock("@capacitor/app", () => ({
  App: { getInfo: vi.fn().mockResolvedValue({ version: "2.7.21" }) },
}));

describe("UpdateCheck", () => {
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
    useAppStore.setState({
      currentVersion: "2.7.21",
      latestVersionInfo: null,
      hasUpdate: true,
      lastCheckTime: Date.now(),
      updateDialogRequested: false,
    });
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    document.body.innerHTML = "";
    root = undefined;
    container = undefined;
  });

  const render = () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<UpdateCheck />));
  };

  it("点版本号也能打开更新弹窗", () => {
    render();

    expect(document.body.textContent).not.toContain("最近检查");
    const version = Array.from(container!.querySelectorAll("span")).find(
      (el) => el.textContent === "2.7.21"
    );
    expect(version).toBeTruthy();

    act(() => {
      version!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("最近检查");
    expect(document.body.textContent).toContain("检查更新");
  });

  it("从新版本 toast 跳转过来时自动打开弹窗", () => {
    useAppStore.setState({ updateDialogRequested: true });
    render();

    expect(document.body.textContent).toContain("最近检查");
    expect(useAppStore.getState().updateDialogRequested).toBe(true);
  });

  it("有新版本时进设置自动弹一次，同一版本第二次不再弹", () => {
    localStorage.clear();
    useAppStore.setState({
      hasUpdate: true,
      latestVersionInfo: {
        latestVersion: "9.9.9",
        versionName: "9.9.9",
        changelog: "",
        publishDate: "2026-01-01T00:00:00Z",
        downloadUrl: "",
      } as never,
      updateDialogRequested: false,
    });

    render();
    expect(document.body.textContent).toContain("最近检查");
    expect(localStorage.getItem("otter_update_auto_shown_9.9.9")).toBe("1");

    // 关掉再重进，同一版本不应再自动弹
    act(() => root?.unmount());
    root = undefined;
    container?.remove();
    render();
    expect(document.body.textContent).not.toContain("最近检查");
  });

  it("没有新版本时不自动弹", () => {
    localStorage.clear();
    useAppStore.setState({ hasUpdate: false, latestVersionInfo: null });
    render();
    expect(document.body.textContent).not.toContain("最近检查");
  });
});
