package com.otterhub.music;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.provider.MediaStore;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 本地音频文件的标签改写与侧挂歌词查找。
 *
 * 繁转简只重写 FLAC 的 VORBIS_COMMENT（流式重写，音频帧不过内存）；其它容器目前只
 * 重命名文件、不改内嵌标签，由调用方在结果里标注 skipReason。
 */
final class MusicTagEditor {

    /** 需要参与繁转简的标签键（Vorbis Comment 键名，大小写不敏感比较）。 */
    private static final String[] LOCALIZABLE_KEYS = { "TITLE", "ARTIST", "ALBUM" };

    private static final int FLAC_BLOCK_VORBIS_COMMENT = 4;
    private static final int FLAC_BLOCK_PADDING = 1;
    private static final int MAX_METADATA_BLOCK = 5 * 1024 * 1024;
    private static final int FLAC_WRITE_PADDING = 8 * 1024;
    private static final int COPY_BUFFER_SIZE = 64 * 1024;
    private static final String DEFAULT_VORBIS_VENDOR = "Otter Music";

    /** 侧挂歌词可能出现的子目录名（小写比较）。 */
    private static final String[] LYRIC_SUBDIRS = { "lyrics", "lyric", "lrc", "歌词" };

    private MusicTagEditor() {}

    /** 单条文件的转换结果。 */
    static final class ItemResult {
        boolean tagsChanged;
        boolean renamed;
        String oldPath;
        String newPath;
        String oldFileName;
        String newFileName;
        String skipReason;

        boolean hasChange() {
            return tagsChanged || renamed;
        }
    }

    /* ------------------------------------------------------------------ */
    /* 繁转简                                                              */
    /* ------------------------------------------------------------------ */

    /**
     * 转换单个文件：先改内嵌标签，再改文件名（顺序固定，避免路径失效）。
     *
     * @param renameFile 是否把文件名中的繁体也转成简体
     */
    static ItemResult convertFile(
            Context context,
            String localPath,
            boolean renameFile,
            T2SConverter converter) throws IOException {

        ItemResult result = new ItemResult();
        result.oldPath = localPath;
        result.newPath = localPath;

        String plainPath = resolveAudioPath(context, localPath);
        if (plainPath == null) {
            result.skipReason = "无法解析文件路径";
            return result;
        }

        File file = new File(plainPath);
        if (!file.exists()) {
            result.skipReason = "文件不存在";
            return result;
        }
        result.oldFileName = file.getName();

        String[] tags = readTags(file);
        String title = tags[0];
        String artist = tags[1];
        String album = tags[2];

        Map<String, String> converted = new LinkedHashMap<>();
        putIfChanged(converted, "TITLE", title, converter.convert(title));
        putIfChanged(converted, "ARTIST", artist, converter.convert(artist));
        putIfChanged(converted, "ALBUM", album, converter.convert(album));

        if (!converted.isEmpty()) {
            if (isFlac(file)) {
                rewriteFlacComment(file, converted);
                result.tagsChanged = true;
            } else {
                result.skipReason = "该格式暂不支持改写内嵌标签";
            }
        }

        if (renameFile) {
            String newFileName = converter.convert(file.getName());
            if (!newFileName.equals(file.getName())) {
                File renamed = renameInPlace(file, newFileName);
                if (renamed != null) {
                    result.renamed = true;
                    result.oldFileName = file.getName();
                    result.newFileName = renamed.getName();
                    result.newPath = renamed.getAbsolutePath();
                }
            }
        }

        // 标签改了也要让媒体库重读，否则快速扫描（走 MediaStore）仍显示旧标题
        if (result.tagsChanged || result.renamed) {
            refreshMediaStore(context, plainPath, result.newPath);
        }

        return result;
    }

