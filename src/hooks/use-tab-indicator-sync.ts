import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export interface TabIndicatorRect {
  left: number;
  top: number;
  width: number;
}

const INDICATOR_SETTLE_MS = 280;
const INDICATOR_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const INDICATOR_TRANSITION = `transform ${INDICATOR_SETTLE_MS}ms ${INDICATOR_EASING}, width ${INDICATOR_SETTLE_MS}ms ${INDICATOR_EASING}`;
const MIRROR_TRANSITION = `transform ${INDICATOR_SETTLE_MS}ms ${INDICATOR_EASING}`;

/**
 * 将顶部 Tab 滑块与页面横向分页轨道绑定：
 * - 提前缓存全部按钮的布局尺寸，拖动和动画期间 0 次重排读取；
 * - 滑块使用「overflow-hidden 视口 + 内部反向平移镜像文字层」的双层反色裁剪方案：
 *   滑块永远位于底层按钮灰底之上（绝不发灰），且被滑块覆盖到的文字实时精准反色，
 *   滑离时立即露回清晰的常规字色；
 * - 拖动中随轨道进度 1:1 插值跟手平移，松手与页面同曲线 280ms 同步落位。
 */
export function useTabIndicatorSync(options: {
  barRef: RefObject<HTMLElement | null>;
  activeIndex: number;
  ids: readonly string[];
  /** 如何从容器内查找第 i 个按钮 */
  attrName: string;
  /** 切换后是否自动将该按钮居中滚入横向滚动栏 */
  autoScrollBar?: boolean;
}) {
  const { barRef, activeIndex, ids, attrName, autoScrollBar = false } = options;
  const indicatorRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<(TabIndicatorRect | null)[]>([]);
  const settlingUntilRef = useRef(0);
  const hasMeasuredRef = useRef(false);
  const [readyRect, setReadyRect] = useState<TabIndicatorRect | null>(null);
  const [barWidth, setBarWidth] = useState<number>(0);

  const idsRef = useRef(ids);
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    idsRef.current = ids;
    activeIndexRef.current = activeIndex;
  }, [ids, activeIndex]);

  const scrollButtonIntoView = useCallback(
    (rect: TabIndicatorRect, smooth: boolean) => {
      if (!autoScrollBar) return;
      const bar = barRef.current;
      if (!bar) return;
      const targetLeft = Math.max(
        0,
        rect.left - (bar.clientWidth - rect.width) / 2
      );
      if (smooth && typeof bar.scrollTo === "function") {
        bar.scrollTo({ left: targetLeft, behavior: "smooth" });
      } else {
        bar.scrollLeft = targetLeft;
      }
    },
    [autoScrollBar, barRef]
  );

  const applyRect = useCallback((rect: TabIndicatorRect, animate: boolean) => {
    const node = indicatorRef.current;
    if (node) {
      node.style.transition = animate ? INDICATOR_TRANSITION : "none";
      node.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
      node.style.width = `${rect.width}px`;
    }
    const mirror = mirrorRef.current;
    if (mirror) {
      mirror.style.transition = animate ? MIRROR_TRANSITION : "none";
      mirror.style.transform = `translate3d(${-rect.left}px, ${-rect.top}px, 0)`;
    }
  }, []);

  const measureAll = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    const rects = idsRef.current.map((id) => {
      const btn = bar.querySelector<HTMLElement>(`[${attrName}="${id}"]`);
      if (!btn || btn.offsetWidth === 0) return null;
      return {
        left: btn.offsetLeft,
        top: btn.offsetTop,
        width: btn.offsetWidth,
      };
    });
    metricsRef.current = rects;
    if (bar.scrollWidth > 0) {
      setBarWidth((prev) =>
        prev === bar.scrollWidth ? prev : bar.scrollWidth
      );
    }
    const currentRect = rects[activeIndexRef.current] ?? null;
    if (!currentRect) return;
    const shouldAnimate = hasMeasuredRef.current;
    hasMeasuredRef.current = true;
    setReadyRect((prev) => prev ?? currentRect);
    if (Date.now() >= settlingUntilRef.current) {
      applyRect(currentRect, shouldAnimate);
      scrollButtonIntoView(currentRect, false);
    }
  }, [attrName, barRef, applyRect, scrollButtonIntoView]);

  useEffect(() => {
    const raf = requestAnimationFrame(measureAll);
    window.addEventListener("resize", measureAll);
    const bar = barRef.current;
    const ro =
      bar && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measureAll)
        : null;
    if (bar) ro?.observe(bar);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measureAll);
      ro?.disconnect();
    };
  }, [measureAll, barRef, ids, activeIndex]);

  // 拖动过程中实时插值平移指示器与反向镜像文字层（直接写 DOM，0 React re-render）
  const handleTrackDrag = useCallback((index: number, ratio: number) => {
    const node = indicatorRef.current;
    const mirror = mirrorRef.current;
    const rects = metricsRef.current;
    const from = rects[index];
    if (!node || !from) return;

    const dir = ratio >= 0 ? 1 : -1;
    const to = rects[index + dir];
    const t = to ? Math.min(1, Math.abs(ratio)) : 0;
    const left = to ? from.left + (to.left - from.left) * t : from.left;
    const width = to ? from.width + (to.width - from.width) * t : from.width;

    settlingUntilRef.current = 0;
    node.style.transition = "none";
    node.style.transform = `translate3d(${left}px, ${from.top}px, 0)`;
    if (Math.abs(width - from.width) > 0.5) {
      node.style.width = `${width}px`;
    }
    if (mirror) {
      mirror.style.transition = "none";
      mirror.style.transform = `translate3d(${-left}px, ${-from.top}px, 0)`;
    }
  }, []);

  // 松手瞬间与页面轨道同步以相同 280ms 缓动滑入目标位
  const handleTrackSettle = useCallback(
    (targetIndex: number, animate: boolean) => {
      const targetRect = metricsRef.current[targetIndex];
      if (!targetRect) return;
      settlingUntilRef.current = animate ? Date.now() + INDICATOR_SETTLE_MS : 0;
      applyRect(targetRect, animate);
      if (animate) scrollButtonIntoView(targetRect, true);
    },
    [applyRect, scrollButtonIntoView]
  );

  return {
    indicatorRef,
    mirrorRef,
    barWidth,
    hasIndicator: readyRect !== null,
    initialRect: readyRect,
    handleTrackDrag,
    handleTrackSettle,
  };
}
