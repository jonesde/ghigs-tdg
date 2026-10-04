import type { TileKind, TileKindImages } from "./index.js";

/**
 * Tile art addressing. A theme may ship several variants per tile kind; the
 * renderer picks one per cell from a hash of the map seed and the cell's
 * absolute tile position, so a cell keeps its variant across a progressive
 * board rebuild and no cell's art depends on iteration order.
 */

/** Variant art for a kind, primary first. Never empty for a loaded theme. */
export function tileImagesOf(tiles: TileKindImages | undefined, kind: TileKind): string[] {
  return tiles?.[kind] ?? [];
}

/**
 * Symbol id for one variant. Variant 0 keeps the documented
 * `tile-r{regionId}-{kind}` id; later variants append `-v{index}`.
 */
export function tileSymbolId(regionId: number, kind: TileKind, variantIndex: number): string {
  const prefix = `tile-r${regionId}-${kind}`;
  return variantIndex === 0 ? prefix : `${prefix}-v${variantIndex}`;
}

/**
 * Variant index for one cell. Uses the same imul mixing shape as
 * progressiveTileRotation (src/sim/grid/ProgressiveMap.ts) with its own
 * constants, so both rotation and variant are stable per absolute tile.
 */
export function tileVariantIndex(
  mapSeed: number,
  absoluteTileX: number,
  absoluteTileY: number,
  variantCount: number,
): number {
  if (variantCount <= 1) return 0;
  const mixed =
    (Math.imul(mapSeed ^ (absoluteTileX + 0x85eb), 0x2545f491) ^ Math.imul(absoluteTileY + 0x1b873, 0x27d4eb2f)) >>> 0;
  return mixed % variantCount;
}
