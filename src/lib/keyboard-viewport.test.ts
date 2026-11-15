import { describe, expect, it } from "vitest";
import { keyboardViewportPatch } from "./keyboard-viewport";

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
