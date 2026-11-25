"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Disc3, Image as ImageIcon, ImagePlus, Palette, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useExitLayer } from "@/hooks/useExitLayer";
import { useScrimSystemBars } from "@/hooks/useScrimSystemBars";
import {
  useMusicStore,
  DEFAULT_VINYL_COLOR,
  TRANSPARENT_VINYL_COLOR,
  type CoverStyle,
  type FullScreenBackgroundMode,
} from "@/store/music-store";
import { LocalMusicPlugin } from "@/plugins/local-music";
import { IS_NATIVE } from "@/lib/api/config";
import toast from "react-hot-toast";
import { BackgroundImageCropper } from "./BackgroundImageCropper";

interface CoverStyleMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 保留长按封面原本的“预览大图”能力 */
  onPreview: () => void;
}

const STYLE_OPTIONS: {
  value: CoverStyle;
  label: string;
  icon: typeof ImageIcon;
}[] = [
  { value: "original", label: "原始", icon: ImageIcon },
  { value: "vinyl", label: "黑胶唱片", icon: Disc3 },
];

const BACKGROUND_OPTIONS: {
  value: FullScreenBackgroundMode;
  label: string;
}[] = [
  { value: "theme", label: "渐变" },
  { value: "cover", label: "模糊" },
  { value: "texture", label: "深色" },
  { value: "photo", label: "我的照片" },
];

/** 黑胶盘面预设色：默认黑保持原来的样子，最后一项透出播放器背景 */
const VINYL_COLORS: { value: string; label: string }[] = [
  { value: DEFAULT_VINYL_COLOR, label: "默认黑" },
  { value: "#FFFFFF", label: "白" },
  { value: "#EF4444", label: "红" },
  { value: "#3B82F6", label: "蓝" },
  { value: "#A855F7", label: "紫" },
  { value: "#EAB308", label: "金" },
  { value: TRANSPARENT_VINYL_COLOR, label: "透明" },
];

/** Web 端兜底选图：和原生一致压到 2048 / JPEG 88，兼顾清晰度与 store 体积 */
async function compressImageFile(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取失败"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = raw;
  });
  const max = 2048;
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 不可用");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

