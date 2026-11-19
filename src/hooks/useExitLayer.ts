"use client";

import { create } from "zustand";

interface ExitLayer {
  id: string;
  /**
   * 消费一次返回键。
   * 返回 true 表示「已处理但请保留这一层」——典型场景是聚焦中的输入框：
   * 第一次返回清空内容后键盘还开着，需要继续拦下一次返回（收起键盘）。
   */
  close: () => void | boolean;
}

interface ExitLayerStore {
  stack: ExitLayer[];
  push: (layer: Omit<ExitLayer, "id">) => string;
  pop: (id: string) => void;
  handleExit: () => boolean;
}

const generateId = () =>
  `exit-layer-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

export const useExitLayerStore = create<ExitLayerStore>((set, get) => ({
  stack: [],

  push: (layer) => {
    const id = generateId();
    set((state) => ({
      stack: [...state.stack, { ...layer, id }],
    }));
    return id;
  },

  pop: (id) => {
    set((state) => ({
      stack: state.stack.filter((layer) => layer.id !== id),
    }));
  },

  handleExit: () => {
    const { stack } = get();
    if (stack.length === 0) return false;

    const topLayer = stack[stack.length - 1];
    // close 返回 true：这次返回键算消费掉了，但这一层要留着继续拦
    const keepLayer = topLayer.close() === true;
    if (keepLayer) return true;

    set((state) => ({
      stack: state.stack.filter((layer) => layer.id !== topLayer.id),
    }));
    return true;
  },
}));

export function useExitLayer() {
  const push = useExitLayerStore((state) => state.push);
  const pop = useExitLayerStore((state) => state.pop);
  const handleExit = useExitLayerStore((state) => state.handleExit);

  return {
    push,
    pop,
    handleExit,
    /**
     * 非响应式快照：**故意不订阅 stack**。
     * 订阅它会让每次 push/pop（例如输入框聚焦挂一层）都重渲染 RootLayout 和整页，
     * 在 Android WebView 里这会把输入框焦点顶掉、键盘刚弹出就被收起。
     * 谁需要响应式的栈长度，单独用 useExitLayerStore 订阅。
     */
    isEmpty: useExitLayerStore.getState().stack.length === 0,
  };
}
