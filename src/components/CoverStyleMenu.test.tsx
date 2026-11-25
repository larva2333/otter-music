import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CoverStyleMenu } from "./CoverStyleMenu";
import { useExitLayerStore } from "@/hooks/useExitLayer";
import { useMusicStore } from "@/store/music-store";

const nativeState = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/api/config", () => ({
  get IS_NATIVE() {
    return nativeState.value;
  },
}));
vi.mock("@/plugins/local-music", () => ({
  LocalMusicPlugin: {
    pickBackgroundImage: vi.fn(async () => ({
      success: true,
      dataUrl: "data:image/jpeg;base64,AA",
    })),
  },
}));

// 裁剪器在本文件里只关心「确定」这一步；真实实现依赖 Canvas/手势，
// 这里替换成一个直接回调的按钮，专测裁剪完的收尾流程。
vi.mock("./BackgroundImageCropper", async () => {
  const { createElement } = await import("react");
  return {
    BackgroundImageCropper: ({
      onConfirm,
    }: {
      onConfirm: (url: string) => void;
    }) =>
      createElement(
        "button",
        {
          type: "button",
          onClick: () => onConfirm("data:image/jpeg;base64,BB"),
        },
        "裁剪确定"
      ),
  };
});

vi.mock("@/lib/storage-adapter", () => ({
  idbStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

describe("CoverStyleMenu", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let onOpenChange: (open: boolean) => void;
  let onPreview: () => void;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    nativeState.value = false;
    useExitLayerStore.setState({ stack: [] });
    useMusicStore.setState({
      coverStyle: "original",
      fullScreenBackgroundMode: "theme",
      customBackgroundImage: null,
      vinylColor: "#0A0A0A",
    });
    onOpenChange = vi.fn();
    onPreview = vi.fn();
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  const render = async (open: boolean) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <CoverStyleMenu
          open={open}
          onOpenChange={onOpenChange}
          onPreview={onPreview}
        />
      );
    });
  };

  const findButton = (text: string) =>
    Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes(text)
    );

  it("列出两个风格，切换后写入 store 并更新选中态", async () => {
    await render(true);

    expect(document.body.textContent).toContain("修改播放风格");
    expect(findButton("原始")).toBeTruthy();
    expect(findButton("黑胶唱片")?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      findButton("黑胶唱片")?.click();
    });

    expect(useMusicStore.getState().coverStyle).toBe("vinyl");
    expect(findButton("黑胶唱片")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("背景可在渐变/模糊/深色间切换，默认是渐变", async () => {
    await render(true);

    expect(useMusicStore.getState().fullScreenBackgroundMode).toBe("theme");
    await act(async () => {
      findButton("模糊")?.click();
    });
    expect(useMusicStore.getState().fullScreenBackgroundMode).toBe("cover");

    await act(async () => {
      findButton("深色")?.click();
    });
    expect(useMusicStore.getState().fullScreenBackgroundMode).toBe("texture");
  });

  it("黑胶颜色可改成透明和预设色", async () => {
    useMusicStore.setState({ coverStyle: "vinyl" });
    await render(true);

    await act(async () => {
      (
        document.body.querySelector(
          'button[aria-label="透明"]'
        ) as HTMLButtonElement
      ).click();
    });
    expect(useMusicStore.getState().vinylColor).toBe("transparent");

    await act(async () => {
      (
        document.body.querySelector(
          'button[aria-label="蓝"]'
        ) as HTMLButtonElement
      ).click();
    });
    expect(useMusicStore.getState().vinylColor).toBe("#3B82F6");
  });

  it("点「我的照片」触发选图", async () => {
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    await render(true);

    await act(async () => {
      findButton("我的照片")?.click();
    });

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("裁剪确定后解码完再应用照片并关闭风格面板，不留黑遮罩", async () => {
    // jsdom 不会真的解码 dataUrl，给预解码一个立即 onload 的替身
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      }
    );
    try {
      nativeState.value = true;
      await render(true);

      await act(async () => {
        findButton("我的照片")?.click();
      });
      expect(findButton("裁剪确定")).toBeTruthy();

      await act(async () => {
        findButton("裁剪确定")?.click();
      });

      expect(useMusicStore.getState().customBackgroundImage).toBe(
        "data:image/jpeg;base64,BB"
      );
      expect(useMusicStore.getState().fullScreenBackgroundMode).toBe("photo");
      // 面板那层 bg-black/60 遮罩必须一起撤掉，否则照片看起来是黑的
      expect(onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("关闭按钮关闭面板", async () => {
    await render(true);

    await act(async () => {
      (
        document.body.querySelector(
          'button[aria-label="关闭"]'
        ) as HTMLButtonElement
      ).click();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("预览入口先关闭面板再请求大图预览", async () => {
    await render(true);

    await act(async () => {
      findButton("预览封面大图")?.click();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("打开时占住退出栈，返回键先关面板", async () => {
    await render(true);

    expect(useExitLayerStore.getState().stack).toHaveLength(1);
    await act(async () => {
      useExitLayerStore.getState().handleExit();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("关闭面板时从退出栈移除", async () => {
    await render(true);
    expect(useExitLayerStore.getState().stack).toHaveLength(1);

    await act(async () => {
      root?.render(
        <CoverStyleMenu
          open={false}
          onOpenChange={onOpenChange}
          onPreview={onPreview}
        />
      );
    });

    expect(useExitLayerStore.getState().stack).toHaveLength(0);
  });
});
