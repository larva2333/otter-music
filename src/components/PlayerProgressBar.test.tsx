import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PlayerProgressBar } from "./PlayerProgressBar";
import { useMusicStore } from "@/store/music-store";

vi.mock("idb-keyval", () => ({
  get: vi.fn(() => Promise.resolve(undefined)),
  set: vi.fn(() => Promise.resolve()),
  del: vi.fn(() => Promise.resolve()),
}));

describe("PlayerProgressBar", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useMusicStore.setState({
      currentAudioTime: 125,
      duration: 300,
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    document.body.innerHTML = "";
    root = undefined;
    container = undefined;
    vi.restoreAllMocks();
  });

  const render = (
    props?: Partial<React.ComponentProps<typeof PlayerProgressBar>>
  ) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<PlayerProgressBar {...props} />);
    });
    return container;
  };

  it("renders current time and total duration", () => {
    const el = render();
    const text = el.textContent ?? "";
    expect(text).toContain("2:05");
    expect(text).toContain("5:00");
  });
});
