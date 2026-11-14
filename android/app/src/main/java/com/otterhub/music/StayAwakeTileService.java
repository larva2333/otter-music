package com.otterhub.music;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.provider.Settings;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import android.widget.Toast;

/**
 * 通知栏快捷开关：不锁屏（开发者选项里的「不锁定屏幕」）。
 *
 * 写的是 {@code Settings.Global.STAY_ON_WHILE_PLUGGED_IN}，也就是
 * {@code adb shell svc power stayon true} 操作的同一个值：
 * 打开后只要插着电，屏幕就不会自动熄灭，自然也不会进锁屏。
 *
 * 这个 key 属于 Global 设置，应用侧需要 WRITE_SECURE_SETTINGS。
 * 该权限不在运行时权限列表里，只能用 adb 一次性授予：
 * {@code adb shell pm grant com.otterhub.music android.permission.WRITE_SECURE_SETTINGS}
 * 授予后一直有效（卸载应用会失效，重装需重新授予）。
 *
 * 注意：这里刻意不写「关闭锁屏」。系统在有密码时会忽略
 * {@code locksettings set-disabled}，普通应用无法绕过，所以做真了也是假的。
 */
public class StayAwakeTileService extends TileService {

    /** 与 PowerManager.BATTERY_PLUGGED_* 的位掩码一致：USB(2) | AC(1) | WIRELESS(4) */
    private static final int STAY_ON_PLUGGED_ALL = 7;
    private static final String SETTING_KEY = Settings.Global.STAY_ON_WHILE_PLUGGED_IN;
    private static final String LABEL = "不锁屏";

    @Override
    public void onStartListening() {
        super.onStartListening();
        updateTile();
    }

    @Override
    public void onTileAdded() {
        super.onTileAdded();
        updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();

        if (!canWriteSecureSettings()) {
            Toast.makeText(
                    this,
                    "缺少权限，请用 adb 执行：\npm grant " + getPackageName()
                            + " android.permission.WRITE_SECURE_SETTINGS",
                    Toast.LENGTH_LONG
            ).show();
            updateTile();
            return;
        }

        boolean turningOff = isStayAwakeOn();
        try {
            Settings.Global.putInt(
                    getContentResolver(),
                    SETTING_KEY,
                    turningOff ? 0 : STAY_ON_PLUGGED_ALL
            );
        } catch (SecurityException e) {
            Toast.makeText(this, "写入系统设置被拒绝", Toast.LENGTH_SHORT).show();
            return;
        }

        // 回读而不是直接相信写入结果，权限/策略被拦时能如实显示
        boolean nowOn = isStayAwakeOn();
        updateTile();
        Toast.makeText(
                this,
                nowOn == !turningOff
                        ? (nowOn ? "已开启：插电生效" : "已关闭：恢复自动熄屏")
                        : "切换失败，系统拒绝了这次修改",
                Toast.LENGTH_SHORT
        ).show();
    }

    private boolean isStayAwakeOn() {
        return Settings.Global.getInt(getContentResolver(), SETTING_KEY, 0) != 0;
    }

    private boolean canWriteSecureSettings() {
        return checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void updateTile() {
        Tile tile = getQsTile();
        if (tile == null) return;

        boolean authorized = canWriteSecureSettings();
        boolean enabled = authorized && isStayAwakeOn();

        tile.setState(enabled ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        // MIUI 有两个限制，都在真机验证过：
        // ① 以「用户请求」为由吞掉本应用的 Toast（logcat 里
        //    Suppressing toast from package ... by user request）；
        // ② 快捷面板只渲染标题，setSubtitle() 写了也不显示；
        //    而标题超过约 6 个字会折行，出现「不锁屏·插电生 / 效」这种
        //    掉单个字的排版。所以开启态改用 5 字的「插电不锁屏」，
        //    既说得清「插电才生效」，也能保证一行放得下。
        String label = LABEL;
        if (!authorized) {
            label = LABEL + "·未授权";
        } else if (enabled) {
            label = "插电不锁屏";
        }
        tile.setLabel(label);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.setSubtitle(
                    !authorized
                            ? "需 adb 授权"
                            : enabled ? "插电生效" : "已关闭"
            );
        }
        tile.setIcon(Icon.createWithResource(this, R.drawable.ic_tile_stay_awake));
        tile.updateTile();
    }
}
