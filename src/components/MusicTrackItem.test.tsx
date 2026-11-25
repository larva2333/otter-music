import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MusicTrack } from "@/types/music";
import { MusicTrackItem } from "./MusicTrackItem";

const OLD_SRC = "https://example.com/old-cover.jpg";
const NEW_SRC = "https://example.com/new-cover.jpg";

vi.mock("@/lib/storage-adapter", () => ({
  idbStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock("@/lib/music-api", () => ({
  musicApi: {
    getPic: vi.fn(() => new Promise(() => undefined)),
  },
}));

vi.mock("react-hot-toast", () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./AddToPlaylistDrawer", () => ({
  AddToPlaylistDrawer: () => null,
}));

vi.mock("./MusicTrackMobileMenu", () => ({
  MusicTrackMobileMenu: () => null,
}));

vi.mock("./MusicTrackVariants", () => ({
  MusicTrackVariants: () => null,
}));

vi.mock("./TrackSourceLabel", () => ({
  TrackSourceLabel: () => null,
}));

function track(id: string, name: string, picId: string): MusicTrack {
  return {
    id,
    name,
    artist: ["Artist"],
    album: "Album",
    pic_id: picId,
    url_id: id,
    lyric_id: id,
    source: "netease",
  };
}

describe("MusicTrackItem cover refresh", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      writable: true,
      value: () => Promise.resolve(),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = "";
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
    vi.restoreAllMocks();
  });

  it("replaces the cover when a virtual row switches to another track", () => {
    act(() => {
      root!.render(
        <MusicTrackItem
          track={track("old-track", "Old song", OLD_SRC)}
          index={0}
          onPlay={vi.fn()}
          showCover
        />
      );
    });

    expect(container?.querySelector("img")?.getAttribute("src")).toBe(OLD_SRC);

    act(() => {
      root!.render(
        <MusicTrackItem
          key="netease:new"
          track={track("new-track", "New song", NEW_SRC)}
          index={0}
          onPlay={vi.fn()}
          showCover
        />
      );
    });

    expect(container?.querySelector("img")?.getAttribute("src")).toBe(NEW_SRC);
  });
});
