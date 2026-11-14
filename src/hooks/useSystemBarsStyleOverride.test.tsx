import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSystemBarsStyleOverride } from "./useSystemBarsStyleOverride";

const mocks = vi.hoisted(() => ({
  setOverride: vi.fn(),
  isNativePlatform: vi.fn(),
}));
const setOverride = mocks.setOverride;
const capacitorMocks = mocks;

vi.mock("@/lib/system-bars", () => ({
  setSystemBarsStyleOverride: mocks.setOverride,
}));

vi.mock("@/lib/api/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/config")>()),
  get IS_NATIVE() {
    return capacitorMocks.isNativePlatform();
  },
}));

function Harness({
  isDarkContent,
  active,
  delayMs,
}: {
  isDarkContent: boolean;
  active: boolean;
  delayMs: number;
}) {
  useSystemBarsStyleOverride(isDarkContent, active, delayMs);
  return null;
}

describe("useSystemBarsStyleOverride", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // 抑制测试环境里 root.render/unmount 的 act 警告
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    setOverride.mockClear();
    capacitorMocks.isNativePlatform.mockReturnValue(true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const render = (props: {
    isDarkContent: boolean;
    active: boolean;
    delayMs: number;
  }) => act(() => root.render(<Harness {...props} />));

  it("不传延迟时立即生效", () => {
    render({ isDarkContent: true, active: true, delayMs: 0 });

    expect(setOverride).toHaveBeenCalledWith(true);
  });

  it("延迟期间不改系统栏，到点才生效", () => {
    render({ isDarkContent: true, active: true, delayMs: 500 });

    expect(setOverride).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(setOverride).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(setOverride).toHaveBeenCalledWith(true);
  });

  it("收起时立即还原：播放页下滑后状态栏很快露出浅色页面", () => {
    render({ isDarkContent: true, active: true, delayMs: 500 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    setOverride.mockClear();

    render({ isDarkContent: true, active: false, delayMs: 500 });

    expect(setOverride).toHaveBeenCalledWith(null);
  });

  it("生效计时未到就收起，不会再改回浅色图标", () => {
    render({ isDarkContent: true, active: true, delayMs: 500 });
    setOverride.mockClear();

    render({ isDarkContent: true, active: false, delayMs: 500 });
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(setOverride).toHaveBeenCalledTimes(1);
    expect(setOverride).toHaveBeenCalledWith(null);
  });

  it("还没生效就卸载时，立即还原覆盖值", () => {
    render({ isDarkContent: true, active: true, delayMs: 500 });
    expect(setOverride).not.toHaveBeenCalled();

    act(() => root.unmount());
    expect(setOverride).toHaveBeenCalledWith(null);
  });

  it("非原生平台不碰系统栏", () => {
    capacitorMocks.isNativePlatform.mockReturnValue(false);
    render({ isDarkContent: true, active: true, delayMs: 0 });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(setOverride).not.toHaveBeenCalled();
  });
});
