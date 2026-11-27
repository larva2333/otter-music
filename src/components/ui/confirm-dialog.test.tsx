import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmDialogHost, promptDialog } from "./confirm-dialog";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { useExitLayerStore } from "@/hooks/useExitLayer";

describe("promptDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useExitLayerStore.setState({ stack: [] });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("submits trimmed value on form confirm and supports defaultValue", async () => {
    await act(async () => {
      root.render(<ConfirmDialogHost />);
    });

    let resultPromise: Promise<string | null> | undefined;
    await act(async () => {
      resultPromise = promptDialog({
        title: "新建歌单",
        placeholder: "请输入新歌单名称",
        defaultValue: "  初始歌单  ",
        confirmText: "创建",
      });
    });

    const input = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="请输入新歌单名称"]'
    );
    expect(input).not.toBeNull();
    expect(input?.value).toBe("  初始歌单  ");

    const submitBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "创建"
    );
    expect(submitBtn).toBeTruthy();

    await act(async () => {
      submitBtn?.click();
    });

    await expect(resultPromise).resolves.toBe("初始歌单");
  });

  it("resolves null when canceled or dismissed via exit layer", async () => {
    await act(async () => {
      root.render(<ConfirmDialogHost />);
    });

    let resultPromise: Promise<string | null> | undefined;
    await act(async () => {
      resultPromise = promptDialog({
        title: "重命名歌单",
        defaultValue: "旧名字",
      });
    });

    await act(async () => {
      useExitLayerStore.getState().handleExit();
    });

    await expect(resultPromise).resolves.toBeNull();
  });

  it("disables submit button when input is blank", async () => {
    await act(async () => {
      root.render(<ConfirmDialogHost />);
    });

    let p: Promise<string | null> | undefined;
    await act(async () => {
      p = promptDialog({ title: "新建歌单", defaultValue: "   " });
    });

    const submitBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "确定"
    );
    expect(submitBtn?.disabled).toBe(true);

    const cancelBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "取消"
    );
    await act(async () => {
      cancelBtn?.click();
    });
    await expect(p).resolves.toBeNull();
  });

  it("keeps horizontal side spacing on DialogContent even when max-w-* override is passed", async () => {
    await act(async () => {
      root.render(
        <Dialog open={true}>
          <DialogContent className="max-w-lg">
            <DialogTitle>测试弹窗</DialogTitle>
          </DialogContent>
        </Dialog>
      );
    });

    const content = document.body.querySelector<HTMLElement>(
      '[data-slot="dialog-content"]'
    );
    expect(content?.className).toContain("w-[calc(100vw-3rem)]");
    expect(content?.className).toContain("max-w-lg");
    expect(content?.className).not.toContain("w-full");
  });
});
