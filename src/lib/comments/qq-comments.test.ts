import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MusicTrack } from "@/types/music";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("./http", () => ({ commentRequest: requestMock }));

import { getQqHotComments, getQqNewComments } from "./qq-comments";

const kuwoTrack = {
  id: "kw_493628806",
  url_id: "493628806",
  name: "七里香",
  artist: ["周杰伦"],
  source: "kuwo",
} as MusicTrack;

const qqTrack = {
  id: "qq_004Z8Ihr0JIu5s",
  url_id: "004Z8Ihr0JIu5s",
  name: "七里香",
  artist: ["周杰伦"],
  source: "qq",
} as MusicTrack;

/** 匹配 URL 返回对应响应 */
function setupResponses() {
  requestMock.mockImplementation(
    async (url: string, opts?: { body?: unknown; form?: unknown }) => {
      const bodyStr = JSON.stringify(opts?.body ?? opts?.form ?? "");
      if (url.includes("client_search_cp")) {
        return {
          data: {
            song: {
              list: [
                {
                  songmid: "004Z8Ihr0JIu5s",
                  songname: "七里香",
                  singer: [{ name: "周杰伦" }],
                },
                {
                  songmid: "xxx",
                  songname: "七里香 (Live)",
                  singer: [{ name: "周杰伦" }],
                },
              ],
            },
          },
        };
      }
      if (bodyStr.includes("get_song_detail_yqq")) {
        return {
          code: 0,
          req: { code: 0, data: { track_info: { id: 102065756 } } },
        };
      }
      if (bodyStr.includes("GetHotCommentList")) {
        return {
          code: 0,
          req: {
            code: 0,
            data: {
              CommentList: {
                Total: 3965,
                Comments: [
                  {
                    SeqNo: 1,
                    Content: "热评内容",
                    Nick: "用户",
                    PraiseNum: 100,
                  },
                ],
              },
            },
          },
        };
      }
      if (url.includes("fcg_global_comment_h5")) {
        return {
          code: 0,
          comment: {
            commenttotal: 102159,
            commentlist: [
              {
                rootcommentid: 1,
                commentid: 1,
                rootcommentcontent: "最新内容",
                rootcommentnick: "@用户",
                praisenum: 5,
              },
            ],
          },
        };
      }
      throw new Error(`unexpected url: ${url}`);
    }
  );
}

describe("QQ 评论跨音源解析", () => {
  beforeEach(() => {
    requestMock.mockReset();
    setupResponses();
  });

  it("酷我曲目按歌名+歌手反查 QQ songmid 后能拿到热门评论", async () => {
    const res = await getQqHotComments(kuwoTrack, 20, 0);
    expect(res.total).toBe(3965);
    expect(res.comments).toHaveLength(1);
    expect(res.comments[0].text).toBe("热评内容");
    expect(
      requestMock.mock.calls.some((c) => c[0].includes("client_search_cp"))
    ).toBe(true);
  });

  it("酷我曲目也能拿到最新评论", async () => {
    const res = await getQqNewComments(kuwoTrack, 20, 0);
    expect(res.total).toBe(102159);
    expect(res.comments[0].text).toBe("最新内容");
  });

  it("QQ 曲目直接用 songmid，无需搜索", async () => {
    const res = await getQqHotComments(qqTrack, 20, 0);
    expect(res.comments).toHaveLength(1);
    expect(
      requestMock.mock.calls.some((c) => c[0].includes("client_search_cp"))
    ).toBe(false);
  });
});
