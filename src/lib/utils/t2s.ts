import charsRaw from "./opencc/t2s-chars.txt?raw";
import phrasesRaw from "./opencc/t2s-phrases.txt?raw";
import jpRaw from "./opencc/jp-shinjitai.txt?raw";

/**
 * 繁体 → 简体（显示层）。
 *
 * 词表来自 OpenCC 的 TSCharacters / TSPhrases（裁剪后放在 ./opencc 下）与
 * 一张日文新字体表。文本在构建时直接打进 JS，因此转换是同步的，
 * 列表里的每一行都能就地转换，不需要逐行 IPC。
 *
 * 策略同样与 OpenCC 的 t2s 一致：短语优先、单字兜底，避免「乾隆」被转成「干隆」
 * 这类消歧错误。日文新字体表（聴/気/実…）作为可选兜底一起加载。
 *
 * 只用于界面展示，不写任何文件。
 */

const charMap = new Map<string, string>();
const phraseMap = new Map<string, string>();
/** 短语首字集合：判定「这段文字是否可能含短语」用，避免每段都做短语匹配 */
const phraseFirstChars = new Set<string>();
let maxPhraseLen = 2;

function loadChars(raw: string) {
  for (const line of raw.split("\n")) {
    const text = line.trim();
    if (text.length < 2 || text.startsWith("#")) continue;
    const traditional = text[0];
    const simplified = text[1];
    if (traditional === simplified) continue;
    charMap.set(traditional, simplified);
  }
}

loadChars(charsRaw);
// 日文新字体表是可选的，格式与单字表相同
loadChars(jpRaw);

// OpenCC TSCharacters 未收录部分台港常用异体代词（如「妳聽得到」），
// 与 music-key.ts 保持一致做单字兜底，避免显示与本地曲目反查漏匹配。
for (const [traditional, simplified] of Object.entries({
  妳: "你",
  祢: "你",
  牠: "它",
  祂: "他",
})) {
  if (!charMap.has(traditional)) charMap.set(traditional, simplified);
}

for (const line of phrasesRaw.split("\n")) {
  const text = line.trim();
  if (text.length < 4 || text.length % 2 !== 0 || text.startsWith("#"))
    continue;
  const half = text.length / 2;
  const traditional = text.slice(0, half);
  const simplified = text.slice(half);
  // 映射到自身的短语（如「乾隆乾隆」）也要保留：它的作用正是挡住单字兜底
  phraseMap.set(traditional, simplified);
  phraseFirstChars.add(traditional[0]);
  if (half > maxPhraseLen) maxPhraseLen = half;
}

/** 结果缓存：歌曲名、歌单名在同一会话里会被反复渲染，命中后就是纯查表 */
const cache = new Map<string, string>();
const CACHE_LIMIT = 4000;

/** 文本里是否可能存在需要转换的字 */
function mayContainTraditional(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (charMap.has(ch) || phraseFirstChars.has(ch)) return true;
  }
  return false;
}

/**
 * 把一段文字转成简体。已是简体（或无需转换）时原样返回。
 *
 * 幂等，可以到处调用；内部有缓存，重复渲染不会重复计算。
 */
export function t2s(text: string | null | undefined): string {
  if (!text) return text ?? "";
  if (!mayContainTraditional(text)) return text;

  const cached = cache.get(text);
  if (cached !== undefined) return cached;

  let out = "";
  let i = 0;
  while (i < text.length) {
    const maxLen = Math.min(maxPhraseLen, text.length - i);
    let matchedPhrase = false;
    for (let len = maxLen; len >= 2; len--) {
      const candidate = text.slice(i, i + len);
      const replaced = phraseMap.get(candidate);
      if (replaced !== undefined) {
        out += replaced;
        i += len;
        matchedPhrase = true;
        break;
      }
    }
    if (matchedPhrase) continue;

    const ch = text[i];
    out += charMap.get(ch) ?? ch;
    i++;
  }

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(text, out);
  return out;
}

/** 歌手的便捷入口：数组逐项转换后原样返回新数组（有变化才建新数组） */
export function t2sArtists(artists: string[] | null | undefined): string[] {
  if (!artists || artists.length === 0) return artists ?? [];
  let changed = false;
  const next = artists.map((name) => {
    const converted = t2s(name);
    if (converted !== name) changed = true;
    return converted;
  });
  return changed ? next : artists;
}
