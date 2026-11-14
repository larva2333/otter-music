import {
  ApiError,
  getApiUrl,
  getCustomApiUrl,
  fetchWithTimeout,
  unwrap,
} from "./config";
import { logger } from "@/lib/logger";

/**
 * 发版仓库（自己的 fork）。
 *
 * 注意：不能再走固定后端 `/update/check`——那台后端查的是上游仓库，
 * 会拿到上游版本号并下载上游 APK。默认直连 GitHub Release API，
 * 只有配置了自建后端时才回退到后端代理（GitHub API 国内可能超时）。
 */
export const RELEASE_REPO = "larva2333/otter-music";

const GITHUB_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;

const updateUrl = () => `${getApiUrl()}/update`;

export interface UpdateInfo {
  latestVersion: string;
  changelog: string;
  downloadUrl: string;
  directUrl: string;
  publishDate: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  body: string | null;
  published_at: string;
  assets: {
    name: string;
    browser_download_url: string;
    size: number;
  }[];
}

/** 经后端转发的下载地址（宿主只校验域名，可代理任意 GitHub release 资产） */
function buildProxyUrl(asset: GitHubRelease["assets"][number]) {
  return `${updateUrl()}/download?url=${encodeURIComponent(
    asset.browser_download_url
  )}&filename=${encodeURIComponent(asset.name)}`;
}

function toUpdateInfo(release: GitHubRelease): UpdateInfo {
  const apk = release.assets.find((asset) => asset.name.endsWith(".apk"));

  if (!apk) throw new ApiError("最新 Release 中没有 APK 资产", 404);

  return {
    latestVersion: release.tag_name,
    changelog: release.body ?? "",
    downloadUrl: buildProxyUrl(apk),
    directUrl: apk.browser_download_url,
    publishDate: release.published_at,
    size: apk.size,
  };
}

/** 直连 GitHub Release API（公开仓库无需鉴权） */
async function checkFromGitHub(): Promise<UpdateInfo> {
  const res = await fetchWithTimeout(
    GITHUB_RELEASE_API,
    {
      method: "GET",
      headers: { Accept: "application/vnd.github.v3+json" },
    },
    15000
  );

  if (res.status === 404) {
    throw new ApiError(`仓库 ${RELEASE_REPO} 还没有发布 Release`, 404);
  }
  if (!res.ok) throw new ApiError(`GitHub API ${res.status}`, res.status);

  return toUpdateInfo((await res.json()) as GitHubRelease);
}

/**
 * 检查更新
 *
 * 优先查自己仓库的 Release；仅在用户配置了自建后端且直连失败时，
 * 才退到后端代理，避免把上游仓库的版本当成新版本。
 */
export async function checkUpdate(): Promise<UpdateInfo> {
  try {
    return await checkFromGitHub();
  } catch (error) {
    // 仓库/资产不存在属于确定性结果，换任何通道都不会变，直接上报
    const notFound = error instanceof ApiError && error.status === 404;
    if (notFound || !getCustomApiUrl()) throw error;

    logger.warn(
      "update",
      "直连 GitHub 失败，改用自建后端代理检查更新",
      error as Error
    );

    return unwrap<UpdateInfo>(
      fetchWithTimeout(`${updateUrl()}/check`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      })
    );
  }
}
