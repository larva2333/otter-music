import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  consumeSwipeArmCut,
  usePlayerSwipeGestures,
} from "./usePlayerSwipeGestures";
import { cancelArmCut, registerArm } from "@/lib/vinyl-arm";

describe("usePlayerSwipeGestures 播放页手势", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelArmCut();
    registerArm(null);
    vi.useRealTimers();
  });

  const touch = (clientX: number, clientY: number) =>
    ({ touches: [{ clientX, clientY }] }) as unknown as React.TouchEvent;

  const renderGestures = (enabled = true) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onClose = vi.fn();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onSwipeUp = vi.fn();
    const onTap = vi.fn();

    let latest: ReturnType<typeof usePlayerSwipeGestures> | undefined;

    function TestHarness() {
      const gestures = usePlayerSwipeGestures({
        enabled,
        onClose,
        onPrev,
        onNext,
        onSwipeUp,
        onTap,
      });

      useEffect(() => {
        latest = gestures;
      }, [gestures]);

      return null;
    }

    act(() => {
      root.render(<TestHarness />);
    });

    const gesture = (
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      /** 手势耗时：> FLING_DURATION 表示慢速拖动，不再按“甩”判定 */
      duration = 0
    ) =>
      act(() => {
        latest!.handlers.onTouchStart(touch(startX, startY));
        vi.advanceTimersByTime(duration);
        latest!.handlers.onTouchMove(touch(endX, endY));
        latest!.handlers.onTouchEnd();
      });

    return {
      gesture,
      onClose,
      onPrev,
      onNext,
      onSwipeUp,
      onTap,
      /** 模拟一次轻点：按下后原地抬起，不产生位移 */
      tap: () =>
        act(() => {
          latest!.handlers.onTouchStart(touch(300, 300));
          latest!.handlers.onTouchEnd();
        }),
      getLatest: () => latest!,
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  };

  it("左滑看下一首", () => {
    const h = renderGestures();
    h.gesture(200, 300, 100, 305);

    expect(h.onNext).toHaveBeenCalledTimes(1);
    expect(h.onPrev).not.toHaveBeenCalled();
    expect(h.onClose).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("右滑回上一首", () => {
    const h = renderGestures();
    h.gesture(100, 300, 200, 295);

    expect(h.onPrev).toHaveBeenCalledTimes(1);
    expect(h.onNext).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("下滑超过阈值收起播放页", () => {
    const h = renderGestures();
    h.gesture(200, 200, 205, 320);

    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(h.onPrev).not.toHaveBeenCalled();
    expect(h.onNext).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("下滑距离不足时回弹，不关闭", () => {
    const h = renderGestures();
    h.gesture(200, 200, 202, 240, 400);

    expect(h.onClose).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("上滑唤出评论，不触发收起或切歌", () => {
    const h = renderGestures();
    h.gesture(200, 400, 202, 200);

    expect(h.onSwipeUp).toHaveBeenCalledTimes(1);
    expect(h.onClose).not.toHaveBeenCalled();
    expect(h.onPrev).not.toHaveBeenCalled();
    expect(h.onNext).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("上滑距离不足时不唤出评论", () => {
    const h = renderGestures();
    h.gesture(200, 400, 202, 340, 400);

    expect(h.onSwipeUp).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("斜向滑动不会同时命中收起和切歌", () => {
    const h = renderGestures();
    h.gesture(200, 200, 260, 280);

    expect(h.onClose).not.toHaveBeenCalled();
    expect(h.onNext).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("歌词页（enabled=false）不响应滑动", () => {
    const h = renderGestures(false);
    h.gesture(200, 300, 100, 320);

    expect(h.onPrev).not.toHaveBeenCalled();
    expect(h.onNext).not.toHaveBeenCalled();
    expect(h.onClose).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("触发动作的滑动只拦一次 click，窗口过后放行", () => {
    const h = renderGestures();
    h.gesture(200, 300, 100, 305);

    expect(h.getLatest().shouldSuppressClick()).toBe(true);
    // 只拦一次，避免连带吞掉后续正常点击
    expect(h.getLatest().shouldSuppressClick()).toBe(false);

    h.gesture(200, 300, 100, 300);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(h.getLatest().shouldSuppressClick()).toBe(false);
    h.cleanup();
  });

  it("上滑唤出评论后拦一次补发的 click", () => {
    const h = renderGestures();
    h.gesture(200, 400, 202, 200);

    expect(h.getLatest().shouldSuppressClick()).toBe(true);
    h.cleanup();
  });

  it("滑动距离不足时不会吞掉随后的点击", () => {
    const h = renderGestures();
    h.gesture(200, 300, 220, 306);

    expect(h.getLatest().shouldSuppressClick()).toBe(false);
    h.cleanup();
  });

  it("新的一次触摸会清掉上一次残留的抑制标记", () => {
    const h = renderGestures();

    // 第一次切歌设下抑制，但模拟浏览器没有补发 click，标记残留
    h.gesture(200, 300, 100, 305);
    // 用户下一次按下手指，说明上一条手势已经结束，不该再被吞
    act(() => {
      h.getLatest().handlers.onTouchStart(touch(300, 300));
    });

    expect(h.getLatest().shouldSuppressClick()).toBe(false);
    h.cleanup();
  });

  it("拖拽过程中跟手位移不超过上限，松手后归零", () => {
    const h = renderGestures();

    act(() => {
      h.getLatest().handlers.onTouchStart(touch(200, 200));
      h.getLatest().handlers.onTouchMove(touch(200, 600));
    });

    expect(h.getLatest().dragY).toBeGreaterThan(0);
    expect(h.getLatest().dragY).toBeLessThanOrEqual(160);
    expect(h.getLatest().isDragging).toBe(true);

    act(() => {
      h.getLatest().handlers.onTouchEnd();
    });

    expect(h.getLatest().dragY).toBe(0);
    expect(h.getLatest().isDragging).toBe(false);
    h.cleanup();
  });

  it("轻点在 touchend 直接触发，不依赖 click", () => {
    const h = renderGestures();
    h.tap();

    expect(h.onTap).toHaveBeenCalledTimes(1);
    expect(h.onClose).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("轻点回调带上 target，用于区分黑胶与周围空白", () => {
    const h = renderGestures();
    const target = document.createElement("div");

    act(() => {
      h.getLatest().handlers.onTouchStart(touch(300, 300));
      h.getLatest().handlers.onTouchEnd({
        target,
      } as unknown as React.TouchEvent);
    });

    expect(h.onTap).toHaveBeenCalledWith(target);
    h.cleanup();
  });

  it("轻点后浏览器补发的 click 会被拦一次", () => {
    const h = renderGestures();
    h.tap();

    expect(h.getLatest().shouldSuppressClick()).toBe(true);
    expect(h.getLatest().shouldSuppressClick()).toBe(false);
    h.cleanup();
  });

  it("滑动不会误触发轻点", () => {
    const h = renderGestures();
    h.gesture(200, 300, 100, 305);

    expect(h.onTap).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("歌词页（enabled=false）轻点仍能切回封面", () => {
    const h = renderGestures(false);
    h.tap();

    expect(h.onTap).toHaveBeenCalledTimes(1);
    expect(h.onPrev).not.toHaveBeenCalled();
    expect(h.onNext).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("横滑跟手位移随手指方向变化，松手归零", () => {
    const h = renderGestures();

    act(() => {
      h.getLatest().handlers.onTouchStart(touch(300, 300));
      h.getLatest().handlers.onTouchMove(touch(200, 305));
    });

    expect(h.getLatest().isHorizDragging).toBe(true);
    expect(h.getLatest().dragX).toBeLessThan(0);

    act(() => {
      h.getLatest().handlers.onTouchEnd();
    });

    expect(h.getLatest().dragX).toBe(0);
    expect(h.getLatest().isHorizDragging).toBe(false);
    h.cleanup();
  });

  it("左滑切歌后新封面从右侧滑入", () => {
    const h = renderGestures();
    h.gesture(300, 300, 200, 305);

    // 松手瞬间：先瞬移到进场起点（右正方向），此时不能有过渡
    expect(h.getLatest().dragEntryX).toBeGreaterThan(0);
    expect(h.getLatest().slideSnap).toBe(true);

    act(() => {
      vi.advanceTimersByTime(64);
    });

    // 下一帧归零，交给 CSS 过渡滑到位
    expect(h.getLatest().dragEntryX).toBe(0);
    expect(h.getLatest().slideSnap).toBe(false);
    h.cleanup();
  });

  it("右滑切歌后新封面从左侧滑入", () => {
    const h = renderGestures();
    h.gesture(200, 300, 300, 295);

    expect(h.getLatest().dragEntryX).toBeLessThan(0);
    h.cleanup();
  });

  it("横滑距离不足时只有回弹，没有入场动画", () => {
    const h = renderGestures();
    h.gesture(300, 300, 280, 306);

    expect(h.getLatest().dragEntryX).toBe(0);
    expect(h.getLatest().slideSnap).toBe(false);
    h.cleanup();
  });

  it("提供 DOM 目标时横滑直接写样式，不产生每帧 state 更新", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const cover = document.createElement("div");
    const tonearm = document.createElement("div");
    const dragRefs = {
      cover: { current: cover },
      tonearm: { current: tonearm },
    };

    let latest: ReturnType<typeof usePlayerSwipeGestures> | undefined;

    function TestHarness() {
      const gestures = usePlayerSwipeGestures({
        enabled: true,
        onClose: vi.fn(),
        onPrev: vi.fn(),
        onNext: vi.fn(),
        dragRefs,
      });
      useEffect(() => {
        latest = gestures;
      }, [gestures]);
      return null;
    }

    act(() => {
      root.render(<TestHarness />);
    });

    act(() => {
      latest!.handlers.onTouchStart(touch(300, 300));
      latest!.handlers.onTouchMove(touch(200, 305));
    });
    // 跟手期间位移只写 DOM，dragX state 保持 0 —— 整页不会因此重渲染
    expect(latest!.dragX).toBe(0);

    act(() => {
      vi.advanceTimersByTime(20);
    });

    // 封面跟手左移 95px（-100 × 0.95），唱臂反向 +95px 抵消
    expect(cover.style.translate).toBe("-95px");
    expect(tonearm.style.translate).toBe("95px");
    expect(latest!.dragX).toBe(0);

    act(() => root.unmount());
    container.remove();
  });

  const renderArmHarness = () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const cover = document.createElement("div");
    const tonearm = document.createElement("div");
    const arm = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    ) as SVGSVGElement;
    // 真实场景里 VinylCover 会把唱臂初始化在播放位绝对角 -4° 并注册给控制器
    arm.style.rotate = "-4deg";
    registerArm(arm);
    const dragRefs = {
      cover: { current: cover },
      tonearm: { current: tonearm },
      tonearmArm: { current: arm },
    };

    const onNext = vi.fn();
    const onPrev = vi.fn();
    let latest: ReturnType<typeof usePlayerSwipeGestures> | undefined;

    function TestHarness() {
      const gestures = usePlayerSwipeGestures({
        enabled: true,
        onClose: vi.fn(),
        onPrev,
        onNext,
        dragRefs,
      });
      useEffect(() => {
        latest = gestures;
      }, [gestures]);
      return null;
    }

    act(() => {
      root.render(<TestHarness />);
    });

    const drag = (fromX: number, toX: number) => {
      act(() => {
        latest!.handlers.onTouchStart(touch(fromX, 300));
        latest!.handlers.onTouchMove(touch(toX, 305));
      });
    };

    const angle = () => parseFloat(arm.style.rotate || "0");

    return {
      root,
      container,
      arm,
      onNext,
      onPrev,
      latest: () => latest!,
      drag,
      angle,
    };
  };

  it("不论往哪边滑，唱臂都朝逆时针方向（负角度）切割，幅度随距离增大", () => {
    const h = renderArmHarness();

    // 左滑 100px
    h.drag(400, 300);
    const leftAngle = h.angle();
    expect(leftAngle).toBeLessThan(0);

    // 换一次手势：起手会把唱臂放回 0，再右滑 160px
    h.drag(200, 360);
    const rightAngle = h.angle();

    // 右滑同样是逆时针，而且滑得更远、角度更大
    expect(rightAngle).toBeLessThan(0);
    expect(rightAngle).toBeLessThan(leftAngle);

    act(() => h.root.unmount());
    h.container.remove();
  });

  it("切歌时唱臂连续匀速完成抬臂与落针，不在半空干等网络就绪", () => {
    const h = renderArmHarness();

    h.drag(400, 150);
    const releaseAngle = h.angle();
    expect(releaseAngle).toBeLessThan(-4);
    expect(releaseAngle).toBeGreaterThan(-40);

    act(() => h.latest().handlers.onTouchEnd());

    // 松手确认切歌：按剩余角度比例补完抬臂（而非固定慢拖 300ms）
    expect(h.onNext).toHaveBeenCalled();
    expect(h.angle()).toBeCloseTo(-40, 1);

    // 横滑已经自己演完抬臂，标记给播放页跳过它那套补间
    expect(consumeSwipeArmCut()).toBe(true);

    // 约 (40 + releaseAngle) / 0.12 ms 后（≤300ms）立即匀速落回 -4°（无需等待网络事件）
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(h.arm.style.rotate).toBe("-4deg");
    expect(h.arm.style.transition).toBe("rotate 300ms linear");

    act(() => h.root.unmount());
    h.container.remove();
  });

  it("暂停状态下唱臂已在暂停位，横滑不会再往上堆角度", () => {
    const h = renderArmHarness();

    // 暂停时 VinylCover 把唱臂停在绝对角 -40°
    h.arm.style.rotate = "-40deg";

    h.drag(400, 250);
    // 起手就在 -40°，没有可抬的余量，角度不变
    expect(h.angle()).toBe(-40);

    act(() => h.latest().handlers.onTouchEnd());
    // 切歌后直接从 -40° 匀速落回播放位 -4°（300ms）
    expect(h.angle()).toBe(-4);
    expect(h.arm.style.transition).toBe("rotate 300ms linear");

    act(() => h.root.unmount());
    h.container.remove();
  });

  it("滑动距离不足时不留下「横滑切歌」标记", () => {
    consumeSwipeArmCut();

    const h = renderArmHarness();

    h.drag(400, 370);
    act(() => h.latest().handlers.onTouchEnd());

    // 没切成歌：播放页该照常播自己的荡开补间
    expect(consumeSwipeArmCut()).toBe(false);

    act(() => h.root.unmount());
    h.container.remove();
  });

  it("滑动距离不足时唱臂立刻回到播放位", () => {
    const h = renderArmHarness();

    h.drag(400, 370);
    expect(h.angle()).toBeLessThan(0);

    act(() => h.latest().handlers.onTouchEnd());

    expect(h.onNext).not.toHaveBeenCalled();
    // 没切成歌就落回起手的播放位 -4°
    expect(h.arm.style.rotate).toBe("-4deg");

    act(() => h.root.unmount());
    h.container.remove();
  });
});
