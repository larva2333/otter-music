package com.otterhub.music;

import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * 应用缓存统计与清理。
 *
 * Android 上占大头的不是 Cache Storage API，而是 WebView 自己的 HTTP 磁盘缓存，
 * 位于 context.getCacheDir()/WebView/Default/HTTP Cache。JS 侧既读不到它的体积，
 * 也清不掉它（caches.delete() 只作用于 Cache Storage API），所以由原生插件代劳。
 */
@CapacitorPlugin(name = "CacheManager")
public class CacheManagerPlugin extends Plugin {

    /** 返回应用 cache 目录的实际体积（字节），包含 WebView HTTP Cache 与更新包残留 */
    @PluginMethod
    public void getCacheSize(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("bytes", dirSize(getContext().getCacheDir()));
        call.resolve(ret);
    }

    /**
     * 清掉 WebView 的 HTTP 磁盘缓存，返回清理后的剩余体积。
     * 必须在 UI 线程调用：WebView.clearCache 会碰 WebView 的内部状态。
     */
    @PluginMethod
    public void clearWebViewCache(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView != null) {
                    webView.clearCache(true);
                } else {
                    // WebView 尚未就绪时兜底：直接删它的缓存目录
                    deleteRecursively(new File(getContext().getCacheDir(), "WebView"));
                }
                // WebView.clearCache 真正删文件是异步的，立刻量会读到删除中途的体积
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    JSObject ret = new JSObject();
                    ret.put("bytes", dirSize(getContext().getCacheDir()));
                    call.resolve(ret);
                }, 800);
            } catch (Exception e) {
                call.reject("清理缓存失败: " + e.getMessage(), "CACHE_CLEAR_FAILED", e);
            }
        });
    }

    private long dirSize(File dir) {
        if (dir == null || !dir.exists()) return 0;
        File[] files = dir.listFiles();
        if (files == null) return 0;
        long total = 0;
        for (File file : files) {
            total += file.isDirectory() ? dirSize(file) : file.length();
        }
        return total;
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursively(child);
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
