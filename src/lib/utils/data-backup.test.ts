import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  serializeStoreData,
  importStoreData,
  validateBackupData,
} from "./data-backup";
import { useMusicStore } from "@/store/music-store";

vi.mock("@/store/ui-prefs-store", () => ({
  applyFontScale: vi.fn(),
}));

// Mock dependencies
vi.mock("@/lib/storage-adapter", () => ({
  idbStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock("@/store/app-store", () => ({
  useAppStore: {
    getState: () => ({ enableUpdateNotify: true }),
    setState: vi.fn(),
  },
}));

vi.mock("@/store/podcast-store", () => ({
  usePodcastStore: {
    getState: () => ({ rssSources: [] }),
  },
}));

vi.mock("@/store/alist-store", () => ({
  useAlistStore: {
    getState: () => ({ servers: [] }),
  },
}));

type BackupPayload = Parameters<typeof importStoreData>[0];

const DEFAULTS = {
  coverSize: 328,
  lyricAlign: "center" as const,
  lyricFontSize: 15,
  lyricOffset: -0.5,
};

describe("data-backup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useMusicStore.setState({ favorites: [], playlists: [], ...DEFAULTS });
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("serializeStoreData", () => {
    it("should include cover/lyric display settings aligned with partialize", () => {
      useMusicStore.setState({
        coverSize: 360,
        lyricAlign: "left",
        lyricFontSize: 22,
        lyricOffset: 0.3,
      });

      const { data } = JSON.parse(serializeStoreData());
      expect(data.coverSize).toBe(360);
      expect(data.lyricAlign).toBe("left");
      expect(data.lyricFontSize).toBe(22);
      expect(data.lyricOffset).toBe(0.3);
    });

    it("should include localStorage settings (theme / font / sources / history)", () => {
      localStorage.setItem("theme", "dark");
      localStorage.setItem(
        "oh_ui_prefs_store",
        JSON.stringify({ state: { fontScale: "large" }, version: 0 })
      );
      localStorage.setItem("otter_imported_sources", '[{"id":"a"}]');
      localStorage.setItem("otter_search_history", '["周杰伦"]');

      const { data } = JSON.parse(serializeStoreData());
      expect(data.theme).toBe("dark");
      expect(data.uiPrefs).toContain("large");
      expect(data.importedSources).toBe('[{"id":"a"}]');
      expect(data.searchHistory).toBe('["周杰伦"]');
    });
  });

  describe("importStoreData", () => {
    it("should restore cover/lyric display settings", () => {
      useMusicStore.setState({
        coverSize: 200,
        lyricAlign: "center",
        lyricFontSize: 12,
        lyricOffset: -2,
      });

      importStoreData({
        favorites: [],
        playlists: [],
        coverSize: 320,
        lyricAlign: "right",
        lyricFontSize: 24,
        lyricOffset: 1,
      } as unknown as BackupPayload);

      const state = useMusicStore.getState();
      expect(state.coverSize).toBe(320);
      expect(state.lyricAlign).toBe("right");
      expect(state.lyricFontSize).toBe(24);
      expect(state.lyricOffset).toBe(1);
    });

    it("should fall back to defaults for legacy backups without these fields", () => {
      useMusicStore.setState({
        coverSize: 400,
        lyricAlign: "right",
        lyricFontSize: 30,
        lyricOffset: 2,
      });

      importStoreData({
        favorites: [],
        playlists: [],
      } as unknown as BackupPayload);

      const state = useMusicStore.getState();
      expect(state.coverSize).toBe(DEFAULTS.coverSize);
      expect(state.lyricAlign).toBe(DEFAULTS.lyricAlign);
      expect(state.lyricFontSize).toBe(DEFAULTS.lyricFontSize);
      expect(state.lyricOffset).toBe(DEFAULTS.lyricOffset);
    });

    it("should restore localStorage settings and validate them", () => {
      const backup = {
        version: 1,
        type: "otter-music-backup",
        data: {
          favorites: [],
          playlists: [],
          theme: "light",
          uiPrefs: JSON.stringify({
            state: { fontScale: "small" },
            version: 0,
          }),
          importedSources: '[{"id":"lx-1"}]',
          searchHistory: '["林俊杰"]',
        },
      };
      const validated = validateBackupData(JSON.stringify(backup));
      expect(validated.valid).toBe(true);
      if (!validated.valid) return;

      importStoreData(validated.data);
      expect(localStorage.getItem("theme")).toBe("light");
      expect(localStorage.getItem("otter_imported_sources")).toBe(
        '[{"id":"lx-1"}]'
      );
      expect(localStorage.getItem("otter_search_history")).toBe('["林俊杰"]');
    });
  });
});
