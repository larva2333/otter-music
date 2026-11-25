"use client";

import { createPortal } from "react-dom";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { srgbToLab, type SodaColors } from "@/lib/utils/soda-color";
import { BG_DARK_MAX, BG_LIGHT_DARK_MAX } from "@/lib/theme-background";
import { renderThemeBackgroundOffThread } from "@/lib/cover-color-client";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { LyricsPanel } from "./LyricsPanel";
import { AudioOriginLabel } from "./AudioOriginLabel";
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
  Maximize2,
  MessageCircleMore,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useMounted } from "@/hooks/use-mounted";
import { usePlayerActions } from "@/hooks/usePlayerActions";
import { usePlayerUIState } from "@/hooks/usePlayerUIState";
import { PlayerQueueDrawer } from "./PlayerQueueDrawer";
import { MusicTrackMobileMenu } from "./MusicTrackMobileMenu";
import { MusicCommentsDrawer } from "./MusicCommentsDrawer";
import { AddToPlaylistDrawer } from "./AddToPlaylistDrawer";
import { QualityDrawer } from "./settings/QualityDrawer";
import { downloadMusicTrack } from "@/lib/utils/download";
import { getQualityShortLabel } from "@/lib/utils/quality";
import {
  useMusicStore,
  type FullScreenBackgroundMode,
} from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import toast from "react-hot-toast";
import { useCoverColors } from "@/hooks/useCoverColors";
import { useCoverWhiteBands } from "@/hooks/useCoverWhiteBands";
import { useLandscapeMode } from "@/hooks/useLandscapeMode";
import { scrollPageToTop } from "@/lib/scroll-to-top";
import {
  consumeSwipeArmCut,
  usePlayerSwipeGestures,
} from "@/hooks/usePlayerSwipeGestures";
import { useSystemBarsStyleOverride } from "@/hooks/useSystemBarsStyleOverride";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { t2s, t2sArtists } from "@/lib/utils/t2s";
import { LandscapePlayer } from "@/components/LandscapePlayer";
import { beginArmCut, notifyArmReady } from "@/lib/vinyl-arm";

/**
 * 播放页展开/收起动画时长，必须与容器上的 `duration-[420ms]` 保持一致。
 * 系统栏颜色延后这么久再切，等页面铺满再变。
 */
const PLAYER_TRANSITION_MS = 420;

