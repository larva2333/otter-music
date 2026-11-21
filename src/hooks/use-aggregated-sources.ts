import { useMusicStore } from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import type { MusicSource } from "@/types/music";
import { isLxPlaybackSource } from "@/lib/imported-sources/lx-playback";

export const EXCLUDED_FOR_SEARCH = ["local", "podcast", "alist"];
export const EXCLUDED_FOR_AUTO_MATCH = ["local", "podcast", "alist"];

/** 设置页里「可见」与「启用」已合并成一个开关，两者同时为 true 才算开启 */
const isOn = (c: { enabled: boolean; visible: boolean }) =>
  c.enabled && c.visible;

/** 洛雪脚本没有搜索能力，只在播放阶段接管内置平台的取链 */
const isSearchable = (source: MusicSource) => !isLxPlaybackSource(source);

const getEnabledSourcesInOrder = (): MusicSource[] => {
  const { sourceConfigs } = useMusicStore.getState();
  return sourceConfigs.filter(isOn).map((c) => c.source);
};

export function useAggregatedSourcesForSearch() {
  return useMusicStore(
    useShallow((state) =>
      state.sourceConfigs
        .filter(
          (c) =>
            isOn(c) &&
            isSearchable(c.source) &&
            !EXCLUDED_FOR_SEARCH.includes(c.source)
        )
        .map((c) => c.source)
    )
  );
}

export function useAggregatedSourcesForMatch() {
  return useMusicStore(
    useShallow((state) =>
      state.sourceConfigs
        .filter(
          (c) =>
            isOn(c) &&
            isSearchable(c.source) &&
            !EXCLUDED_FOR_AUTO_MATCH.includes(c.source)
        )
        .map((c) => c.source)
    )
  );
}

export function getAggregatedSourcesForSearch() {
  return getEnabledSourcesInOrder().filter(
    (s) => isSearchable(s) && !EXCLUDED_FOR_SEARCH.includes(s)
  );
}

export function getAggregatedSourcesForMatch() {
  return getEnabledSourcesInOrder().filter(
    (s) => isSearchable(s) && !EXCLUDED_FOR_AUTO_MATCH.includes(s)
  );
}

/** 获取所有可见音源（用于手动切换音源对话框），排除 local/podcast */
export function getAllVisibleSourcesForSwitch(): MusicSource[] {
  const { sourceConfigs } = useMusicStore.getState();
  return sourceConfigs
    .filter(
      (c) =>
        isOn(c) &&
        isSearchable(c.source) &&
        !EXCLUDED_FOR_AUTO_MATCH.includes(c.source)
    )
    .map((c) => c.source);
}

export function useAllVisibleSourcesForSwitch() {
  return useMusicStore(
    useShallow((state) =>
      state.sourceConfigs
        .filter(
          (c) =>
            isOn(c) &&
            isSearchable(c.source) &&
            !EXCLUDED_FOR_AUTO_MATCH.includes(c.source)
        )
        .map((c) => c.source)
    )
  );
}