/** 长按封面弹出的“修改播放风格”面板 */
export function CoverStyleMenu({
  open,
  onOpenChange,
  onPreview,
}: CoverStyleMenuProps) {
  const coverStyle = useMusicStore((s) => s.coverStyle);
  const setCoverStyle = useMusicStore((s) => s.setCoverStyle);
  const fullScreenBackgroundMode = useMusicStore(
    (s) => s.fullScreenBackgroundMode
  );
  const setFullScreenBackgroundMode = useMusicStore(
    (s) => s.setFullScreenBackgroundMode
  );
  const customBackgroundImage = useMusicStore((s) => s.customBackgroundImage);
  const setCustomBackgroundImage = useMusicStore(
    (s) => s.setCustomBackgroundImage
  );
  const vinylColor = useMusicStore((s) => s.vinylColor);
  const setVinylColor = useMusicStore((s) => s.setVinylColor);
  const { push, pop } = useExitLayer();
  // 遮罩铺到状态栏底下：打开期间把状态栏图标切成浅色，否则深色图标会糊在黑色蒙层上
  useScrimSystemBars(open);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 待裁剪的原图 dataUrl：选完图先进裁剪器，确定后才写进 store
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // 面板打开时占住退出栈：Android 返回键 / Web Esc 先关它，而不是收起播放器
  useEffect(() => {
    if (!open) return;
    const id = push({ close });
    return () => pop(id);
  }, [open, push, pop, close]);

  const applyBackground = useCallback(
    async (dataUrl: string) => {
      // Android WebView 会在大图 dataUrl 还没解码完时把图层合成成黑色，
      // 且解码完成后不会主动重绘 —— 表现就是「传完是黑的，摸一下才出现」。
      // 先解码完再写 store，等图层挂载时图片已经能直接画出来。
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = dataUrl;
        if (img.complete) resolve();
      });
      setCustomBackgroundImage(dataUrl);
      setFullScreenBackgroundMode("photo");
    },
    [setCustomBackgroundImage, setFullScreenBackgroundMode]
  );

  const handlePickImage = useCallback(async () => {
    if (!IS_NATIVE) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const result = await LocalMusicPlugin.pickBackgroundImage();
      if (result.success && result.dataUrl) {
        // 相册选完先裁剪，不直接应用
        setCropSrc(result.dataUrl);
      } else if (result.error && result.error !== "cancelled") {
        toast.error("选择图片失败");
      }
    } catch {
      toast.error("选择图片失败");
    }
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // 立刻清空，保证同一张图片可以重选
      e.target.value = "";
      if (!file) return;
      try {
        setCropSrc(await compressImageFile(file));
      } catch {
        toast.error("图片处理失败");
      }
    },
    []
  );

  if (!open) return null;

  const menuPortal = createPortal(
    <div className="fixed inset-0 z-500 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/60 animate-in fade-in duration-200"
        onClick={close}
      />

      <div
        className={cn(
          "relative mb-6 max-h-[85vh] w-[min(420px,calc(100%-32px))] overflow-y-auto rounded-2xl p-4",
          "bg-neutral-900/95 ring-1 ring-white/10 shadow-2xl backdrop-blur-xl",
          "animate-in slide-in-from-bottom-4 duration-200"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-white">修改播放风格</span>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            className="flex h-8 w-8 shrink-0 flex-[0_0_32px] min-h-8 min-w-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <div className="flex h-4 w-4 items-center justify-center">
              <X size={16} className="h-full w-full" />
            </div>
          </button>
        </div>

        <div className="space-y-4">
          {/* 封面 / 黑胶 */}
          <section className="space-y-2">
            <h3 className="text-xs tracking-wider text-white/40">封面样式</h3>
            <div className="flex gap-2">
              {STYLE_OPTIONS.map(({ value, label, icon: Icon }) => {
                const selected = coverStyle === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCoverStyle(value)}
                    aria-pressed={selected}
                    className={cn(
                      "flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs transition-all",
                      selected
                        ? "bg-white/15 text-white ring-1 ring-white/20"
                        : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    {/* 低版本 WebView 会把 flex 容器里的 SVG 压成 0px：尺寸锁在外层 div 上 */}
                    <div className="flex h-5 w-5 shrink-0 flex-[0_0_20px] min-h-5 min-w-5 items-center justify-center">
                      <Icon size={18} className="h-full w-full" />
                    </div>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 修改背景 */}
          <section className="space-y-2">
            <h3 className="text-xs tracking-wider text-white/40">修改背景</h3>
            <div className="grid grid-cols-4 gap-2">
              {BACKGROUND_OPTIONS.map(({ value, label }) => {
                const selected = fullScreenBackgroundMode === value;
                const isPhoto = value === "photo";
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      isPhoto
                        ? customBackgroundImage
                          ? setFullScreenBackgroundMode("photo")
                          : handlePickImage()
                        : setFullScreenBackgroundMode(value)
                    }
                    aria-pressed={selected}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs transition-all",
                      selected
                        ? "bg-white/15 text-white ring-1 ring-white/20"
                        : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    <div
                      className="flex h-5 w-5 shrink-0 flex-[0_0_20px] min-h-5 min-w-5 items-center justify-center overflow-hidden rounded"
                      style={
                        isPhoto && customBackgroundImage
                          ? {
                              backgroundImage: `url("${customBackgroundImage}")`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }
                          : undefined
                      }
                    >
                      {isPhoto && !customBackgroundImage ? (
                        <ImagePlus size={18} className="h-full w-full" />
                      ) : !isPhoto ? (
                        <Palette size={18} className="h-full w-full" />
                      ) : null}
                    </div>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
            {customBackgroundImage && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handlePickImage}
                  className="flex-1 rounded-lg bg-white/5 py-2 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  更换照片
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomBackgroundImage(null);
                    setFullScreenBackgroundMode("theme");
                  }}
                  className="flex-1 rounded-lg bg-white/5 py-2 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  删除照片
                </button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </section>

          {/* 黑胶颜色：仅黑胶风格时有用 */}
          {coverStyle === "vinyl" && (
            <section className="space-y-2">
              <h3 className="text-xs tracking-wider text-white/40">黑胶颜色</h3>
              <div className="flex flex-wrap items-center gap-2">
                {VINYL_COLORS.map(({ value, label }) => {
                  const selected =
                    vinylColor.toLowerCase() === value.toLowerCase();
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setVinylColor(value)}
                      aria-label={label}
                      aria-pressed={selected}
                      title={label}
                      className={cn(
                        "h-7 w-7 shrink-0 rounded-full border-2 transition-all",
                        selected
                          ? "border-primary scale-110"
                          : "border-white/20 hover:border-white/50"
                      )}
                      style={
                        value === TRANSPARENT_VINYL_COLOR
                          ? {
                              backgroundImage:
                                "linear-gradient(45deg,#777 25%,transparent 25%,transparent 75%,#777 75%),linear-gradient(45deg,#777 25%,transparent 25%,transparent 75%,#777 75%)",
                              backgroundSize: "8px 8px",
                              backgroundPosition: "0 0,4px 4px",
                            }
                          : { backgroundColor: value }
                      }
                    />
                  );
                })}
                <label
                  title="自定义颜色"
                  className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-white/30 text-2xs text-white/60"
                >
                  <span>+</span>
                  <input
                    type="color"
                    value={
                      VINYL_COLORS.some(
                        (c) =>
                          c.value.toLowerCase() === vinylColor.toLowerCase()
                      )
                        ? "#FFFFFF"
                        : vinylColor
                    }
                    onChange={(e) => setVinylColor(e.target.value)}
                    className="sr-only"
                    aria-label="自定义黑胶颜色"
                  />
                </label>
              </div>
            </section>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            close();
            onPreview();
          }}
          className="mt-4 w-full rounded-xl bg-white/5 py-2.5 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          预览封面大图
        </button>
      </div>
    </div>,
    document.body
  );

  return (
    <>
      {menuPortal}
      {/* 选完照片先进裁剪器：拖动平移、捏合缩放，框内所见即最终背景 */}
      {cropSrc && (
        <BackgroundImageCropper
          src={cropSrc}
          onCancel={() => setCropSrc(null)}
          onConfirm={(dataUrl) => {
            setCropSrc(null);
            // 等图片解码完成再应用并关面板，避免 WebView 画出黑图层
            void applyBackground(dataUrl).finally(close);
          }}
        />
      )}
    </>
  );
}
