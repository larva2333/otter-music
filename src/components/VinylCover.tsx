"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  ARM_PAUSE_ANGLE,
  ARM_PLAY_ANGLE,
  ARM_STEADY_TRANSITION,
  isArmCutPending,
  isGestureArmControlled,
  readArmAngle,
  registerArm,
  writeArmAngle,
} from "@/lib/vinyl-arm";
import { MusicCover } from "./MusicCover";

interface VinylCoverProps {
  src?: string | null;
  alt?: string;
  isPlaying?: boolean;
  /**
   * 切歌取链期间旧音轨会短暂暂停 isPlaying，这段时间仍算「这张唱片在盘上」，
   * 稳态角保持播放位，避免落针刚结束就被拽回暂停位。
   */
  isLoading?: boolean;
  /**
   * 中心封面解码完成时通知播放页。播放页据此把「下一首封面已就绪」送给唱臂
   * 控制器，与音源就绪一起决定是否落针。
   */
  onCoverReady?: () => void;
  className?: string;
  iconClassName?: string;
  /** 封面自带白边的裁切缩放，透传给中心封面的 <img> */
  imgStyle?: React.CSSProperties;
  previewOpen?: boolean;
  onPreviewOpenChange?: (open: boolean) => void;
  /**
   * 中心封面换图时是否交叉淡入（透传 MusicCover）。
   * 播放页开启：切歌时唱片中心不该闪出底色，要跟唱臂一样是「换片」。
   */
  crossfade?: boolean;
  /** 盘面颜色；"transparent" 表示透明，透出播放器背景 */
  discColor?: string;
  /** 是否渲染唱臂骨架（基座+臂管+唱头）。播放条里的小黑胶不放骨架。 */
  showTonearm?: boolean;
  /**
   * 唱臂容器的额外样式。播放页横滑切歌时整个封面容器会 translate，
   * 传反向 translate 进来即可让唱臂固定在屏幕原位（只有唱片滑动/旋转）。
   * transition 也由调用方给全，保证跟手阶段无过渡、松手阶段与封面同步。
   */
  tonearmContainerStyle?: React.CSSProperties;
  /** 唱臂容器节点引用：播放页横滑时直接写它的 translate 做反向抵消 */
  tonearmContainerRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * 唱臂 svg 节点引用：横滑唱片时直接写它的 rotate，
   * 让唱头跟着唱片滑动的方向摆动（与容器的 translate 分工，互不覆盖）。
   */
  tonearmArmRef?: React.RefObject<SVGSVGElement | null>;
  /**
   * 唱臂骨架被点击（鼠标 click 路径）。触摸端的轻点在 touchend 已处理，
   * 这里只兜住桌面端鼠标点击，并把 click 拦在骨架内不再冒泡到外层容器。
   */
  onControlActivate?: () => void;
}

const DEFAULT_DISC_COLOR = "#0A0A0A";

/**
 * 网易云风格的黑胶唱片封面。
 *
 * 比例按网易真机截图还原（不是凭感觉）：
 * - 唱片盘面直径约为容器 82%，靠下放，上方留出唱臂基座的位置；
 * - 中心封面直径约为盘面的 68%（inset 16%）：按网易云真机播放页截图测量，
 *   唱片外圈约 900px、中心封面约 610px；黑胶外圈每边留 16%；
 * - 唱臂基座在盘外正上方，臂是弯的，唱头落在盘面右上的沟槽上。
 *
 * 盘面旋转时用 animationPlayState 暂停，不能移除动画否则会跳回 0°；
 * 唱臂绕基座做落下/抬起动画，播放时落到沟槽、暂停时抬离盘面。
 * 中心封面复用 MusicCover，两种播放风格都保留预览大图能力。
 */
