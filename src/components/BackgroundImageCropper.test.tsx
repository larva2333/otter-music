import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BackgroundImageCropper } from "./BackgroundImageCropper";

vi.mock("@/hooks/useExitLayer", () => ({
  useExitLayer: () => ({
    push: vi.fn(() => "exit-layer-id"),
    pop: vi.fn(),
  }),
}));

describe("BackgroundImageCropper", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  const frameSize = { w: 0, h: 0 };
  // jsdom 把 clientWidth 定义在 Element.prototype 上；这里在 HTMLElement.prototype
  // 上临时遮蔽它，测试结束必须删掉自己的属性，否则会污染同一 worker 里的其它用例
  const widthDescriptor =
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth") ??
    Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
  const heightDescriptor =
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight") ??
    Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
  const widthOnHTMLElement = Object.prototype.hasOwnProperty.call(
    HTMLElement.prototype,
    "clientWidth"
  );
  const heightOnHTMLElement = Object.prototype.hasOwnProperty.call(
    HTMLElement.prototype,
    "clientHeight"
  );
  const naturalWidthDescriptor = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "naturalWidth"
  );
  const naturalHeightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "naturalHeight"
  );

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    frameSize.w = 0;
    frameSize.h = 0;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => frameSize.w,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => frameSize.h,
    });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", {
      configurable: true,
      get: () => 2000,
    });
    window.innerWidth = 400;
    window.innerHeight = 800;
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    if (widthOnHTMLElement && widthDescriptor)
      Object.defineProperty(
        HTMLElement.prototype,
        "clientWidth",
        widthDescriptor
      );
    else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    if (heightOnHTMLElement && heightDescriptor)
      Object.defineProperty(
        HTMLElement.prototype,
        "clientHeight",
        heightDescriptor
      );
    else
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    if (naturalWidthDescriptor)
      Object.defineProperty(
        HTMLImageElement.prototype,
        "naturalWidth",
        naturalWidthDescriptor
      );
    else
      delete (HTMLImageElement.prototype as { naturalWidth?: number })
        .naturalWidth;
    if (naturalHeightDescriptor)
      Object.defineProperty(
        HTMLImageElement.prototype,
        "naturalHeight",
        naturalHeightDescriptor
      );
    else
      delete (HTMLImageElement.prototype as { naturalHeight?: number })
        .naturalHeight;
    vi.restoreAllMocks();
  });

  it("图片先 load、裁剪框还没量到尺寸时不画出 scale(0) 的黑屏", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <BackgroundImageCropper
          src="data:image/jpeg;base64,AA"
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      );
    });

    const img = document.body.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();

    // 模拟 dataUrl 命中缓存、图片比布局更早完成
    await act(async () => {
      img.dispatchEvent(new Event("load"));
    });
    expect(img.style.transform).not.toContain("scale(0)");
    expect(document.body.textContent).toContain("加载中");

    // 布局完成后由尺寸变化再次触发初始化，此时应直接显示正确缩放
    window.innerWidth = 500;
    window.innerHeight = 1000;
    frameSize.w = 360;
    frameSize.h = 720;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    // 布局尺寸被压到裁剪框大小（1000×2000 的图 → 360×720），
    // 视觉缩放叠加在 baseScale 上，最终仍是 0.36 倍
    expect(img.style.width).toBe("360px");
    expect(img.style.height).toBe("720px");
    expect(img.style.transform).toContain("scale(1)");
    expect(document.body.textContent).not.toContain("加载中");
  });
});
