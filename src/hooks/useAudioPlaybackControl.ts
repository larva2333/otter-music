import { useEffect } from "react";
import { useMusicStore } from "@/store/music-store";
import { logger } from "@/lib/logger";
import { fadeOutAndPause, restoreVolume } from "@/lib/audio-fade";

export function useAudioPlaybackControl(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  isSwitchingTrackRef: React.MutableRefObject<boolean>
) {
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const setIsPlaying = useMusicStore((s) => s.setIsPlaying);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!isPlaying) {
      // 硬 pause 会截断解码器输出（一声 pop），系统音频通路的残留缓冲
      // 听起来就是「尾音」。暂停也走 64ms 淡出，音量停在 0，
      // 恢复播放时由 restoreVolume 同步写回。
      fadeOutAndPause(audio);
      return;
    }

    if (isSwitchingTrackRef.current) return;
    if (!audio.src) return;
    if (audio.paused) {
      // 起播前同步还原音量：上一轮暂停把 volume 留在了 0，淡出阶梯也可能还挂着，
      // 不先写回就是「点了播放没声音」或者「开头半秒静音」
      restoreVolume(audio, useMusicStore.getState().volume);
      audio.play().catch((e) => {
        logger.error("useAudioPlaybackControl", "Resume play failed", e);
        if (audio.paused) {
          setIsPlaying(false);
        }
      });
    }
  }, [isPlaying, setIsPlaying]); // eslint-disable-line react-hooks/exhaustive-deps
}
