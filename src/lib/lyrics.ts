/**
 * LRC 解析与当前行定位。
 *
 * 被 `LyricsPanel`（界面滚动）与 `useCarLyric`（蓝牙车载歌词）共用，
 * 两处必须用同一套时间轴口径，否则车机与屏幕会显示不同的行。
 */

/** 一个字（酷我 lrcx 等逐字歌词）的起止时间，单位毫秒，相对本行起点 */
export interface LyricWord {
  text: string;
  start: number;
  end: number;
}

export interface LyricLine {
  time: number;
  text: string;
  ttext?: string;
  /** 只有源带 `<start,duration>` 字级时间戳时才有；普通 LRC 没有 */
  words?: LyricWord[];
}

const TIME_EXP = /\[(\d{2}):(\d{2})\.(\d{2,3})]/g;
const WORD_TIME_EXP = /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g;
const MATCH_TOLERANCE = 0.5;

/** 从行文本里切出逐字片段，时间戳是相对行起点的毫秒 */
function extractWords(raw: string): LyricWord[] | undefined {
  const matches = [...raw.matchAll(WORD_TIME_EXP)];
  if (matches.length === 0) return undefined;

  const words: LyricWord[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = Number(m[1]);
    const duration = Number(m[2]);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(duration) ||
      start < 0 ||
      duration <= 0
    ) {
      continue;
    }

    // 标记在前、文字在后；最后一组吃到行尾。空格（如 " - "）也算一个字
    const from = (m.index ?? 0) + m[0].length;
    const to =
      i + 1 < matches.length
        ? (matches[i + 1].index ?? raw.length)
        : raw.length;
    const text = raw.slice(from, to);
    if (!text) continue;

    words.push({ text, start, end: start + duration });
  }

  // 纯空格 token 不占独立的逐字 step：唱到空格时若上一字突然失去覆盖层，
  // 看起来就是「上一行末字晃一下」。把空格并入相邻字的文本并延长其结束时间，
  // 空格跟着字一起唱完，过渡连续。
  const merged: LyricWord[] = [];
  let leadingSpace = "";
  for (const w of words) {
    if (w.text.trim() === "") {
      if (merged.length > 0) {
        const prev = merged[merged.length - 1];
        prev.text += w.text;
        prev.end = Math.max(prev.end, w.end);
      } else {
        leadingSpace += w.text;
      }
      continue;
    }
    if (leadingSpace) {
      w.text = leadingSpace + w.text;
      leadingSpace = "";
    }
    merged.push(w);
  }
  if (leadingSpace && merged.length > 0) {
    merged[merged.length - 1].text += leadingSpace;
  }

  return merged.length > 0 ? merged : undefined;
}

export function parseSimpleLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const line of lrc.split("\n")) {
    const timeMatches = [...line.matchAll(TIME_EXP)];

    if (timeMatches.length > 0) {
      const raw = line.replace(TIME_EXP, "");
      // text 始终剥掉字级标记，车载/桌面歌词拿到的仍是干净的逐行文本
      const text = raw.replace(WORD_TIME_EXP, "").trim();

      if (text) {
        const words = extractWords(raw);

        for (const m of timeMatches) {
          const time =
            Number(m[1]) * 60 +
            Number(m[2]) +
            Number(m[3].padEnd(3, "0")) / 1000;

          lines.push({ time, text, ...(words && { words }) });
        }
      }
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

/** 解析歌词，并把译文按时间戳就近匹配到原文行上 */
export function parseLrc(lrc: string, tLrc?: string): LyricLine[] {
  const lLines = parseSimpleLrc(lrc);

  if (!tLrc) {
    return lLines;
  }

  const tLines = parseSimpleLrc(tLrc);
  const result: LyricLine[] = [];
  let tIdx = 0;

  for (const line of lLines) {
    let ttext: string | undefined;

    while (
      tIdx < tLines.length &&
      tLines[tIdx].time < line.time - MATCH_TOLERANCE
    ) {
      tIdx++;
    }

    let bestMatchIdx = -1;
    let minDiff = MATCH_TOLERANCE;

    for (let i = tIdx; i < tLines.length; i++) {
      const diff = Math.abs(tLines[i].time - line.time);

      if (tLines[i].time > line.time + MATCH_TOLERANCE) {
        break;
      }

      if (diff <= MATCH_TOLERANCE && diff < minDiff) {
        minDiff = diff;
        bestMatchIdx = i;
      }
    }

    if (bestMatchIdx !== -1) {
      ttext = tLines[bestMatchIdx].text;
    }

    result.push({ ...line, ttext });
  }

  return result;
}

/**
 * 当前播放时间对应的歌词行下标。
 * 早于第一行（前奏）时返回 -1，交由调用方决定显示什么（界面用第 0 行占位，
 * 车机则回退显示歌名）。
 */
export function findActiveLyricIndex(
  lines: LyricLine[],
  currentTime: number,
  offset = 0
): number {
  if (lines.length === 0) return -1;

  return lines.findLastIndex((line) => currentTime >= line.time + offset);
}
