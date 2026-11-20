"use client";

import { createPortal } from "react-dom";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { srgbToLab, type SodaColors } from "@/lib/utils/soda-color";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { LyricsPanel } from "./LyricsPanel";
import { MusicCover } from "./MusicCover";
import { VinylCover } from "./VinylCover";
import { CoverStyleMenu } from "./CoverStyleMenu";
import { PlayerProgressBar } from "./PlayerProgressBar";
import { MusicTrack } from "@/types/music";
import {
  ChevronDown,
  Heart,
  ListVideo,
  Shuffle,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  SquareArrowOutUpRight,
  ClockFading,
  Maximize2,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useMounted } from "@/hooks/use-mounted";
import { usePlayerActions } from "@/hooks/usePlayerActions";
import { usePlayerUIState } from "@/hooks/usePlayerUIState";
import { PlayerQueueDrawer } from "./PlayerQueueDrawer";
import { MusicTrackMobileMenu } from "./MusicTrackMobileMenu";
import { AddToPlaylistDrawer } from "./AddToPlaylistDrawer";
import { QualityDrawer } from "./settings/QualityDrawer";
import { PlaybackSpeedDrawer } from "./settings/PlaybackSpeedDrawer";
import { SleepTimerDrawer } from "./settings/SleepTimerDrawer";
import { downloadMusicTrack } from "@/lib/utils/download";
import { getQualityShortLabel } from "@/lib/utils/quality";
import { formatTime } from "@/lib/utils/time";
import {
  useMusicStore,
  type FullScreenBackgroundMode,
} from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import toast from "react-hot-toast";
import { useCoverColors } from "@/hooks/useCoverColors";
import { useCoverWhiteBands } from "@/hooks/useCoverWhiteBands";
import { useLandscapeMode } from "@/hooks/useLandscapeMode";
import { handleLyricsBlankTap } from "@/lib/lyrics-tap";
import {
  consumeSwipeArmCut,
  usePlayerSwipeGestures,
} from "@/hooks/usePlayerSwipeGestures";
import { useSystemBarsStyleOverride } from "@/hooks/useSystemBarsStyleOverride";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { t2s, t2sArtists } from "@/lib/utils/t2s";
import { LandscapePlayer } from "@/components/LandscapePlayer";

/**
 * 播放页展开/收起动画时长，必须与容器上的 `duration-[420ms]` 保持一致。
 * 系统栏颜色延后这么久再切，等页面铺满再变。
 */
const PLAYER_TRANSITION_MS = 420;

/**
 * 主题色背景：canvas 逐像素绘制 + 像素级随机抖动（dither）。
 *
 * 为什么不能靠 CSS 渐变：一个 2670px 高的深色渐变，总落差往往只有 80 级左右，
 * 平均每行只降 0.03 级——也就是**每 30 行才跳 1 级**。斜率越平缓，8bit 量化
 * 台阶越宽：屏幕上就是一条 8dp 高的横向色带，一屏能出现十几条，读起来就是
 * 「好几层」。加色标、调曲线只会让台阶重新排列，治不了根。
 *
 * 抖动必须是二维的：一维（只沿 y 做 Bayer）只能在 16 行内平均，量化边界处
 * 仍然会形成 16 行高的块，横带照旧。这里每个物理像素独立取随机值，让边界
 * 处的相邻像素各取上下两级、按比例混合，视觉上就是均匀的细颗粒，横带消失。
 *
 * 必须用真 `<canvas>` 元素而不是 `background-image`：WebView 会把背景图先缩放
 * 到 CSS 尺寸（400×890）再按 dpr 放大，抖动被 3 倍下采样平均掉，等于白做。
 * canvas 的 backing store 就是设备像素，1:1 绘制，抖动原样保留。
 */
const BG_GLOW_STEPS = 64;
const BG_DARK_MAX = 0.55;
/** 浅色底只做极轻的底部压暗：压到 55% 会把浅色渐变直接拉成深色 */
const BG_LIGHT_DARK_MAX = 0.05;

