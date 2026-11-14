import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { storeKey } from "./store-keys";

/**
 * 界面偏好：字体大小
 * - 不用 idbStorage，改用 localStorage：index.html 里的预执行脚本要同步读到它，
 *   以便在首帧前把 data-font-scale 打上，避免先渲染默认字号再跳一下。
 */
export type FontScale = "small" | "standard" | "large";

export const FONT_SCALE_OPTIONS: { value: FontScale; label: string }[] = [
  { value: "small", label: "小" },
  { value: "standard", label: "标准" },
  { value: "large", label: "大" },
];

const FONT_SCALE_SET = new Set<string>(
  FONT_SCALE_OPTIONS.map((option) => option.value)
);

/** 写入 <html data-font-scale>，global.css 里按档位覆盖字号变量 */
export function applyFontScale(scale: FontScale) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (scale === "standard") {
    root.removeAttribute("data-font-scale");
  } else {
    root.setAttribute("data-font-scale", scale);
  }
}

export function isFontScale(value: unknown): value is FontScale {
  return typeof value === "string" && FONT_SCALE_SET.has(value);
}

interface UiPrefsState {
  fontScale: FontScale;
}

interface UiPrefsActions {
  setFontScale: (scale: FontScale) => void;
}

export const useUiPrefsStore = create<UiPrefsState & UiPrefsActions>()(
  persist(
    (set) => ({
      fontScale: "standard",
      setFontScale: (fontScale) => {
        applyFontScale(fontScale);
        set({ fontScale });
      },
    }),
    {
      name: storeKey.UiPrefsStore,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ fontScale: state.fontScale }),
      onRehydrateStorage: () => (state) => {
        if (state) applyFontScale(state.fontScale);
      },
    }
  )
);
