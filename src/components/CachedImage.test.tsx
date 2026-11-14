import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CachedImage } from "./CachedImage";

const SRC = "https://p1.music.126.net/reload-fixture/cover.jpg";

describe("CachedImage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom 没有实现 img.decode()，按规范补一个立即 resolve 的版本
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      writable: true,
      value: () => Promise.resolve(),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
    vi.restoreAllMocks();
  });

  const imgOf = () =>
    container?.querySelector("img") as HTMLImageElement | null;
  const shimmerOf = () =>
    container?.querySelector(".skeleton-shimmer") as HTMLDivElement | null;

  it("首次加载先隐藏，解码完成后才显示", async () => {
    root = createRoot(container!);
    act(() => root!.render(<CachedImage src={SRC} alt="cover" />));

    expect(imgOf()?.className).toContain("opacity-0");
    expect(shimmerOf()?.className).toContain("opacity-100");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(imgOf()?.className).toContain("opacity-100");
    expect(shimmerOf()?.className).toContain("is-idle");
  });

  it("同一个 URL 重新挂载时直接显示，不再重播加载动画", async () => {
    root = createRoot(container!);
    act(() => root!.render(<CachedImage src={SRC} alt="cover" />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => root!.unmount());

    // 模拟页面重建：节点全新，但图片本次运行已经解码过
    container!.innerHTML = "";
    root = createRoot(container!);
    act(() => root!.render(<CachedImage src={SRC} alt="cover" />));

    expect(imgOf()?.className).toContain("opacity-100");
    expect(shimmerOf()?.className).toContain("is-idle");
  });
});
