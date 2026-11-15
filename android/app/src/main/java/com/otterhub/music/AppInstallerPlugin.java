package com.otterhub.music;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * APK 安装器插件。
 *
 * 只做一件事：把 JS 侧已经下载好的 apk 文件（cache 目录，file:// 路径）通过
 * FileProvider 转成 content:// 后交给系统安装器。下载与进度展示全在 JS 侧完成，
 * 原生不持有网络请求，也就不存在"下载失败只能重下整包"的隐藏状态。
 *
 * 依赖 REQUEST_INSTALL_PACKAGES：Android 8.0+ 必须由用户在
 * 「安装未知应用」页单独授权，无法运行时弹窗授权，故未授权时先跳授权页再拒绝。
 */
@CapacitorPlugin(name = "AppInstaller")
public class AppInstallerPlugin extends Plugin {

    private boolean canRequestPackageInstalls() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void launchInstallSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", canRequestPackageInstalls());
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            launchInstallSettings();
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开安装权限设置页", "SETTINGS_UNAVAILABLE", e);
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("缺少安装包路径", "APK_PATH_MISSING");
            return;
        }

        if (!canRequestPackageInstalls()) {
            launchInstallSettings();
            call.reject("请先允许「安装未知应用」", "NEED_INSTALL_PERMISSION");
            return;
        }

        String filePath = path.startsWith("file://") ? path.substring("file://".length()) : path;
        File apk = new File(filePath);
        if (!apk.exists() || apk.length() <= 0) {
            call.reject("安装包不存在或为空", "APK_MISSING");
            return;
        }

        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            call.resolve();
        } catch (Exception e) {
            call.reject("无法启动系统安装器: " + e.getMessage(), "INSTALL_FAILED", e);
        }
    }
}
