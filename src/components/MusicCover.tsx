"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Music2, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { forceHttps } from "@otter-music/shared";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { ensurePermission, triggerBlobDownload } from "@/lib/utils/download";
import { blobToBase64 } from "@/lib/utils/base64";
import { useExitLayer } from "@/hooks/useExitLayer";
import toast from "react-hot-toast";
import { IS_NATIVE } from "@/lib/api/config";

interface MusicCoverProps {
  src?: string | null;
  alt?: string;
  className?: string;
  iconClassName?: string;
  fallbackIcon?: React.ReactNode;
  previewable?: boolean;
  /** 额外的 img 内联样式（例如裁掉图片自带白边用的 scale） */
  imgStyle?: React.CSSProperties;
  /** 受控：外部控制预览浮层开关（配合 onPreviewOpenChange），不传则走内部状态 */
  previewOpen?: boolean;
  onPreviewOpenChange?: (open: boolean) => void;
  /**
   * 换图时保留上一张做交叉淡入。
   *
   * 播放页切歌时 `src` 一变，`<img>` 会立刻清掉旧位图并等新图解码 ——
   * 中间那一两帧露的是盘面底色/占位图标，看起来就是「封面啪一下闪白再出现」。
   * 打开这个开关后旧图留作底图，新图加载完再淡入盖上去，和唱臂动画的节奏对得上。
   *
   * 只在播放页这类「一屏只有一张封面」的地方开启：列表里成百上千张封面
   * 同时挂着淡入过渡，反而会在快速滚动时糊成一片。
   */
  crossfade?: boolean;
  /**
   * 当前封面解码完成。播放页用它作为「下一首就绪」的一路信号，
   * 与音源可播一起决定唱臂何时落针；不影响这里的淡入逻辑。
   */
  onLoad?: () => void;
}

/** 交叉淡入时长：与唱臂落针前的封面滑入（320ms）大致同拍 */
const CROSSFADE_MS = 280;

