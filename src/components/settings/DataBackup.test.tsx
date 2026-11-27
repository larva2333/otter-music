import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DataBackup } from "./DataBackup";

vi.mock("@/lib/api/config", () => ({
  IS_NATIVE: false,
}));

vi.mock("@/lib/utils/auto-backup", () => ({
  AUTO_BACKUP_DIR: "Documents/OtterMusic/backups",
  createManualBackup: vi.fn(),
  listAutoBackups: vi.fn(async () => []),
  restoreAutoBackup: vi.fn(),
}));

describe("DataBackup", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders backup content directly without 导出数据/导入数据 tabs bar", async () => {
    await act(async () => {
      root.render(<DataBackup open={true} onOpenChange={vi.fn()} />);
    });

    expect(document.body.textContent).toContain("数据备份");
    expect(document.body.textContent).toContain("Documents/OtterMusic/backups");
    expect(document.body.textContent).not.toContain("导出数据");
    expect(document.body.textContent).not.toContain("导入数据");
    expect(document.body.querySelector('[role="tablist"]')).toBeNull();
  });
});
