/**
 * 确保自适应图标 XML 存在且配置正确（幂等）。
 *
 * 历史教训（2026-11-18）：
 * 本脚本原先把 mipmap-anydpi-v26 的 XML 删掉，想让 MIUI 用不透明方图。
 * 实际后果相反：Android 8+ 找不到 adaptive-icon 就降级裁整图 ic_launcher.png，
 * 那张图自带圆角 alpha，被系统二次遮罩后圆角外侧混出灰白边——正是用户报的"白边"。
 * 微信等同款机型无此问题，是因为它们走系统主题图标，不降级。
 *
 * 正确做法：保留 adaptive-icon，background 用纯色（全出血，无圆角无 alpha），
 * foreground 直接引用 drawable（@capacitor/assets 默认会包一层 16.7% inset，
 * 那会把已经按 108dp 画布画好的主体二次缩小，必须去掉）。
 *
 * 每次 `npm run resources` 后调用本脚本，防止 cap sync / capacitor-assets 重建出 inset 版本。
 */
import fs from "node:fs";
import path from "node:path";

const RES_ANYDPI = path.resolve("android/app/src/main/res/mipmap-anydpi-v26");
const FILES = ["ic_launcher.xml", "ic_launcher_round.xml"];
const TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
// @capacitor/assets 生成的 <foreground><inset .../></foreground> 要压平
const INSET_WRAPPER =
  /<(foreground|background)\b[^>]*>\s*<inset\b[^>]*?android:drawable="([^"]+)"[^>]*?\/>\s*<\/\1>/g;

let changed = 0;
fs.mkdirSync(RES_ANYDPI, { recursive: true });
for (const name of FILES) {
  const file = path.join(RES_ANYDPI, name);
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  let after = before.replace(
    INSET_WRAPPER,
    (_m, tag, drawable) => `<${tag} android:drawable="${drawable}" />`
  );
  // 背景统一用纯色，避免 PNG 自带圆角 alpha 被系统二次裁切
  after = after.replace(
    /<background\b[^>]*android:drawable="[^"]+"[^>]*\/>/,
    '<background android:drawable="@color/ic_launcher_background" />'
  );
  if (!after.trim()) after = TEMPLATE;
  if (after !== before) {
    fs.writeFileSync(file, after);
    changed += 1;
    console.log(
      `[fix-adaptive-icon] 已修正：${path.relative(process.cwd(), file)}`
    );
  }
}
if (changed === 0)
  console.log("[fix-adaptive-icon] XML 已是正确配置，无需修改");