function clampByte(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function drawThemeBackground(
  canvas: HTMLCanvasElement,
  colors: SodaColors,
  darkenMax: number = BG_DARK_MAX
) {
  const W = canvas.width;
  const H = canvas.height;
  if (W <= 0 || H <= 0) return;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  const img = ctx.createImageData(W, H);
  const data = img.data;

  const [tr, tg, tb] = colors.top;
  const [br, bg, bb] = colors.bottom;
  const [dr, dg, db] = colors.dominant;
  const l = srgbToLab(colors.dominant)[0];
  // 亮主色（白底封面）若按固定透明度叠加会把顶部糊成一片，白字和图标直接失读
  const glowAlpha = l > 65 ? 0.12 : l > 45 ? 0.22 : 0.32;

  // 光晕横向曲线按 64 段采样、逐像素线性插值：省掉 W×H 次 sqrt，
  // 64 段在 1200px 上的折线误差远小于 1 级，看不出竖纹。
  const alphaTab = new Float32Array(BG_GLOW_STEPS);
  const uScale = (BG_GLOW_STEPS - 1) / (W - 1);

  // xorshift32：每像素一次的伪随机，比 Math.random 快一个量级
  let seed = 0x9e3779b9 | 0;

  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const baseR = tr + (br - tr) * t;
    const baseG = tg + (bg - tg) * t;
    const baseB = tb + (bb - tb) * t;

    // 顶部径向光晕：中心 (0.5, -0.20)，半径 (1.30, 1.20)，终点在元素外
    const dy = (t + 0.2) / 1.2;
    const dy2 = dy * dy;
    for (let j = 0; j < BG_GLOW_STEPS; j++) {
      const dx = (j / (BG_GLOW_STEPS - 1) - 0.5) / 1.3;
      let s = Math.sqrt(dx * dx + dy2);
      if (s > 1) s = 1;
      alphaTab[j] = glowAlpha * (1 - s);
    }

    // 压暗：底部压到 darkenMax，斜率恒定（浅色底几乎不压）
    const darken = 1 - darkenMax * t;

    const rowOffset = y * W * 4;
    for (let x = 0; x < W; x++) {
      const u = x * uScale;
      const i0 = u | 0;
      const f = u - i0;
      const a =
        i0 + 1 < BG_GLOW_STEPS
          ? alphaTab[i0] + (alphaTab[i0 + 1] - alphaTab[i0]) * f
          : alphaTab[i0];

      const r = (baseR + (dr - baseR) * a) * darken;
      const g = (baseG + (dg - baseG) * a) * darken;
      const b = (baseB + (db - baseB) * a) * darken;

      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      // ±0.5 级：刚好足以把相位在整数边界附近的量化台阶打散
      const n = ((seed >>> 0) / 4294967296 - 0.5) * 1.6;

      const i = rowOffset + x * 4;
      data[i] = clampByte(r + n);
      data[i + 1] = clampByte(g + n);
      data[i + 2] = clampByte(b + n);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}

/** CSS 兜底：canvas 首帧还没画出来时垫在下面，颜色算法与 canvas 一致 */
function fallbackThemeStyle(colors: SodaColors): React.CSSProperties {
  const [tr, tg, tb] = colors.top;
  const [br, bg, bb] = colors.bottom;
  const [r, g, b] = colors.dominant;
  const l = srgbToLab(colors.dominant)[0];
  const alpha = l > 65 ? 0.12 : l > 45 ? 0.22 : 0.32;
  return {
    backgroundImage: `radial-gradient(130% 120% at 50% -20%, rgba(${r}, ${g}, ${b}, ${alpha}) 0%, rgba(${r}, ${g}, ${b}, 0) 100%), linear-gradient(to bottom, rgb(${tr}, ${tg}, ${tb}) 0%, rgb(${br}, ${bg}, ${bb}) 100%)`,
  } as React.CSSProperties;
}

interface ModeIconProps {
  isRepeat: boolean;
  isShuffle: boolean;
}

function ModeIcon({ isRepeat, isShuffle }: ModeIconProps) {
  if (isRepeat) return <Repeat1 className="h-5 w-5" />;
  if (isShuffle) return <Shuffle className="h-5 w-5" />;
  return <Repeat className="h-5 w-5" />;
}

const BackgroundLayer = memo(
  ({
    colors,
    coverUrl,
    mode,
    photoUrl,
    isLight = false,
  }: {
    colors: SodaColors | null;
    coverUrl: string | null;
    mode: FullScreenBackgroundMode;
    photoUrl: string | null;
    /** 浅色主题下的浅色底：渐变已在取色阶段抬亮，这里不再压暗 */
    isLight?: boolean;
  }) => {
    const showThemeColor = mode === "theme" && !!colors;
    const showCoverMask = mode === "cover" && coverUrl;
    const showPhoto = mode === "photo" && !!photoUrl;
    const canvasRef = useRef<HTMLCanvasElement>(null);

    /**
     * 主题色背景画到 canvas 上：主渐变、光晕、压暗、抖动全部合成进同一张位图，
     * 屏幕上是单一元素，不存在任何「层的边界」。
     *
     * 画布尺寸取 CSS 尺寸 × dpr，等于设备像素数，绘制 1:1，抖动不会被缩放平滑掉。
     * 放在 rAF 里画，避免阻塞打开播放页的过渡动画；这之前容器上的 CSS 渐变垫着，
     * 颜色算法一致，看不出跳变。
     */
    const fallbackStyle = useMemo(
      () => (showThemeColor && colors ? fallbackThemeStyle(colors) : undefined),
      [colors, showThemeColor]
    );

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !showThemeColor || !colors) return;
      let raf = 0;
      const paint = () => {
        const dpr = window.devicePixelRatio || 1;
        const cssW = canvas.clientWidth;
        const cssH = canvas.clientHeight;
        if (!cssW || !cssH) {
          raf = requestAnimationFrame(paint);
          return;
        }
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        drawThemeBackground(
          canvas,
          colors,
          isLight ? BG_LIGHT_DARK_MAX : BG_DARK_MAX
        );
      };
      raf = requestAnimationFrame(paint);
      return () => cancelAnimationFrame(raf);
    }, [colors, showThemeColor, isLight]);

    return (
      <div
        className={cn(
          "absolute inset-0 z-[-1] overflow-hidden",
          isLight ? "bg-[#eef2f5]" : "bg-zinc-950"
        )}
      >
        {/* 动态颜色层：主渐变 + 光晕 + 压暗 + dither 已合成在同一张图里 */}
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-1000 ease-in-out",
            showThemeColor ? "opacity-100" : "opacity-0"
          )}
          style={fallbackStyle}
        >
          {showThemeColor && (
            <canvas
              ref={canvasRef}
              aria-hidden="true"
              className="absolute inset-0 block h-full w-full"
            />
          )}
        </div>

        {/* 封面遮罩层 */}
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-1000",
            showCoverMask ? "opacity-100" : "opacity-0"
          )}
        >
          {coverUrl && (
            <img
              src={coverUrl}
              alt=""
              aria-hidden="true"
              className="absolute inset-[-32px] h-[calc(100%+64px)] w-[calc(100%+64px)] object-cover blur-3xl scale-110"
            />
          )}
          <div className="absolute inset-0 bg-black/60" />
          <div className="absolute inset-0 bg-linear-to-b from-black/10 via-zinc-950/20 to-black/60" />
        </div>

        {/* 自定义照片层：压暗 + 上下渐隐，保证白色文字/控件可读 */}
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-1000",
            showPhoto ? "opacity-100" : "opacity-0"
          )}
        >
          {photoUrl && (
            <img
              src={photoUrl}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-0 bg-linear-to-b from-black/25 via-transparent to-black/60" />
        </div>

        {/* 兜底背景层 */}
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-1000",
            showThemeColor || showCoverMask || showPhoto
              ? "opacity-0"
              : "opacity-100"
          )}
        >
          <div className="absolute inset-0 bg-linear-to-b from-zinc-900 via-zinc-950 to-black" />
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-2xl h-[60vh] opacity-30 pointer-events-none"
            style={{
              background:
                "radial-gradient(circle at 50% 0%, rgba(255,255,255,0.08) 0%, transparent 70%)",
            }}
          />
        </div>
      </div>
    );
  }
);
BackgroundLayer.displayName = "BackgroundLayer";

