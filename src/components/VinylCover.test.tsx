import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VinylCover } from "./VinylCover";
import { beginArmCut, cancelArmCut, registerArm } from "@/lib/vinyl-arm";

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
    cancelArmCut();
    registerArm(null);
    container?.remove();
    root = undefined;
    container = undefined;
    vi.useRealTimers();
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

  it("中心封面直径约为盘面 68%，与网易云实拍比例一致", async () => {
    await render(true);
    const label = document.body.querySelector(
      '[data-testid="vinyl-label"]'
    ) as HTMLDivElement;
    expect(label.className).toContain("inset-[16%]"); // 直径 68%，黑圈每边 16%
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

  it("唱臂播放时落到盘面、暂停时抬起，角度只写在 rotate 单一通道", async () => {
    await render(true);
    const arm = () =>
      document.body.querySelector(
        '[data-testid="vinyl-tonearm"]'
      ) as SVGElement;

    // 播放态绝对角 -4°（绕基座轴心）；transform 不再承载角度
    expect(arm().style.rotate).toBe("-4deg");
    expect(arm().style.transform).toBe("");
    expect(arm().style.willChange).toBe("rotate");
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
    expect(arm().style.rotate).toBe("-40deg");
    expect(arm().style.transform).toBe("");
    // 稳态切换走 rotate 单通道的过渡
    expect(arm().style.transition).toBe("rotate 300ms linear");
  });

  it("切歌连续完成抬臂与落针（恒定角速度，不在半空顿住等网络），根部轴心始终固定", async () => {
    vi.useFakeTimers();
    await render(true);
    const arm = () =>
      document.body.querySelector(
        '[data-testid="vinyl-tonearm"]'
      ) as SVGElement;
    // 轴心与基座 div 的中心重合：left 50% / top -9% + 半高 3% = -6%
    expect(arm().style.transformOrigin).toBe("50% -6%");

    act(() => beginArmCut());
    // 36° / 0.12°/ms = 300ms 抬臂
    expect(arm().style.rotate).toBe("-40deg");
    expect(arm().style.transition).toBe("rotate 300ms linear");

    // 到达抬臂终点后无需等音源/封面信号，立即以同速匀速落回播放位
    act(() => vi.advanceTimersByTime(300));
    expect(arm().style.rotate).toBe("-4deg");
    expect(arm().style.transition).toBe("rotate 300ms linear");
    expect(arm().style.transform).toBe("");
    // 基座是独立节点、不参与旋转，所以根部视觉上完全不动
    const base = document.body.querySelector(
      "[data-vinyl-control]"
    ) as HTMLElement;
    expect(base.style.transform).toBe("");
  });

  it("支持 WAAPI 时用单条连续线性动画完成抬臂与落针，零定时器停顿且中途状态翻转不打断", async () => {
    const createdAnim = {
      cancel: vi.fn(),
      onfinish: null as (() => void) | null,
      oncancel: null as (() => void) | null,
    };
    const animate = vi.fn(() => createdAnim);
    (SVGElement.prototype as unknown as { animate: unknown }).animate = animate;

    try {
      await render(true);
      const arm = () =>
        document.body.querySelector(
          '[data-testid="vinyl-tonearm"]'
        ) as SVGElement;

      act(() => beginArmCut());
      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate).toHaveBeenCalledWith(
        [
          { rotate: "-4deg" },
          { rotate: "-40deg", offset: 0.5 },
          { rotate: "-4deg" },
        ],
        { duration: 600, easing: "linear" }
      );
      // 提前将 inline 设为终点 -4deg，无 fill:forwards 交接闪烁
      expect(arm().style.rotate).toBe("-4deg");
      expect(arm().style.transition).toBe("none");

      // 动画进行中 isPlaying 翻转，不能把唱臂取消或重开
      await act(async () => {
        root?.render(
          <VinylCover src="https://example.com/cover.jpg" isPlaying={false} />
        );
      });
      expect(createdAnim.cancel).not.toHaveBeenCalled();

      act(() => createdAnim.onfinish?.());
      expect(arm().style.rotate).toBe("-40deg");
    } finally {
      delete (SVGElement.prototype as unknown as { animate?: unknown }).animate;
    }
  });

  it("横滑剩余角度按同角速度折算抬臂时长，保证整段匀速", async () => {
    const animate = vi.fn(() => ({
      cancel: vi.fn(),
      onfinish: null,
      oncancel: null,
    }));
    (SVGElement.prototype as unknown as { animate: unknown }).animate = animate;

    try {
      await render(true);
      const arm = () =>
        document.body.querySelector(
          '[data-testid="vinyl-tonearm"]'
        ) as SVGElement;
      // 模拟横滑松手时唱臂位于 -22°（距 -40° 仅剩 18° = 150ms，回落 36° = 300ms，总 450ms）
      arm().style.rotate = "-22deg";

      act(() => beginArmCut());
      expect(animate).toHaveBeenCalledWith(
        [
          { rotate: "-22deg" },
          { rotate: "-40deg", offset: 150 / 450 },
          { rotate: "-4deg" },
        ],
        { duration: 450, easing: "linear" }
      );
    } finally {
      delete (SVGElement.prototype as unknown as { animate?: unknown }).animate;
    }
  });

  it("暂停态切歌直接从 -40° 匀速落到 -4°（300ms）", async () => {
    const createdAnim = {
      cancel: vi.fn(),
      onfinish: null as (() => void) | null,
    };
    const animate = vi.fn(() => createdAnim);
    (SVGElement.prototype as unknown as { animate: unknown }).animate = animate;

    try {
      await render(false);
      const arm = () =>
        document.body.querySelector(
          '[data-testid="vinyl-tonearm"]'
        ) as SVGElement;
      expect(arm().style.rotate).toBe("-40deg");

      act(() => beginArmCut({ hasCover: false }));
      expect(animate).toHaveBeenCalledWith(
        [{ rotate: "-40deg" }, { rotate: "-4deg" }],
        { duration: 300, easing: "linear" }
      );
      expect(arm().style.rotate).toBe("-4deg");
      act(() => createdAnim.onfinish?.());
    } finally {
      delete (SVGElement.prototype as unknown as { animate?: unknown }).animate;
    }
  });
});
