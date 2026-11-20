import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSystemScrollToTopBridge,
  onPageScrollToTop,
  scrollPageToTop,
} from "./scroll-to-top";

/** 造一个带指定 scrollTop 的滚动容器，并记录 scrollTo 调用 */
function makeScrollContainer(initialTop: number) {
  const el = document.createElement("div");
  el.setAttribute("data-page-scroll", "");
  let top = initialTop;
  Object.defineProperty(el, "scrollTop", {
    get: () => top,
    set: (v: number) => {
      top = v;
    },
    configurable: true,
  });
  const scrollTo = vi.fn((opts: ScrollToOptions) => {
    top = opts.top ?? 0;
  });
  el.scrollTo = scrollTo as unknown as typeof el.scrollTo;
  document.body.appendChild(el);
  return { el, scrollTo, getTop: () => top };
}

describe("scrollPageToTop", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("把所有带 data-page-scroll 且已滚动的容器归零", () => {
    const a = makeScrollContainer(800);
    const b = makeScrollContainer(120);

    expect(scrollPageToTop("auto")).toBe(true);
    expect(a.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    expect(b.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    expect(a.getTop()).toBe(0);
    expect(b.getTop()).toBe(0);
  });

  it("已在顶部的容器不调用 scrollTo", () => {
    const a = makeScrollContainer(0);

    expect(scrollPageToTop()).toBe(false);
    expect(a.scrollTo).not.toHaveBeenCalled();
  });

  it("未标记的容器不受影响", () => {
    const el = document.createElement("div");
    let top = 300;
    Object.defineProperty(el, "scrollTop", {
      get: () => top,
      set: (v: number) => {
        top = v;
      },
      configurable: true,
    });
    const scrollTo = vi.fn();
    el.scrollTo = scrollTo as unknown as typeof el.scrollTo;
    document.body.appendChild(el);

    scrollPageToTop();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(top).toBe(300);
  });
});

describe("scrollPageToTop 取消滚动惯性", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("归零后临时锁住 overflowY，到点自动恢复", () => {
    const a = makeScrollContainer(800);

    scrollPageToTop("auto");
    expect(a.el.style.overflowY).toBe("hidden");

    vi.advanceTimersByTime(999);
    expect(a.el.style.overflowY).toBe("hidden");

    vi.advanceTimersByTime(1);
    expect(a.el.style.overflowY).toBe("");
  });

  it("用户在容器上按下时立刻解锁，避免列表被锁住", () => {
    const a = makeScrollContainer(800);

    scrollPageToTop();
    expect(a.el.style.overflowY).toBe("hidden");

    a.el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(a.el.style.overflowY).toBe("");
  });

  it("锁定期内再次回顶只延长计时，不会污染原始 overflowY", () => {
    const a = makeScrollContainer(800);
    a.el.style.overflowY = "auto";

    scrollPageToTop();
    vi.advanceTimersByTime(600);
    // 模拟惯性还没结束、位移又被推了回去
    a.el.scrollTop = 300;
    scrollPageToTop();

    vi.advanceTimersByTime(999);
    expect(a.el.style.overflowY).toBe("hidden");

    vi.advanceTimersByTime(1);
    expect(a.el.style.overflowY).toBe("auto");
  });

  it("smooth 滚动不锁 overflowY", () => {
    const a = makeScrollContainer(800);

    scrollPageToTop("smooth");
    expect(a.el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(a.el.style.overflowY).toBe("");
  });

  it("回顶前先通知订阅方，此时还能读到旧的 scrollTop", () => {
    const container = makeScrollContainer(720);
    let seen: number | null = null;

    const off = onPageScrollToTop(() => {
      seen = container.getTop();
    });

    scrollPageToTop();

    expect(seen).toBe(720);
    expect(container.getTop()).toBe(0);

    // 已经在顶部时不会再通知
    let notified = 0;
    const off2 = onPageScrollToTop(() => {
      notified += 1;
    });
    scrollPageToTop();
    expect(notified).toBe(0);

    off();
    off2();
  });
});

describe("installSystemScrollToTopBridge", () => {
  const originalScrollTo = window.scrollTo;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
    document.body.innerHTML = "";
  });

  it("收到系统的 window.scrollTo(0,0) 时把内层容器一起归零", () => {
    const container = makeScrollContainer(900);
    window.scrollTo = vi.fn();
    const remove = installSystemScrollToTopBridge();

    // 系统 loadUrl 注入的就是这个精确调用
    window.scrollTo(0, 0);

    expect(container.getTop()).toBe(0);
    remove();
  });

  it("非 (0,0) 的调用不触发", () => {
    const container = makeScrollContainer(900);
    window.scrollTo = vi.fn();
    const remove = installSystemScrollToTopBridge();

    window.scrollTo(0, 120);

    expect(container.getTop()).toBe(900);
    remove();
  });

  it("卸载后恢复原始 window.scrollTo", () => {
    const stub = vi.fn();
    window.scrollTo = stub;
    const remove = installSystemScrollToTopBridge();
    expect(window.scrollTo).not.toBe(stub);

    remove();
    expect(window.scrollTo).toBe(stub);
  });
});