interface FullScreenPlayerProps {
  isFullScreen: boolean;
  onClose: () => void;
}

export function FullScreenPlayer({
  isFullScreen,
  onClose,
}: FullScreenPlayerProps) {
  const isMounted = useMounted();
  /** 横屏沉浸模式：手动进入后锁定横屏，由独立的 LandscapePlayer 渲染 */
  const {
    isLandscapeMode,
    enter: enterLandscapeMode,
    exit: exitLandscapeMode,
  } = useLandscapeMode(isFullScreen);
  const {
    showLyrics,
    setShowLyrics,
    moreDrawerOpen,
    setMoreDrawerOpen,
    isAddToPlaylistOpen,
    setIsAddToPlaylistOpen,
    qualityDrawerOpen,
    setQualityDrawerOpen,
    speedDrawerOpen,
    setSpeedDrawerOpen,
    sleepDrawerOpen,
    setSleepDrawerOpen,
  } = usePlayerUIState(isFullScreen);

  const {
    queue,
    quality,
    currentIndex,
    setCurrentIndexAndPlay,
    clearQueue,
    reshuffle,
    removeFromQueue,
    playTrackAsNext,
    currentAudioUrl,
    fullScreenBackgroundMode,
    coverSize,
    coverRadius,
    coverStyle,
    playbackSpeed,
    sleepTimerIsActive,
    sleepTimerRemaining,
    isPlaying,
    isLoading,
    isRepeat,
    isShuffle,
    togglePlay,
    toggleRepeat,
    toggleShuffle,
    coverUrl,
    customBackgroundImage,
    vinylColor,
    lightThemeLightBackground,
  } = useMusicStore(
    useShallow((state) => ({
      queue: state.queue,
      currentIndex: state.currentIndex,
      setCurrentIndexAndPlay: state.setCurrentIndexAndPlay,
      clearQueue: state.clearQueue,
      reshuffle: state.reshuffle,
      removeFromQueue: state.removeFromQueue,
      playTrackAsNext: state.playTrackAsNext,
      currentAudioUrl: state.currentAudioUrl,
      quality: state.quality,
      fullScreenBackgroundMode: state.fullScreenBackgroundMode,
      coverSize: state.coverSize,
      coverRadius: state.coverRadius,
      coverStyle: state.coverStyle,
      playbackSpeed: state.playbackSpeed,
      sleepTimerIsActive: state.sleepTimerIsActive,
      sleepTimerRemaining: state.sleepTimerRemaining,
      isPlaying: state.isPlaying,
      isLoading: state.isLoading,
      isRepeat: state.isRepeat,
      isShuffle: state.isShuffle,
      togglePlay: state.togglePlay,
      toggleRepeat: state.toggleRepeat,
      toggleShuffle: state.toggleShuffle,
      coverUrl: state.coverUrl,
      customBackgroundImage: state.customBackgroundImage,
      vinylColor: state.vinylColor,
      lightThemeLightBackground: state.lightThemeLightBackground,
    }))
  );

  const currentTrack = queue[currentIndex] || null;

  /**
   * 切歌唱臂动画：切歌瞬间唱臂先荡开让出唱片，新封面滑入完成后再落回沟槽。
   * 监听曲目 id 变化（而不是在按钮 handler 里埋点），这样上一首/下一首、
   * 队列点选、播放结束自动续播几条路径都能覆盖。
   * 组件常驻不重挂载，所以用 ref 记住上一首 id。
   *
   * 横滑切歌要排除：那条路径下唱臂已经跟着手指抬到切割位、并在新唱片落位后
   * 自己转回去了（见 usePlayerSwipeGestures）。再来一遍荡开等于动画重播。
   */
  const prevTrackIdRef = useRef<string | null>(currentTrack?.id ?? null);
  const [armAway, setArmAway] = useState(false);
  useEffect(() => {
    const id = currentTrack?.id ?? null;
    const prev = prevTrackIdRef.current;
    prevTrackIdRef.current = id;
    // 首次挂载、清空队列、同一首歌都不触发
    if (prev === null || id === null || prev === id) return;
    // 横滑切歌：唱臂的抬臂/回落已由手势层演完，这里不再补一遍荡开动画。
    // （残留的 armAway 状态自有 320ms 定时器收尾，effect 里不碰 state）
    if (consumeSwipeArmCut()) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    // 推到下一帧再切状态：让新封面先渲染出来，唱臂随后荡开；
    // 也避免在 effect 同步调用 setState 触发级联渲染。
    let timer = 0;
    const raf = requestAnimationFrame(() => {
      setArmAway(true);
      // 与封面滑入时长（320ms）对齐：新封面落位时唱臂开始回摆
      timer = window.setTimeout(() => setArmAway(false), 320);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [currentTrack?.id]);

  const [isCoverPreviewOpen, setIsCoverPreviewOpen] = useState(false);
  const [isStyleMenuOpen, setIsStyleMenuOpen] = useState(false);
  /** 风格菜单刚关闭的时刻：紧接着的那次点击只用于关菜单，不要切歌词页 */
  const styleMenuClosedAtRef = useRef(0);

  /** 封面长按 → 修改播放风格（原始 / 黑胶唱片） */
  const handleCoverLongPress = () => setIsStyleMenuOpen(true);

  /** 风格菜单开关：关闭时打时间戳，供切页守卫消费 */
  const handleStyleMenuOpenChange = useCallback((open: boolean) => {
    setIsStyleMenuOpen(open);
    if (!open) styleMenuClosedAtRef.current = Date.now();
  }, []);

  /** 刚关菜单的补发点击：消费一次，返回 true 表示这次点击应被吞掉 */
  const consumeMenuCloseClick = useCallback(() => {
    const recent = Date.now() - styleMenuClosedAtRef.current < 400;
    if (recent) styleMenuClosedAtRef.current = 0;
    return recent;
  }, []);

  /** 从风格菜单进入大图预览（无封面时提示） */
  const handleCoverPreview = () => {
    if (!coverUrl) {
      toast.error("暂无封面");
      return;
    }
    setIsCoverPreviewOpen(true);
  };

  const {
    handleShare,
    handleToggleLike,
    isCurrentTrackFavorite,
    trackInfoPressHandlers,
    coverPressHandlers,
    consumeLongPressClick,
  } = usePlayerActions(currentTrack, currentAudioUrl, handleCoverLongPress);

  const isDarkTheme = useIsDarkTheme();
  const isLightTheme = !isDarkTheme;
  // 「浅色主题显示浅色背景」关闭时，浅色主题也按深色区间取色、按深色排版。
  const useLightColors = isLightTheme && lightThemeLightBackground;
  const { colors: backgroundColors } = useCoverColors(
    coverUrl && fullScreenBackgroundMode === "theme" ? coverUrl : null,
    useLightColors ? "light" : "dark"
  );

  /**
   * 页面底色是浅色还是深色：
   * 只有「浅色主题 + 允许浅色背景 + 封面主题色背景 + 颜色已算出」这些同时成立才是浅色底。
   * 模糊封面 / 自定义照片两种背景叠了黑色遮罩，恒为深色；
   * 取色未完成时兜底是深色，先按深色排版，避免白字压浅底。
   */
  const isLightTone =
    fullScreenBackgroundMode === "theme" &&
    useLightColors &&
    !!backgroundColors;

  /**
   * 系统栏图标明暗跟随页面底色：深色底用浅色图标，浅色底用深色图标。
   * 否则浅色主题下深色底会得到「黑底黑图标」，浅色底会得到「白底白图标」。
   *
   * 延后到展开动画结束再生效：否则点播放条的一瞬间状态栏就跳成另一套图标，
   * 而此时页面还没铺满，观感是「颜色先变、页面后到」。
   */
  useSystemBarsStyleOverride(!isLightTone, isFullScreen, PLAYER_TRANSITION_MS);

  /** 封面原图如果自带纯白边（平台上传时就带了），按比例放大裁掉 */
  const coverZoom = useCoverWhiteBands(coverUrl);

  const playTrack = (index: number) => setCurrentIndexAndPlay(index);

  const handleClearQueue = async () => {
    if (
      await confirmDialog({
        title: "确定要清空播放列表吗？",
        destructive: true,
        confirmText: "清空",
      })
    ) {
      clearQueue();
      toast.success("播放列表已清空");
    }
  };

  const handleRemoveFromQueue = (track: MusicTrack) => {
    removeFromQueue(track.id);
  };

  const handlePrev = useCallback(() => {
    if (queue.length === 0) return;
    setCurrentIndexAndPlay((currentIndex - 1 + queue.length) % queue.length);
  }, [queue.length, currentIndex, setCurrentIndexAndPlay]);

  const handleNext = useCallback(() => {
    if (queue.length === 0) return;
    setCurrentIndexAndPlay((currentIndex + 1) % queue.length);
  }, [queue.length, currentIndex, setCurrentIndexAndPlay]);

  const gestureAreaRef = useRef<HTMLDivElement | null>(null);
  /**
   * 横滑跟手的 DOM 直写目标。位移直接写到这两个元素的 style 上，
   * 不再每个 touchmove 都 setState 重渲染整页 —— 那是横滑卡顿的根因。
   */
  const coverTransformRef = useRef<HTMLDivElement | null>(null);
  const tonearmTransformRef = useRef<HTMLDivElement | null>(null);
  const tonearmArmRef = useRef<SVGSVGElement | null>(null);
  const dragRefs = useMemo(
    () => ({
      cover: coverTransformRef,
      tonearm: tonearmTransformRef,
      tonearmArm: tonearmArmRef,
    }),
    [coverTransformRef, tonearmTransformRef, tonearmArmRef]
  );

  /**
   * 上一次「点在唱臂骨架上」的触摸轻点时间。
   *
   * 触摸的轻点在 touchend 里就切换了播放状态，随后浏览器还会补发一次 click；
   * 骨架自己会 stopPropagation 兜住它，但如果时序错开、click 先到了外层容器，
   * 就会变成「切了播放又切了歌词」。这里用时间戳让两条路径互斥。
   */
  const vinylTapAtRef = useRef(0);

  /**
   * 封面可用空间：跟着容器实际尺寸走。
   *
   * 之前用的是 `min(coverSize, 100vw-16, 70svh)`——只按视口算，没算上下两排控件占掉
   * 的高度。分屏、横屏、小屏手机上封面会把中间那块挤爆（甚至压到歌名下面），
   * 或者被裁掉一部分。这里直接量容器，封面尺寸永远不超过可用空间。
   */
  const [coverBox, setCoverBox] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const el = gestureAreaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setCoverBox({ width: box.width, height: box.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 可用空间扣掉 16px 余量；没量到之前先不做限制，避免首帧闪烁 */
  const coverPx = coverBox
    ? Math.max(
        0,
        Math.min(coverSize, coverBox.width - 16, coverBox.height - 16)
      )
    : null;

  /**
   * 高度实在不够就别画封面了：小于 140px 的封面既看不出内容，又会把歌名和
   * 控件挤成一团，直接不显示，把空间让给歌词/控件。
   */
  const showCover = coverPx === null || coverPx >= 140;

  /**
   * 歌词页、封面预览、横屏沉浸模式都不接手势：
   * 歌词要能原生滚动，预览要能双指缩放，横屏有自己的交互。
   */
  const swipeEnabled =
    isFullScreen &&
    !showLyrics &&
    !isCoverPreviewOpen &&
    !isStyleMenuOpen &&
    !isLandscapeMode;

  /**
   * touch-action 必须同步关掉：否则 WebView 把上滑当页面滚动手势，
   * 手指抬起后的惯性期内紧接着的 tap 只用于「停止滚动」，click 根本不会派发，
   * 表现就是「上滑之后再点一下没反应」。封面页本来就没有要原生滚动的内容。
   */
  const gestureAreaStyle = {
    touchAction: swipeEnabled ? "none" : "auto",
  } as const;

  const swipe = usePlayerSwipeGestures({
    enabled: swipeEnabled,
    onClose,
    onPrev: handlePrev,
    onNext: handleNext,
    // 轻点在 touchend 里处理：不依赖 click，避免上滑/滚动后点击被 WebView 吞掉
    onTap: (target) => {
      // 长按抬手补发的 tap 只用于弹菜单，不要顺带切到/切回歌词页
      if (consumeLongPressClick()) return;
      // 刚关掉风格菜单的那次 tap 只用于关菜单，不要切页
      if (consumeMenuCloseClick()) return;
      if (isCoverPreviewOpen || isStyleMenuOpen) return;
      // 歌词页的空白：点一下回顶，别当成「切回封面」
      if (showLyrics && handleLyricsBlankTap(target)) return;
      // 只有唱臂骨架（基座/臂管/唱头）= 播放/暂停；点盘面与周围空白都是切歌词
      if (target instanceof Element && target.closest("[data-vinyl-control]")) {
        vinylTapAtRef.current = Date.now();
        togglePlay();
        return;
      }
      setShowLyrics(!showLyrics);
    },
    containerRef: gestureAreaRef,
    // 横滑位移走 DOM 直写，避免每个 touchmove 都重渲染整个播放页
    dragRefs,
  });

  /** 下拉跟手位移只作用于整页容器；松手后交回 CSS transition 回弹或滑出 */
  const dragStyle =
    swipe.isDragging || swipe.dragY > 0
      ? {
          transform: `translateY(${swipe.dragY}px)`,
          // 回弹比关闭更慢一点、曲线更"黏"：手指离开后页面像被吸回去，
          // linear / ease-in-out 都会显得生硬，easeOutQuint 收尾几乎无速度，观感最接近原生
          transition: swipe.isDragging
            ? "none"
            : "transform 360ms cubic-bezier(0.22, 1, 0.36, 1)",
        }
      : undefined;

  /**
   * 横向切歌：跟手时封面随手指平移，松手切歌后新封面从侧边滑入。
   * 用独立的 `translate` 属性而不是改 transform —— 播放/暂停的 scale 走的是
   * Tailwind 的 `scale` 属性，两者互不覆盖，位移和缩放能同时生效。
   */
  /**
   * 这里只给 transition，位移本身由手势 hook 直接写到 DOM 节点上。
   * 关键：JSX style 里不能出现 translate —— 否则 React 每次重渲染都会把
   * 跟手写到 DOM 上的实时位移覆盖掉，既闪又卡。
   */
  const coverSlideStyle: React.CSSProperties = {
    transition:
      swipe.isHorizDragging || swipe.slideSnap
        ? "none"
        : "translate 320ms cubic-bezier(0.22, 1, 0.36, 1), scale 500ms",
  };

  /**
   * 横滑时唱臂固定在屏幕原位：唱臂在封面容器内部，会跟着封面一起平移。
   * 手势 hook 给唱臂容器写了反向等量的 translate 抵消，让唱片从唱臂下方滑过，
   * 只有唱片本身在滑动/旋转，唱臂不跟着左右晃。
   * transition 与封面用同一套时序（跟手无过渡、松手 320ms），两者同步才不会错位。
   */
  const tonearmCounterStyle: React.CSSProperties = {
    transition:
      swipe.isHorizDragging || swipe.slideSnap
        ? "none"
        : "translate 320ms cubic-bezier(0.22, 1, 0.36, 1)",
  };

  if (!isMounted) return null;

  // 循环切换播放模式：none → repeat → shuffle → none
  const handleModeToggle = () => {
    if (!isShuffle && !isRepeat) toggleRepeat();
    else if (isRepeat) {
      toggleRepeat();
      toggleShuffle();
    } else toggleShuffle();
  };

  return createPortal(
    <div
      className={cn(
        // 420ms + easeOutQuint：展开/收起都走同一条曲线，起步快、末尾缓，
        // 原 500ms ease-in-out 在 Android WebView 上收尾会"顿"一下再停住
        "fixed inset-0 z-50 transition-transform duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] flex flex-col select-none will-change-transform",
        isFullScreen ? "translate-y-0" : "translate-y-full",
        // 浅色底时整页的 white 语义反转成深色（见 global.css）
        isLightTone && "player-tone-light"
      )}
      // 整个播放页（含黑胶盘面空白区、歌词、歌名）长按都不弹 WebView 系统菜单/选中文字，
      // 否则系统会抢走触摸手势并派发 touchcancel，长按定时器被清掉，风格菜单弹不出来
      onContextMenu={(e) => e.preventDefault()}
      style={{ WebkitTouchCallout: "none", ...dragStyle }}
    >
      {/* 背景渲染层 */}
      <BackgroundLayer
        colors={backgroundColors}
        coverUrl={coverUrl}
        mode={fullScreenBackgroundMode}
        photoUrl={customBackgroundImage}
        isLight={isLightTone}
      />

      {/* 横屏沉浸模式：独立组件，覆盖于普通布局之上 */}
      {isLandscapeMode && (
        <LandscapePlayer
          background={
            <BackgroundLayer
              colors={backgroundColors}
              coverUrl={coverUrl}
              mode={fullScreenBackgroundMode}
              photoUrl={customBackgroundImage}
              isLight={isLightTone}
            />
          }
          onExit={exitLandscapeMode}
        />
      )}

      <header className="shrink-0 grid grid-cols-3 items-center px-6 pt-[calc(1rem+var(--safe-area-top))] relative z-10">
        <div className="flex justify-start">
          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 text-white/60 hover:bg-white/10 hover:text-white"
            onClick={() => {
              onClose();
            }}
          >
            <ChevronDown className="size-7" strokeWidth={1.5} />
          </Button>
        </div>
        <div className="flex justify-center">
          {!showLyrics && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs tracking-widest text-white/50 hover:text-white hover:bg-white/10 h-8 px-3"
              onClick={() => setQualityDrawerOpen(true)}
            >
              {getQualityShortLabel(quality)}
            </Button>
          )}
        </div>
        <div className="flex items-center justify-end">
          {showLyrics ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 text-white/60 hover:bg-white/10 hover:text-white"
              onClick={enterLandscapeMode}
              aria-label="横屏沉浸播放"
              title="横屏沉浸播放"
            >
              <Maximize2 className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 text-white/60 hover:bg-white/10 hover:text-white"
              onClick={handleShare}
              aria-label="分享"
              title="分享"
            >
              <SquareArrowOutUpRight className="h-5 w-5" />
            </Button>
          )}
        </div>
      </header>

      <CoverStyleMenu
        open={isStyleMenuOpen}
        onOpenChange={handleStyleMenuOpenChange}
        onPreview={handleCoverPreview}
      />

      {/**
       * 长按改播放风格只绑定这块内容区——它和歌词页是同一个容器，
       * 所以触发区上下边界恰好与歌词区域一致；歌名行、进度条、底部控件
       * 都在容器外，长按不会误弹菜单。
       */}
      <div
        ref={gestureAreaRef}
        className="flex-1 flex flex-col items-center justify-center px-2 relative z-10 overflow-hidden cursor-pointer"
        {...swipe.handlers}
        onTouchStart={(e) => {
          swipe.handlers.onTouchStart(e);
          if (!showLyrics) coverPressHandlers.onTouchStart?.(e);
        }}
        onTouchMove={(e) => {
          swipe.handlers.onTouchMove(e);
          // 横滑切歌时移动超过阈值就取消「长按改风格」的计时器
          if (!showLyrics) coverPressHandlers.onTouchMove?.(e);
        }}
        onTouchEnd={(e) => {
          swipe.handlers.onTouchEnd(e);
          if (!showLyrics) coverPressHandlers.onTouchEnd?.();
        }}
        onTouchCancel={() => {
          swipe.handlers.onTouchCancel();
          if (!showLyrics) coverPressHandlers.onTouchCancel?.();
        }}
        onMouseDown={(e) => {
          if (!showLyrics) coverPressHandlers.onMouseDown?.(e);
        }}
        onMouseMove={(e) => {
          if (!showLyrics) coverPressHandlers.onMouseMove?.(e);
        }}
        onMouseUp={() => {
          if (!showLyrics) coverPressHandlers.onMouseUp?.();
        }}
        onMouseLeave={() => {
          if (!showLyrics) coverPressHandlers.onMouseLeave?.();
        }}
        style={gestureAreaStyle}
        onClick={(e) => {
          // 长按内容区弹菜单后补发的 click：只吞掉，菜单保持打开、歌词页保持不变
          if (consumeLongPressClick()) return;
          // 刚关掉风格菜单的那次点击：只吞掉，不要切页
          if (consumeMenuCloseClick()) return;
          // 预览/风格菜单打开期间不切换歌词，避免长按后的 click 冒泡到这里
          if (isCoverPreviewOpen || isStyleMenuOpen) return;
          // 滑动切歌/收起后浏览器还会补一次 click，这里吞掉，否则会顺带切到歌词页
          if (swipe.shouldSuppressClick()) return;
          // 歌词页的空白：点一下回顶（Web 端鼠标点击走这里）
          if (showLyrics && handleLyricsBlankTap(e.target)) return;
          // Web 端鼠标点击没有 touchend 的 onTap，在这里走同一套分流
          if (
            e.target instanceof Element &&
            e.target.closest("[data-vinyl-control]")
          ) {
            togglePlay();
            return;
          }
          setShowLyrics(!showLyrics);
        }}
      >
        {showLyrics ? (
          <div className="w-full h-full">
            <LyricsPanel track={currentTrack} active={isFullScreen} />
          </div>
        ) : showCover ? (
          <div
            ref={coverTransformRef}
            title="长按修改播放风格"
            className={cn(
              "relative aspect-square transition-transform duration-500",
              // 黑胶的唱臂基座在盘外上方，不能被裁；盘面/封面各自已 rounded-full
              coverStyle === "vinyl" ? "overflow-visible" : "overflow-hidden",
              isPlaying ? "scale-100" : "scale-[0.95]"
            )}
            style={{
              width: coverPx
                ? `${coverPx}px`
                : `min(${coverSize}px, calc(100vw - 16px), 70svh)`,
              borderRadius: coverStyle === "vinyl" ? 0 : coverRadius,
              ...coverSlideStyle,
            }}
          >
            {/* 1.02 的底噪裁边 + 检测到的白边裁切：部分平台封面原图自带纯白
                letterbox（上下各 ~4%），不裁就是一整圈白框贴在深色背景上 */}
            {coverStyle === "vinyl" ? (
              <VinylCover
                src={coverUrl}
                alt={currentTrack?.name}
                isPlaying={isPlaying}
                armState={armAway ? "away" : isPlaying ? "playing" : "paused"}
                tonearmContainerStyle={tonearmCounterStyle}
                tonearmContainerRef={tonearmTransformRef}
                tonearmArmRef={tonearmArmRef}
                className="h-full w-full touch-none"
                imgStyle={{
                  transform: `scale(${(1.02 * coverZoom).toFixed(4)})`,
                }}
                iconClassName="h-16 w-16 text-white/30"
                previewOpen={isCoverPreviewOpen}
                onPreviewOpenChange={setIsCoverPreviewOpen}
                discColor={vinylColor}
                onControlActivate={() => {
                  // 骨架自己吞掉了 click（不再冒泡到内容区的分流里），
                  // 所以这边的守卫要跟内容区那套保持一致，否则长按弹风格菜单、
                  // 刚关菜单这些「补发的 click」会顺带把播放状态切了。
                  if (consumeLongPressClick()) return;
                  if (consumeMenuCloseClick()) return;
                  if (isCoverPreviewOpen || isStyleMenuOpen) return;
                  if (swipe.shouldSuppressClick()) return;
                  // 触摸轻点已经在 touchend 处理过，这里只兜住补发的 click
                  if (Date.now() - vinylTapAtRef.current < 700) return;
                  togglePlay();
                }}
              />
            ) : (
              <MusicCover
                src={coverUrl}
                alt={currentTrack?.name}
                className="h-full w-full object-cover dark select-none touch-none"
                imgStyle={{
                  transform: `scale(${(1.02 * coverZoom).toFixed(4)})`,
                }}
                iconClassName="h-16 w-16 text-white/30"
                previewOpen={isCoverPreviewOpen}
                onPreviewOpenChange={setIsCoverPreviewOpen}
              />
            )}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 px-8 py-4 relative z-10">
        <div className="flex items-center justify-between">
          <div
            className={cn("min-w-0 flex-1 cursor-pointer select-none")}
            onMouseDown={trackInfoPressHandlers.onMouseDown}
            onMouseMove={trackInfoPressHandlers.onMouseMove}
            onMouseUp={trackInfoPressHandlers.onMouseUp}
            onMouseLeave={trackInfoPressHandlers.onMouseLeave}
            onTouchStart={trackInfoPressHandlers.onTouchStart}
            onTouchMove={trackInfoPressHandlers.onTouchMove}
            onTouchEnd={trackInfoPressHandlers.onTouchEnd}
            onTouchCancel={trackInfoPressHandlers.onTouchCancel}
            title="长按复制歌曲信息"
          >
            <h2 className="truncate text-sm font-semibold text-white">
              {t2s(currentTrack?.name) || "未知歌曲"}
            </h2>
            <p className="truncate text-xs text-white/60 mt-1">
              {t2sArtists(currentTrack?.artist).join(", ") || "未知歌手"}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-white/70 hover:bg-white/10 hover:text-white"
              onClick={(e) => {
                e.stopPropagation();
                handleToggleLike();
              }}
            >
              <Heart
                className={cn(
                  "h-6 w-6 transition-all",
                  isCurrentTrackFavorite && "fill-primary text-primary"
                )}
              />
            </Button>
            {currentTrack && (
              <>
                <MusicTrackMobileMenu
                  track={currentTrack}
                  open={moreDrawerOpen}
                  onOpenChange={setMoreDrawerOpen}
                  onAddToPlaylist={() => {
                    setIsAddToPlaylistOpen(true);
                  }}
                  onDownload={() => {
                    downloadMusicTrack(currentTrack, parseInt(quality));
                  }}
                  isFavorite={isCurrentTrackFavorite}
                  onToggleLike={() => {
                    handleToggleLike();
                  }}
                  triggerClassName="h-10 w-10 text-white/70 hover:bg-white/10 hover:text-white"
                  onNavigate={() => {
                    onClose();
                  }}
                />
                <AddToPlaylistDrawer
                  open={isAddToPlaylistOpen}
                  onOpenChange={setIsAddToPlaylistOpen}
                  track={currentTrack}
                />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-8 relative z-10">
        <PlayerProgressBar
          className="relative"
          leftTimeSuffix={
            playbackSpeed !== 1.0 ? (
              <span className="ml-1 text-[0.7em] align-sub opacity-70">
                x{playbackSpeed.toFixed(1)}
              </span>
            ) : null
          }
          centerContent={
            sleepTimerIsActive ? (
              <span className="flex items-center gap-1 text-[0.85em]">
                <ClockFading className="w-2.5 h-2.5" />
                {formatTime(sleepTimerRemaining)}
              </span>
            ) : null
          }
          onLeftTimeClick={() => setSpeedDrawerOpen(true)}
          onRightTimeClick={() => setSleepDrawerOpen(true)}
          onCenterClick={() => setSleepDrawerOpen(true)}
        />
      </div>

      <div className="shrink-0 flex items-center justify-between px-8 py-6 pb-[calc(2rem+var(--safe-area-bottom))] relative z-10">
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 transition-colors text-white/70 hover:text-white hover:bg-white/10"
          onClick={handleModeToggle}
        >
          <ModeIcon isRepeat={isRepeat} isShuffle={isShuffle} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 text-white/70 hover:bg-white/10 hover:text-white"
          onClick={handlePrev}
        >
          <SkipBack className="h-6 w-6 fill-current" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 rounded-full hover:bg-transparent p-0"
          onClick={togglePlay}
          disabled={isLoading}
          aria-label={isPlaying ? "暂停" : "播放"}
        >
          <span
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95",
              // 浅色底：白底墨色图标 + 一圈淡投影浮起来。
              // 不能沿用 bg-white text-black —— 那两个类走 --color-white/--color-black
              // 变量，在浅色底会被反转成深底白箭头，观感太重。
              isLightTone
                ? "player-play-btn-light"
                : "bg-white text-black shadow-lg"
            )}
          >
            {isLoading ? (
              <Spinner className="h-6 w-6 text-inherit" />
            ) : isPlaying ? (
              <Pause className="h-6 w-6 fill-current" />
            ) : (
              <Play className="h-6 w-6 fill-current ml-0.5" />
            )}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 text-white/70 hover:bg-white/10 hover:text-white"
          onClick={handleNext}
        >
          <SkipForward className="h-6 w-6 fill-current" />
        </Button>
        <PlayerQueueDrawer
          queue={queue}
          currentIndex={currentIndex}
          isPlaying={isPlaying}
          isShuffle={isShuffle}
          onPlay={playTrack}
          onClear={handleClearQueue}
          onReshuffle={reshuffle}
          onRemove={handleRemoveFromQueue}
          onPlayTrack={playTrackAsNext}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 text-white/70 hover:bg-white/10 hover:text-white"
            >
              <ListVideo className="h-5 w-5" />
            </Button>
          }
        />
      </div>

      <QualityDrawer
        open={qualityDrawerOpen}
        onOpenChange={setQualityDrawerOpen}
      />
      <PlaybackSpeedDrawer
        open={speedDrawerOpen}
        onOpenChange={setSpeedDrawerOpen}
      />
      <SleepTimerDrawer
        open={sleepDrawerOpen}
        onOpenChange={setSleepDrawerOpen}
      />
    </div>,
    document.body
  );
}
