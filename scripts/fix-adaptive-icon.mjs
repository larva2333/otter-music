/**
 * 修复 @capacitor/assets 生成的自适应图标 XML。
 *
 * 它固定写成：
 *   <foreground><inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%" /></foreground>
 * 等于把 108dp 的前景图再缩到 66.7% 才放进画布。我们提供的 assets/icon-foreground.png
 * 本身已经按 108dp 画布画好内容（64%），再叠一层 inset 就成了双重缩小，桌面图标明显偏小。
 *
 * 所以每次 `npm run resources` 之后都要把 inset 拆掉，直接用 drawable。
 * 脚本幂等：已经是直接引用的 XML 不会被改动。
 */
import fs from "node:fs";
import path from "node:path";

const RES_ANYDPI = path.resolve("android/app/src/main/res/mipmap-anydpi-v26");
const FILES = ["ic_launcher.xml", "ic_launcher_round.xml"];

/** <foreground>…<inset android:drawable="X" android:inset="16.7%" />…</foreground> → <foreground android:drawable="X" /> */
const INSET_WRAPPER =
  /<(foreground|background)\b[^>]*>\s*<inset\b[^>]*?android:drawable="([^"]+)"[^>]*?\/>\s*<\/\1>/g;

let changed = 0;
for (const name of FILES) {
  const file = path.join(RES_ANYDPI, name);
  if (!fs.existsSync(file)) continue;

  const before = fs.readFileSync(file, "utf8");
  const after = before.replace(
    INSET_WRAPPER,
    (_match, tag, drawable) => `<${tag} android:drawable="${drawable}" />`
  );

  if (after !== before) {
    fs.writeFileSync(file, after);
    changed += 1;
    console.log(
      `[fix-adaptive-icon] 去掉 inset：${path.relative(process.cwd(), file)}`
    );
  }
}

if (changed === 0) {
  console.log("[fix-adaptive-icon] 已经是直接引用，无需修改");
}
