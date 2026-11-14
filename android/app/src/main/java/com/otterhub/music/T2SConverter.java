package com.otterhub.music;

import android.content.Context;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 繁体 → 简体转换器。
 *
 * 词表来自 OpenCC 的 TSPhrases（短语例外）与 TSCharacters（单字），裁剪后放在
 * assets/opencc/ 下，首次使用时懒加载。
 *
 * 转换策略与 OpenCC 的 t2s 一致：**短语优先，单字兜底**。短语优先级是为了避免
 * 「乾隆」被转成「干隆」这类消歧错误——单字表里「乾」映射到「干」，但短语表里
 * 「乾隆」映射到它自己（保留原样）。
 *
 * 只用于音乐标签与文件名的展示层转换，不追求全语言覆盖。
 */
final class T2SConverter {

    private static final String CHARS_ASSET = "opencc/t2s-chars.txt";
    private static final String PHRASES_ASSET = "opencc/t2s-phrases.txt";
    /**
     * 日本新字体 → 简体（如 聴→听、気→气、実→实）。
     * 日文汉字里被日本简化过的字形不在繁简表内，单独一张表兜底；
     * 本身已是中文常用字形的（会/体/学/芸/浜 等）已剔除，避免误伤中文歌名。
     */
    private static final String JP_ASSET = "opencc/jp-shinjitai.txt";

    private static volatile T2SConverter instance;

    private final Map<Character, Character> charMap = new HashMap<>(4096);
    private final Map<String, String> phraseMap = new HashMap<>(1024);
    /** 短语按长度分桶，长度从大到小依次尝试，保证最长匹配。 */
    private final List<List<String>> phraseBuckets = new ArrayList<>();

    static T2SConverter get(Context context) {
        T2SConverter local = instance;
        if (local != null) return local;
        synchronized (T2SConverter.class) {
            if (instance == null) instance = new T2SConverter(context);
            return instance;
        }
    }

    private T2SConverter(Context context) {
        try {
            loadChars(context);
        } catch (IOException ignored) {
            // 词表缺失时保持空表，转换退化为原样返回，不阻塞调用方
        }
        // 日文新字体表是可选的：缺失时只做繁简转换，不影响主流程
        try {
            loadCharsFrom(context, JP_ASSET);
        } catch (IOException ignored) {
        }
        try {
            loadPhrases(context);
        } catch (IOException ignored) {
        }
    }

    private void loadChars(Context context) throws IOException {
        loadCharsFrom(context, CHARS_ASSET);
    }

    private void loadCharsFrom(Context context, String assetName) throws IOException {
        List<String> lines = readLines(context, assetName);
        for (String line : lines) {
            if (line.length() < 2) continue;
            char traditional = line.charAt(0);
            char simplified = line.charAt(1);
            if (traditional == simplified) continue;
            charMap.put(traditional, simplified);
        }
    }

    private void loadPhrases(Context context) throws IOException {
        List<String> lines = readLines(context, PHRASES_ASSET);
        int maxLength = 0;
        for (String line : lines) {
            if (line.length() < 4 || line.length() % 2 != 0) continue;
            int half = line.length() / 2;
            String traditional = line.substring(0, half);
            String simplified = line.substring(half);
            phraseMap.put(traditional, simplified);
            if (half > maxLength) maxLength = half;
        }
        for (int i = 0; i <= maxLength; i++) phraseBuckets.add(new ArrayList<>());
        for (String key : phraseMap.keySet()) {
            phraseBuckets.get(key.length()).add(key);
        }
        // 同一长度内按字典序稳定排序，纯粹是为了可复现
        for (List<String> bucket : phraseBuckets) {
            bucket.sort(Comparator.naturalOrder());
        }
    }

    private List<String> readLines(Context context, String assetName) throws IOException {
        List<String> lines = new ArrayList<>();
        try (InputStream in = context.getAssets().open(assetName);
             BufferedReader reader = new BufferedReader(
                     new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.charAt(0) == '#') continue;
                lines.add(line);
            }
        }
        return lines;
    }

    /** 词表是否加载成功。 */
    boolean isReady() {
        return !charMap.isEmpty();
    }

    /** 是否含有可被转换的繁体字符（含短语消歧后仍会变化的词组）。 */
    boolean containsTraditional(String input) {
        if (input == null || input.isEmpty()) return false;
        for (int i = 0; i < input.length(); i++) {
            Character mapped = charMap.get(input.charAt(i));
            if (mapped != null && mapped != input.charAt(i)) return true;
        }
        return false;
    }

    /** 繁体转简体；无词表或无可转换字符时原样返回。 */
    String convert(String input) {
        if (input == null || input.isEmpty()) return input;

        StringBuilder out = new StringBuilder(input.length());
        int i = 0;
        while (i < input.length()) {
            String phrase = matchPhrase(input, i);
            if (phrase != null) {
                out.append(phraseMap.get(phrase));
                i += phrase.length();
                continue;
            }
            char c = input.charAt(i);
            Character mapped = charMap.get(c);
            out.append(mapped != null ? mapped : c);
            i++;
        }
        return out.toString();
    }

    /** 在 position 处做最长短语匹配，未命中返回 null。 */
    private String matchPhrase(String input, int position) {
        int maxLength = Math.min(phraseBuckets.size() - 1, input.length() - position);
        for (int length = maxLength; length >= 2; length--) {
            List<String> bucket = phraseBuckets.get(length);
            if (bucket.isEmpty()) continue;
            String candidate = input.substring(position, position + length);
            if (phraseMap.containsKey(candidate)) return candidate;
        }
        return null;
    }
}
