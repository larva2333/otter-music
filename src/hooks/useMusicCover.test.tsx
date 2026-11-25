import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { prefetchTrackCover, useMusicCover } from "./useMusicCover";
import { musicApi } from "@/lib/music-api";
import type { MusicTrack } from "@/types/music";

describe("useMusicCover", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it("HTTP 直链封面在渲染期同步直出带尺寸参数 URL，不先返回 null 闪烁", () => {
    const getPicSpy = vi.spyOn(musicApi, "getPic");
    const track: MusicTrack = {
      id: "1",
      name: "晴天",
      artist: ["周杰伦"],
      album: "叶惠美",
      pic_id: "https://p4.music.126.net/abc==/109951173219336672.jpg",
      url_id: "1",
      lyric_id: "1",
      source: "netease",
    };

    function Probe() {
      const url = useMusicCover(track);
      return <span data-testid="url">{url ?? "null"}</span>;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<Probe />);
    });

    expect(container.querySelector('[data-testid="url"]')?.textContent).toBe(
      "https://p4.music.126.net/abc==/109951173219336672.jpg?param=800y800"
    );
    expect(getPicSpy).not.toHaveBeenCalled();
  });

  it("B 站等需代理或非直链封面走异步解析，解析后返回 URL", async () => {
    const getPicSpy = vi
      .spyOn(musicApi, "getPic")
      .mockResolvedValue("https://resolved.example.com/pic.jpg");
    const track: MusicTrack = {
      id: "b1",
      name: "Video",
      artist: ["UP"],
      album: "",
      pic_id: "https://i0.hdslb.com/bfs/archive/abc.jpg",
      url_id: "b1",
      lyric_id: "b1",
      source: "bilibili",
    };

    function Probe() {
      const url = useMusicCover(track);
      return <span data-testid="url">{url ?? "null"}</span>;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<Probe />);
    });

    expect(getPicSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="url"]')?.textContent).toBe(
      "https://resolved.example.com/pic.jpg"
    );
  });

  it("prefetchTrackCover 预下载图片且对相同 URL 去重", async () => {
    const createdImages: Array<{ src: string }> = [];
    const OriginalImage = globalThis.Image;
    class MockImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      private _src = "";
      set src(val: string) {
        this._src = val;
        createdImages.push({ src: val });
      }
      get src() {
        return this._src;
      }
    }
    (globalThis as unknown as { Image: unknown }).Image = MockImage;

    try {
      const track: MusicTrack = {
        id: "2",
        name: "七里香",
        artist: ["周杰伦"],
        album: "七里香",
        pic_id: "http://p3.music.126.net/xyz==/123.jpg",
        url_id: "2",
        lyric_id: "2",
        source: "netease",
      };

      await prefetchTrackCover(track);
      await prefetchTrackCover(track);

      expect(createdImages).toHaveLength(1);
      expect(createdImages[0].src).toBe(
        "https://p3.music.126.net/xyz==/123.jpg?param=800y800"
      );
    } finally {
      (globalThis as unknown as { Image: unknown }).Image = OriginalImage;
    }
  });
});
