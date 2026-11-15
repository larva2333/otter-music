import type { StateCreator } from "zustand";
import type { MusicState } from "./types";
import type { MusicTrack, SearchIntent } from "@/types/music";
import {
  EMPTY_SEARCH_CATEGORY_PAGING,
  type SearchCategoryGroups,
  type SearchCategoryPaging,
  type SearchResultTab,
} from "@/lib/search-categories";

export interface SearchSlice {
  searchQuery: string;
  searchIntent: SearchIntent | null;
  searchResults: MusicTrack[];
  searchCategories: SearchCategoryGroups | null;
  searchCategoryPaging: SearchCategoryPaging;
  searchCategoryLoading: boolean;
  searchTab: SearchResultTab;
  searchLoading: boolean;
  searchHasMore: boolean;
  searchPage: number;
  setSearchQuery: (query: string) => void;
  setSearchIntent: (intent: SearchIntent | null) => void;
  setSearchResults: (results: MusicTrack[]) => void;
  setSearchCategories: (categories: SearchCategoryGroups | null) => void;
  setSearchCategoryPaging: (paging: SearchCategoryPaging) => void;
  setSearchCategoryLoading: (loading: boolean) => void;
  setSearchTab: (tab: SearchResultTab) => void;
  setSearchLoading: (loading: boolean) => void;
  setSearchHasMore: (hasMore: boolean) => void;
  setSearchPage: (page: number) => void;
  resetSearch: () => void;
}

export const createSearchSlice: StateCreator<
  MusicState,
  [],
  [],
  SearchSlice
> = (set) => ({
  searchQuery: "",
  searchIntent: null,
  searchResults: [],
  searchCategories: null,
  searchCategoryPaging: EMPTY_SEARCH_CATEGORY_PAGING,
  searchCategoryLoading: false,
  searchTab: "song",
  searchLoading: false,
  searchHasMore: false,
  searchPage: 0,
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchIntent: (searchIntent) => set({ searchIntent }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setSearchCategories: (searchCategories) => set({ searchCategories }),
  setSearchCategoryPaging: (searchCategoryPaging) => set({ searchCategoryPaging }),
  setSearchCategoryLoading: (searchCategoryLoading) =>
    set({ searchCategoryLoading }),
  setSearchTab: (searchTab) => set({ searchTab }),
  setSearchLoading: (searchLoading) => set({ searchLoading }),
  setSearchHasMore: (searchHasMore) => set({ searchHasMore }),
  setSearchPage: (searchPage) => set({ searchPage }),
  resetSearch: () =>
    set({
      searchQuery: "",
      searchIntent: null,
      searchResults: [],
      searchCategories: null,
      searchCategoryPaging: EMPTY_SEARCH_CATEGORY_PAGING,
      searchCategoryLoading: false,
      searchTab: "song",
      searchLoading: false,
      searchHasMore: false,
      searchPage: 0,
    }),
});
