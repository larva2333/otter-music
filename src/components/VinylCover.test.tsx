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

  it("切歌受控状态 away 只写稳态角，让位量走增量通道，根部轴心始终固定", async () => {
    await render(true);
    const arm = () =>
      document.body.querySelector(
        '[data-testid="vinyl-tonearm"]'
      ) as SVGElement;
    // 轴心与基座 div 的中心重合：left 50% / top -9% + 半高 3% = -6%
    expect(arm().style.transformOrigin).toBe("50% -6%");

    await act(async () => {
      root?.render(
        <VinylCover
          src="https://example.com/cover.jpg"
          isPlaying={true}
          armState="away"
        />
      );
    });
    // 关键：away 不写 -62° 到 transform 上。写了的话 350ms transition 会先
    // 往让位角滑一段，再被 WAAPI 动画接管 —— 视觉上闪一下。
    // 稳态角保持播放位，让位量（-62 - (-4) = -58）走在 style.rotate 增量上。
    expect(arm().style.transform).toBe("rotate(-4deg)");
    expect(arm().style.rotate).toBe("-58deg");
    expect(arm().style.transformOrigin).toBe("50% -6%");
    // 基座是独立节点、不参与旋转，所以根部视觉上完全不动
    const base = document.body.querySelector(
      "[data-vinyl-control]"
    ) as HTMLElement;
    expect(base.style.transform).toBe("");

    await act(async () => {
      root?.render(
        <VinylCover
          src="https://example.com/cover.jpg"
          isPlaying={true}
          armState="playing"
        />
      );
    });
    // 新歌切入后唱臂落回沟槽，增量写回 0
    expect(arm().style.transform).toBe("rotate(-4deg)");
    expect(arm().style.rotate).toBe("0deg");
    expect(arm().style.transformOrigin).toBe("50% -6%");
  });

  it("away 时走 WAAPI：760ms 五帧、过冲到 -67 再落回增量 0", async () => {
    const animate = vi.fn(() => ({
      cancel: vi.fn(),
      finished: Promise.resolve(),
    }));
    // jsdom 的 SVGElement 没有 Web Animations API，手动补一个
    (SVGElement.prototype as unknown as { animate: unknown }).animate = animate;

    try {
      await render(true);
      await act(async () => {
        root?.render(
          <VinylCover
            src="https://example.com/cover.jpg"
            isPlaying={true}
            armState="away"
          />
        );
      });

      expect(animate).toHaveBeenCalledTimes(1);
      const [keyframes, options] = animate.mock.calls[0] as unknown as [
        Array<{ rotate: string; offset: number }>,
        { duration: number },
      ];
      expect(options.duration).toBe(760);
      expect(keyframes.map((k) => k.offset)).toEqual([0, 0.33, 0.45, 0.59, 1]);
      // 起手接当前位置 → 过冲（增量 -63，视觉总角 -67，比让位角再多 5 度）
      // → 顶点停留 -58（视觉 -62）→ 增量回 0
      expect(keyframes[0].rotate).toBe("0deg");
      expect(keyframes[1].rotate).toBe("-63deg");
      expect(keyframes[2].rotate).toBe("-58deg");
      expect(keyframes[3].rotate).toBe("-58deg");
      expect(keyframes[4].rotate).toBe("0deg");
    } finally {
      delete (SVGElement.prototype as unknown as { animate?: unknown }).animate;
    }
  });
});
