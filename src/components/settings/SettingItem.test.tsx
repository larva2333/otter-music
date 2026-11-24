import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { HardDrive } from "lucide-react";
import { SettingItem } from "./SettingItem";

function Harness() {
  const [expanded, setExpanded] = useState(false);
  return (
    <SettingItem
      icon={HardDrive}
      title="缓存管理"
      isExpanded={expanded}
      onClick={() => setExpanded((v) => !v)}
      expandedContent={<div>明细</div>}
    />
  );
}

describe("SettingItem", () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const scrollIntoView = vi.fn();
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    scrollIntoView.mockClear();
  });

  afterAll(() => {
    if (originalScrollIntoView) {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("展开时保持当前位置，不自动滚动条目", async () => {
    await act(async () => {
      root!.render(<Harness />);
    });

    const title = Array.from(container!.querySelectorAll("span")).find(
      (el) => el.textContent === "缓存管理"
    );
    expect(title).toBeTruthy();

    await act(async () => {
      title!.parentElement!.click();
    });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 260));
    });

    expect(container!.textContent).toContain("明细");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
