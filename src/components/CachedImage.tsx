"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Music2 } from "lucide-react";
import { forceHttps } from "@otter-music/shared";
import { cn } from "@/lib/utils";
import { withImageSize } from "@/lib/utils/image-url";

/**
 * 已经成功解码过的图片 URL（本地持久化，冷启动也认）。
 * 只作为「这张图大概率已经在缓存里」的提示使用，绝不能据此直接显示图片 ——
 * 缓存被淘汰时浏览器会重新请求，此时 <img> 一旦可见就会暴露 JPEG 逐行解码的过程。
 */
const KNOWN_KEY = "otter:known-covers:v1";
const MAX_KNOWN = 400;

function loadKnown(): Set<string> {
  try {
    if (typeof window === "undefined") return new Set();
    const raw = window.localStorage.getItem(KNOWN_KEY);
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

const decodedImages = loadKnown();

/**
 * 本次运行中真正解码完成的 URL（内存级）。
 *
 * 和 decodedImages 的区别：这个集合代表「位图此刻还在 WebView 的图片缓存里」，
 * 可以据此在节点重建时**直接显示、不再走一遍骨架 + 淡入**；
 * 而 decodedImages 是跨启动的提示，只能用来提前发起请求，不能直接显示。
 */
const sessionDecoded = new Set<string>();

let persistTimer: number | null = null;

/**
 * 离屏解码池。
 *
 * WebView 只有在图片资源仍被某个 <img> 引用时才会保留解码好的位图。
 * 歌单详情往返、分类网格节点被 React 重建之后，新挂载的 <img> 虽然能命中
 * HTTP 缓存，但仍要重新解码一遍（几十张图叠起来就是几百毫秒的空白卡片）。
 * 这里把解码过的 URL 留一个 1px 的 <img> 挂在屏幕外，让解码结果一直有引用，
 * 新节点挂载时就能直接复用同一份位图。
 *
 * 注意不能用 display:none / visibility:hidden，也不能把 <img> 缩到 1px：
 * 那样 WebView 会按缩小后的尺寸解码（或直接不解码），池子就失去了意义。
 * 这里按接近卡片的尺寸（96px）渲染，再用 overflow 裁掉，放在屏幕外。
 */
const POOL_LIMIT = 120;
const pool = new Map<string, HTMLImageElement>();
let poolContainer: HTMLDivElement | null = null;

function keepDecoded(url: string) {
  if (typeof document === "undefined") return;
  const existing = pool.get(url);
  if (existing) {
    // 命中就挪到队尾，让它比久未出现的图更晚被淘汰
    pool.delete(url);
    pool.set(url, existing);
    return;
  }
  if (!poolContainer || !poolContainer.isConnected) {
    poolContainer = document.createElement("div");
    poolContainer.setAttribute("aria-hidden", "true");
    poolContainer.style.cssText =
      "position:fixed;left:-2000px;top:0;width:600px;height:600px;overflow:hidden;pointer-events:none;";
    document.body.appendChild(poolContainer);
  }
  const img = new Image();
  img.decoding = "sync";
  img.alt = "";
  img.src = url;
  // 按原始尺寸渲染（不写 width/height）：WebView 会按「显示尺寸」决定解码精度，
  // 之前把池子里的图缩到 1px / 96px，解码结果对 115px 的卡片没用，等于白存。
  img.style.cssText = "display:block;float:left;";
  poolContainer.appendChild(img);
  pool.set(url, img);
  if (pool.size > POOL_LIMIT) {
    const oldest = pool.keys().next().value;
    if (oldest) {
      pool.get(oldest)?.remove();
      pool.delete(oldest);
    }
  }
}

function remember(url: string) {
  sessionDecoded.add(url);
  decodedImages.add(url);
  keepDecoded(url);
  // 控制内存/存储上限，超出丢弃最早插入的
  if (decodedImages.size > MAX_KNOWN) {
    const oldest = decodedImages.values().next().value;
    if (oldest) decodedImages.delete(oldest);
  }
  if (persistTimer !== null) return;
  // 一次切换会连续解码 30 张图，合并成一次写盘
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    try {
      window.localStorage.setItem(
        KNOWN_KEY,
        JSON.stringify(Array.from(decodedImages))
      );
    } catch {
      /* 存储满了就只保留内存缓存 */
    }
  }, 800);
}

interface InnerProps {
  url: string | null;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  shimmerDelay?: number;
}