export function VinylCover({
  src,
  alt,
  isPlaying = false,
  isLoading = false,
  onCoverReady,
  className,
  iconClassName,
  imgStyle,
  previewOpen,
  onPreviewOpenChange,
  crossfade = false,
  discColor = DEFAULT_DISC_COLOR,
  showTonearm = true,
  tonearmContainerStyle,
  tonearmContainerRef,
  tonearmArmRef,
  onControlActivate,
}: VinylCoverProps) {
  const transparent = discColor.toLowerCase() === "transparent";

  /**
   * 唱臂 svg 节点：横滑手势、切歌控制器、稳态 effect 共用同一条 rotate 通道。
   * callback ref 卸载时收到 null，正好把控制器里的会话一起注销。
   */
  const armNodeRef = useRef<SVGSVGElement | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const isLoadingRef = useRef(isLoading);
  useLayoutEffect(() => {
    isPlayingRef.current = isPlaying;
    isLoadingRef.current = isLoading;
  }, [isPlaying, isLoading]);

  const syncSteadyAngle = useCallback(() => {
    if (!showTonearm) return;
    if (isGestureArmControlled() || isArmCutPending()) return;
    const el = armNodeRef.current;
    if (!el) return;
    const target =
      isPlayingRef.current || isLoadingRef.current
        ? ARM_PLAY_ANGLE
        : ARM_PAUSE_ANGLE;
    if (Math.abs(readArmAngle(el) - target) < 0.01) return;
    writeArmAngle(el, target, ARM_STEADY_TRANSITION);
  }, [showTonearm]);

  const bindArmRef = useCallback(
    (node: SVGSVGElement | null) => {
      armNodeRef.current = node;
      if (tonearmArmRef) tonearmArmRef.current = node;
      registerArm(node, syncSteadyAngle);
      // 首次挂载直接把唱臂放到稳态角（无过渡），之后角度不再由 React 写。
      if (node && !node.style.rotate) {
        writeArmAngle(
          node,
          isPlayingRef.current ? ARM_PLAY_ANGLE : ARM_PAUSE_ANGLE
        );
      }
    },
    [tonearmArmRef, syncSteadyAngle]
  );

  /**
   * 这里只负责播放/暂停的稳态切换；切歌的「抬臂 → 落针」由 lib/vinyl-arm 的
   * 连续动画接管，不受本组件的 state 起伏影响：
   * - 横滑期间让开手势；
   * - 切歌会话进行中让开控制器，isPlaying / isLoading 反复翻转不会拽走唱臂。
   */
  useEffect(() => {
    syncSteadyAngle();
  }, [isPlaying, isLoading, syncSteadyAngle]);

  /**
   * 骨架上的 click 一律就地消化。
   *
   * 外层容器还有一层「点盘面/空白 = 切歌词」的判断，靠的是 target 上有没有
   * data-vinyl-control。只要 click 冒泡到那里就会再判一次，一旦时序错开
   * （触摸的轻点已经处理过、补发的 click 又晚于抑制窗口），就会变成
   * 「播放/暂停的同时还切到了歌词页」。这里直接 stopPropagation，从根上断掉。
   */
  const handleControlClick = onControlActivate
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        onControlActivate();
      }
    : undefined;

  return (
    // 整块黑胶容器：只作视觉容器，不再承担点击。
    // 只有唱臂骨架（基座 + 臂管 + 唱头）带 data-vinyl-control，轻点它才播放/暂停。
    <div
      data-vinyl-cover
      className={cn("relative h-full w-full select-none vinyl-tone", className)}
    >
      {/* 盘外那圈浅灰托盘边（网易的黑胶盘不是直接贴在背景上）。
          无骨架场景（播放条小盘）托盘直接铺满，让盘面水平垂直都居中 */}
      {showTonearm ? (
        <div className="absolute left-[5%] top-[13%] h-[90%] w-[90%] rounded-full bg-linear-to-br from-white/12 to-white/2 ring-1 ring-white/5" />
      ) : (
        <div className="absolute inset-0 rounded-full bg-linear-to-br from-white/12 to-white/2 ring-1 ring-white/5" />
      )}

      {/* 唱片盘面：有骨架时盘面下移给唱臂基座让位；无骨架时满幅居中 */}
      <div
        data-testid="vinyl-disc-face"
        className={cn(
          "absolute overflow-hidden rounded-full ring-1 ring-white/10",
          showTonearm ? "left-[7%] top-[15%] h-[86%] w-[86%]" : "inset-[5%]"
        )}
        style={{ backgroundColor: transparent ? "transparent" : discColor }}
      >
        {/* 旋转体 */}
        <div
          data-testid="vinyl-disc"
          className="vinyl-spin absolute inset-0 rounded-full"
          style={{ animationPlayState: isPlaying ? "running" : "paused" }}
        >
          <div
            className="absolute inset-[3%] rounded-full"
            style={{
              backgroundImage:
                "repeating-radial-gradient(circle at center, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 4px)",
            }}
          />
          {/* 中心封面按网易云实拍比例（直径约 68%），黑胶外圈每边 16%；唱头落点仍在沟槽上 */}
          <div
            data-testid="vinyl-label"
            className="absolute inset-[16%] overflow-hidden rounded-full shadow-[0_0_0_2px_rgba(255,255,255,0.08)]"
          >
            <MusicCover
              src={src}
              alt={alt}
              className="h-full w-full object-cover dark"
              imgStyle={imgStyle}
              iconClassName={iconClassName}
              previewOpen={previewOpen}
              onPreviewOpenChange={onPreviewOpenChange}
              crossfade={crossfade}
              onLoad={onCoverReady}
            />
          </div>
        </div>

        {/* 固定高光，不跟盘转 */}
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 200deg, transparent 0deg, rgba(255,255,255,0.10) 32deg, transparent 70deg, transparent 180deg, rgba(255,255,255,0.06) 215deg, transparent 255deg)",
          }}
        />
      </div>

      {/* 唱臂：基座在盘外正上方，折线（竖直段→圆角拐弯→斜段），唱头落在黑胶沟槽带中间。
          播放条等小尺寸场景用 showTonearm={false} 只留盘面。 */}
      {showTonearm && (
        <div
          ref={tonearmContainerRef}
          className="pointer-events-none absolute inset-0"
          style={{ willChange: "translate", ...tonearmContainerStyle }}
        >
          {/* 基座：干净的白色圆点 + 浅灰轴心，z-10 盖住唱臂根部（臂从圆盘底下伸出）。
            骨架根部单独开放命中，pointer-events-auto 抵消父级的 none。
            before 伪元素把命中区向外扩 8px：圆点本身只有 6% 宽，直接点很难准。 */}
          <div
            data-vinyl-control
            onClick={handleControlClick}
            className="pointer-events-auto absolute left-1/2 top-[-9%] z-10 h-[6%] w-[6%] -translate-x-1/2 cursor-pointer rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.3)] before:absolute before:-inset-3 before:content-[''] before:rounded-full"
          >
            <div className="absolute inset-[38%] rounded-full bg-neutral-300" />
          </div>
          <svg
            ref={bindArmRef}
            data-testid="vinyl-tonearm"
            viewBox="0 0 100 100"
            className="absolute inset-0 h-full w-full overflow-visible"
            style={{
              // 角度（rotate）由上面的统一 effect 命令式写入，React 渲染不碰它，
              // 否则每次重渲染都会把动画/手势写到 DOM 上的当前角度覆盖回稳态角。
              // 轴心固定在基座中心（基座 div 中心正是 50% / -6%），根部始终不动。
              transformOrigin: "50% -6%",
              // 预先提升到独立合成层，避免播放/暂停/切歌启动 rotate 过渡时才临时建层或走主线程重绘 SVG
              willChange: "rotate",
              // 整块 svg 不挡盘面；只有下面显式声明 pointer-events 的骨架笔画可命中
              pointerEvents: "none",
            }}
          >
            {/* 命中区：沿臂管的透明粗线，窄线也点得中；随臂一起旋转不错位。
              粗细按手指落点定：viewBox 100 对应实际约 300px 直径，22 个单位≈66px 宽，
              斜段和拐弯处也能压中；细臂本身只有 2~3 个单位（7~10px），
              手指稍有偏差就落到盘面上被当成「切歌词」。 */}
            <path
              data-vinyl-control
              data-testid="vinyl-tonearm-hit"
              onClick={handleControlClick}
              d="M 50 -4 L 50 10 Q 50 13 52 15 L 62 25"
              fill="none"
              stroke="transparent"
              strokeWidth="22"
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="stroke"
              className="cursor-pointer"
            />
            {/* 两段直线 + 拐点小圆角：切点前竖直段、切点后斜段各约 14，Q 控制点即尖角顶点。
              两条实线本身也带 data-vinyl-control：手指压在看得见的白臂上，
              命中的就是这根线，不能因为只有透明热区带标记而落到盘面分支去切歌词。 */}
            <path
              data-vinyl-control
              onClick={handleControlClick}
              d="M 50 -4 L 50 10 Q 50 13 52 15 L 62 25"
              fill="none"
              stroke="rgba(0,0,0,0.16)"
              strokeWidth="3.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="stroke"
              className="cursor-pointer"
            />
            <path
              data-vinyl-control
              onClick={handleControlClick}
              d="M 50 -4 L 50 10 Q 50 13 52 15 L 62 25"
              fill="none"
              stroke="#fafbfc"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="stroke"
              className="cursor-pointer"
            />
            {/* 唱头：白色圆角方盒 + 两道浅灰凹槽 + 小连接节，落在盘面沟槽带中间。
              两段等长（各约 17）、斜段保持 45°，连接节贴住臂末端 (62,25) 不错位。 */}
            <g
              data-testid="vinyl-head-group"
              transform="translate(62 25) rotate(45)"
              onClick={handleControlClick}
            >
              {/* 唱头整体热区：盒体只有 6.8×5.8 个单位，直指很难压中。
                透明矩形把整个唱头（含四周余量）包成一块，点这里一律算播放/暂停。
                近 20×18 个单位（实际约 60×55px）刚好覆盖手指落点误差。 */}
              <rect
                data-vinyl-control
                data-testid="vinyl-head-hit"
                x="-5"
                y="-8.5"
                width="20"
                height="18"
                rx="4"
                fill="transparent"
                pointerEvents="fill"
                className="cursor-pointer"
              />
              {/* 臂管与盒体之间的合页连接节：从臂末端顺出 */}
              <rect
                x="-1.2"
                y="-1.3"
                width="3.4"
                height="2.6"
                rx="0.7"
                fill="#f4f5f7"
                pointerEvents="fill"
                className="cursor-pointer"
              />
              <line
                x1="0.2"
                y1="-1.1"
                x2="0.2"
                y2="1.1"
                stroke="#b9bfc7"
                strokeWidth="0.5"
                pointerEvents="stroke"
                className="cursor-pointer"
              />
              {/* 盒体：接近方形、圆角、无黑边，靠形状而不是描边出轮廓 */}
              <rect
                data-vinyl-control
                data-testid="vinyl-head-body"
                x="0.4"
                y="-2.9"
                width="6.8"
                height="5.8"
                rx="1.5"
                fill="#fcfcfd"
                pointerEvents="fill"
                className="cursor-pointer"
              />
              {/* 两道浅灰凹槽，沿长轴平行 */}
              <line
                data-testid="vinyl-head-groove"
                x1="2"
                y1="-1.4"
                x2="6.1"
                y2="-1.4"
                stroke="#b9bfc7"
                strokeWidth="0.7"
                strokeLinecap="round"
                pointerEvents="stroke"
                className="cursor-pointer"
              />
              <line
                data-testid="vinyl-head-groove"
                x1="2"
                y1="1.4"
                x2="6.1"
                y2="1.4"
                stroke="#b9bfc7"
                strokeWidth="0.7"
                strokeLinecap="round"
                pointerEvents="stroke"
                className="cursor-pointer"
              />
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}
