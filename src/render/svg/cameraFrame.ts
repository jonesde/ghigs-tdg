import type { ViewRect } from "@/render/svg/viewBoxTween.js";

export const TILE_SIZE = 36;
export const ZOOM_STEP = 1.2;
export const MIN_VIEW_TILES = 4;
export const MIN_VIEW_HEIGHT = MIN_VIEW_TILES * TILE_SIZE;
export const WHEEL_NOTCH_PIXELS = 100;
export const MAX_WHEEL_NOTCHES = 4;
export const FRAME_EPSILON = 0.01;
// Clearance kept between a highlighted point and each edge, as a fraction of the frame width.
export const EDGE_BUFFER_FRACTION = 0.2;
// Fraction of the frame (screen) size that one Ctrl+arrow press pans along that axis.
export const ARROW_PAN_FRACTION = 0.2;

const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;

export function framesMatch(left: ViewRect, right: ViewRect): boolean {
  return (
    Math.abs(left.originX - right.originX) < FRAME_EPSILON &&
    Math.abs(left.originY - right.originY) < FRAME_EPSILON &&
    Math.abs(left.width - right.width) < FRAME_EPSILON &&
    Math.abs(left.height - right.height) < FRAME_EPSILON
  );
}

export function tileMapRect(
  originTileX: number,
  originTileY: number,
  widthTiles: number,
  heightTiles: number,
  tileSize: number,
): ViewRect {
  return {
    originX: originTileX * tileSize,
    originY: originTileY * tileSize,
    width: widthTiles * tileSize,
    height: heightTiles * tileSize,
  };
}

// Smallest viewport-aspect rectangle that contains the map, centered on it.
// The axis that is already tighter matches the map. The other axis adds empty margin.
export function fitFrame(mapRect: ViewRect, viewportWidth: number, viewportHeight: number): ViewRect {
  if (mapRect.width <= 0 || mapRect.height <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return mapRect;
  const viewAspect = viewportWidth / viewportHeight;
  const mapAspect = mapRect.width / mapRect.height;
  const width = mapAspect > viewAspect ? mapRect.width : mapRect.height * viewAspect;
  const height = mapAspect > viewAspect ? mapRect.width / viewAspect : mapRect.height;
  const centerX = mapRect.originX + mapRect.width / 2;
  const centerY = mapRect.originY + mapRect.height / 2;
  return { originX: centerX - width / 2, originY: centerY - height / 2, width, height };
}

export function frameFromCenter(
  centerX: number,
  centerY: number,
  viewHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): ViewRect {
  const viewWidth = viewportHeight > 0 ? viewHeight * (viewportWidth / viewportHeight) : viewHeight;
  return { originX: centerX - viewWidth / 2, originY: centerY - viewHeight / 2, width: viewWidth, height: viewHeight };
}

export function clampFrame(frame: ViewRect, mapRect: ViewRect): ViewRect {
  return {
    originX: clampOrigin(frame.originX, frame.width, mapRect.originX, mapRect.width),
    originY: clampOrigin(frame.originY, frame.height, mapRect.originY, mapRect.height),
    width: frame.width,
    height: frame.height,
  };
}

function clampOrigin(origin: number, viewSize: number, mapOrigin: number, mapSize: number): number {
  if (viewSize >= mapSize) return mapOrigin + (mapSize - viewSize) / 2;
  const minimum = mapOrigin;
  const maximum = mapOrigin + mapSize - viewSize;
  return Math.min(maximum, Math.max(minimum, origin));
}

export interface ZoomFrameResult {
  frame: ViewRect;
  reachedFit: boolean;
}

// magnificationFactor > 1 zooms in. The focal world point keeps its fraction of the frame.
// Reaching the fit frame reports reachedFit so the caller can hand the camera back to map growth.
export function zoomFrame(
  frame: ViewRect,
  focalX: number,
  focalY: number,
  magnificationFactor: number,
  mapRect: ViewRect,
  fit: ViewRect,
): ZoomFrameResult {
  if (frame.width <= 0 || frame.height <= 0 || magnificationFactor <= 0) {
    return { frame, reachedFit: false };
  }
  if (fit.height <= MIN_VIEW_HEIGHT + FRAME_EPSILON) return { frame: fit, reachedFit: true };
  const nextHeight = frame.height / magnificationFactor;
  if (nextHeight >= fit.height - FRAME_EPSILON) return { frame: fit, reachedFit: true };
  const clampedHeight = Math.max(MIN_VIEW_HEIGHT, nextHeight);
  const fractionX = (focalX - frame.originX) / frame.width;
  const fractionY = (focalY - frame.originY) / frame.height;
  const nextWidth = clampedHeight * (frame.width / frame.height);
  const nextFrame = clampFrame(
    {
      originX: focalX - fractionX * nextWidth,
      originY: focalY - fractionY * clampedHeight,
      width: nextWidth,
      height: clampedHeight,
    },
    mapRect,
  );
  return { frame: nextFrame, reachedFit: false };
}

export function panFrame(frame: ViewRect, worldDx: number, worldDy: number, mapRect: ViewRect): ViewRect {
  return clampFrame(
    { originX: frame.originX + worldDx, originY: frame.originY + worldDy, width: frame.width, height: frame.height },
    mapRect,
  );
}

// Shifts the frame just enough that the world point sits inside a one-margin inset.
// A frame smaller than two margins uses the raw edges so the inset cannot invert.
export function revealPoint(
  frame: ViewRect,
  worldX: number,
  worldY: number,
  margin: number,
  mapRect: ViewRect,
): ViewRect {
  const insetX = frame.width <= margin * 2 ? 0 : margin;
  const insetY = frame.height <= margin * 2 ? 0 : margin;
  const left = frame.originX + insetX;
  const right = frame.originX + frame.width - insetX;
  const top = frame.originY + insetY;
  const bottom = frame.originY + frame.height - insetY;
  let shiftX = 0;
  let shiftY = 0;
  if (worldX < left) shiftX = worldX - left;
  else if (worldX > right) shiftX = worldX - right;
  if (worldY < top) shiftY = worldY - top;
  else if (worldY > bottom) shiftY = worldY - bottom;
  if (shiftX === 0 && shiftY === 0) return frame;
  return panFrame(frame, shiftX, shiftY, mapRect);
}

// Wheel up (negative deltaY) returns a factor greater than 1. One 100-pixel notch, or one
// line, is ZOOM_STEP. A single event is capped so a trackpad swipe cannot cross the whole range.
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const lines =
    deltaMode === WHEEL_DELTA_LINE
      ? deltaY
      : deltaMode === WHEEL_DELTA_PAGE
        ? deltaY * 10
        : deltaY / WHEEL_NOTCH_PIXELS;
  const capped = Math.min(MAX_WHEEL_NOTCHES, Math.max(-MAX_WHEEL_NOTCHES, lines));
  return Math.exp(-capped * Math.log(ZOOM_STEP));
}
