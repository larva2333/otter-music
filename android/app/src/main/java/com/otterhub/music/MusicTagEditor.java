package com.otterhub.music;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 本地音频的路径解析与侧挂歌词查找。
 *
 * 只读操作：把 MediaStore 的 content:// 换成真实路径，并找出与音频同名的 .lrc。
 */
final class MusicTagEditor {

    /** 歌词文件大小上限（超过视为不是正常歌词文件）。 */
    private static final int MAX_METADATA_BLOCK = 5 * 1024 * 1024;
    private static final int COPY_BUFFER_SIZE = 64 * 1024;

    /** 侧挂歌词可能出现的子目录名（小写比较）。 */
    private static final String[] LYRIC_SUBDIRS = { "lyrics", "lyric", "lrc", "歌词" };

    private MusicTagEditor() {}

    private static String plainPathOf(String localPath) {
        if (localPath == null || localPath.isEmpty()) return null;
        if (localPath.startsWith("content://")) return null;
        if (localPath.startsWith("file://")) {
            String path = Uri.parse(localPath).getPath();
            return path != null ? path : null;
        }
        return localPath;
    }

    /**
     * 把 MediaStore 的 content:// URI 解析成真实文件路径。
     *
     * 扫描出来的 localPath 是 {@code content://media/external/audio/media/<id>}，
     * 不能直接做 File 操作，也无法重命名，必须借 DATA 列换回绝对路径。
     * 无「所有文件管理」权限时 DATA 仍可读，读不到就返回 null 由调用方跳过。
     */
    static String resolveAudioPath(Context context, String localPath) {
        if (localPath == null || localPath.isEmpty()) return null;
        if (!localPath.startsWith("content://")) return plainPathOf(localPath);

        try (Cursor cursor = context.getContentResolver().query(
                Uri.parse(localPath),
                new String[]{ MediaStore.Audio.Media.DATA },
                null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String path = cursor.getString(0);
                return path != null && !path.isEmpty() ? path : null;
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    /* ------------------------------------------------------------------ */
    /* 侧挂 .lrc 歌词                                                      */
    /* ------------------------------------------------------------------ */

    /**
     * 查找与音频同名的 .lrc：同目录优先，其次 lyrics/lyric/lrc/歌词 子目录。
     * 兼容「xxx.lrc」和「xxx.flac.lrc」两种命名，扩展名匹配不区分大小写。
     */
    static String findSidecarLyric(Context context, String audioPath) {
        String plainPath = resolveAudioPath(context, audioPath);
        if (plainPath == null) return null;

        File audio = new File(plainPath);
        File parent = audio.getParentFile();
        if (parent == null) return null;

        String fullName = audio.getName();
        int dot = fullName.lastIndexOf('.');
        String baseName = dot > 0 ? fullName.substring(0, dot) : fullName;

        List<String> candidates = new ArrayList<>();
        candidates.add(baseName + ".lrc");
        candidates.add(fullName + ".lrc");

        // 同目录
        String found = findInDirectory(parent, candidates);
        if (found != null) return found;

        // 子目录
        File[] children = parent.listFiles();
        if (children != null) {
            for (File child : children) {
                if (!child.isDirectory()) continue;
                String dirName = child.getName().toLowerCase(Locale.ROOT);
                for (String allowed : LYRIC_SUBDIRS) {
                    if (!dirName.equals(allowed)) continue;
                    found = findInDirectory(child, candidates);
                    if (found != null) return found;
                }
            }
        }
        return null;
    }

    private static String findInDirectory(File directory, List<String> candidateNames) {
        File[] files = directory.listFiles();
        if (files == null) return null;

        for (String candidate : candidateNames) {
            for (File file : files) {
                if (!file.isFile()) continue;
                if (file.getName().equalsIgnoreCase(candidate)) {
                    return readTextFile(file);
                }
            }
        }
        return null;
    }

    /** 读文本文件：先 UTF-8 严格解码，失败再回退 GBK（老歌词文件常见）。 */
    private static String readTextFile(File file) {
        byte[] data;
        try {
            if (file.length() > MAX_METADATA_BLOCK) return null;
            try (InputStream in = new FileInputStream(file)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream((int) file.length());
                byte[] buffer = new byte[COPY_BUFFER_SIZE];
                int read;
                while ((read = in.read(buffer)) >= 0) out.write(buffer, 0, read);
                data = out.toByteArray();
            }
        } catch (IOException e) {
            return null;
        }

        // 去掉 UTF-8 BOM
        int offset = 0;
        if (data.length >= 3 && (data[0] & 0xFF) == 0xEF
                && (data[1] & 0xFF) == 0xBB && (data[2] & 0xFF) == 0xBF) {
            offset = 3;
        }

        String text = decodeStrict(data, offset, StandardCharsets.UTF_8);
        if (text == null) text = decodeStrict(data, offset, Charset.forName("GBK"));
        if (text == null) text = new String(data, offset, data.length - offset, StandardCharsets.UTF_8);
        return text.trim().isEmpty() ? null : text;
    }

    private static String decodeStrict(byte[] data, int offset, Charset charset) {
        try {
            return charset.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(data, offset, data.length - offset))
                    .toString();
        } catch (CharacterCodingException e) {
            return null;
        }
    }
}
