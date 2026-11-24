import { useEffect, useRef } from "react";
import { useExitLayer } from "@/hooks/useExitLayer";

/** 键盘弹出动画大致时长：等它跑完再挂返回键层，避免打断 insets 动画 */
const KEYBOARD_POP_MS = 350;

interface UseSearchBackClearOptions {
  /** 发现页是否在当前路由；从搜索结果进二级页后应让返回键走正常返回 */
  enabled?: boolean;
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
 * 只接「应用真正收到返回键」这一条路径（useExitLayer 的层）。
 * 不再用 keyboardWillHide 兜底：点击输入法的收起按钮同样会派发该事件，
 * 且 WebView 里输入框不会失焦，无法与「按返回键」区分，会把「收键盘看结果」
 * 误判成清空搜索（表现为突然返回发现页）。收键盘就只收键盘，遵循 Android
 * 标准交互：第一次返回收键盘，第二次返回才清空搜索。
 */
export function useSearchBackClear({
  enabled = true,
  focused,
  value,
  onClear,
  onDismiss,
}: UseSearchBackClearOptions) {
  const { push, pop } = useExitLayer();

  // 用 ref 拿最新值：输入过程中不要反复 push/pop，否则返回键栈会抖动
  const valueRef = useRef(value);
  const onClearRef = useRef(onClear);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onClearRef.current = onClear;
  }, [onClear]);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  /** 一次返回：清空 + 失焦，然后把这一层移除 */
  const exitSearch = () => {
    if (valueRef.current.length > 0) onClearRef.current();
    onDismissRef.current();
  };

  useEffect(() => {
    if (!enabled || !focused) return;

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
  }, [enabled, focused, push, pop]);
}
