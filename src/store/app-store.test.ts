import { describe, expect, it, vi, afterEach } from "vitest";
import { App } from "@capacitor/app";
import toast from "react-hot-toast";
import { router } from "@/router";
import {
  checkUpdate as apiCheckUpdate,
  type UpdateInfo,
} from "@/lib/api/update";
import { useAppStore } from "./app-store";
import { idbStorage } from "@/lib/storage-adapter";
import { storeKey } from "./store-keys";

vi.mock("@/lib/storage-adapter", () => ({
  idbStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock("@/lib/api/update", () => ({
  checkUpdate: vi.fn().mockResolvedValue({
    latestVersion: "0.0.0",
    downloadUrl: "",
    changelog: "",
  }),
}));

vi.mock("@capacitor/app", () => ({
  App: { getInfo: vi.fn().mockResolvedValue({ version: "0.0.0" }) },
}));

vi.mock("react-hot-toast", () => {
  const fn = vi.fn();
  Object.assign(fn, {
    success: vi.fn(),
    error: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
  });
  return { toast: fn, default: fn };
});

vi.mock("@/router", () => ({
  router: { navigate: vi.fn() },
}));

// 让 getCurrentVersion 走 App.getInfo 这条原生分支，方便模拟「刚装完更新」
vi.mock("@/lib/api/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/config")>();
  return { ...actual, IS_NATIVE: true };
});

const cachedInfo: UpdateInfo = {
  latestVersion: "v2.7.22",
  changelog: "",
  downloadUrl: "",
  mirrorUrls: [],
  directUrl: "",
  publishDate: "2026-11-22T00:00:00Z",
  size: 0,
};

describe("app-store persistence (partialize)", () => {
  afterEach(() => {
    vi.mocked(idbStorage.getItem).mockReset();
    vi.mocked(App.getInfo).mockResolvedValue({ version: "0.0.0" } as Awaited<
      ReturnType<typeof App.getInfo>
    >);
    vi.mocked(apiCheckUpdate).mockResolvedValue({
      latestVersion: "0.0.0",
      changelog: "",
      downloadUrl: "",
      mirrorUrls: [],
      directUrl: "",
      publishDate: "2026-11-22T00:00:00Z",
      size: 0,
    });
    useAppStore.setState({
      currentVersion: "0.0.0",
      latestVersionInfo: null,
      hasUpdate: false,
      lastCheckTime: 0,
      updateDialogRequested: false,
    });
  });

  it("should persist allowSimultaneousPlayback", () => {
    useAppStore.setState({ allowSimultaneousPlayback: true });

    const call = vi
      .mocked(idbStorage.setItem)
      .mock.calls.find(([name]) => name === storeKey.AppStore);
    expect(call).toBeDefined();

    const persisted = JSON.parse(call![1]);
    expect(persisted.state.allowSimultaneousPlayback).toBe(true);
  });

  it("should restore allowSimultaneousPlayback on rehydrate", async () => {
    vi.mocked(idbStorage.getItem).mockResolvedValue(
      JSON.stringify({
        state: { allowSimultaneousPlayback: true },
        version: 0,
      })
    );

    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().allowSimultaneousPlayback).toBe(true);

    useAppStore.setState({ allowSimultaneousPlayback: false });
  });
});

