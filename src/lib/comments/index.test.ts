import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MusicTrack } from "@/types/music";
import type { NeteaseComment } from "@/lib/netease/netease-raw-types";
import type { FormattedComment } from "@/lib/netease/comment-format";

const mocks = vi.hoisted(() => ({
  getHotComments: vi.fn(),
  getNewComments: vi.fn(),
  resolveCommentSongId: vi.fn(),
  getQqHotComments: vi.fn(),
  getQqNewComments: vi.fn(),
  getKuwoHotComments: vi.fn(),
  getKuwoNewComments: vi.fn(),
}));

vi.mock("@/lib/netease/netease-api", () => ({
  getHotComments: mocks.getHotComments,
  getNewComments: mocks.getNewComments,
}));
vi.mock("@/lib/netease/comment-source", () => ({
  resolveCommentSongId: mocks.resolveCommentSongId,
}));
vi.mock("./qq-comments", () => ({
  getQqHotComments: mocks.getQqHotComments,
  getQqNewComments: mocks.getQqNewComments,
}));
vi.mock("./kuwo-comments", () => ({
  getKuwoHotComments: mocks.getKuwoHotComments,
  getKuwoNewComments: mocks.getKuwoNewComments,
}));

import { getTrackComments } from "./index";

const track = {
  id: "kw_123",
  name: "test",
  artist: ["test"],
  album: "",
  pic_id: "",
  url_id: "123",
  lyric_id: "",
  source: "kuwo",
} as MusicTrack;

/** 网易云原始评论（供 netease 分支 formatComments 归一化） */
const rawComment = (id: number): NeteaseComment => ({
  commentId: id,
  content: `c${id}`,
  time: 0,
  likedCount: 0,
  user: { userId: 1, nickname: "u", avatarUrl: "" },
});

/** 已归一化的评论（供 QQ / 酷我分支直接使用） */
const comment = (id: number): FormattedComment => ({
  id,
  text: `c${id}`,
  time: 0,
  timeStr: "",
  userName: "u",
  likedCount: 0,
});

/** provider 现在返回 { comments, total } */
const page = (id: number, total = 100) => ({ comments: [comment(id)], total });

describe("多平台评论降级", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveCommentSongId.mockResolvedValue("456");
    mocks.getHotComments.mockResolvedValue({
      hotComments: [],
      topComments: [],
    });
    mocks.getNewComments.mockResolvedValue({ comments: [] });
    mocks.getQqHotComments.mockResolvedValue({ comments: [], total: 0 });
    mocks.getQqNewComments.mockResolvedValue({ comments: [], total: 0 });
    mocks.getKuwoHotComments.mockResolvedValue({ comments: [], total: 0 });
    mocks.getKuwoNewComments.mockResolvedValue({ comments: [], total: 0 });
  });

  it("网易云有数据时直接用网易云", async () => {
    mocks.getHotComments.mockResolvedValue({
      hotComments: [rawComment(1)],
      topComments: [],
    });
    const res = await getTrackComments(track, "hot");
    expect(res.source).toBe("netease");
    expect(res.comments).toHaveLength(1);
    expect(mocks.getQqHotComments).not.toHaveBeenCalled();
  });

  it("网易云 topComments 也能作为热评", async () => {
    mocks.getHotComments.mockResolvedValue({
      hotComments: [],
      topComments: [rawComment(2)],
    });
    const res = await getTrackComments(track, "hot");
    expect(res.source).toBe("netease");
    expect(res.comments[0].id).toBe(2);
  });

  it("网易云为空时回退 QQ", async () => {
    mocks.getQqHotComments.mockResolvedValue(page(3));
    const res = await getTrackComments(track, "hot");
    expect(res.source).toBe("qq");
    expect(res.comments[0].id).toBe(3);
  });

  it("网易云失败时回退 QQ", async () => {
    mocks.getHotComments.mockRejectedValue(new Error("blocked"));
    mocks.getQqHotComments.mockResolvedValue(page(4));
    const res = await getTrackComments(track, "hot");
    expect(res.source).toBe("qq");
    expect(res.comments[0].id).toBe(4);
  });

  it("网易云和 QQ 都失败时回退酷我", async () => {
    mocks.getHotComments.mockRejectedValue(new Error("blocked"));
    mocks.getQqHotComments.mockRejectedValue(new Error("failed"));
    mocks.getKuwoHotComments.mockResolvedValue(page(5));
    const res = await getTrackComments(track, "hot");
    expect(res.source).toBe("kuwo");
    expect(res.comments[0].id).toBe(5);
  });

  it("最新评论同样按平台顺序降级", async () => {
    mocks.getNewComments.mockResolvedValue({ comments: [] });
    mocks.getQqNewComments.mockResolvedValue(page(6));
    const res = await getTrackComments(track, "new");
    expect(res.source).toBe("qq");
    expect(res.comments[0].id).toBe(6);
  });

  it("所有平台都无数据时返回空", async () => {
    const res = await getTrackComments(track, "hot");
    expect(res.source).toBeNull();
    expect(res.comments).toEqual([]);
    expect(res.total).toBe(0);
  });

  it("透传平台返回的总数", async () => {
    mocks.getQqHotComments.mockResolvedValue({
      comments: [comment(8)],
      total: 12345,
    });
    const res = await getTrackComments(track, "hot");
    expect(res.total).toBe(12345);
  });

  it("分页参数传给平台 provider", async () => {
    mocks.getQqHotComments.mockResolvedValue(page(9));
    await getTrackComments(track, "hot", 20, 3);
    expect(mocks.getQqHotComments).toHaveBeenCalledWith(track, 20, 3);
  });

  it("指定来源时只取该平台，不降级", async () => {
    mocks.getQqHotComments.mockResolvedValue(page(11));
    const res = await getTrackComments(track, "hot", 20, 0, "qq");
    expect(res.source).toBe("qq");
    expect(res.comments[0].id).toBe(11);
    // 网易云排在 QQ 前面，若走自动降级会先调它
    expect(mocks.getHotComments).not.toHaveBeenCalled();
  });

  it("指定来源取不到时不降级到其它平台", async () => {
    mocks.getQqHotComments.mockResolvedValue({ comments: [], total: 0 });
    mocks.getKuwoHotComments.mockResolvedValue(page(12));
    const res = await getTrackComments(track, "hot", 20, 0, "qq");
    expect(res.source).toBeNull();
    expect(res.comments).toEqual([]);
    expect(mocks.getKuwoHotComments).not.toHaveBeenCalled();
  });

  it("指定酷我来源时直连酷我", async () => {
    mocks.getKuwoHotComments.mockResolvedValue(page(13));
    const res = await getTrackComments(track, "hot", 20, 0, "kuwo");
    expect(res.source).toBe("kuwo");
    expect(res.comments[0].id).toBe(13);
    expect(mocks.getQqHotComments).not.toHaveBeenCalled();
  });

  it("网易云 ID 解析失败时跳过网易云", async () => {
    mocks.resolveCommentSongId.mockResolvedValue(null);
    mocks.getQqHotComments.mockResolvedValue(page(7));
    const res = await getTrackComments(track, "hot");
    expect(mocks.getHotComments).not.toHaveBeenCalled();
    expect(res.source).toBe("qq");
  });
});
