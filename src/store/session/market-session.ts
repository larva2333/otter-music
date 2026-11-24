import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { MarketPlaylist, ArtistAlbum } from "@/lib/netease/netease-types";

/** 快照防御上限：排行榜有 65 项，不能照着普通分页的 12 项砍掉 */
const MAX_SNAPSHOT_ITEMS = 80;
/** 访问过的分类快照上限，防止长期使用后 localStorage 里堆几十份列表 */
const MAX_SNAPSHOT_KEYS = 20;

// 抽离初始状态，便于 clearSession 复用
const INITIAL_MINE_DATA: MineDataState = {
  recommend: null,
  created: null,
  subscribed: null,
  albums: null,
  hasMoreAlbums: true,
};

export interface MineDataState {
  recommend: MarketPlaylist[] | null;
  created: MarketPlaylist[] | null;
  subscribed: MarketPlaylist[] | null;
  albums: ArtistAlbum[] | null;
  hasMoreAlbums: boolean;
}

export interface ListSnapshot {
  items: MarketPlaylist[];
  offset: number;
  hasMore: boolean;
}

export interface SearchCache {
  query: string;
  items: MarketPlaylist[];
  offset: number;
  hasMore: boolean;
}

interface MarketSessionState {
  mineData: MineDataState;
  listSnapshots: Record<string, ListSnapshot>;
  searchCache: SearchCache | null;
  /** Billboard 历史周榜日期（YYYY-MM-DD，undefined 表示最新一期），会话级缓存 */
  billboardDate: string | undefined;
  /** 奖项页上次浏览的年份（key: awardId），会话级缓存 */
  awardYears: Record<string, number>;
  /** 歌单广场页内筛选分类（null = 全部）；仅会话级，不持久化 */
  marketFilter: string | null;
  setMarketFilter: (filter: string | null) => void;
  setMineData: (
    data: Partial<MineDataState> | ((prev: MineDataState) => MineDataState)
  ) => void;
  saveListSnapshot: (key: string, snapshot: ListSnapshot) => void;
  saveSearchCache: (cache: SearchCache | null) => void;
  setBillboardDate: (date: string | undefined) => void;
  setAwardYear: (awardId: string, year: number) => void;
  toggleAlbumInSession: (
    album: {
      id: string | number;
      name: string;
      picUrl: string;
      artistName?: string;
    },
    isSub: boolean
  ) => void;
  togglePlaylistInSession: (
    playlist: MarketPlaylist,
    shouldSub: boolean
  ) => void;
  clearSession: () => void;
}

export const useMarketSession = create<MarketSessionState>()(
  persist(
    (set) => ({
      mineData: INITIAL_MINE_DATA,
      listSnapshots: {},
      searchCache: null,
      billboardDate: undefined,
      awardYears: {},
      marketFilter: null,

      setMarketFilter: (marketFilter) => set({ marketFilter }),

      setMineData: (data) =>
        set((state) => ({
          mineData:
            typeof data === "function"
              ? data(state.mineData)
              : { ...state.mineData, ...data },
        })),

      saveListSnapshot: (key, snapshot) =>
        set((state) => {
          const listSnapshots = {
            ...state.listSnapshots,
            [key]: {
              ...snapshot,
              items: snapshot.items.slice(0, MAX_SNAPSHOT_ITEMS),
            },
          };
          const keys = Object.keys(listSnapshots);
          for (const oldKey of keys.slice(
            0,
            Math.max(0, keys.length - MAX_SNAPSHOT_KEYS)
          )) {
            delete listSnapshots[oldKey];
          }
          return { listSnapshots };
        }),

      saveSearchCache: (cache) => set({ searchCache: cache }),

      setBillboardDate: (billboardDate) => set({ billboardDate }),

      setAwardYear: (awardId, year) =>
        set((state) => ({
          awardYears: { ...state.awardYears, [awardId]: year },
        })),

      toggleAlbumInSession: (album, shouldSub) =>
        set((state) => {
          const { albums } = state.mineData;
          if (!albums) return state;

          const newAlbums = shouldSub
            ? [
                {
                  id: Number(album.id),
                  name: album.name,
                  picUrl: album.picUrl,
                  artist: { name: album.artistName || "" },
                } as ArtistAlbum,
                ...albums,
              ]
            : albums.filter((a) => String(a.id) !== String(album.id));

          return {
            mineData: { ...state.mineData, albums: newAlbums },
          };
        }),

      togglePlaylistInSession: (playlist, shouldSub) =>
        set((state) => {
          const { subscribed } = state.mineData;
          if (!subscribed) return state;

          const newSubscribed = shouldSub
            ? [playlist, ...subscribed]
            : subscribed.filter((p) => String(p.id) !== String(playlist.id));

          return {
            mineData: { ...state.mineData, subscribed: newSubscribed },
          };
        }),

      clearSession: () =>
        set({
          mineData: INITIAL_MINE_DATA,
          listSnapshots: {},
          searchCache: null,
          billboardDate: undefined,
          awardYears: {},
          marketFilter: null,
        }),
    }),
    {
      name: "market-session-storage",
      // v2：分页改版后旧快照是「追加式几百条」，留着会一进歌单广场就挂几百张卡片。
      // 迁移时只丢列表缓存，收藏/登录等 mineData 继续保留。
      version: 2,
      migrate: (persisted) => ({
        ...(persisted as MarketSessionState),
        listSnapshots: {},
        searchCache: null,
      }),
      // 用 localStorage 而不是 sessionStorage：冷启动后切回看过的分类/搜索能直接出缓存，
      // 不再整块 loading。数据本身由接口层 cachedFetch 控制 1 天过期。
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mineData: state.mineData,
        listSnapshots: state.listSnapshots,
        searchCache: state.searchCache,
        billboardDate: state.billboardDate,
        awardYears: state.awardYears,
      }),
    }
  )
);
