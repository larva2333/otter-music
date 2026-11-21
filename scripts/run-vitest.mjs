/**
 * vitest 启动器：规避 Windows 盘符大小写 bug（vitest-dev/vitest#11872）。
 *
 * 当 vitest CLI 入口路径（argv[1]）的盘符大小写与 node_modules 里模块
 * 实际解析路径不一致（例如 shell 以小写 c: 或大写 C: 启动，npx/npm 传给
 * node 的 bin 路径大小写与另一侧不同）时，vitest 4 会加载两份自己的
 * runtime，所有测试文件在 describe() 处抛
 * "TypeError: Cannot read properties of undefined (reading 'config')"。
 *
 * 这里用 realpathSync.native 把 CLI 路径规范化成磁盘真实大小写后再
 * import，保证 bin 路径与模块解析路径一致。Linux/macOS 上是 no-op。
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const cli = realpathSync.native(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url)
);

await import(pathToFileURL(cli).href);
