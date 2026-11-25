import { createContext, useContext } from "react";

/** 根级横向滑动链顺序（与底部 TabBar 一致） */
export const ROOT_TAB_ORDER = [
  "/search",
  "/favorites",
  "/mine",
  "/settings",
] as const;

export type RootTabPath = (typeof ROOT_TAB_ORDER)[number];
export type RootTabId = "search" | "favorites" | "mine" | "settings";
export type RootEdgeSide = "start" | "end";

export const ROOT_TAB_TO_PATH: Record<RootTabId, RootTabPath> = {
  search: "/search",
  favorites: "/favorites",
  mine: "/mine",
  settings: "/settings",
};

export type RootTabAligner = {
  /** 滑动露出相邻根页面前，对齐到该页靠近当前页的一端（start=首个子Tab，end=末尾子Tab） */
  previewAlign: (edge: RootEdgeSide) => void;
  /** 拖动取消回弹后恢复原状 */
  cancelAlign: () => void;
  /** 确认切换完成后提交新位置 */
  commitAlign: () => void;
};

export interface RootPagerContextValue {
  /** 当前激活的根路由路径（非根路由时为 null） */
  activePath: RootTabPath | null;
  /** 该方向是否存在相邻的根页面（链头右滑 / 链尾左滑返回 false） */
  canSlideEdge: (fromTab: RootTabId, dir: "prev" | "next") => boolean;
  /** 读取当前根视口宽度 */
  getViewportWidth: () => number;
  /**
   * 准备边缘相邻根页面：
   * 1. 确保目标页已挂载并临时显示；
   * 2. 对齐目标页子 Tab 到靠近当前页的那一端。
   */
  prepareEdgeNeighbor: (
    fromTab: RootTabId,
    dir: "prev" | "next"
  ) => RootTabPath | null;
  /** 边缘拖动中：将根轨道相对当前根页基准位平移 deltaX（px） */
  dragRootBy: (deltaX: number) => void;
  /** 读取根轨道当前相对当前根页基准位的偏移（用于中断进行中的切页动画） */
  getRootDragOffset: () => number;
  /** 取消边缘拖动，回归当前根页 */
  cancelRootDrag: (animate: boolean) => void;
  /** 确认切换到相邻根页 */
  commitRootEdge: (fromTab: RootTabId, dir: "prev" | "next") => void;
  /** 注册页面子 Tab 对齐器（发现页 / 歌单页用于首尾对齐） */
  registerAligner: (path: RootTabPath, aligner: RootTabAligner) => () => void;
}

export const RootPagerContext = createContext<RootPagerContextValue | null>(
  null
);

export function useRootPager(): RootPagerContextValue | null {
  return useContext(RootPagerContext);
}

/** 计算从 fromTab 往 dir 方向滑动时的目标根路由；越界返回 null */
export function resolveRootNeighborPath(
  fromTab: RootTabId,
  dir: "prev" | "next"
): RootTabPath | null {
  const fromPath = ROOT_TAB_TO_PATH[fromTab];
  const idx = ROOT_TAB_ORDER.indexOf(fromPath);
  if (idx === -1) return null;
  const nextIdx = dir === "next" ? idx + 1 : idx - 1;
  return ROOT_TAB_ORDER[nextIdx] ?? null;
}

/** 判断指定元素当前是否位于已激活的根页面内（未被保活隐藏） */
export function useIsRootTabActive(tab: RootTabId): boolean {
  const pager = useRootPager();
  if (!pager) return true;
  return pager.activePath === ROOT_TAB_TO_PATH[tab];
}
