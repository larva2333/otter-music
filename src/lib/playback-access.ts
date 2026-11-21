import type { MusicTrack } from "@/types/music";
import { useQqStore } from "@/store/qq-store";
import { useNeteaseStore } from "@/store/netease-store";

/**
 * 曲目是否属于「必须会员才能完整播放」。
 *
 * 只读曲目自身携带的标记，与账号无关：
 * - QQ：搜索 / 歌单接口的 `pay.payplay === 1` 被转成 `fee: 1`
 * - 网易云：`privilege.fee` 为 1（VIP）或 4（付费专辑），
 *   `privilege.st < 0` 表示连版权都没有
 */
export function isVipOnlyTrack(track: MusicTrack): boolean {
  if (track.source === "qq") return track.fee === 1;

  if (track.source === "_netease") {
    const fee = track.privilege?.fee ?? track.fee ?? 0;
    const st = track.privilege?.st;
    if (typeof st === "number" && st < 0) return true;
    return fee === 1 || fee === 4;
  }

  return false;
}

/**
 * 当前账号在对应平台是否有会员。
 *
 * - QQ：登录信息里的 `isVip`；没登录就是 false
 * - 网易云：登录资料里的 `vipType`（0 / 缺失都视为无会员）
 * - 其它平台不参与这个判断，返回 true 以免误跳过
 */
export function hasPlatformVip(source: MusicTrack["source"]): boolean {
  if (source === "qq") {
    return useQqStore.getState().user?.isVip === true;
  }

  if (source === "_netease") {
    const vipType = useNeteaseStore.getState().user?.vipType;
    return typeof vipType === "number" && vipType > 0;
  }

  return true;
}

/**
 * 是否应该跳过官方取链。
 *
 * 会员曲 + 当前账号没会员时，官方接口只会返回 30/45 秒试听片段（或者干脆空链接）：
 * 播下去必然是「听半分钟就断」，还要先等一轮取链和加载。
 * 这种情况直接从洛雪开始，取不到就让上层换源。
 */
export function shouldSkipOfficialResolve(track: MusicTrack): boolean {
  return isVipOnlyTrack(track) && !hasPlatformVip(track.source);
}
