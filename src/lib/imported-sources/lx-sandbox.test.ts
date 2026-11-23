import { describe, expect, it } from "vitest";
import { strToU8, zlibSync } from "fflate";
import {
  getLxRuntime,
  lxSearch,
  lxGetUrl,
  pickLxQuality,
  clearLxRuntime,
  decodeLxScript,
} from "./lx-sandbox";

const SAMPLE_SCRIPT = `
/* @name 测试洛雪源 @version v1.0 */
const { EVENT_NAMES, request, on, send } = globalThis.lx
on(EVENT_NAMES.request, ({ action, source, info }) => {
  if (action === 'musicUrl') {
    return { url: 'https://example.com/' + source + '/' + info.musicInfo.songmid + '.mp3' }
  }
  if (action === 'lyric') {
    return { lyric: '[00:00]测试歌词', tlyric: '' }
  }
})
send(EVENT_NAMES.inited, { sources: { tx: { name: 'QQ音乐', actions: ['musicUrl'] }, wy: { name: '网易云', actions: ['musicUrl'] } } })
`;

const TRACK = (id: string, source: string, songmid = "123") => ({
  id: `${id}_${songmid}`,
  name: "测试",
  artist: ["某歌手"],
  album: "某专辑",
  pic_id: "",
  url_id: songmid,
  lyric_id: songmid,
  source: source as never,
});

describe("lx-sandbox", () => {
  it("洛雪协议没有搜索，lxSearch 恒为空", async () => {
    const id = "imp_test_" + Math.random().toString(36).slice(2);
    const rt = getLxRuntime(id, SAMPLE_SCRIPT, "tx");
    expect(rt.handler).not.toBeNull();

    const res = await lxSearch(rt, "周杰伦", 1, 20);
    expect(res.items).toHaveLength(0);
    clearLxRuntime(id);
  });

  it("记录脚本 send(inited) 上报的平台能力", () => {
    const id = "imp_test_" + Math.random().toString(36).slice(2);
    const rt = getLxRuntime(id, SAMPLE_SCRIPT, "tx");
    expect(Object.keys(rt.inited?.sources ?? {})).toEqual(["tx", "wy"]);
    clearLxRuntime(id);
  });

  it("getUrl 把平台代号传给脚本", async () => {
    const id = "imp_test_" + Math.random().toString(36).slice(2);
    const rt = getLxRuntime(id, SAMPLE_SCRIPT, "tx");
    const url = await lxGetUrl(rt, TRACK(id, "qq") as never, 320);
    expect(url).toBe("https://example.com/tx/123.mp3");
    clearLxRuntime(id);
  });

  it("getUrl 可用显式平台覆盖导入时探测到的平台", async () => {
    const id = "imp_test_" + Math.random().toString(36).slice(2);
    // 导入时识别成 wy，但脚本其实也支持 tx
    const rt = getLxRuntime(id, SAMPLE_SCRIPT, "wy");
    const url = await lxGetUrl(rt, TRACK(id, "qq") as never, 320, "tx");
    expect(url).toBe("https://example.com/tx/123.mp3");
    clearLxRuntime(id);
  });

  it("音质按脚本声明的 qualitys 取，声明里没有 320k 就退到 128k", async () => {
    const id = "imp_test_" + Math.random().toString(36).slice(2);
    const script = `
      const { EVENT_NAMES, on, send } = globalThis.lx
      on(EVENT_NAMES.request, ({ action, info }) => {
        if (action === 'musicUrl') return { url: 'https://example.com/' + info.type + '.mp3' }
      })
      send(EVENT_NAMES.inited, {
        sources: { tx: { name: 'QQ音乐', actions: ['musicUrl'], qualitys: ['128k'] } },
      })
    `;
    const rt = getLxRuntime(id, script, "tx");

    expect(await lxGetUrl(rt, TRACK(id, "qq") as never, 320)).toBe(
      "https://example.com/128k.mp3"
    );
    clearLxRuntime(id);
  });

  it("pickLxQuality 只在声明档位里挑，未声明时按请求档位", () => {
    expect(pickLxQuality(["320k", "128k"], 320)).toBe("320k");
    expect(pickLxQuality(["128k"], 320)).toBe("128k");
    expect(pickLxQuality(["flac"], 320)).toBe("flac");
    expect(pickLxQuality(undefined, 320)).toBe("320k");
  });

  it("脚本异步 send(inited) 时 waitInited 能等到", async () => {
    const id = "imp_test_" + Math.random().toString(36).slice(2);
    const script = `
      setTimeout(() => {
        globalThis.lx.send(globalThis.lx.EVENT_NAMES.inited, { sources: { tx: {} } })
      }, 10)
    `;
    const rt = getLxRuntime(id, script, "tx");
    expect(rt.inited).toBeNull();

    await expect(rt.waitInited(500)).resolves.toBe(true);
    expect(rt.inited).not.toBeNull();
    clearLxRuntime(id);
  });

  it("初始化抛错时记录 initError，且 waitInited 为 false", async () => {
    const id = "imp_test_" + Math.random().toString(36).slice(2);
    const rt = getLxRuntime(id, "throw new Error('接口已下线')", "tx");

    expect(rt.initError).toContain("接口已下线");
    await expect(rt.waitInited(50)).resolves.toBe(false);
    clearLxRuntime(id);
  });

  it("老脚本用 status:false 表示初始化失败时也能识别", async () => {
    const id = "imp_test_" + Math.random().toString(36).slice(2);
    const script = `
      globalThis.lx.send(globalThis.lx.EVENT_NAMES.inited, {
        status: false,
        message: '接口已失效',
      })
    `;
    const rt = getLxRuntime(id, script, "tx");

    expect(rt.initError).toBe("接口已失效");
    expect(rt.inited).toBeNull();
    clearLxRuntime(id);
  });

  it("inited 之后抛错不算初始化失败", async () => {
    const id = "imp_test_" + Math.random().toString(36).slice(2);
    const script = `
      globalThis.lx.send(globalThis.lx.EVENT_NAMES.inited, { sources: { tx: {} } })
      throw new Error('后续代码出错')
    `;
    const rt = getLxRuntime(id, script, "tx");

    expect(rt.inited).not.toBeNull();
    expect(rt.initError).toBeUndefined();
    clearLxRuntime(id);
  });

  it("gz_ 压缩脚本能被解压后执行", () => {
    const code =
      "globalThis.lx.send(globalThis.lx.EVENT_NAMES.inited, { sources: { tx: {} } })";
    const b64 = Buffer.from(zlibSync(strToU8(code))).toString("base64");
    expect(decodeLxScript(`gz_${b64}`)).toBe(code);

    const id = "imp_test_" + Math.random().toString(36).slice(2);
    const rt = getLxRuntime(id, `gz_${b64}`, "tx");
    expect(rt.initError).toBeUndefined();
    expect(rt.inited).not.toBeNull();
    clearLxRuntime(id);
  });

  it("明文脚本原样返回", () => {
    expect(decodeLxScript(SAMPLE_SCRIPT)).toBe(SAMPLE_SCRIPT);
  });
});
