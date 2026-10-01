export interface ViewRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export const VIEW_BOX_TWEEN_MS = 320;

export function easeOutCubic(progress: number): number {
  const remaining = 1 - progress;
  return 1 - remaining * remaining * remaining;
}

export function interpolateViewRect(from: ViewRect, to: ViewRect, progress: number): ViewRect {
  const blend = (start: number, end: number) => start + (end - start) * progress;
  return {
    originX: blend(from.originX, to.originX),
    originY: blend(from.originY, to.originY),
    width: blend(from.width, to.width),
    height: blend(from.height, to.height),
  };
}

export function formatViewRect(rect: ViewRect): string {
  return `${rect.originX} ${rect.originY} ${rect.width} ${rect.height}`;
}
