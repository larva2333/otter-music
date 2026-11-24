import { strFromU8, unzlibSync } from "fflate";

/**
 * 洛雪音源脚本有两种存储形态：明文 JS，或 `gz_` + base64(zlib deflate)。
 *
 * 桌面端从「音源仓库/导出文件」导入时存的就是压缩形态，官方客户端会在
 * 注入前解压。探测阶段也要用同一套逻辑，否则压缩脚本会被判成「无法识别」。
 */
export function decodeLxScript(script: string): string {
  if (!script.startsWith("gz_")) return script;
  const b64 = script.slice(3).trim();
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return strFromU8(unzlibSync(bytes));
}
