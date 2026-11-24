/** 评论来源偏好：auto 自动降级，或固定某个平台 */
export type CommentSourcePreference = "auto" | "netease" | "qq" | "kuwo";

export interface CommentSourceOption {
  value: CommentSourcePreference;
  label: string;
  /** 标题旁按钮显示的短标签 */
  short: string;
  /** 说明文字 */
  description: string;
}

export const COMMENT_SOURCE_OPTIONS: CommentSourceOption[] = [
  {
    value: "auto",
    label: "自动选择",
    short: "自动",
    description: "依次尝试 网易云 → QQ 音乐 → 酷我",
  },
  {
    value: "netease",
    label: "网易云音乐",
    short: "网易云",
    description: "仅从网易云获取评论",
  },
  {
    value: "qq",
    label: "QQ 音乐",
    short: "QQ",
    description: "仅从 QQ 音乐获取评论",
  },
  {
    value: "kuwo",
    label: "酷我音乐",
    short: "酷我",
    description: "仅从酷我音乐获取评论",
  },
];

export function getCommentSourceShort(pref: CommentSourcePreference): string {
  return COMMENT_SOURCE_OPTIONS.find((o) => o.value === pref)?.short ?? "自动";
}

export function getCommentSourceLabel(pref: CommentSourcePreference): string {
  return (
    COMMENT_SOURCE_OPTIONS.find((o) => o.value === pref)?.label ?? "自动选择"
  );
}

/** 实际提供评论的平台 → 短标签 */
export const COMMENT_SOURCE_LABEL: Record<string, string> = {
  netease: "网易云",
  qq: "QQ",
  kuwo: "酷我",
};
