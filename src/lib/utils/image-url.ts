/**
 * 网易云图床支持用 `?param=WxH` 取缩略图。
 *
 * 这一点非常关键：歌单广场的封面卡片在手机上只有 ~115 CSS px 宽，
 * 但接口返回的原图往往是 1000×1000 甚至 3000×3000（解码后一张就 6~36 MB）。
 * 几十张原图会把 WebView 的图片缓存直接挤爆，导致节点一重建就得重新解码，
 * 用户看到的就是「切回看过的分类，封面又一张张重新加载」。
 *
 * 只对 `*.126.net` 生效：其它音源（Alist / 自建图床）的直链加上 query 可能直接 404。
 */
const NETEASE_IMG_HOST = /(^|\.)126\.net$/i;

export function withImageSize(
  url: string | null | undefined,
  size?: number
): string | null {
  if (!url) return null;
  if (!size || !Number.isFinite(size) || size <= 0) return url;

  try {
    const parsed = new URL(url, "https://localhost");
    if (!NETEASE_IMG_HOST.test(parsed.hostname)) return url;
    const px = Math.round(size);
    parsed.searchParams.set("param", `${px}y${px}`);
    return parsed.toString();
  } catch {
    return url;
  }
}
