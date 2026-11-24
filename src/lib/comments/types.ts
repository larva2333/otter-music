import type { FormattedComment } from "@/lib/netease/comment-format";

/** 单页评论结果 */
export interface CommentPage {
  comments: FormattedComment[];
  /** 该平台报告的总评论数 */
  total: number;
}

export type CommentTab = "hot" | "new";