describe("checkUpdate", () => {
  it("静默检查不受 24 小时节流影响，每次启动都发请求", async () => {
    vi.mocked(apiCheckUpdate).mockClear();
    vi.mocked(App.getInfo).mockResolvedValue({
      version: "2.7.21",
    } as Awaited<ReturnType<typeof App.getInfo>>);
    useAppStore.setState({ lastCheckTime: Date.now(), isChecking: false });

    await useAppStore.getState().checkUpdate(true);

    expect(apiCheckUpdate).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().hasUpdate).toBe(false);
  });

  it("发现新版本的 toast 可点击跳转到设置并请求打开弹窗", async () => {
    vi.mocked(toast.custom).mockClear();
    vi.mocked(apiCheckUpdate).mockResolvedValue({
      ...cachedInfo,
      latestVersion: "9.9.9",
    });
    vi.mocked(App.getInfo).mockResolvedValue({
      version: "2.7.21",
    } as Awaited<ReturnType<typeof App.getInfo>>);

    await useAppStore.getState().checkUpdate(true);

    type ToastElement = { props: { children: unknown; onClick: () => void } };
    type Builder = (t: { id: string }) => ToastElement;
    const builders = vi
      .mocked(toast.custom)
      .mock.calls.map(([builder]) => builder as unknown as Builder);
    const builder = builders.find((fn) =>
      String(fn({ id: "t1" }).props.children).includes("9.9.9")
    );
    expect(builder).toBeTruthy();

    const element = builder!({ id: "t1" });
    element.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useAppStore.getState().updateDialogRequested).toBe(true);
    expect(router.navigate).toHaveBeenCalledWith("/settings");
  });

  it("多次检查更新时 toast 用固定 id 且带显式时长，不会堆叠或常驻", async () => {
    vi.mocked(toast.custom).mockClear();
    vi.mocked(apiCheckUpdate).mockResolvedValue({
      ...cachedInfo,
      latestVersion: "9.9.9",
    });
    vi.mocked(App.getInfo).mockResolvedValue({
      version: "2.7.21",
    } as Awaited<ReturnType<typeof App.getInfo>>);

    await useAppStore.getState().checkUpdate(true);
    useAppStore.setState({ isChecking: false });
    await useAppStore.getState().checkUpdate(true);

    const calls = vi.mocked(toast.custom).mock.calls;
    expect(calls).toHaveLength(2);
    // 两次调用必须用同一个固定 id（后者替换前者），且都带有限时长
    for (const [, options] of calls) {
      expect(options?.id).toBe("app-update-available");
      expect(options?.duration).toBeGreaterThan(0);
      expect(options?.duration).not.toBe(Infinity);
    }
  });
});

describe("syncInstalledVersion", () => {
  it("升级后清掉上一版遗留的 hasUpdate 并重置检查时间", async () => {
    vi.mocked(App.getInfo).mockResolvedValue({
      version: "2.7.22",
    } as Awaited<ReturnType<typeof App.getInfo>>);
    useAppStore.setState({
      currentVersion: "2.7.21",
      latestVersionInfo: cachedInfo,
      hasUpdate: true,
      lastCheckTime: Date.now(),
    });

    await useAppStore.getState().syncInstalledVersion();

    expect(useAppStore.getState().currentVersion).toBe("2.7.22");
    // latestVersion 是刚装上的 v2.7.22（带 v 前缀也要能比）
    expect(useAppStore.getState().hasUpdate).toBe(false);
    expect(useAppStore.getState().lastCheckTime).toBe(0);
  });

  it("版本没变时不动已有状态", async () => {
    vi.mocked(App.getInfo).mockResolvedValue({
      version: "2.7.21",
    } as Awaited<ReturnType<typeof App.getInfo>>);
    const lastCheckTime = Date.now() - 1000;
    useAppStore.setState({
      currentVersion: "2.7.21",
      latestVersionInfo: cachedInfo,
      hasUpdate: true,
      lastCheckTime,
    });

    await useAppStore.getState().syncInstalledVersion();

    expect(useAppStore.getState().hasUpdate).toBe(true);
    expect(useAppStore.getState().lastCheckTime).toBe(lastCheckTime);
  });

  it("缓存里的版本仍更新时保留绿点", async () => {
    vi.mocked(App.getInfo).mockResolvedValue({
      version: "2.7.20",
    } as Awaited<ReturnType<typeof App.getInfo>>);
    useAppStore.setState({
      currentVersion: "2.7.19",
      latestVersionInfo: cachedInfo,
      hasUpdate: false,
      lastCheckTime: Date.now(),
    });

    await useAppStore.getState().syncInstalledVersion();

    expect(useAppStore.getState().hasUpdate).toBe(true);
    expect(useAppStore.getState().lastCheckTime).toBe(0);
  });
});
