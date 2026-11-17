import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VinylCover } from "./VinylCover";

// 只验证黑胶盘面结构与旋转状态，中心封面由 MusicCover 自己覆盖测试
vi.mock("./MusicCover", () => ({
  MusicCover: ({ src }: { src?: string | null }) => (
    <img data-testid="inner-cover" src={src ?? undefined} alt="cover" />
  ),
}));

describe("VinylCover", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  const render = async (isPlaying: boolean, discColor?: string) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <VinylCover
          src="https://example.com/cover.jpg"
          isPlaying={isPlaying}
          discColor={discColor}
        />
      );
    });
  };

  const disc = () =>
    document.body.querySelector('[data-testid="vinyl-disc"]') as HTMLDivElement;

  it("中心渲染封面", async () => {
    await render(true);

    expect(
      document.body
        .querySelector('[data-testid="inner-cover"]')
        ?.getAttribute("src")
    ).toBe("https://example.com/cover.jpg");
  });

  it("播放时旋转，暂停时用 animationPlayState 停住而不是移除动画", async () => {
    await render(true);
    expect(disc().classList.contains("vinyl-spin")).toBe(true);
    expect(disc().style.animationPlayState).toBe("running");

    await act(async () => {
      root?.render(
        <VinylCover src="https://example.com/cover.jpg" isPlaying={false} />
      );
    });

    // 移除动画会让唱片跳回 0°，所以必须保留 class，只改播放状态
    expect(disc().classList.contains("vinyl-spin")).toBe(true);
    expect(disc().style.animationPlayState).toBe("paused");
  });

  it("中心封面约占盘面直径的三分之二（对齐网易）", async () => {
    await render(true);
    const label = document.body.querySelector(
      '[data-testid="vinyl-label"]'
    ) as HTMLDivElement;
    expect(label.className).toContain("inset-[17%]"); // 直径 66%
  });

  it("盘面用传入颜色，transparent 时透出背景；只有唱臂骨架可被轻点识别", async () => {
    await render(false, "#3B82F6");
    const face = () =>
      document.body.querySelector(
        '[data-testid="vinyl-disc-face"]'
      ) as HTMLDivElement;

    expect(face().style.backgroundColor).toBe("rgb(59, 130, 246)");
    // 盘面本身不参与点击判定，避免点唱片就播放/暂停
    expect(face().closest("[data-vinyl-control]")).toBeNull();
    expect(
      document.body
        .querySelector('[data-testid="vinyl-disc"]')
        ?.closest("[data-vinyl-control]")
    ).toBeNull();
    // 命中区：基座、臂管热区、唱头盒体
    expect(
      document.body.querySelectorAll("[data-vinyl-control]").length
    ).toBeGreaterThanOrEqual(3);
    expect(
      document.body.querySelector("[data-testid='vinyl-tonearm-hit']")
    ).toBeTruthy();
    expect(
      document.body
        .querySelector('[data-testid="vinyl-head-body"]')
        ?.closest("[data-vinyl-control]")
    ).toBeTruthy();

    await act(async () => {
      root?.render(
        <VinylCover
          src="https://example.com/cover.jpg"
          isPlaying={false}
          discColor="transparent"
        />
      );
    });
    expect(face().style.backgroundColor).toBe("transparent");
  });

  it("唱头是带两道凹槽的白色方盒，不是细长胶囊", async () => {
    await render(true);
    const body = document.body.querySelector(
      '[data-testid="vinyl-head-body"]'
    ) as SVGRectElement;
    expect(body).toBeTruthy();
    // 宽高接近 1:1 才是网易那种方盒；之前的 8x4 胶囊宽高比 2:1
    const w = Number(body.getAttribute("width"));
    const h = Number(body.getAttribute("height"));
    expect(w / h).toBeLessThan(1.3);
    expect(
      document.body.querySelectorAll('[data-testid="vinyl-head-groove"]')
    ).toHaveLength(2);
  });

  it("唱臂播放时落到盘面、暂停时抬起，走 CSS transition", async () => {
    await render(true);
    const arm = () =>
      document.body.querySelector(
        '[data-testid="vinyl-tonearm"]'
      ) as SVGElement;

    // 播放态整个骨架逆时针偏 4°（绕基座轴心）
    expect(arm().style.transform).toBe("rotate(-4deg)");
    expect(arm().style.transition).toContain("transform 350ms");
    // 两段直线等长（各约14）+ 拐点 Q 小圆角，不是尖角硬折
    const tube = arm().querySelector("path") as SVGPathElement;
    expect(tube.getAttribute("d")).toBe(
      "M 50 -4 L 50 10 Q 50 13 52 15 L 62 25"
    );
    // 唱头顺着臂 45° 搭在沟槽上
    const headGroup = document.body.querySelector(
      '[data-testid="vinyl-head-group"]'
    );
    expect(headGroup?.getAttribute("transform")).toBe(
      "translate(62 25) rotate(45)"
    );

    await act(async () => {
      root?.render(
        <VinylCover src="https://example.com/cover.jpg" isPlaying={false} />
      );
    });
    // 暂停抬到 -40°，唱头完全离开盘面并离盘更远（盘心 50,58 半径 43）
    expect(arm().style.transform).toBe("rotate(-40deg)");
  });
});
