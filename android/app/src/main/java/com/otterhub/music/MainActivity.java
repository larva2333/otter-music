package com.otterhub.music;

import static androidx.core.view.WindowCompat.enableEdgeToEdge;

import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Android 15 enforces edge-to-edge; older versions should let the
        // system keep WebView content above the navigation bar.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            enableEdgeToEdge(getWindow());
        }
        registerPlugin(LocalMusicPlugin.class);
        registerPlugin(BilibiliProxyPlugin.class);
        registerPlugin(AudioRoutePlugin.class);
        registerPlugin(WebViewLoginPlugin.class);
        registerPlugin(DesktopLyricPlugin.class);
        super.onCreate(savedInstanceState);
        useTransientSystemBars();
    }

    /**
     * 让被隐藏的系统栏以「瞬时」方式显示：用户从边缘下拉时系统栏只是浮层显示并在数秒后自动收回。
     * 默认的 BEHAVIOR_SHOW_BARS_BY_SWIPE 会把系统栏永久显示出来，导致横屏沉浸模式下状态栏常驻。
     */
    private void useTransientSystemBars() {
        WindowInsetsControllerCompat insetsController = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        insetsController.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    /**
     * 屏幕方向的两处适配，都在真机上验证过：
     *
     * 1. 插件的 lock("landscape") 只能锁固定横屏（SCREEN_ORIENTATION_LANDSCAPE），
     *    设备旋转 180° 时不会翻转。改写成「传感器横屏」，允许在两个横向之间翻转，
     *    同时仍然禁止竖屏。
     *
     * 2. 插件的 unlock() 会设 SCREEN_ORIENTATION_UNSPECIFIED，这个值**不理会系统的
     *    「自动旋转」开关**——用户明明在控制中心锁定了竖屏，退出横屏播放后整个 App
     *    却开始跟着手机转，看起来就像「方向锁被应用关掉了」。改写为
     *    SCREEN_ORIENTATION_USER，按用户当前偏好决定：锁着就保持不动，开着才跟随传感器。
     */
    @Override
    public void setRequestedOrientation(int requestedOrientation) {
        if (requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        } else if (requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_USER;
        }
        super.setRequestedOrientation(requestedOrientation);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        int nightModeFlags = newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK;
        boolean isDarkMode = nightModeFlags == Configuration.UI_MODE_NIGHT_YES;
        PluginHandle handle = getBridge().getPlugin("LocalMusicPlugin");
        if (handle != null) {
            ((LocalMusicPlugin) handle.getInstance()).notifyDarkModeChange(isDarkMode);
        }
    }
}
