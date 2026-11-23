import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MusicTrack } from "@/types/music";

const resolveMock = vi.fn();
const cacheMap = new Map<
  string,
  { url: string; cachedAt: number; via?: string }
>();

vi.mock("@/lib/audio-resolver", () => ({
  resolveTrackUrl: (...args: unknown[]) => resolveMock(...args),
}));
vi.mock("@/store/url-cache-store", () => ({
  buildUrlCacheKey: (source: string, id: string, _urlId: string, q: string) =>
    `${source}:${id}:${q}`,
  useUrlCacheStore: {
    getState: () => ({ getEntry: (k: string) => cacheMap.get(k) }),
  },
}));
vi.mock("@/store/music-store", () => ({
  useMusicStore: (sel: (s: { quality: string }) => unknown) =>
    sel({ quality: "192" }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

// shouldSkipOfficialResolve：privilege 有值视为 VIP（未登录时跳过官方）
vi.mock("@/lib/playback-access", () => ({
  shouldSkipOfficialResolve: (t: MusicTrack) => !!t.privilege,
}));

import { useSearchUrlPrefetch } from "./useSearchUrlPrefetch";

function Harness({ tracks }: { tracks: MusicTrack[] }) {
  useSearchUrlPrefetch(tracks);
  return <div />;
}

const mk = (id: string, vip: boolean): MusicTrack =>
  ({
    id,
    name: id,
    artist: ["x"],
    album: "a",
    pic_id: "",
    url_id: id,
    lyric_id: "",
    source: "qq",
    ...(vip ? { privilege: { pl: 1 } } : {}),
  }) as MusicTrack;

describe("useSearchUrlPrefetch", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    resolveMock.mockReset();
    resolveMock.mockResolvedValue({ url: "https://x/a.mp3" });
    cacheMap.clear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("只对 VIP 曲预取，免费曲跳过", async () => {
    const tracks = [mk("free", false), mk("vip1", true), mk("vip2", true)];
    await act(async () => {
      root.render(<Harness tracks={tracks} />);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(resolveMock).toHaveBeenCalledTimes(2);
    expect(resolveMock.mock.calls.map((c) => (c[0] as MusicTrack).id)).toEqual([
      "vip1",
      "vip2",
    ]);
  });

  it("最多预取 3 首", async () => {
    const tracks = Array.from({ length: 6 }, (_, i) => mk(`vip${i}`, true));
    await act(async () => {
      root.render(<Harness tracks={tracks} />);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(resolveMock).toHaveBeenCalledTimes(3);
  });

  it("已有缓存的曲目跳过", async () => {
    cacheMap.set("qq:vip1:192", {
      url: "https://x/cached.mp3",
      cachedAt: Date.now(),
      via: "lx",
    });
    const tracks = [mk("vip1", true), mk("vip2", true)];
    await act(async () => {
      root.render(<Harness tracks={tracks} />);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect((resolveMock.mock.calls[0][0] as MusicTrack).id).toBe("vip2");
  });

  it("3 首并发发起，不等前一首完成", async () => {
    // 第一首永不 resolve；串行实现会卡死在这里，并发实现应继续发起第 2、3 首
    resolveMock.mockImplementation((t: MusicTrack) =>
      t.id === "vip0"
        ? new Promise(() => {})
        : Promise.resolve({ url: "https://x/a.mp3" })
    );
    const tracks = Array.from({ length: 3 }, (_, i) => mk(`vip${i}`, true));
    await act(async () => {
      root.render(<Harness tracks={tracks} />);
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(resolveMock).toHaveBeenCalledTimes(3);
  });
});
