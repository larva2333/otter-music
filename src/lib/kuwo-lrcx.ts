/**
 * 酷我 lrcx 逐字时间戳解码。
 *
 * mlyric.kuwo.cn 的 `lrcx=1` 不是标准 LRC：每行字前带 `<a,b>`，a/b 是编码值，
 * 必须按 `[kuwo:xxx]` 标签里的八进制数还原出「相对本行起点的毫秒」。
 * 算法对齐洛雪 music-sdk 的 lrcTools.getWordInfo：
 *   n = parseInt(tag, 8)
 *   offset  = trunc(n / 10)
 *   offset2 = n % 10
 *   start = trunc(|a + b| / (2 * offset))
 *   end   = trunc(|a - b| / (2 * offset2)) + start
 *
 * 解码后写成标准 `<start,duration>` 形式，交给 `parseLrc` 统一解析；
 * 没有逐字标记（普通 LRC）时原样返回。
 */

const KUWO_TAG_EXP = /\[kuwo:\s*([0-7]+)\s*]/;
const WORD_TIME_EXP = /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g;

interface DecodedWord {
  raw: string;
  start: number;
  end: number;
}

/** 无 `[kuwo:]` 标签时无法解出时间，直接剥掉字级标记，退回普通逐行歌词 */
function stripWordTimes(lrc: string): string {
  return lrc.replace(WORD_TIME_EXP, "");
}

export function decodeKuwoLrcx(lrc: string): string {
  const tag = KUWO_TAG_EXP.exec(lrc);
  if (!tag) return lrc;

  const encoded = parseInt(tag[1], 8);
  const offset = Math.trunc(encoded / 10);
  const offset2 = encoded % 10;
  if (!Number.isFinite(encoded) || offset <= 0 || offset2 <= 0) {
    return stripWordTimes(lrc);
  }

  return lrc
    .split("\n")
    .map((line) => {
      const matches = [...line.matchAll(WORD_TIME_EXP)];
      if (matches.length === 0) return line;

      const words: DecodedWord[] = [];
      for (const m of matches) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        const start = Math.trunc(Math.abs(a + b) / (2 * offset));
        const end = Math.trunc(Math.abs(a - b) / (2 * offset2)) + start;

        // 洛雪的防重叠修正：当前字起点早于上一个字终点时，截断上一个字
        const prev = words[words.length - 1];
        if (prev && start < prev.end) {
          prev.end = start;
          if (prev.start > prev.end) prev.start = prev.end;
        }

        words.push({ raw: m[0], start, end });
      }

      let out = "";
      let cursor = 0;
      for (const w of words) {
        const idx = line.indexOf(w.raw, cursor);
        if (idx < 0) break;
        out +=
          line.slice(cursor, idx) +
          `<${w.start},${Math.max(0, w.end - w.start)}>`;
        cursor = idx + w.raw.length;
      }
      return out + line.slice(cursor);
    })
    .join("\n");
}
