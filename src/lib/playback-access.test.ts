import { beforeEach, describe, expect, it } from "vitest";
import type { MusicTrack } from "@/types/music";
import { useQqStore } from "@/store/qq-store";
import { useNeteaseStore } from "@/store/netease-store";
import {
  hasPlatformVip,
  isVipOnlyTrack,
  shouldSkipOfficialResolve,
} from "./playback-access";

const track = (over: Partial<MusicTrack>): MusicTrack =>
  ({
    id: "1",
    name: "test",
    artist: ["a"],
    album: "b",
    pic_id: "",
    url_id: "1",
    lyric_id: "1",
    source: "qq",
    ...over,
  }) as MusicTrack;

describe("playback-access", () => {
  beforeEach(() => {
    useQqStore.setState({ cookie: "", user: null });
    useNeteaseStore.setState({ cookie: "", user: null });
  });

  it("QQ 付费曲（fee=1）识别为会员曲", () => {
    expect(isVipOnlyTrack(track({ source: "qq", fee: 1 }))).toBe(true);
    expect(isVipOnlyTrack(track({ source: "qq", fee: undefined }))).toBe(false);
  });

  it("网易云 VIP / 付费专辑 / 无版权都算会员曲", () => {
    expect(
      isVipOnlyTrack(
        track({
          source: "_netease",
          privilege: { fee: 1, st: 0 } as MusicTrack["privilege"],
        })
      )
    ).toBe(true);
    expect(
      isVipOnlyTrack(
        track({
          source: "_netease",
          privilege: { fee: 4, st: 0 } as MusicTrack["privilege"],
        })
      )
    ).toBe(true);
    expect(
      isVipOnlyTrack(
        track({
          source: "_netease",
          privilege: { fee: 0, st: -200 } as MusicTrack["privilege"],
        })
      )
    ).toBe(true);
    expect(
      isVipOnlyTrack(
        track({
          source: "_netease",
          privilege: { fee: 0, st: 0 } as MusicTrack["privilege"],
        })
      )
    ).toBe(false);
  });

  it("没登录 QQ 时没有会员", () => {
    expect(hasPlatformVip("qq")).toBe(false);
    useQqStore.setState({
      cookie: "c",
      user: { isVip: true } as never,
    });
    expect(hasPlatformVip("qq")).toBe(true);
  });

  it("网易云登录但 vipType=0 视为无会员", () => {
    useNeteaseStore.setState({
      cookie: "c",
      user: { userId: 1, nickname: "n", avatarUrl: "", vipType: 0 } as never,
    });
    expect(hasPlatformVip("_netease")).toBe(false);

    useNeteaseStore.setState({
      cookie: "c",
      user: { userId: 1, nickname: "n", avatarUrl: "", vipType: 11 } as never,
    });
    expect(hasPlatformVip("_netease")).toBe(true);
  });

  it("会员曲 + 无会员才跳过官方；免费曲或已有会员不跳过", () => {
    const vip = track({ source: "qq", fee: 1 });
    const free = track({ source: "qq" });

    expect(shouldSkipOfficialResolve(vip)).toBe(true);
    expect(shouldSkipOfficialResolve(free)).toBe(false);

    useQqStore.setState({ cookie: "c", user: { isVip: true } as never });
    expect(shouldSkipOfficialResolve(vip)).toBe(false);
  });

  it("洛雪 / GD 等导入源不参与会员判断，避免误跳过", () => {
    const imported = track({ source: "imp_abc" as never, fee: 1 });
    expect(isVipOnlyTrack(imported)).toBe(false);
    expect(shouldSkipOfficialResolve(imported)).toBe(false);
  });
});
