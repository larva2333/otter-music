import { registerPlugin } from "@capacitor/core";

/**
 * APK 安装器插件（仅 Android 原生实现）。
 *
 * 只负责"把已下载到本机的 apk 交给系统安装器"，不下载、不弹通知。
 * 下载由 JS 侧 FileTransfer 完成（进度可回传 UI），装完的临时文件由 JS 清理。
 *
 * 需要 REQUEST_INSTALL_PACKAGES 权限；未授予时 install() 会先跳系统授权页，
 * 再以 NEED_INSTALL_PERMISSION 拒绝，调用方提示用户授权后重试即可。
 */
export interface AppInstallerPlugin {
  /** 是否已允许「安装未知应用」 */
  canInstall(): Promise<{ granted: boolean }>;
  /** 跳转本应用的「安装未知应用」授权页 */
  openInstallSettings(): Promise<void>;
  /** 拉起系统安装器，path 支持 file:// 绝对路径 */
  install(options: { path: string }): Promise<void>;
}

const AppInstaller = registerPlugin<AppInstallerPlugin>("AppInstaller");

export { AppInstaller };
