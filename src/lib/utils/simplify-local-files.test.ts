import { describe, expect, it } from "vitest";

import type { LocalMusicFile } from "@/plugins/local-music";
import { simplifyLocalFilesText } from "./simplify-local-files";

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
  it("把曲名、歌手、专辑一起转成简体", async () => {
    const files = [
      file({ id: "1", name: "印地安老斑鳩", artist: "周杰倫", album: "JAY" }),
      file({ id: "2", name: "晴天", artist: "周杰倫", album: null }),
    ];

    const result = await simplifyLocalFilesText(files);

    expect(result[0]).toMatchObject({
      name: "印地安老斑鸠",
      artist: "周杰伦",
      album: "JAY",
    });
    expect(result[1]).toMatchObject({ name: "晴天", artist: "周杰伦" });
    // 原始对象不被就地修改
    expect(files[0].name).toBe("印地安老斑鳩");
  });

  it("没有繁体时返回原数组引用", async () => {
    const files = [file({ id: "1", name: "晴天", artist: "周杰伦" })];
    await expect(simplifyLocalFilesText(files)).resolves.toBe(files);
  });

  it("空列表直接返回", async () => {
    const files: LocalMusicFile[] = [];
    await expect(simplifyLocalFilesText(files)).resolves.toBe(files);
  });
});
