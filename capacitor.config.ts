import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.otterhub.music",
  appName: "水獭音乐",
  webDir: "dist",
  plugins: {
    SystemBars: {
      insetsHandling: "css",
    },
    // 只用来监听键盘开合（判断「返回键被输入法吃掉」），不改 WebView 尺寸行为
    Keyboard: {
      resizeOnFullScreen: false,
    },
  },
};

export default config;