export function MusicCover({
  src,
  alt = "Cover",
  className,
  iconClassName,
  fallbackIcon,
  previewable = false,
  imgStyle,
  previewOpen,
  onPreviewOpenChange,
  crossfade = false,
  onLoad,
}: MusicCoverProps) {
  const [error, setError] = useState(false);
  const [internalPreviewOpen, setInternalPreviewOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { push, pop } = useExitLayer();
  const coverUrl = forceHttps(src);

  /**
   * 交叉淡入的两个状态：
   * - `prevUrl`：垫在底下的上一张封面，新图淡入完成后移除；
   * - `entered`：当前这张是否已经淡到不透明。初值 true，首屏不做淡入（避免白闪）。
   */
  const [prevUrl, setPrevUrl] = useState<string | null>(null);
  const [entered, setEntered] = useState(true);
  /** 上一次成功 onLoad 的地址：用来判断新图是否已经在缓存里（同步 load 会绕过淡入） */
  const loadedUrlRef = useRef<string | null>(null);
  const crossfadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 主图节点：同一张封面连续几首歌复用时不会重新触发 onLoad，这里补一次就绪通知 */
  const imgRef = useRef<HTMLImageElement | null>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(
    () => () => {
      if (crossfadeTimerRef.current) clearTimeout(crossfadeTimerRef.current);
    },
    []
  );

  useLayoutEffect(() => {
    // 换图先取消上一张的「摘底图」定时器：否则它可能在本次淡入还没走完时
    // 把刚垫上的 prevUrl 清掉，露出黑胶盘面 —— 用户看到的黑影一闪。
    if (crossfadeTimerRef.current) {
      clearTimeout(crossfadeTimerRef.current);
      crossfadeTimerRef.current = null;
    }
    if (!crossfade || !coverUrl) {
      setPrevUrl(null);
      setEntered(true);
      return;
    }
    const last = loadedUrlRef.current;
    // 没有上一张可垫底（首次加载 / 上一张还没解码完）：绝对不能把新图设为
    // opacity 0，否则中间几帧没有任何封面，直接透出黑色盘面。直接显示。
    if (!last || last === coverUrl) {
      setPrevUrl(null);
      setEntered(true);
      return;
    }
    setPrevUrl(last);
    setEntered(false);
  }, [coverUrl, crossfade]);

  const handleCoverLoad = useCallback(() => {
    // 不管有没有开交叉淡入，都要上报「这张封面已经能显示」
    onLoadRef.current?.();
    if (!crossfade) return;
    loadedUrlRef.current = coverUrl;
    setEntered(true);
    if (crossfadeTimerRef.current) clearTimeout(crossfadeTimerRef.current);
    // 等淡入走完再摘掉底图，提前摘会露出中间态
    crossfadeTimerRef.current = setTimeout(
      () => setPrevUrl(null),
      CROSSFADE_MS + 40
    );
  }, [crossfade, coverUrl]);

  // src 没变（相邻曲目共用同一张专辑封面）或图片已被缓存同步就绪时，浏览器不一定再派发
  // load。同步完成上报就绪并驱动淡入，唱臂与封面都不干等。
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (coverUrl && img?.complete && img.naturalWidth > 0) {
      handleCoverLoad();
    }
  }, [coverUrl, handleCoverLoad]);

  // 受控时以外界状态为准，否则使用内部开关
  const isPreviewOpen = previewOpen ?? internalPreviewOpen;

  // 打开预览：外部控制时通知父组件；自管时更新内部状态
  const openPreview = useCallback(() => {
    if (previewOpen === undefined) setInternalPreviewOpen(true);
    onPreviewOpenChange?.(true);
  }, [previewOpen, onPreviewOpenChange]);

  const closePreview = useCallback(() => {
    if (previewOpen === undefined) setInternalPreviewOpen(false);
    onPreviewOpenChange?.(false);
  }, [previewOpen, onPreviewOpenChange]);

  // src 变化时重置错误状态，让新的封面 URL 有机会重新加载
  useEffect(() => {
    setError(false);
  }, [src]);

  useEffect(() => {
    if (!isPreviewOpen) return;
    const id = push({ close: closePreview });
    return () => {
      pop(id);
    };
  }, [isPreviewOpen, push, pop, closePreview]);

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!coverUrl || isSaving) return;
    setIsSaving(true);

    try {
      const filename = `${alt.replace(/[\\/:*?"<>|]/g, "_")}.jpg`;

      if (IS_NATIVE) {
        await ensurePermission();
        const response = await fetch(coverUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const base64 = await blobToBase64(blob);
        await Filesystem.writeFile({
          path: `Pictures/OtterMusic/${filename}`,
          data: base64,
          directory: Directory.ExternalStorage,
          recursive: true,
        });
        toast.success(`已保存到 Pictures/OtterMusic`);
      } else {
        const response = await fetch(coverUrl);
        const blob = await response.blob();
        triggerBlobDownload(blob, filename);
      }
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setIsSaving(false);
    }
  };

  if (!src || error) {
    return (
      <div
        className={cn(
          "w-full h-full bg-muted flex items-center justify-center shrink-0",
          className
        )}
        // 与 <img> 分支保持一致：拦掉 WebView 原生长按菜单/title 提示，避免手势被系统接管后 click 丢失
        onContextMenu={(e) => e.preventDefault()}
      >
        {fallbackIcon || (
          <Music2 className={cn("text-muted-foreground/50", iconClassName)} />
        )}
      </div>
    );
  }

  return (
    <>
      {/* 上一张垫底：新图淡入时不会露出底层色块，视觉上是「唱片换面」而不是「闪一下」 */}
      {crossfade && prevUrl && (
        <img
          src={prevUrl}
          alt=""
          aria-hidden
          draggable={false}
          className={cn(
            "absolute inset-0 w-full h-full object-cover shrink-0",
            className
          )}
          style={imgStyle}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}

      <img
        ref={imgRef}
        src={coverUrl}
        alt={alt}
        className={cn(
          "w-full h-full object-cover shrink-0",
          previewable && "cursor-pointer",
          className
        )}
        draggable={false}
        style={
          crossfade
            ? {
                ...imgStyle,
                opacity: entered ? 1 : 0,
                transition: `opacity ${CROSSFADE_MS}ms ease-out`,
                willChange: "opacity",
              }
            : imgStyle
        }
        onLoad={handleCoverLoad}
        onError={() => setError(true)}
        onClick={() => previewable && openPreview()}
        onContextMenu={(e) => e.preventDefault()}
      />

      {isPreviewOpen &&
        createPortal(
          <div
            data-testid="cover-preview-portal"
            className="fixed inset-0 z-500 flex flex-col items-center justify-center bg-black select-none animate-in fade-in duration-200"
            onClick={closePreview}
          >
            <img
              src={coverUrl}
              alt={alt}
              className="max-w-full max-h-[80vh] object-contain pointer-events-none"
            />

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="absolute bottom-5 flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-full text-sm transition-colors border border-white/10 disabled:opacity-50"
            >
              <Download size={16} />
              {isSaving ? "保存中..." : "保存图片"}
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
