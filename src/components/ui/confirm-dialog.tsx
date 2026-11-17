"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useExitLayer } from "@/hooks/useExitLayer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Button } from "./button";

/**
 * 应用内确认框，替代 window.confirm。
 *
 * 为什么要换：Android WebView 的 confirm 是系统原生对话框，不跟随 App 主题，
 * 深色系统下是一整块黑底白字，跟应用里的圆角卡片完全不搭；而且它阻塞 JS 线程，
 * 弹出期间动画全部停住。
 *
 * 用法跟 confirm 一样，只是变成 Promise：
 *   if (await confirmDialog({ title: "确定删除吗？" })) { ... }
 */
export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（删除/清空）用红色确认按钮 */
  destructive?: boolean;
}

type PendingConfirm = ConfirmOptions & { resolve: (value: boolean) => void };

let pendingConfirm: PendingConfirm | null = null;
const subscribers = new Set<(value: PendingConfirm | null) => void>();

function notify() {
  subscribers.forEach((fn) => fn(pendingConfirm));
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  // 前一个还没答完就来了新的：旧的按取消处理，否则它的 Promise 永远不落地
  pendingConfirm?.resolve(false);
  return new Promise<boolean>((resolve) => {
    pendingConfirm = { ...options, resolve };
    notify();
  });
}

/** 挂在 RootLayout 的全局宿主，全应用只需要一个 */
export function ConfirmDialogHost() {
  const [current, setCurrent] = useState<PendingConfirm | null>(null);
  const currentRef = useRef<PendingConfirm | null>(null);
  currentRef.current = current;
  const { push, pop } = useExitLayer();

  useEffect(() => {
    subscribers.add(setCurrent);
    setCurrent(pendingConfirm);
    return () => {
      subscribers.delete(setCurrent);
    };
  }, []);

  const settle = useCallback((value: boolean) => {
    const pending = currentRef.current;
    currentRef.current = null;
    pendingConfirm = null;
    pending?.resolve(value);
    notify();
  }, []);

  // Android 返回键 / Esc 走高优先级退出层，先关确认框而不是退出页面
  useEffect(() => {
    if (!current) return;
    const id = push({ close: () => settle(false) });
    return () => pop(id);
  }, [current, push, pop, settle]);

  return (
    <Dialog
      open={!!current}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <DialogContent className="max-w-[calc(100vw-2.5rem)] rounded-2xl sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{current?.title}</DialogTitle>
          {current?.description && (
            <DialogDescription className="text-[13px] leading-relaxed">
              {current.description}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="mt-2 flex-row justify-end gap-2">
          <Button
            variant="outline"
            className="h-9 flex-1 text-[13px] sm:flex-none"
            onClick={() => settle(false)}
          >
            {current?.cancelText ?? "取消"}
          </Button>
          <Button
            variant={current?.destructive ? "destructive" : "default"}
            className="h-9 flex-1 text-[13px] sm:flex-none"
            onClick={() => settle(true)}
          >
            {current?.confirmText ?? "确定"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
