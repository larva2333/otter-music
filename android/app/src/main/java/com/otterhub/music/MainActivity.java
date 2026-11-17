package com.otterhub.music;

import static androidx.core.view.WindowCompat.enableEdgeToEdge;

import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    /** 主题偏好由网页层写入，原生在冷启动时读取，用来决定启动底色 */
    public static final String THEME_PREFS = "otter_theme";
    public static final String THEME_KEY = "theme";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须在 super.onCreate 之前把窗口底色换掉，否则布局出来时会先闪一帧静态底色
        applyWindowBackground();
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
        registerPlugin(AppInstallerPlugin.class);
        super.onCreate(savedInstanceState);
        useTransientSystemBars();
        applyWebViewBackground();
        padWebViewForIme();
    }

    /**
     * Android 15 起 edge-to-edge 强制生效，`adjustResize` 不再缩小窗口，键盘会直接盖住页面。
     *
     * 注意不能用 `webView.setPadding(...)`：WebView 的 padding 不参与 CSS 视口的计算，
     * 网页里的 `100vh` / `position: fixed; bottom: 0`（底部抽屉、输入框）依然按整屏高度算，
     * 结果就是「新建/导入」抽屉被键盘整个盖住、搜出来的历史面板被顶出屏幕。
     *
     * 这里改成给 WebView 加**底部外边距**（layout margin）：父容器会把 WebView 重新布局成
     * 更矮的一块，CSS 视口跟着变矮，`fixed` 元素自然落在键盘上方，和旧版本 adjustResize 一致。
     */
    private void padWebViewForIme() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return;
        if (getBridge() == null || getBridge().getWebView() == null) return;
        View webView = getBridge().getWebView();
        if (!(webView.getLayoutParams() instanceof ViewGroup.MarginLayoutParams)) return;

        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
            int imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            ViewGroup.LayoutParams raw = v.getLayoutParams();
            if (raw instanceof ViewGroup.MarginLayoutParams) {
                ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) raw;
                if (lp.bottomMargin != imeBottom) {
                    lp.bottomMargin = imeBottom;
                    v.setLayoutParams(lp);
                }
            }
            return insets;
        });
        ViewCompat.requestApplyInsets(webView);
    }

    /**
     * 冷启动「闪一下黑」的根因：WebView 在首帧渲染之前，它自己的 surface 是黑的。
     * 启动窗口（windowBackground）退出时正好把这块黑色露出来，于是白 → 黑 → 白闪一下。
     *
     * 这里把 WebView 背景显式刷成启动窗口同色，网页层也刻意不写 html 背景
     * （见 index.html），首帧之前透出的就是这层颜色，冷启动全程只有一个底色。
     * 注意：WebView 的 prefers-color-scheme 与原生 Configuration 可能不一致
     * （实测系统浅色时 WebView 仍报 dark），所以这里不能按媒体查询取值。
     */
    private void applyWebViewBackground() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().setBackgroundColor(resolveWindowBackgroundColor());
    }

    private void applyWindowBackground() {
        getWindow().setBackgroundDrawable(new ColorDrawable(resolveWindowBackgroundColor()));
    }

    /**
     * 启动底色取哪一套：优先 APP 内的主题偏好（网页层通过 LocalMusicPlugin
     * .setStoredTheme 写进来），"跟随系统"时看 Configuration 的日夜。
     * 这样系统深色 + APP 内选浅色、或系统浅色 + APP 内选深色，都不会串色。
     */
    private int resolveWindowBackgroundColor() {
        String pref = getSharedPreferences(THEME_PREFS, MODE_PRIVATE).getString(THEME_KEY, "system");
        boolean dark;
        if ("dark".equals(pref)) {
            dark = true;
        } else if ("light".equals(pref)) {
            dark = false;
        } else {
            dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        }
        return ContextCompat.getColor(
            this,
            dark ? R.color.app_window_background_dark : R.color.app_window_background_light
        );
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
     *
     *    同理，AndroidManifest 里 MainActivity 必须声明 android:screenOrientation="user"。
     *    不声明时活动启动默认是 UNSPECIFIED，冷启动（例如刚装完点开）照样无视方向锁，
     *    只有进过横屏模式、调用过 unlock() 之后才被这里的改写纠正——这就是
     *    「装一次就把方向锁搞没了」的真正来源。
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
        // 日夜切换后「跟随系统」的底色要跟着换，WebView 底和窗口底一起刷
        applyWindowBackground();
        applyWebViewBackground();
        int nightModeFlags = newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK;
        boolean isDarkMode = nightModeFlags == Configuration.UI_MODE_NIGHT_YES;
        PluginHandle handle = getBridge().getPlugin("LocalMusicPlugin");
        if (handle != null) {
            ((LocalMusicPlugin) handle.getInstance()).notifyDarkModeChange(isDarkMode);
        }
    }
}
