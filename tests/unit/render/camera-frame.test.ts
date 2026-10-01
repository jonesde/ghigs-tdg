import { describe, expect, it } from "vitest";
import {
  fitFrame,
  framesMatch,
  MAX_WHEEL_NOTCHES,
  MIN_VIEW_HEIGHT,
  panFrame,
  revealPoint,
  wheelZoomFactor,
  ZOOM_STEP,
  zoomFrame,
} from "@/render/svg/cameraFrame.js";
import type { ViewRect } from "@/render/svg/viewBoxTween.js";

const mapRect: ViewRect = { originX: 0, originY: 0, width: 720, height: 720 };

describe("fitFrame", () => {
  it("contains the map, matches the viewport aspect, and stays centered", () => {
    const fit = fitFrame(mapRect, 800, 600);
    expect(fit.width / fit.height).toBeCloseTo(800 / 600);
    expect(fit.originX).toBeLessThanOrEqual(mapRect.originX);
    expect(fit.originY).toBeLessThanOrEqual(mapRect.originY);
    expect(fit.originX + fit.width).toBeGreaterThanOrEqual(mapRect.originX + mapRect.width);
    expect(fit.originY + fit.height).toBeGreaterThanOrEqual(mapRect.originY + mapRect.height);
    expect(fit.originX + fit.width / 2).toBeCloseTo(mapRect.originX + mapRect.width / 2);
    expect(fit.originY + fit.height / 2).toBeCloseTo(mapRect.originY + mapRect.height / 2);
    expect(fit.height).toBeCloseTo(mapRect.height);
  });
});

describe("zoomFrame", () => {
  it("keeps the focal point at the same fraction of the frame", () => {
    const frame: ViewRect = { originX: 0, originY: 0, width: 800, height: 400 };
    const fit: ViewRect = { originX: -400, originY: -450, width: 2000, height: 2000 };
    const wideMap: ViewRect = { originX: 0, originY: 0, width: 2000, height: 2000 };
    const focalX = 200;
    const focalY = 100;
    const result = zoomFrame(frame, focalX, focalY, 2, wideMap, fit);
    expect(result.reachedFit).toBe(false);
    expect(result.frame.height).toBeCloseTo(200);
    expect(result.frame.width).toBeCloseTo(400);
    expect((focalX - result.frame.originX) / result.frame.width).toBeCloseTo(0.25);
    expect((focalY - result.frame.originY) / result.frame.height).toBeCloseTo(0.25);
  });

  it("reports reachedFit when zooming out to the whole map", () => {
    const fit = fitFrame(mapRect, 800, 600);
    const zoomed: ViewRect = {
      originX: fit.originX + 40,
      originY: fit.originY + 30,
      width: fit.width / 2,
      height: fit.height / 2,
    };
    const result = zoomFrame(zoomed, 360, 360, 0.1, mapRect, fit);
    expect(result.reachedFit).toBe(true);
    expect(framesMatch(result.frame, fit)).toBe(true);
  });

  it("stops zooming in at four tiles", () => {
    const frame: ViewRect = { originX: 100, originY: 100, width: 400, height: 200 };
    const fit = fitFrame(mapRect, 800, 600);
    const result = zoomFrame(frame, 200, 150, 10, mapRect, fit);
    expect(result.reachedFit).toBe(false);
    expect(result.frame.height).toBeCloseTo(MIN_VIEW_HEIGHT);
  });
});

describe("panFrame", () => {
  it("clamps a zoomed view inside the map and locks a letterboxed axis", () => {
    const wideMap: ViewRect = { originX: 0, originY: 0, width: 200, height: 100 };
    const frame: ViewRect = { originX: 50, originY: 0, width: 100, height: 100 };
    const panned = panFrame(frame, 20, 50, wideMap);
    expect(panned.originX).toBeCloseTo(70);
    expect(panned.originY).toBeCloseTo(0);
    expect(panned.width).toBe(100);
    expect(panned.height).toBe(100);
  });

  it("does not pan a fit frame", () => {
    const fit = fitFrame(mapRect, 800, 600);
    expect(framesMatch(panFrame(fit, 80, -40, mapRect), fit)).toBe(true);
  });
});

describe("revealPoint", () => {
  it("shifts only far enough to bring an outside point inside the margin", () => {
    const frame: ViewRect = { originX: 0, originY: 0, width: 200, height: 200 };
    const revealed = revealPoint(frame, 190, 100, 36, mapRect);
    expect(revealed.originX).toBeCloseTo(26);
    expect(revealed.originY).toBeCloseTo(0);
  });
});

describe("wheelZoomFactor", () => {
  it("turns one wheel notch into one zoom step and caps a swipe", () => {
    expect(wheelZoomFactor(-100, 0)).toBeCloseTo(ZOOM_STEP);
    expect(wheelZoomFactor(100, 0)).toBeCloseTo(1 / ZOOM_STEP);
    expect(wheelZoomFactor(-1, 1)).toBeCloseTo(ZOOM_STEP);
    expect(wheelZoomFactor(-1000, 0)).toBeCloseTo(ZOOM_STEP ** MAX_WHEEL_NOTCHES);
  });
});