    /** 读取内嵌标签，返回 [title, artist, album]，缺失为 null。 */
    private static String[] readTags(File file) {
        String[] tags = new String[3];
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            try (FileInputStream fis = new FileInputStream(file)) {
                retriever.setDataSource(fis.getFD());
            }
            tags[0] = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
            tags[1] = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
            tags[2] = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
        } catch (Exception ignored) {
            // 标签读不出来时按“无变化”处理
        } finally {
            try {
                retriever.release();
            } catch (Exception ignored) {
            }
        }
        return tags;
    }

    private static void putIfChanged(
            Map<String, String> target, String key, String original, String converted) {
        if (original == null || original.isEmpty() || converted == null) return;
        if (original.equals(converted)) return;
        target.put(key, converted);
    }

    private static boolean isFlac(File file) {
        try (InputStream in = new FileInputStream(file)) {
            byte[] magic = new byte[4];
            if (in.read(magic) != 4) return false;
            return magic[0] == 'f' && magic[1] == 'L' && magic[2] == 'a' && magic[3] == 'C';
        } catch (IOException e) {
            return false;
        }
    }

    /** 同目录内重命名；目标已存在时加 (1)、(2) 后缀。失败返回 null。 */
    private static File renameInPlace(File file, String newName) {
        File parent = file.getParentFile();
        if (parent == null) return null;

        String extension = "";
        String baseName = newName;
        int dot = newName.lastIndexOf('.');
        if (dot > 0) {
            extension = newName.substring(dot);
            baseName = newName.substring(0, dot);
        }

        File candidate = new File(parent, newName);
        int suffix = 1;
        while (candidate.exists() && !candidate.equals(file)) {
            if (suffix > 99) return null;
            candidate = new File(parent, baseName + " (" + suffix + ")" + extension);
            suffix++;
        }

        if (candidate.equals(file)) return null;
        if (!file.renameTo(candidate)) return null;
        return candidate;
    }

    /**
     * 重命名后同步媒体库：先按旧路径删掉残留记录，再扫入新路径。
     * 否则列表里会同时出现一条指向不存在文件的僵尸记录。
     */
    private static void refreshMediaStore(Context context, String oldPath, String newPath) {
        ContentResolver resolver = context.getContentResolver();
        // 路径没变说明只是改了标签，直接重扫即可，不需要删记录
        if (!oldPath.equals(newPath)) {
            try {
                resolver.delete(
                        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                        MediaStore.Audio.Media.DATA + "=?",
                        new String[]{ oldPath });
            } catch (Exception ignored) {
                // 分区存储下可能被拒，交给下面的扫描兜底
            }
        }
        try {
            MediaScannerConnection.scanFile(
                    context, new String[]{ newPath }, null, null);
        } catch (Exception ignored) {
        }
    }

    /* ------------------------------------------------------------------ */
    /* FLAC 标签重写                                                       */
    /* ------------------------------------------------------------------ */

    /**
     * 重写 FLAC 的 VORBIS_COMMENT：替换给定键的值，其余条目原样保留。
     * 音频帧以流式方式复制到临时文件，内存占用与文件大小无关。
     */
    private static void rewriteFlacComment(File source, Map<String, String> replacements)
            throws IOException {

        File temp = new File(source.getParentFile(), source.getName() + ".t2s.tmp");
        try {
            try (InputStream in = new FileInputStream(source);
                 OutputStream out = new BufferedOutputStream(
                         new FileOutputStream(temp), COPY_BUFFER_SIZE)) {

                byte[] magic = readExact(in, 4);
                if (magic == null || magic[0] != 'f' || magic[1] != 'L'
                        || magic[2] != 'a' || magic[3] != 'C') {
                    throw new IOException("Not a FLAC file");
                }
                out.write(magic);

                VorbisComment comment = null;
                boolean isLast = false;
                while (!isLast) {
                    byte[] blockHeader = readExact(in, 4);
                    if (blockHeader == null) throw new IOException("Truncated FLAC metadata");

                    isLast = (blockHeader[0] & 0x80) != 0;
                    int blockType = blockHeader[0] & 0x7F;
                    int blockLength = ((blockHeader[1] & 0xFF) << 16)
                            | ((blockHeader[2] & 0xFF) << 8)
                            | (blockHeader[3] & 0xFF);

                    if (blockType == FLAC_BLOCK_VORBIS_COMMENT) {
                        if (blockLength > MAX_METADATA_BLOCK) {
                            throw new IOException("Vorbis comment too large");
                        }
                        byte[] block = readExact(in, blockLength);
                        if (block == null) throw new IOException("Truncated vorbis comment");
                        comment = parseVorbisComment(block);
                        continue;
                    }

                    // 旧 PADDING 丢弃，统一在末尾补一个新的
                    if (blockType == FLAC_BLOCK_PADDING) {
                        if (!skipFully(in, blockLength)) {
                            throw new IOException("Truncated padding");
                        }
                        continue;
                    }

                    writeBlockHeader(out, blockType, blockLength, false);
                    if (!copyExact(in, out, blockLength)) {
                        throw new IOException("Truncated FLAC block");
                    }
                }

                byte[] rebuilt = buildVorbisComment(comment, replacements);
                writeBlockHeader(out, FLAC_BLOCK_VORBIS_COMMENT, rebuilt.length, false);
                out.write(rebuilt);

                writeBlockHeader(out, FLAC_BLOCK_PADDING, FLAC_WRITE_PADDING, true);
                out.write(new byte[FLAC_WRITE_PADDING]);

                copyRemaining(in, out);
            }

            if (!temp.renameTo(source)) throw new IOException("Failed to replace file");
        } catch (IOException | RuntimeException e) {
            temp.delete();
            throw e;
        }
    }

    private static final class VorbisComment {
        String vendor;
        final List<String> entries = new ArrayList<>();
    }

    private static VorbisComment parseVorbisComment(byte[] block) {
        if (block.length < 4) return null;

        int vendorLength = readLeInt(block, 0);
        if (vendorLength < 0 || vendorLength > block.length - 4) return null;

        int offset = 4;
        VorbisComment comment = new VorbisComment();
        comment.vendor = new String(block, offset, vendorLength, StandardCharsets.UTF_8);
        offset += vendorLength;
        if (offset + 4 > block.length) return null;

        int count = readLeInt(block, offset);
        offset += 4;
        if (count < 0) return null;

        for (int i = 0; i < count; i++) {
            if (offset + 4 > block.length) break;
            int length = readLeInt(block, offset);
            offset += 4;
            if (length < 0 || length > block.length - offset) break;
            comment.entries.add(new String(block, offset, length, StandardCharsets.UTF_8));
            offset += length;
        }
        return comment;
    }

    /** 在原条目基础上替换指定键，保留 vendor、顺序和其它字段。 */
    private static byte[] buildVorbisComment(
            VorbisComment source, Map<String, String> replacements) throws IOException {

        String vendor = source != null && source.vendor != null && !source.vendor.isEmpty()
                ? source.vendor
                : DEFAULT_VORBIS_VENDOR;

        List<byte[]> entries = new ArrayList<>();
        Set<String> alreadyReplaced = new LinkedHashSet<>();

        if (source != null) {
            for (String entry : source.entries) {
                int equalsIdx = entry.indexOf('=');
                if (equalsIdx <= 0) continue;

                String key = entry.substring(0, equalsIdx).trim();
                String replacementKey = findReplacementKey(replacements, key);
                if (replacementKey != null) {
                    // 同一个键可能有多条（如多歌手），只保留第一条替换后的
                    if (alreadyReplaced.contains(replacementKey)) continue;
                    alreadyReplaced.add(replacementKey);
                    entries.add((replacementKey + "=" + replacements.get(replacementKey))
                            .getBytes(StandardCharsets.UTF_8));
                    continue;
                }
                entries.add(entry.getBytes(StandardCharsets.UTF_8));
            }
        }

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] vendorBytes = vendor.getBytes(StandardCharsets.UTF_8);
        writeLeInt(out, vendorBytes.length);
        out.write(vendorBytes, 0, vendorBytes.length);
        writeLeInt(out, entries.size());
        for (byte[] entry : entries) {
            writeLeInt(out, entry.length);
            out.write(entry, 0, entry.length);
        }
        return out.toByteArray();
    }

    /** 大小写不敏感地找出 replacements 中匹配 key 的键名。 */
    private static String findReplacementKey(Map<String, String> replacements, String key) {
        for (String candidate : replacements.keySet()) {
            if (candidate.equalsIgnoreCase(key)) return candidate;
        }
        return null;
    }

    private static void writeBlockHeader(
            OutputStream out, int blockType, int length, boolean isLast) throws IOException {
        out.write((isLast ? 0x80 : 0) | (blockType & 0x7F));
        out.write((length >> 16) & 0xFF);
        out.write((length >> 8) & 0xFF);
        out.write(length & 0xFF);
    }

    private static void writeLeInt(OutputStream out, int value) throws IOException {
        out.write(value & 0xFF);
        out.write((value >> 8) & 0xFF);
        out.write((value >> 16) & 0xFF);
        out.write((value >> 24) & 0xFF);
    }

    private static int readLeInt(byte[] data, int offset) {
        return (data[offset] & 0xFF)
                | ((data[offset + 1] & 0xFF) << 8)
                | ((data[offset + 2] & 0xFF) << 16)
                | ((data[offset + 3] & 0xFF) << 24);
    }

    private static byte[] readExact(InputStream in, int length) throws IOException {
        byte[] buffer = new byte[length];
        int offset = 0;
        while (offset < length) {
            int read = in.read(buffer, offset, length - offset);
            if (read < 0) return null;
            offset += read;
        }
        return buffer;
    }

    private static boolean copyExact(InputStream in, OutputStream out, int length)
            throws IOException {
        byte[] buffer = new byte[COPY_BUFFER_SIZE];
        int remaining = length;
        while (remaining > 0) {
            int read = in.read(buffer, 0, Math.min(buffer.length, remaining));
            if (read < 0) return false;
            out.write(buffer, 0, read);
            remaining -= read;
        }
        return true;
    }

    private static void copyRemaining(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[COPY_BUFFER_SIZE];
        int read;
        while ((read = in.read(buffer)) >= 0) out.write(buffer, 0, read);
    }

    private static boolean skipFully(InputStream in, int length) throws IOException {
        int remaining = length;
        byte[] buffer = new byte[Math.min(COPY_BUFFER_SIZE, Math.max(remaining, 1))];
        while (remaining > 0) {
            int read = in.read(buffer, 0, Math.min(buffer.length, remaining));
            if (read < 0) return false;
            remaining -= read;
        }
        return true;
    }

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

    /* ------------------------------------------------------------------ */

    static boolean needsConversion(T2SConverter converter, String... texts) {
        for (String text : texts) {
            if (text != null && converter.containsTraditional(text)) return true;
        }
        return false;
    }

    /**
     * 预检：必须与 {@link #convertFile} 使用完全相同的标签读取路径，
     * 否则会出现「预检说不用转、转换却能转」的误判。
     */
    static boolean needsConversion(Context context, String localPath, T2SConverter converter) {
        String plainPath = resolveAudioPath(context, localPath);
        if (plainPath == null) return false;

        File file = new File(plainPath);
        if (!file.exists()) return false;
        if (converter.containsTraditional(file.getName())) return true;

        String[] tags = readTags(file);
        return needsConversion(converter, tags[0], tags[1], tags[2]);
    }
}
