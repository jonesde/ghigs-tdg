import { fieldFillOf } from "@/render/themes/fieldFill.js";
import type { RegionVisualMeta } from "@/render/themes/index.js";
import { tileImagesOf } from "@/render/themes/tileArt.js";
import { type BlockTemplate, localTile, type PlacedBlock, PROGRESSIVE_BLOCK_SIZE } from "@/sim/grid/ProgressiveMap.js";

const FALLBACK_PATH_FILL = "#7d7259";
const FALLBACK_TERRAIN_FILLS = ["#5d6b5d", "#475347", "#333d33", "#222922"];
const TERRAIN_TILE_KEYS = ["terrain1", "terrain2", "terrain3", "terrain4"] as const;

// Variant 0 carries the field fill every variant shares, so the block preview
// reads the same ramp the stamped map paints.
function fieldFillOfVariant(
  regionVisual: RegionVisualMeta | undefined | null,
  tileKey: (typeof TERRAIN_TILE_KEYS)[number] | "path",
): string | null {
  const primaryVariant = tileImagesOf(regionVisual?.tiles, tileKey)[0];
  return primaryVariant ? fieldFillOf(primaryVariant) : null;
}

function pathFillOf(regionVisual: RegionVisualMeta | undefined | null): string {
  return fieldFillOfVariant(regionVisual, "path") ?? FALLBACK_PATH_FILL;
}

function terrainFillOf(regionVisual: RegionVisualMeta | undefined | null, heightStep: number): string {
  const tileKey = TERRAIN_TILE_KEYS[heightStep - 1]!;
  return fieldFillOfVariant(regionVisual, tileKey) ?? FALLBACK_TERRAIN_FILLS[heightStep - 1]!;
}

export function progressivePreviewFill(
  tile: { type: string; height: number },
  regionVisual: RegionVisualMeta | undefined | null,
): string {
  if (tile.type === "path") return pathFillOf(regionVisual);
  const heightStep = Math.min(4, Math.max(1, Math.round(tile.height)));
  return terrainFillOf(regionVisual, heightStep);
}

export function progressivePatternMarkup(
  catalog: BlockTemplate[],
  templateIndex: number,
  rotation: number,
  originX: number,
  originY: number,
  cellSize: number,
  selected: boolean,
  regionVisual: RegionVisualMeta | undefined | null,
): string {
  const block: PlacedBlock = {
    kind: "catalog",
    templateIndex,
    rotation,
    blockX: 0,
    blockY: 0,
    fill: false,
    entryEdges: [],
    heightPattern: "slope",
    flatHeight: 1,
    peakCorner: 0,
  };
  let cells = "";
  for (let localY = 0; localY < PROGRESSIVE_BLOCK_SIZE; localY++) {
    for (let localX = 0; localX < PROGRESSIVE_BLOCK_SIZE; localX++) {
      const tile = localTile(catalog, block, localX, localY);
      const fill = progressivePreviewFill(tile ?? { type: "terrain", height: 1 }, regionVisual);
      const cellX = originX + localX * cellSize;
      const cellY = originY + localY * cellSize;
      cells += `<rect x="${cellX}" y="${cellY}" width="${cellSize}" height="${cellSize}" fill="${fill}" />`;
    }
  }
  const size = PROGRESSIVE_BLOCK_SIZE * cellSize;
  const stroke = selected
    ? `<rect x="${originX}" y="${originY}" width="${size}" height="${size}" fill="none" stroke="var(--color-accent)" stroke-width="3" />`
    : "";
  const opacity = selected ? 0.75 : 0.45;
  return `<g opacity="${opacity}">${cells}${stroke}</g>`;
}
