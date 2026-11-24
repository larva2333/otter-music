import { useEffect, useLayoutEffect } from "react";

/**
 * 二级页返回时恢复列表位置。
 *
 * 应用里所有可滚动内容都挂在 `[data-page-scroll]` 上（外层 MusicLayout 一层，
 * 设置页 / 歌单详情 / 搜索页各自还有一层内层滚动区）。这些容器会随着路由切换
 * 重新挂载或内容变短，`scrollTop` 自然被夹回 0 —— 于是从「回收站」返回设置页、
 * 从歌曲详情返回列表，都会跳回顶部。
 *
 * 这里按「pathname + 容器在页面里的出现顺序」记账：
 * - 滚动时持续记录（rAF 合并，避免每一帧都写 Map）；
 * - 路由变化后在 POP（返回/前进）时恢复，底部 tab 的 PUSH 可通过 preserveOnPush 也恢复；
 *   PUSH 进入二级页仍然从顶部开始；
 * - 内容异步加载时容器可能还不够高，恢复会连续补几帧，直到真的滚到目标位置。
 */

const positions = new Map<string, number>();

function scrollers(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  // 跳过被隐藏（display:none）的容器：歌单页的四个 type 面板是常驻的，
  // 隐藏面板的 scrollTop 恒读 0，混进来会把「第几个容器」的记账错位
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-page-scroll]")
  ).filter((el) => el.getClientRects().length > 0);
}

function keyOf(pathname: string, index: number) {
  return `${pathname}#${index}`;
}

/** 直接记一次当前位置（清缓存、主动复位等场景用） */
export function rememberScroll(pathname: string) {
  scrollers().forEach((el, index) => {
    positions.set(keyOf(pathname, index), el.scrollTop);
  });
}

export function clearRememberedScroll(pathname?: string) {
  if (pathname === undefined) {
    positions.clear();
    return;
  }
  for (const key of positions.keys()) {
    if (key.startsWith(`${pathname}#`)) positions.delete(key);
  }
}

export function useScrollRestoration(
  pathname: string,
  navigationType: "POP" | "PUSH" | "REPLACE",
  preserveOnPush = false
) {
  // 记录：capture 阶段监听 document，内层滚动容器的事件也会冒到这里
  useEffect(() => {
    let frame = 0;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        !target.hasAttribute("data-page-scroll")
      ) {
        return;
      }
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const index = scrollers().indexOf(target);
        if (index >= 0) positions.set(keyOf(pathname, index), target.scrollTop);
      });
    };

    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pathname]);

  useLayoutEffect(() => {
    // 底部 tab 虽然通常是 PUSH，但页面本身保活，位置也应该保留
    const restore = navigationType === "POP" || preserveOnPush;

    let cancelled = false;
    let frames = 0;
    let raf = 0;

    // 用户已经动手了就别再抢滚动位置
    const stop = () => {
      cancelled = true;
    };
    window.addEventListener("pointerdown", stop, true);
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("wheel", stop, { passive: true });

    const apply = () => {
      if (cancelled) return;

      let pending = false;
      scrollers().forEach((el, index) => {
        const target = restore
          ? (positions.get(keyOf(pathname, index)) ?? 0)
          : 0;
        el.scrollTop = target;
        // 内容还没撑开到目标高度时会被夹住，等布局长起来再补
        if (el.scrollTop !== target) pending = true;
      });

      if (pending && ++frames < 30) {
        raf = requestAnimationFrame(apply);
      } else {
        cleanup();
      }
    };

    const cleanup = () => {
      window.removeEventListener("pointerdown", stop, true);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("wheel", stop);
    };

    raf = requestAnimationFrame(apply);

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      cleanup();
    };
  }, [pathname, navigationType, preserveOnPush]);
}
