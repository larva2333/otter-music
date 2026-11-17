import { describe, expect, it } from "vitest";
import { keyboardLift, keyboardViewportPatch } from "./keyboard-viewport";

describe("keyboardViewportPatch", () => {
  it("does nothing when the keyboard is closed", () => {
    expect(keyboardViewportPatch(800, 800, 0)).toBeNull();
  });

  it("ignores a short navigation-bar overlap", () => {
    expect(keyboardViewportPatch(800, 760, 0)).toBeNull();
  });

  it("shrinks the shell when the keyboard covers the bottom", () => {
    expect(keyboardViewportPatch(800, 420, 0)).toEqual({
      height: 420,
      translateY: 0,
    });
  });

  it("pulls the shell back down when the page was panned upward", () => {
    expect(keyboardViewportPatch(800, 420, 96)).toEqual({
      height: 420,
      translateY: 96,
    });
  });
});

describe("keyboardLift", () => {
  it("does not move anything when the keyboard is closed", () => {
    expect(keyboardLift(800, null, 800)).toBe(0);
  });

  it("lifts by the shell shrink when the window was not resized (edge-to-edge)", () => {
    // Android 15+：innerHeight 仍是全屏 800，壳层被缩到 420
    expect(keyboardLift(800, { height: 420, translateY: 0 }, 800)).toBe(380);
  });

  it("lifts by the window compression when adjustResize shrank the window", () => {
    // Android 14 及以下：窗口本身缩到 420，壳层没被 patch
    expect(keyboardLift(800, null, 420)).toBe(380);
  });

  it("counts the pan offset so the bar still lands on the screen bottom", () => {
    expect(keyboardLift(800, { height: 420, translateY: 96 }, 800)).toBe(284);
  });
});
