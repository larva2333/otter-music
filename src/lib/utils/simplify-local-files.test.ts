import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalMusicPlugin, type LocalMusicFile } from "@/plugins/local-music";
import { simplifyLocalFilesText } from "./simplify-local-files";

vi.mock("@/plugins/local-music", () => ({
  LocalMusicPlugin: {
    toSimplifiedTexts: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function file(overrides: Partial<LocalMusicFile>): LocalMusicFile {
  return {
    id: "1",
    name: null,
    artist: null,
    album: null,
    duration: 0,
    localPath: "/music/a.flac",
    fileSize: 0,
    ...overrides,
  };
}

describe("simplifyLocalFilesText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("batch converts name, artist and album in one native call", async () => {
    const files = [
      file({ id: "1", name: "印地安老斑鳩", artist: "周杰倫", album: "JAY" }),
      file({ id: "2", name: "晴天", artist: "周杰倫", album: null }),
    ];
    vi.mocked(LocalMusicPlugin.toSimplifiedTexts).mockResolvedValue({
      success: true,
      texts: ["印地安老斑鸠", "周杰伦", "JAY", "晴天", "周杰伦"],
    });

    const result = await simplifyLocalFilesText(files);

    expect(LocalMusicPlugin.toSimplifiedTexts).toHaveBeenCalledTimes(1);
    expect(LocalMusicPlugin.toSimplifiedTexts).toHaveBeenCalledWith({
      texts: ["印地安老斑鳩", "周杰倫", "JAY", "晴天", "周杰倫"],
    });
    expect(result[0]).toMatchObject({
      name: "印地安老斑鸠",
      artist: "周杰伦",
      album: "JAY",
    });
    expect(result[1]).toMatchObject({ name: "晴天", artist: "周杰伦" });
    // 原始对象不被就地修改
    expect(files[0].name).toBe("印地安老斑鳩");
  });

  it("returns the original list when conversion fails", async () => {
    const files = [file({ id: "1", name: "周杰倫" })];
    vi.mocked(LocalMusicPlugin.toSimplifiedTexts).mockResolvedValue({
      success: false,
      error: "词表加载失败",
    });

    await expect(simplifyLocalFilesText(files)).resolves.toBe(files);
  });

  it("skips the native call when there is nothing to convert", async () => {
    const files = [file({ id: "1" })];

    await expect(simplifyLocalFilesText(files)).resolves.toBe(files);
    expect(LocalMusicPlugin.toSimplifiedTexts).not.toHaveBeenCalled();
  });
});
