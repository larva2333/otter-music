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
import { Input } from "./input";

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

/**
 * 应用内输入弹窗，替代 window.prompt，跟随 App 主题与返回键退出栈。
 * 确认返回裁剪或原字符串，取消返回 null。
 */
export interface PromptOptions {
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
}

type PendingPrompt = PromptOptions & {
  resolve: (value: string | null) => void;
};

let pendingPrompt: PendingPrompt | null = null;
const promptSubscribers = new Set<(value: PendingPrompt | null) => void>();

function notifyPrompt() {
  promptSubscribers.forEach((fn) => fn(pendingPrompt));
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  pendingPrompt?.resolve(null);
  return new Promise<string | null>((resolve) => {
    pendingPrompt = { ...options, resolve };
    notifyPrompt();
  });
}

/** 挂在 RootLayout 的全局宿主，全应用只需要一个 */
export function ConfirmDialogHost() {
  const [current, setCurrent] = useState<PendingConfirm | null>(null);
  const currentRef = useRef<PendingConfirm | null>(null);
  currentRef.current = current;

  const [currentPrompt, setCurrentPrompt] = useState<PendingPrompt | null>(
    null
  );
  const currentPromptRef = useRef<PendingPrompt | null>(null);
  currentPromptRef.current = currentPrompt;
  const [promptValue, setPromptValue] = useState("");
  const promptInputRef = useRef<HTMLInputElement>(null);

  const { push, pop } = useExitLayer();

  useEffect(() => {
    subscribers.add(setCurrent);
    setCurrent(pendingConfirm);
    return () => {
      subscribers.delete(setCurrent);
    };
  }, []);

  useEffect(() => {
    const syncPrompt = (next: PendingPrompt | null) => {
      setCurrentPrompt(next);
      setPromptValue(next?.defaultValue ?? "");
    };
    promptSubscribers.add(syncPrompt);
    syncPrompt(pendingPrompt);
    return () => {
      promptSubscribers.delete(syncPrompt);
    };
  }, []);

  const settle = useCallback((value: boolean) => {
    const pending = currentRef.current;
    currentRef.current = null;
    pendingConfirm = null;
    pending?.resolve(value);
    notify();
  }, []);

  const settlePrompt = useCallback((value: string | null) => {
    const pending = currentPromptRef.current;
    currentPromptRef.current = null;
    pendingPrompt = null;
    pending?.resolve(value);
    notifyPrompt();
  }, []);

  // Android 返回键 / Esc 走高优先级退出层，先关确认框而不是退出页面
  useEffect(() => {
    if (!current) return;
    const id = push({ close: () => settle(false) });
    return () => pop(id);
  }, [current, push, pop, settle]);

  useEffect(() => {
    if (!currentPrompt) return;
    const id = push({ close: () => settlePrompt(null) });
    return () => pop(id);
  }, [currentPrompt, push, pop, settlePrompt]);

  const trimmedPrompt = promptValue.trim();

  return (
    <>
      <Dialog
        open={!!current}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        <DialogContent className="rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{current?.title}</DialogTitle>
            {current?.description && (
              <DialogDescription className="text-sm leading-relaxed">
                {current.description}
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter className="mt-2 flex-row justify-end gap-2">
            <Button
              variant="outline"
              className="h-9 flex-1 text-sm sm:flex-none"
              onClick={() => settle(false)}
            >
              {current?.cancelText ?? "取消"}
            </Button>
            <Button
              variant={current?.destructive ? "destructive" : "default"}
              className="h-9 flex-1 text-sm sm:flex-none"
              onClick={() => settle(true)}
            >
              {current?.confirmText ?? "确定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!currentPrompt}
        onOpenChange={(open) => {
          if (!open) settlePrompt(null);
        }}
      >
        <DialogContent
          className="rounded-2xl sm:max-w-sm"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            requestAnimationFrame(() => {
              const input = promptInputRef.current;
              if (!input) return;
              input.focus();
              if (currentPromptRef.current?.defaultValue) {
                input.select();
              }
            });
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!trimmedPrompt) return;
              settlePrompt(trimmedPrompt);
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-base">
                {currentPrompt?.title}
              </DialogTitle>
              {currentPrompt?.description && (
                <DialogDescription className="text-sm leading-relaxed">
                  {currentPrompt.description}
                </DialogDescription>
              )}
            </DialogHeader>
            <div className="py-3">
              <Input
                ref={promptInputRef}
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                placeholder={currentPrompt?.placeholder ?? "请输入..."}
                className="h-10 text-sm"
              />
            </div>
            <DialogFooter className="flex-row justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 flex-1 text-sm sm:flex-none"
                onClick={() => settlePrompt(null)}
              >
                {currentPrompt?.cancelText ?? "取消"}
              </Button>
              <Button
                type="submit"
                disabled={!trimmedPrompt}
                className="h-9 flex-1 text-sm sm:flex-none"
              >
                {currentPrompt?.confirmText ?? "确定"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
