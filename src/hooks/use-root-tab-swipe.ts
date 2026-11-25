import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { resolveBarCategories } from "@/lib/netease/netease-cats";
import { useAppStore } from "@/store/app-store";
import { useMusicStore } from "@/store/music-store";

export type RootSwipeTab = "search" | "favorites" | "mine" | "settings";
export type SwipeEdgeDir = "next" | "prev";

/** 歌单页 4 个 type 的顺序；跨 tab 滑动的落点取两端 */
export const MINE_TYPE_IDS = ["mine", "queue", "history", "local"] as const;

/**
 * 四个根 tab 的滑动边界统一处理。
 *
 * 把「发现分类 → 喜欢 → 歌单 type → 设置」看成一条线性链：
 * - 左划（dx<0，next）沿链向右走，右划（dx>0，prev）沿链向左走；
 * - 跨到相邻 tab 时落在它的**靠近当前位置那一端**：
 *   喜欢右滑 → 发现最后一个分类；喜欢左滑 → 歌单第一个 type；
 *   设置右滑 → 歌单最后一个 type；歌单第一个 type 右滑 → 喜欢；
 *   歌单最后一个 type 左滑 → 设置。
 * - 链两端（发现第一个分类右滑、设置左滑）不动作。
 *
 * 发现分类用 store 的 lastPlaylistCategory 传递落点（该页本来就从这里读当前分类）；
 * 歌单 type 用 ?type= 传递（MinePage 的选中 type 是本地 state）。
 */
export function useRootTabSwipe(tab: RootSwipeTab) {
  const navigate = useNavigate();
  const setLastPlaylistCategory = useMusicStore(
    (s) => s.setLastPlaylistCategory
  );
  const playlistCategoryOrder = useMusicStore((s) => s.playlistCategoryOrder);

  // 带上 pageDir 供 RootLayout 选进入动画方向：next=去右边的 tab，prev=回左边
  const go = useCallback(
    (path: string, dir: SwipeEdgeDir) => {
      navigate(path, {
        state: { pageDir: dir === "next" ? "forward" : "back" },
      });
    },
    [navigate]
  );

  return useCallback(
    (dir: SwipeEdgeDir) => {
      if (tab === "search") {
        // 发现页第一个分类再往左已经是链头；最后一个分类往右进「喜欢」
        if (dir === "next") go("/favorites", dir);
        return;
      }

      if (tab === "favorites") {
        if (dir === "prev") {
          const { fixed, residents } = resolveBarCategories(
            playlistCategoryOrder
          );
          const ids = [...fixed, ...residents].map((c) => c.id);
          setLastPlaylistCategory(ids[ids.length - 1] ?? "全部");
          go("/search", dir);
        } else {
          go(`/mine?type=${MINE_TYPE_IDS[0]}`, dir);
        }
        return;
      }

      if (tab === "mine") {
        if (dir === "next") {
          useAppStore.getState().autoOpenUpdateDialogOnce();
          go("/settings", dir);
        } else {
          go("/favorites", dir);
        }
        return;
      }

      // 设置是链尾，右滑无下一页；右滑手势（prev）回到歌单最后一个 type
      if (dir === "prev") {
        go(`/mine?type=${MINE_TYPE_IDS[MINE_TYPE_IDS.length - 1]}`, dir);
      }
    },
    [tab, go, setLastPlaylistCategory, playlistCategoryOrder]
  );
}
