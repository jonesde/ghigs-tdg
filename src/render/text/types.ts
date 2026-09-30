export interface TextRenderScale {
  scaleX: number;
  scaleY: number;
  originX?: number;
  originY?: number;
}

export function textPixelX(world: number, scale: TextRenderScale): number {
  return (world - (scale.originX ?? 0)) * scale.scaleX;
}

export function textPixelY(world: number, scale: TextRenderScale): number {
  return (world - (scale.originY ?? 0)) * scale.scaleY;
}

// Minimal theme accessor surface the text managers need. The real Pinia
// `useMapThemeStore()` return value is structurally compatible.
export interface TextThemeAccess {
  getTowerVisual(type: string): { icon: string; color: string } | undefined;
  getEnemyVisual(type: string): { shape: string; color: string } | undefined;
  getEnemyGlyph(shape: string): string;
}
