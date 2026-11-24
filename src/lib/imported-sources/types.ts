/**
 * 用户导入的自定义音源。
 *
 * 两种类型：
 * - gd：一个 GD Studio 兼容的 api.php 端点，四个动作（search/url/pic/lyric）
 *   由 BaseMusicProvider 统一处理，只需存 baseUrl。
 * - lx：洛雪音乐（LX Music）的 JS 脚本，运行时在受控沙箱里执行，
 *   通过 globalThis.lx 暴露的 request/on/send 接口与脚本通信。
 */
export type ImportedSourceKind = "gd" | "lx";

export interface ImportedSource {
  /** 唯一标识，形如 "imp_<随机>"，作为 MusicSource 传给播放链路 */
  id: string;
  /** 显示名 */
  name: string;
  kind: ImportedSourceKind;
  /** 音源脚本 / API 的获取地址（GitHub raw 或任意直链） */
  url: string;
  /** 导入时抓取到的原始内容：gd 为空，lx 为 JS 脚本全文（离线可用） */
  script?: string;
  /** 探测到的能力，决定 search/getUrl 等是否可用 */
  capabilities?: string[];
  /** 洛雪脚本用的平台代号（如 tx/wy/kw），传给脚本 handler 的 source 字段 */
  sourceCode?: string;
  enabled: boolean;
  visible: boolean;
  addedAt: number;
  /** 洛雪脚本头部的 @version，更新时用于提示 */
  version?: string;
  /** 最近一次导入 / 从地址更新的时间 */
  updatedAt?: number;
}

/** 探测结果：URL 指向的内容被识别成哪种音源 */
export interface ProbeResult {
  kind: ImportedSourceKind;
  name: string;
  /** 原始内容（lx 为脚本全文，gd 为空） */
  script?: string;
  capabilities?: string[];
  sourceCode?: string;
  /** 洛雪脚本头部的 @version */
  version?: string;
}
