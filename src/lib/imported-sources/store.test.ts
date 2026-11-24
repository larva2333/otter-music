import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportedSource } from "./types";
import { useImportedSourcesStore } from "./store";

function makeSource(
  id: string,
  overrides: Partial<ImportedSource> = {}
): ImportedSource {
  return {
    id,
    name: id,
    kind: "lx",
    url: `https://raw.githubusercontent.com/foo/${id}/main/latest.js`,
    enabled: false,
    visible: false,
    addedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  useImportedSourcesStore.setState({ sources: [] });
});

describe("洛雪脚本单启规则", () => {
  it("启用另一个洛雪脚本时自动停用旧的，并写入持久化", () => {
    const a = makeSource("a", { name: "A", enabled: true, visible: true });
    const b = makeSource("b", { name: "B" });
    useImportedSourcesStore.setState({ sources: [a, b] });

    const { disabled } = useImportedSourcesStore
      .getState()
      .update("b", { enabled: true, visible: true });

    expect(disabled.map((s) => s.id)).toEqual(["a"]);
    const { sources } = useImportedSourcesStore.getState();
    expect(sources.find((s) => s.id === "a")?.enabled).toBe(false);
    expect(sources.find((s) => s.id === "b")?.enabled).toBe(true);
    const saved = JSON.parse(
      localStorage.getItem("otter_imported_sources") ?? "[]"
    ) as ImportedSource[];
    expect(saved.find((s) => s.id === "a")?.visible).toBe(false);
  });

  it("批量导入新的洛雪脚本时由新脚本接管", () => {
    const a = makeSource("a", { name: "A", enabled: true, visible: true });
    useImportedSourcesStore.setState({ sources: [a] });
    const fresh = makeSource("fresh", {
      name: "F",
      enabled: true,
      visible: true,
    });

    const { disabled } = useImportedSourcesStore.getState().addMany([fresh]);

    expect(disabled.map((s) => s.id)).toEqual(["a"]);
    expect(
      useImportedSourcesStore.getState().sources.find((s) => s.id === "a")
        ?.enabled
    ).toBe(false);
  });

  it("GD 音源不受洛雪单启影响", () => {
    const lx = makeSource("lx", { enabled: true, visible: true });
    const gd = makeSource("gd", { kind: "gd", enabled: true, visible: true });
    useImportedSourcesStore.setState({ sources: [lx, gd] });

    const { disabled } = useImportedSourcesStore
      .getState()
      .update("gd", { enabled: true });

    expect(disabled).toEqual([]);
    expect(
      useImportedSourcesStore.getState().sources.find((s) => s.id === "lx")
        ?.enabled
    ).toBe(true);
  });

  it("加载历史数据时只保留第一个启用的洛雪脚本", async () => {
    vi.resetModules();
    localStorage.setItem(
      "otter_imported_sources",
      JSON.stringify([
        makeSource("a", { enabled: true, visible: true }),
        makeSource("b", { enabled: true, visible: true }),
        makeSource("gd", { kind: "gd", enabled: true, visible: true }),
      ])
    );
    const { useImportedSourcesStore: freshStore } = await import("./store");
    const { sources } = freshStore.getState();
    expect(sources.find((s) => s.id === "a")?.enabled).toBe(true);
    expect(sources.find((s) => s.id === "b")?.enabled).toBe(false);
    expect(sources.find((s) => s.id === "gd")?.enabled).toBe(true);
  });
});
