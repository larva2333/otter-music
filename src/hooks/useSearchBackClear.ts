import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { useExitLayer } from "@/hooks/useExitLayer";

/** 键盘弹出动画大致时长：等它跑完再挂返回键层，避免打断 insets 动画 */
const KEYBOARD_POP_MS = 350;

/** 键盘收起后再等一帧确认焦点，避免和 blur 抢时序 */
const KEYBOARD_HIDE_SETTLE_MS = 60;

interface UseSearchBackClearOptions {
  /** 输入框是否处于聚焦状态（键盘开着） */
  focused: boolean;
  /** 当前输入内容（用 ref 取最新值，避免每次输入都重建返回键层） */
  value: string;
  /** 清空内容 */
  onClear: () => void;
  /** 收起键盘（失焦） */
  onDismiss: () => void;
}

/**
 * 输入框聚焦时接管系统返回键，一次返回就把搜索态退干净：
 * 清空内容 + 收起键盘（失焦），不退出页面、不最小化应用。
 *
 * Android 上第一次返回键不一定到得了应用，所以两条路径都接：
 * 1. 应用收到返回键 → 走 useExitLayer 的层，直接清空 + 失焦；
 * 2. 输入法先把这次返回消费掉（只收键盘，WebView 里输入框并不会失焦）
 *    → 用原生 Keyboard 插件的 keyboardWillHide 补上「清空 + 失焦」。
 *
 * 之所以不用 visualViewport 判断：这个 WebView 里 innerHeight 与
 * visualViewport.height 在键盘弹出时都不变（实测均为 890），拿不到键盘高度。
 */
export function useSearchBackClear({
  focused,
  value,
  onClear,
  onDismiss,
}: UseSearchBackClearOptions) {
  const { push, pop } = useExitLayer();

  // 用 ref 拿最新值：输入过程中不要反复 push/pop，否则返回键栈会抖动
  const valueRef = useRef(value);
  const focusedRef = useRef(focused);
  const onClearRef = useRef(onClear);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    focusedRef.current = focused;
  }, [focused]);

  useEffect(() => {
    onClearRef.current = onClear;
  }, [onClear]);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  // 聚焦时记下真实的 DOM 焦点元素：判断「键盘收起」是点了别处还是按了返回，
  // 只看 document.activeElement 最准，不受 React 状态更新时序影响。
  const focusElRef = useRef<Element | null>(null);
  useEffect(() => {
    if (!focused) return;
    const el = document.activeElement;
    if (el && el !== document.body) focusElRef.current = el;
  }, [focused]);

  /** 一次返回：清空 + 失焦，然后把这一层移除 */
  const exitSearch = () => {
    if (valueRef.current.length > 0) onClearRef.current();
    onDismissRef.current();
  };

  useEffect(() => {
    if (!focused) return;

    // 聚焦瞬间不要立刻写 store：那一刻输入法正在跑 insets 弹出动画，
    // 任何整页级更新都会让 WebView 重排、打断动画，键盘窗口会停在「可见但空白」
    // 的状态（实测过：mImeWindowVis=3、窗口全屏，但一个键都不画）。
    // 等动画结束再挂返回键层，用户在 350ms 内不可能按返回。
    let id: string | null = null;
    const timer = window.setTimeout(() => {
      id = push({ close: exitSearch });
    }, KEYBOARD_POP_MS);

    return () => {
      window.clearTimeout(timer);
      if (id) pop(id);
    };
    // exitSearch 只读 ref，引用变化不影响行为
  }, [focused, push, pop]);

  // 兜底：输入法把返回键吃掉、只收起键盘时，应用收不到 onBackPressed。
  // 原生 Keyboard 插件的 hide 事件是唯一可靠的信号（JS 侧拿不到键盘高度）。
  // 收起后输入框仍握着焦点 → 是返回键；已经失焦 → 用户点了别处，内容保留。
  useEffect(() => {
    if (!focused) return;
    if (!Capacitor.isNativePlatform()) return;

    let settleTimer: number | null = null;
    let handle: { remove: () => Promise<void> } | null = null;
    let disposed = false;

    Keyboard.addListener("keyboardWillHide", () => {
      // 切到后台/其它应用导致的键盘收起不算「返回」，不要清空内容
      if (document.visibilityState !== "visible") return;
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        const el = focusElRef.current;
        const stillFocused = el
          ? document.activeElement === el
          : focusedRef.current;
        if (!stillFocused) return;
        exitSearch();
      }, KEYBOARD_HIDE_SETTLE_MS);
    })
      .then((h) => {
        if (disposed) void h.remove();
        else handle = h;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (settleTimer) window.clearTimeout(settleTimer);
      if (handle) void handle.remove();
    };
    // exitSearch 只读 ref，引用变化不影响行为
  }, [focused]);
}
