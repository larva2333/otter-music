"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useExitLayer } from "@/hooks/useExitLayer";

interface BackgroundImageCropperProps {
  src: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}

/**
 * 全屏播放器背景图裁剪器。
 *
 * 裁剪框按当前屏幕比例固定，照片在框内拖动平移、双指捏合缩放（桌面滚轮/触摸板也行），
 * 确定时按框内所见导出 1080 宽 JPEG。背景图最终以 cover 铺满全屏，
 * 框的比例跟屏幕一致，所以「框里看到什么，播放器背景就是什么」。
 */
export function BackgroundImageCropper({
  src,
  onCancel,
  onConfirm,
}: BackgroundImageCropperProps) {
  const { push, pop } = useExitLayer();
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);

  // 数学计算走 ref，渲染走 state，避免指针事件里闭包拿到旧值
  const view = useRef({ x: 0, y: 0, s: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchBase = useRef<{ dist: number; s: number } | null>(null);

  // 占住退出栈：Android 返回键 / Esc 关裁剪器而不是关整个面板
  useEffect(() => {
    const id = push({ close: onCancel });
    return () => pop(id);
  }, [push, pop, onCancel]);

  // 裁剪框尺寸：跟随屏幕比例，限制最大高
  useEffect(() => {
    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let w = Math.min(vw - 32, 420);
      let h = (w * vh) / vw;
      const maxH = Math.min(vh * 0.72, 900);
      if (h > maxH) {
        h = maxH;
        w = (h * vw) / vh;
      }
      setFrame({ w: Math.round(w), h: Math.round(h) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const clamp = useCallback(
    (
      x: number,
      y: number,
      s: number,
      fw: number,
      fh: number,
      iw: number,
      ih: number
    ) => {
      const nx =
        iw * s <= fw
          ? (fw - iw * s) / 2
          : Math.min(0, Math.max(fw - iw * s, x));
      const ny =
        ih * s <= fh
          ? (fh - ih * s) / 2
          : Math.min(0, Math.max(fh - ih * s, y));
      return { x: nx, y: ny };
    },
    []
  );

  const sync = useCallback(
    (x: number, y: number, s: number) => {
      const f = frameRef.current;
      const img = imgRef.current;
      if (!f || !img) return;
      const fw = f.clientWidth;
      const fh = f.clientHeight;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const cover = Math.max(fw / iw, fh / ih);
      const minS = cover;
      const maxS = cover * 5;
      const cs = Math.min(maxS, Math.max(minS, s));
      const c = clamp(x, y, cs, fw, fh, iw, ih);
      view.current = { x: c.x, y: c.y, s: cs };
      setPos({ x: c.x, y: c.y });
      setScale(cs);
    },
    [clamp]
  );

  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    const f = frameRef.current;
    if (!img || !f) return;
    setReady(true);
    const cover = Math.max(
      f.clientWidth / img.naturalWidth,
      f.clientHeight / img.naturalHeight
    );
    sync(0, 0, cover);
  }, [sync]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchBase.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        s: view.current.s,
      };
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const f = frameRef.current;
      if (!f) return;

      if (pointers.current.size >= 2 && pinchBase.current) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const rect = f.getBoundingClientRect();
        const cx = (a.x + b.x) / 2 - rect.left;
        const cy = (a.y + b.y) / 2 - rect.top;
        const v = view.current;
        const ns = (pinchBase.current.s * dist) / pinchBase.current.dist;
        if (ns === v.s) return;
        // 以捏合中点为锚缩放：中点对应的图上点缩放前后保持不动
        const k = ns / v.s;
        sync(cx - (cx - v.x) * k, cy - (cy - v.y) * k, ns);
        return;
      }

      // 单指平移
      const v = view.current;
      sync(v.x + (e.clientX - prev.x), v.y + (e.clientY - prev.y), v.s);
    },
    [sync]
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchBase.current = null;
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const f = frameRef.current;
      if (!f) return;
      const rect = f.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const v = view.current;
      const ns = v.s * (e.deltaY < 0 ? 1.12 : 0.89);
      if (ns === v.s) return;
      const k = ns / v.s;
      sync(cx - (cx - v.x) * k, cy - (cy - v.y) * k, ns);
    },
    [sync]
  );

  const handleConfirm = useCallback(() => {
    const img = imgRef.current;
    const f = frameRef.current;
    if (!img || !f) return;
    const fw = f.clientWidth;
    const fh = f.clientHeight;
    if (fw <= 0 || fh <= 0) return;
    const v = view.current;
    const s = v.s;
    if (s <= 0) return;
    // 导出 1080 宽（横图反之以高为基准），框内所见即所得
    const outW = fw >= fh ? 1080 : Math.round((1080 * fw) / fh);
    const outH = fw >= fh ? Math.round((1080 * fh) / fw) : 1080;
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    // 用 9 参数 drawImage 指定「源矩形 → 目标矩形」，源矩形取自原图（最大不过原图尺寸），
    // 避免 5 参数版本把整张图绘制到「原图宽 * 缩放 * k」那么大的目标尺寸上——放大时目标
    // 尺寸可达 5000+ px，WebView 要分配约 100MB 临时位图，容易 OOM 闪退。
    const sx = -v.x / s;
    const sy = -v.y / s;
    const sw = fw / s;
    const sh = fh / s;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    onConfirm(canvas.toDataURL("image/jpeg", 0.8));
  }, [onConfirm]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-500 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top,0px)+12px)] pb-3">
        <span className="text-sm font-medium text-white">调整背景</span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="关闭"
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <div
          ref={frameRef}
          className="relative touch-none overflow-hidden rounded-lg ring-1 ring-white/15"
          style={{ width: frame.w || undefined, height: frame.h || undefined }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={onImgLoad}
            className="pointer-events-none absolute left-0 top-0 origin-top-left select-none"
            style={{
              transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
              maxWidth: "none",
            }}
          />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white/40">
              加载中…
            </div>
          )}
        </div>
      </div>

      <div className="px-6 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-3">
        <div className="mb-3 text-center text-[11px] text-white/40">
          拖动调整位置 · 双指捏合缩放
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl bg-white/10 py-2.5 text-[13px] text-white/80 transition-colors hover:bg-white/15"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!ready}
            className="flex-1 rounded-xl bg-primary py-2.5 text-[13px] font-medium text-primary-foreground transition-opacity disabled:opacity-40"
          >
            确定
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
