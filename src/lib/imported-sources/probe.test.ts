import { describe, it, expect, vi, beforeEach } from "vitest";
import { strToU8, zlibSync } from "fflate";

const { fetchWithTimeout } = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
}));

vi.mock("@/lib/api/config", () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
  IS_NATIVE: true, // 原生端直连，不走代理
  getProxyUrl: (u: string) => u,
}));

import { probeSourceCandidates } from "./probe";

/** 构造一个响应：text() 返回给定内容 */
function textResponse(text: string, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

/** 把明文脚本压成洛雪的 gz_ 形态 */
function gz(script: string): string {
  const bytes = zlibSync(strToU8(script));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `gz_${btoa(bin)}`;
}

// 最小可用洛雪脚本：用解构写法（真实脚本常见形态）
const LX_SCRIPT = `
/* @name 测试音源 @version v1.0 */
const { EVENT_NAMES, on, send } = globalThis.lx
on(EVENT_NAMES.request, ({ action }) => {
  if (action === 'musicUrl') return { url: 'https://example.com/a.mp3' }
})
send(EVENT_NAMES.inited, { sources: { tx: { actions: ['musicUrl'] } } })
`;

// 只有 @name 注释 + action 的压缩脚本（宿主变量被混淆）
const MINIFIED_LX = `/* @name 极简源 */var a={};a.on("request",function(e){"musicUrl"===e.action&&(e.url="x")});`;

beforeEach(() => {
  fetchWithTimeout.mockReset();
});

describe("probeSourceCandidates — JS 脚本识别", () => {
  it("直接粘贴明文洛雪脚本能识别（不再要求长度 > 80）", async () => {
    const short = `globalThis.lx && on('request', e => { if (e.action === 'musicUrl') return e })`;
    const outcome = await probeSourceCandidates(short);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.candidates[0].kind).toBe("lx");
      expect(fetchWithTimeout).not.toHaveBeenCalled();
    }
  });

  it("gz_ 压缩脚本内容能解压并识别", async () => {
    const outcome = await probeSourceCandidates(gz(LX_SCRIPT));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.candidates[0].name).toBe("测试音源");
      expect(outcome.candidates[0].script).toContain("globalThis.lx");
    }
  });

  it("解析脚本头部的 @version，供更新提示使用", async () => {
    const outcome = await probeSourceCandidates(LX_SCRIPT);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.candidates[0].version).toBe("v1.0");
  });

  it("只实现取链、没有 search 能力的脚本也能识别", async () => {
    const outcome = await probeSourceCandidates(MINIFIED_LX);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.candidates[0].name).toBe("极简源");
  });

  it("JS 直链抓取到压缩脚本后能识别（曾经的无法识别场景）", async () => {
    // probeGdApi 拿到非 JSON 会重试一次（共 2 次），都返回 false；
    // 第 3 次由 fetchTextAny 拿到 gz_ 脚本
    fetchWithTimeout.mockResolvedValue(textResponse(gz(LX_SCRIPT)));
    const outcome = await probeSourceCandidates(
      "https://cdn.example.com/source.js"
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.candidates[0].kind).toBe("lx");
      expect(outcome.candidates[0].name).toBe("测试音源");
    }
  });

  it("非脚本的普通文本仍判为无法识别", async () => {
    fetchWithTimeout.mockResolvedValue(textResponse("<html>404</html>"));
    const outcome = await probeSourceCandidates("https://cdn.example.com/x.js");
    expect(outcome.ok).toBe(false);
  });
});
