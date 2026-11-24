import { describe, expect, it } from "vitest";
import type { SourceHealthResult } from "@/lib/source-health";
import type { MusicSource, SourceConfig } from "@/types/music";
import { sortConfigsByHealth, sortLxConfigs } from "./health-sort";

const asSource = (id: string) => id as MusicSource;
const cfg = (source: string, enabled = true): SourceConfig => ({
  source: asSource(source),
  enabled,
  visible: enabled,
});
const result = (
  source: string,
  status: SourceHealthResult["status"],
  latencyMs: number
): SourceHealthResult => ({ source: asSource(source), status, latencyMs });

const health: Record<string, SourceHealthResult> = {
  slowOk: result("slowOk", "ok", 900),
  fastOk: result("fastOk", "ok", 120),
  unknown: result("unknown", "unknown", 10),
  fail: result("fail", "fail", 5),
  offOk: result("offOk", "ok", 1),
};

describe("sortConfigsByHealth", () => {
  it("可用在前、未判定居中、不可用垫底；同档启用优先，再按延迟", () => {
    const configs = [
      cfg("fail"),
      cfg("offOk", false),
      cfg("slowOk"),
      cfg("unknown"),
      cfg("fastOk"),
    ];
    expect(sortConfigsByHealth(configs, health).map((c) => c.source)).toEqual([
      "fastOk",
      "slowOk",
      "offOk",
      "unknown",
      "fail",
    ]);
  });

  it("检测失败被自动停用的源仍排在未判定之后，不会因为延迟低而插队", () => {
    const disabledFail: SourceConfig = {
      ...cfg("fail", false),
      healthDisabled: true,
    };
    const configs = [disabledFail, cfg("unknown"), cfg("fastOk")];
    expect(sortConfigsByHealth(configs, health).map((c) => c.source)).toEqual([
      "fastOk",
      "unknown",
      "fail",
    ]);
  });

  it("洛雪列表始终将启用的脚本排第一，其余按健康状态", () => {
    const configs = [
      cfg("fail"),
      cfg("offOk", false),
      cfg("fastOk"),
      cfg("unknown"),
    ];
    expect(sortLxConfigs(configs, health).map((c) => c.source)).toEqual([
      "fastOk",
      "unknown",
      "fail",
      "offOk",
    ]);
  });

  it("不修改传入数组的顺序", () => {
    const configs = [cfg("fail"), cfg("fastOk")];
    sortConfigsByHealth(configs, health);
    expect(configs.map((c) => c.source)).toEqual(["fail", "fastOk"]);
  });
});
