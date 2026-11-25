import { describe, expect, it } from "vitest";
import {
  applyEmoji,
  formatComment,
  formatCommentTime,
  formatComments,
} from "./comment-format";
import type { NeteaseComment } from "./netease-raw-types";

const raw: NeteaseComment = {
  commentId: 123,
  content: "好听[强][爱心]",
  time: 1700000000000,
  likedCount: 42,
  user: { userId: 1, nickname: "听歌的人", avatarUrl: "https://x/avatar.png" },
  ipLocation: { location: "广东" },
};

describe("评论格式化（对齐洛雪 filterComment）", () => {
  it("替换表情占位符", () => {
    expect(applyEmoji("好听[强][爱心]")).toBe("好听👍❤️");
    // 正文里的方括号不该被误伤
    expect(applyEmoji("[普通文字]")).toBe("[普通文字]");
  });

  it("归一评论字段：id/text/timeStr/location/likedCount", () => {
    const c = formatComment(raw);
    expect(c.id).toBe(123);
    expect(c.text).toBe("好听👍❤️");
    expect(c.userName).toBe("听歌的人");
    expect(c.avatar).toBe("https://x/avatar.png");
    // 按本地时区格式化，与展示一致
    const d = new Date(raw.time);
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(c.timeStr).toBe(
      `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`
    );
    expect(c.location).toBe("广东");
    expect(c.likedCount).toBe(42);
  });

  it("引用被回复的原评论", () => {
    const withReply: NeteaseComment = {
      ...raw,
      beReplied: [
        {
          beRepliedCommentId: 9,
          content: "原评论[大笑]",
          user: { userId: 2, nickname: "原作者", avatarUrl: "" },
        },
      ],
    };
    expect(formatComment(withReply).reply).toEqual({
      userName: "原作者",
      text: "原评论😃",
    });
  });

  it("空列表返回空数组", () => {
    expect(formatComments()).toEqual([]);
    expect(formatComments(undefined)).toEqual([]);
  });

  it("拿不到时间时返回空串，不显示 1970 年", () => {
    for (const bad of [
      undefined,
      null,
      "",
      0,
      -1,
      1000,
      150000000,
      "abc",
      NaN,
    ]) {
      expect(formatCommentTime(bad)).toBe("");
      expect(formatComment({ ...raw, time: Number(bad) || 0 }).timeStr).toBe(
        ""
      );
    }
    // 明显超前的时间同样是脏数据
    expect(formatCommentTime(Date.now() + 30 * 24 * 60 * 60 * 1000)).toBe("");
  });

  it("秒级时间戳也能正确格式化，酷我按秒传入", () => {
    const d = new Date(1700000000000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
    expect(formatCommentTime(1700000000, "ms")).toBe(expected);
    expect(formatCommentTime(1700000000, "s")).toBe(expected);
  });
});