/**
 * 主题色背景：canvas 逐像素绘制 + 像素级随机抖动（dither），像素合成在 Worker 中执行
 * （见 lib/theme-background.ts & lib/cover-color-client.ts），避免主线程卡死唱臂动画。
 *
 * 必须用真 `<canvas>` 元素而不是 `background-image`：WebView 会把背景图先缩放
 * 到 CSS 尺寸（400×890）再按 dpr 放大，抖动被 3 倍下采样平均掉，等于白做。
 * canvas 的 backing store 就是设备像素，1:1 绘制，抖动原样保留。
 */

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
    active = true,
  }: {
    colors: SodaColors | null;
    coverUrl: string | null;
    mode: FullScreenBackgroundMode;
    photoUrl: string | null;
    /** 浅色主题下的浅色底：渐变已在取色阶段抬亮，这里不再压暗 */
    isLight?: boolean;
    /** 全屏页收起时不合成全屏像素，避免后台切歌空耗内存与 Worker */
    active?: boolean;
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
     * 像素合成在 Worker 里算，主线程只做一次 putImageData，避免切歌时阻塞唱臂动画；
     * 这之前容器上的 CSS 渐变垫着，颜色算法一致，看不出跳变。
     */
    const fallbackStyle = useMemo(
      () => (showThemeColor && colors ? fallbackThemeStyle(colors) : undefined),
      [colors, showThemeColor]
    );

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!active || !canvas || !showThemeColor || !colors) return;
      let raf = 0;
      let cancelled = false;
      const paint = () => {
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const cssW = canvas.clientWidth;
        const cssH = canvas.clientHeight;
        if (!cssW || !cssH) {
          raf = requestAnimationFrame(paint);
          return;
        }
        const width = Math.round(cssW * dpr);
        const height = Math.round(cssH * dpr);
        const darkenMax = isLight ? BG_LIGHT_DARK_MAX : BG_DARK_MAX;
        void renderThemeBackgroundOffThread(
          width,
          height,
          colors,
          darkenMax
        ).then((pixels) => {
          if (cancelled || !pixels.length) return;
          const ctx = canvas.getContext("2d", { alpha: false });
          if (!ctx) return;
          canvas.width = width;
          canvas.height = height;
          ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
        });
      };
      raf = requestAnimationFrame(paint);
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
      };
    }, [active, colors, showThemeColor, isLight]);

    return (
      <div
        className={cn(
          "absolute inset-0 z-[-1] overflow-hidden",
          isLight ? "bg-[#eef2f5]" : "bg-zinc-950"
        )}
      >
        {/*
          兜底背景层放最底下：它以前是最后一个子节点、盖在照片/封面之上，
          切换背景的 1 秒淡出期间会有一层深色压在上面，刚选完照片看起来就是黑的。
        */}
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

        {/* 封面遮罩层：仅在模糊封面模式挂载图片，避免其他模式下后台解码大图与 blur-3xl */}
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-1000",
            showCoverMask ? "opacity-100" : "opacity-0"
          )}
        >
          {showCoverMask && (
            <img
              src={coverUrl}
              alt=""
              aria-hidden="true"
              className="absolute inset-[-32px] h-[calc(100%+64px)] w-[calc(100%+64px)] object-cover blur-3xl scale-110 will-change-transform"
            />
          )}
          <div className="absolute inset-0 bg-black/60" />
          <div className="absolute inset-0 bg-linear-to-b from-black/10 via-zinc-950/20 to-black/60" />
        </div>

        {/* 自定义照片层：压暗 + 上下渐隐，保证白色文字/控件可读。
            这里淡入比另外两层快：选完图立即看到结果，不要先黑一秒。 */}
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-300",
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
  /** 切歌前的位置，用来判断按钮切的是上一首还是下一首，决定封面从哪边滑入 */
  const prevIndexRef = useRef(currentIndex);
  /** 正在播放的封面/唱臂容器入场动画：连续切歌时先收掉上一段 */
  const coverEntryRef = useRef<Animation[]>([]);
  const counterEntryRef = useRef<Animation[]>([]);

  useEffect(() => {
    const id = currentTrack?.id ?? null;
    const prev = prevTrackIdRef.current;
    const prevIndex = prevIndexRef.current;
    prevTrackIdRef.current = id;
    prevIndexRef.current = currentIndex;
    // 首次挂载、清空队列、同一首歌都不触发
    if (prev === null || id === null || prev === id) return;
    // 横滑切歌：封面入场和唱臂抬臂/回落已由手势层演完，这里不再补一遍
    if (consumeSwipeArmCut()) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const direction =
      currentIndex === (prevIndex + 1) % Math.max(queue.length, 1) ? 1 : -1;
    const offset = Math.round((window.innerWidth || 360) * 0.5) * direction;

    /**
     * 按钮切歌的封面入场：用 WAAPI 直接在 DOM 上跑，不经过 React state。
     *
     * 之前用 setEntrySnap + 三帧 rAF 切 CSS transition，state 是异步渲染的，
     * 偶尔某一帧过渡还没生效就把位移归零，封面「滑出去又闪回来」—— 用户看到
     * 的黑影就是这中间露出的背景。WAAPI 一步到位，没有中间帧竞态。
     * 唱臂容器同步反向平移，唱臂保持在屏幕原位（与横滑一致）。
     */
    const cover = coverTransformRef.current;
    const counter = tonearmTransformRef.current;
    coverEntryRef.current.forEach((anim) => anim.cancel());
    coverEntryRef.current = [];
    counterEntryRef.current.forEach((anim) => anim.cancel());
    counterEntryRef.current = [];
    cover?.getAnimations?.().forEach((anim) => anim.cancel());
    counter?.getAnimations?.().forEach((anim) => anim.cancel());
    // 先清掉上一次手势可能残留的 inline 位移，动画结束时才能干净落到 0
    if (cover) cover.style.translate = "";
    if (counter) counter.style.translate = "";
    const entryOptions: KeyframeAnimationOptions = {
      duration: 320,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    };
    if (cover && typeof cover.animate === "function") {
      const entry = cover.animate(
        [{ translate: `${offset}px` }, { translate: "0px" }],
        entryOptions
      );
      coverEntryRef.current.push(entry);
      // 动画结束把 inline 位移清干净：fill:none 时元素会回到 inline 值，
      // 若上次横滑残留了非零 translate，不清就会在结束瞬间跳一下。
      entry.finished
        .then(() => {
          cover.style.translate = "";
          coverEntryRef.current = coverEntryRef.current.filter(
            (a) => a !== entry
          );
        })
        .catch(() => {});
    }
    if (counter && typeof counter.animate === "function") {
      counterEntryRef.current.forEach((anim) => anim.cancel());
      counterEntryRef.current = [];
      const entry = counter.animate(
        [{ translate: `${-offset}px` }, { translate: "0px" }],
        entryOptions
      );
      counterEntryRef.current.push(entry);
      entry.finished
        .then(() => {
          counter.style.translate = "";
          counterEntryRef.current = counterEntryRef.current.filter(
            (a) => a !== entry
          );
        })
        .catch(() => {});
    }

    /**
     * 唱臂切歌命令：抬臂到暂停位后停住，等音源可播 + 封面解码两路信号到齐
     * 才落针。控制器只在 DOM 上跑动画，isPlaying / isLoading / 网络重试
     * 这些 React 状态的起伏都碰不到它。
     *
     * 暂停态起手时唱臂本来就在 -40°，控制器会跳过抬臂、直接等就绪后落下，
     * 不会出现「先往上滑一下再下来」。无封面曲目不等封面信号。
     */
    beginArmCut({ hasCover: Boolean(currentTrack?.pic_id) });
  }, [currentTrack?.id, currentTrack?.pic_id, currentIndex, queue.length]);

  const [isCoverPreviewOpen, setIsCoverPreviewOpen] = useState(false);
  const [isStyleMenuOpen, setIsStyleMenuOpen] = useState(false);
  /** 评论抽屉：收藏旁的评论按钮、上滑手势共用同一个入口 */
  const [commentsOpen, setCommentsOpen] = useState(false);
  /**
   * 歌词样式面板开关（受控）。播放页「更多」菜单里的「歌词调整」与长按歌词
   * 共用这一个状态，LyricsPanel 不再自己持有。
   */
  const [lyricStyleOpen, setLyricStyleOpen] = useState(false);
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
    onSwipeUp: () => setCommentsOpen(true),
    // 轻点在 touchend 里处理：不依赖 click，避免上滑/滚动后点击被 WebView 吞掉
    onTap: (target) => {
      // 长按抬手补发的 tap 只用于弹菜单，不要顺带切到/切回歌词页
      if (consumeLongPressClick()) return;
      // 刚关掉风格菜单的那次 tap 只用于关菜单，不要切页
      if (consumeMenuCloseClick()) return;
      if (isCoverPreviewOpen || isStyleMenuOpen) return;
      // 标题栏的「回顶」热区：交给它自己的 onClick，别当成切页
      if (
        target instanceof Element &&
        target.closest("[data-lyrics-scrolltop]")
      )
        return;
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
    willChange: "translate",
    transition:
      swipe.isHorizDragging || swipe.slideSnap
        ? "none"
        : "translate 320ms cubic-bezier(0.22, 1, 0.36, 1)",
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
        active={isFullScreen}
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

      <header
        data-lyrics-header=""
        className="shrink-0 grid grid-cols-3 items-center px-6 pt-[calc(1rem+var(--safe-area-top))] relative z-10"
      >
        {/* 歌词回顶热区：整条标题栏都能点，往下还多探出 12dp。
            注意：三格容器不能再加 z-index（之前给它们加 relative z-10，
            三格把整条盖住，热区反而一次都收不到点击）。只给左右两个角按钮
            自己加 relative z-10，让它们浮在热区之上。 */}
        {showLyrics && (
          <button
            type="button"
            data-lyrics-scrolltop=""
            aria-label="歌词回到顶部"
            className="absolute inset-x-0 top-[calc(1rem+var(--safe-area-top))] bottom-[-0.75rem]"
            onClick={(e) => {
              e.stopPropagation();
              scrollPageToTop();
            }}
          />
        )}
        <div className="flex justify-start">
          <Button
            variant="ghost"
            size="icon"
            className="relative z-10 h-12 w-12 text-white/60 hover:bg-white/10 hover:text-white"
            onClick={() => {
              onClose();
            }}
          >
            <ChevronDown className="size-7" strokeWidth={1.5} />
          </Button>
        </div>
        {/* h-12 必须写死：header 是 items-center，本格内没有流内元素，
            高度会塌成 0。items-center 让 h-8 的音质按钮与左右 h-12 按钮
            视觉居中对齐，否则按钮会贴着顶边显得偏上 */}
        <div className="flex items-center justify-center h-12">
          {showLyrics ? null : (
            <Button
              variant="ghost"
              size="sm"
              className="relative z-10 text-xs tracking-widest text-white/50 hover:text-white hover:bg-white/10 h-8 px-3"
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
              className="relative z-10 h-12 w-12 text-white/60 hover:bg-white/10 hover:text-white"
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
              className="relative z-10 h-12 w-12 text-white/60 hover:bg-white/10 hover:text-white"
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
          // 标题栏回顶按钮：onClick 已 stopPropagation，这里再兜一层防切页
          if (
            e.target instanceof Element &&
            e.target.closest("[data-lyrics-scrolltop]")
          )
            return;
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
            <LyricsPanel
              track={currentTrack}
              active={isFullScreen}
              stylePanelOpen={lyricStyleOpen}
              onStylePanelOpenChange={setLyricStyleOpen}
            />
          </div>
        ) : showCover ? (
          <div
            ref={coverTransformRef}
            title="长按修改播放风格"
            className={cn(
              "relative aspect-square",
              // 黑胶的唱臂基座在盘外上方，不能被裁；盘面/封面各自已 rounded-full
              coverStyle === "vinyl" ? "overflow-visible" : "overflow-hidden"
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
                // 切歌加载期间旧音轨暂停会把 isPlaying 翻成 false，如果这时把稳态角
                // 当「暂停」处理（-40°），唱臂会在落针动画结束的一瞬间被拽到半空。
                // 加载中仍然算「在放这张唱片」，稳住 -4°，让动画自己演完。
                isLoading={isLoading}
                onCoverReady={() => notifyArmReady("cover")}
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
                crossfade
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
                crossfade
                onLoad={() => notifyArmReady("cover")}
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
            <p className="truncate text-xs text-white/60 mt-1 flex items-center gap-1.5">
              <span className="truncate">
                {t2sArtists(currentTrack?.artist).join(", ") || "未知歌手"}
              </span>
              <AudioOriginLabel className="shrink-0 text-white/45" />
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
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="评论"
              title="评论"
              onClick={(e) => {
                e.stopPropagation();
                setCommentsOpen(true);
              }}
            >
              <MessageCircleMore className="h-6 w-6" />
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
                  onOpenPlayerStyle={() => {
                    // 风格改的是封面/盘面：从歌词页进来时先切回播放器封面，
                    // 否则面板开着但看不到效果
                    setShowLyrics(false);
                    setIsStyleMenuOpen(true);
                  }}
                  onOpenLyricStyle={() => {
                    // 从「更多」菜单进歌词调整：先切到歌词页，再弹面板
                    setShowLyrics(true);
                    setLyricStyleOpen(true);
                  }}
                />
                <AddToPlaylistDrawer
                  open={isAddToPlaylistOpen}
                  onOpenChange={setIsAddToPlaylistOpen}
                  track={currentTrack}
                />
                <MusicCommentsDrawer
                  track={currentTrack}
                  open={commentsOpen}
                  onOpenChange={setCommentsOpen}
                />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-8 relative z-10">
        <PlayerProgressBar className="relative" />
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
    </div>,
    document.body
  );
}
