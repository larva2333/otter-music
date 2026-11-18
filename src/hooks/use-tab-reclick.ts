import { useEffect, useRef } from "react";

const TAB_RECLICK_EVENT = "otter:tab-reclick";

/** 底部导航再次点击已激活的 tab 时广播，携带 tab id */
export function emitTabReclick(tabId: string) {
  window.dispatchEvent(new CustomEvent(TAB_RECLICK_EVENT, { detail: tabId }));
}

/**
 * 监听「再次点击当前 tab」。页面据此做页内动作：
 * 有 type 的页面循环切到下一个 type（不跨页），无 type 的页面滚回顶部。
 * handler 存 ref，避免每次渲染都重新注册监听。
 */
export function useTabReclick(tabId: string, handler: () => void) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const onReclick = (event: Event) => {
      if ((event as CustomEvent<string>).detail === tabId) handlerRef.current();
    };
    window.addEventListener(TAB_RECLICK_EVENT, onReclick);
    return () => window.removeEventListener(TAB_RECLICK_EVENT, onReclick);
  }, [tabId]);
}
