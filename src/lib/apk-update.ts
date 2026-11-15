import { Capacitor, PluginListenerHandle } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { FileTransfer } from "@capacitor/file-transfer";
import { AppInstaller } from "@/plugins/app-installer";
import { openUrl } from "@/lib/utils";
import { logger } from "@/lib/logger";

/** 更新包统一落在应用 cache 目录：无需存储权限，装完即删，不占用户空间 */
const APK_CACHE_DIR = Directory.Cache;
const APK_PREFIX = "otter-update-";

export interface DownloadApkOptions {
  url: string;
  /** 服务端给出的字节数，用于校验下载完整性（可选） */
  expectedSize?: number;
  onProgress?: (percent: number) => void;
}

/** 安装器缺失（老版本安装包 / Web 端）时退回系统浏览器下载 */
function isMissingNativeImpl(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /not implemented|UNIMPLEMENTED/i.test(message);
}

/** 清掉上次遗留的 apk，避免 cache 目录堆积 */
async function cleanupCachedApks() {
  try {
    const { files } = await Filesystem.readdir({
      directory: APK_CACHE_DIR,
      path: "",
    });
    await Promise.all(
      files
        .filter((file) => file.name?.startsWith(APK_PREFIX))
        .map((file) =>
          Filesystem.deleteFile({
            directory: APK_CACHE_DIR,
            path: file.name,
          }).catch(() => undefined)
        )
    );
  } catch (e) {
    logger.warn("apk-update", "清理历史安装包失败", e);
  }
}

/**
 * 应用内下载更新包并拉起系统安装器。
 *
 * - Android：FileTransfer 下载到 cache（进度回调 0-100），校验体积后交给
 *   AppInstaller 拉起系统安装器，全程不跳浏览器。
 * - Web / 缺少原生实现：退回 openUrl。
 */
export async function downloadAndInstallApk({
  url,
  expectedSize,
  onProgress,
}: DownloadApkOptions): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    openUrl(url);
    return;
  }

  // 先确认「安装未知应用」权限，避免白下一遍包
  try {
    const { granted } = await AppInstaller.canInstall();
    if (!granted) {
      await AppInstaller.openInstallSettings();
      const err = new Error("请允许「安装未知应用」后点击重试");
      Object.assign(err, { code: "NEED_INSTALL_PERMISSION" });
      throw err;
    }
  } catch (e) {
    if (isMissingNativeImpl(e)) {
      logger.warn("apk-update", "当前安装包不含安装器插件，退回浏览器下载");
      openUrl(url);
      return;
    }
    throw e;
  }

  await cleanupCachedApks();

  const fileName = `${APK_PREFIX}${Date.now()}.apk`;
  const { uri } = await Filesystem.getUri({
    directory: APK_CACHE_DIR,
    path: fileName,
  });

  let listener: PluginListenerHandle | null = null;

  try {
    listener = await FileTransfer.addListener(
      "progress",
      ({ bytes, contentLength }) => {
        const total = contentLength || expectedSize || 0;
        if (!total) return;
        onProgress?.(Math.min(99, Math.round((bytes / total) * 100)));
      }
    );

    // progress: true 才会派发 progress 事件（原生默认关闭）
    await FileTransfer.downloadFile({ url, path: uri, progress: true });

    const stat = await Filesystem.stat({
      directory: APK_CACHE_DIR,
      path: fileName,
    });

    if (!stat.size) throw new Error("下载的安装包为空");

    // CDN 返回错误页时通常也是 200，靠体积兜底识别
    if (expectedSize && stat.size < expectedSize * 0.9) {
      throw new Error(
        `安装包不完整（${(stat.size / 1024 / 1024).toFixed(1)}MB / ${(
          expectedSize /
          1024 /
          1024
        ).toFixed(1)}MB）`
      );
    }

    onProgress?.(100);

    await AppInstaller.install({ path: uri });
  } catch (e) {
    if (isMissingNativeImpl(e)) {
      logger.warn("apk-update", "当前安装包不含安装器插件，退回浏览器下载");
      openUrl(url);
      return;
    }
    // 保留 NEED_INSTALL_PERMISSION 的包没必要，直接删
    await Filesystem.deleteFile({
      directory: APK_CACHE_DIR,
      path: fileName,
    }).catch(() => undefined);
    throw e;
  } finally {
    await listener?.remove();
  }
}
