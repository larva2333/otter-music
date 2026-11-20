/**
 * 歌词页的「点空白回顶」判定。
 *
 * 歌词面板里除了歌词行，第一句上方还有一片留白（PADDING_LINES 撑出来的），
 * 以及两侧的留白。点在歌词行上是定位播放位置，点在按钮上是它自己的动作，
 * 而点在空白处原本没有任何反应 —— 这里把它接成「回顶」，和点状态栏同一个动作。
 *
 * 放在独立文件里而不是 LyricsPanel.tsx：那个文件只导出组件，
 * 混进工具函数会让 Fast Refresh 失效。
 */

import { scrollPageToTop } from "./scroll-to-top";

/** 歌词面板根节点标记：用来判断一次点击是不是落在歌词面板里 */
export const LYRICS_PANEL_ATTR = "data-lyrics-panel";

/**
 * 处理歌词页空白处的点击。
 *
 * @returns 是否消费了这次点击（true 表示已经触发回顶，调用方不要再切页）
 */
export function handleLyricsBlankTap(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (!target.closest(`[${LYRICS_PANEL_ATTR}]`)) return false;
  // 歌词行、按钮（含基准线上的「从此句播放」）不算空白
  if (
    target.closest(
      ".lyric-line, button, a, input, textarea, select, [role='button']"
    )
  ) {
    return false;
  }

  scrollPageToTop();
  return true;
}
