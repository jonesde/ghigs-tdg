import { describe, expect, it } from "vitest";
import { formatViewRect, interpolateViewRect, type ViewRect } from "@/render/svg/viewBoxTween.js";

const fromRect: ViewRect = { originX: -180, originY: -180, width: 540, height: 540 };
const toRect: ViewRect = { originX: -360, originY: -180, width: 720, height: 540 };

describe("viewBox tween", () => {
  it("returns the endpoints at progress 0 and 1", () => {
    expect(interpolateViewRect(fromRect, toRect, 0)).toEqual(fromRect);
    expect(interpolateViewRect(fromRect, toRect, 1)).toEqual(toRect);
  });

  it("returns the midpoints at progress 0.5", () => {
    expect(interpolateViewRect(fromRect, toRect, 0.5)).toEqual({
      originX: -270,
      originY: -180,
      width: 630,
      height: 540,
    });
  });

  it("formats the rectangle the svg viewBox binds", () => {
    expect(formatViewRect(fromRect)).toBe("-180 -180 540 540");
  });
});