function CoverImageInner({
  url,
  alt,
  className,
  placeholderClassName,
  shimmerDelay = 0,
}: InnerProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  // 本次运行已经解码过的图：直接可见，不再重播一次骨架 + 淡入
  // （节点因分类淘汰/页面重建而重建时，用户看到的就是「图还在」而不是「又在加载」）
  const [ready, setReady] = useState(() => !!url && sessionDecoded.has(url));
  const [failed, setFailed] = useState(false);

  /**
   * 关键：等浏览器把整张图解码完成，再让 <img> 变为可见。
   *
   * 之前是「onLoad 一触发就显示」，但 load 只代表字节下载完了，
   * 解码可能还在异步线程里进行，此时 JPEG 会一条一条描出来，
   * 看起来就是从上往下刷。img.decode() 明确等到位图可用才 resolve，
   * 所以显示出来的第一帧就是完整的一整块。
   */
  useEffect(() => {
    const el = imgRef.current;
    if (!url || !el) return;
    // 本次运行已解码过：位图还在图片缓存里，直接显示，不再等一遍 decode
    // （decoding="sync" 保证即便要重新解码，也在这一帧绘制前完成，不会露出半张图）
    if (sessionDecoded.has(url)) {
      // 把这条 URL 挪到离屏池的队尾，正在浏览的图不会被较早的图挤掉
      keepDecoded(url);
      return;
    }

    let cancelled = false;
    let fallbackLoad: (() => void) | null = null;
    const reveal = () => {
      if (cancelled) return;
      remember(url);
      setReady(true);
    };

    const pending = el.decode?.();
    if (pending) {
      pending.then(reveal, () => {
        // decode 有时会在数据还没到齐时被拒（少数 WebView），
        // 这时退回 load 事件，宁可淡入也不能一直白着。
        if (cancelled) return;
        if (el.complete && el.naturalWidth > 0) {
          reveal();
          return;
        }
        fallbackLoad = reveal;
        el.addEventListener("load", fallbackLoad, { once: true });
      });
    } else if (el.complete && el.naturalWidth > 0) {
      reveal();
    } else {
      fallbackLoad = reveal;
      el.addEventListener("load", fallbackLoad, { once: true });
    }

    return () => {
      cancelled = true;
      if (fallbackLoad) el.removeEventListener("load", fallbackLoad);
    };
  }, [url]);

  if (!url || failed) {
    return (
      <div
        className={cn(
          "w-full h-full bg-muted flex items-center justify-center shrink-0",
          placeholderClassName
        )}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Music2 className="h-1/3 w-1/3 max-h-8 max-w-8 text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <>
      {/* 占位层常驻到图片之上再隐去：直接卸载会看到「灰块 → 透明 → 图」的跳变 */}
      <div
        aria-hidden
        style={{ "--shimmer-delay": `${shimmerDelay}ms` } as CSSProperties}
        className={cn(
          "absolute inset-0 skeleton-shimmer transition-opacity duration-200 ease-out",
          ready ? "opacity-0 is-idle" : "opacity-100",
          placeholderClassName
        )}
      />
      <img
        ref={imgRef}
        src={url}
        alt={alt}
        draggable={false}
        // 必须 eager：lazy 队列会让 decode() 拿不到数据，也会延迟一整屏的显示
        loading="eager"
        // 解码结果直接用于这一帧绘制，不再异步补画
        decoding="sync"
        onError={() => setFailed(true)}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          "w-full h-full object-cover transition-[opacity,transform] duration-200 ease-out",
          // 只有解码完成才显示，杜绝「半张图」
          ready ? "opacity-100" : "opacity-0",
          className
        )}
      />
    </>
  );
}

interface CachedImageProps {
  src?: string | null;
  alt: string;
  /** 作用在 <img> 上（如需 transform/scale 等） */
  className?: string;
  /** 占位层额外样式 */
  placeholderClassName?: string;
  /** 占位扫光的延迟（毫秒）：网格里按序号错开，高光会像波浪扫过 */
  shimmerDelay?: number;
  /**
   * 期望的展示边长（CSS 像素）。传入后对网易云图床改用 `?param=WxH` 缩略图，
   * 避免为一张 115px 的卡片下载/解码 1000px 的原图（原图会把图片缓存挤爆，
   * 节点重建时就要重新解码，看起来像「又加载了一次」）。
   */
  size?: number;
}

/**
 * 带缓存的网络图片。
 *
 * - 先用 img.decode() 等位图就绪，再显示：首帧就是完整的一张，不会从上往下刷
 * - 显示前覆盖骨架占位（扫光静默地跑，不闪不跳版）
 * - 依赖浏览器/WebView 的 HTTP 缓存（同一 URL 不会重复下载）
 *
 * 注意：骨架是 absolute 定位，父容器必须是 relative。
 */
export function CachedImage({
  src,
  alt,
  className,
  placeholderClassName,
  shimmerDelay = 0,
  size,
}: CachedImageProps) {
  const url = withImageSize(forceHttps(src), size);

  // 用 key 让 URL 变化时重置内部加载状态，避免在 effect 里同步 setState
  return (
    <CoverImageInner
      key={url ?? "empty"}
      url={url}
      alt={alt}
      className={className}
      placeholderClassName={placeholderClassName}
      shimmerDelay={shimmerDelay}
    />
  );
}
