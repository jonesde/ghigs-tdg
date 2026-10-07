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

const PATH_CONTOUR_STROKE_RATIO = 0.1;

function isPreviewPath(tile: { type: string } | null): boolean {
  return tile?.type === "path";
}

// Outlines the path inside the block only. A mouth on the 5×5 perimeter is left
// open: that edge continues into the neighboring block, and a stroke there would
// read as a wall that vanishes once the block is stamped.
function progressivePathContourMarkup(
  tiles: ({ type: string } | null)[][],
  originX: number,
  originY: number,
  cellSize: number,
): string {
  let pathData = "";
  for (let localY = 0; localY < PROGRESSIVE_BLOCK_SIZE; localY++) {
    for (let localX = 0; localX < PROGRESSIVE_BLOCK_SIZE; localX++) {
      const tile = tiles[localY]![localX] ?? null;
      const cellX = originX + localX * cellSize;
      const cellY = originY + localY * cellSize;
      const rightTile = localX + 1 < PROGRESSIVE_BLOCK_SIZE ? (tiles[localY]![localX + 1] ?? null) : null;
      if (rightTile && isPreviewPath(tile) !== isPreviewPath(rightTile)) {
        const edgeX = cellX + cellSize;
        pathData += `M${edgeX},${cellY} L${edgeX},${cellY + cellSize} `;
      }
      const bottomTile = localY + 1 < PROGRESSIVE_BLOCK_SIZE ? (tiles[localY + 1]![localX] ?? null) : null;
      if (bottomTile && isPreviewPath(tile) !== isPreviewPath(bottomTile)) {
        const edgeY = cellY + cellSize;
        pathData += `M${cellX},${edgeY} L${cellX + cellSize},${edgeY} `;
      }
    }
  }
  const trimmedPathData = pathData.trim();
  if (!trimmedPathData) return "";
  const strokeWidth = cellSize * PATH_CONTOUR_STROKE_RATIO;
  return (
    `<path data-edge="path-contour" d="${trimmedPathData}" fill="none" stroke="rgba(0,0,0,0.7)" ` +
    `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`
  );
}

// Unit-cell <rect> markup for one block in absolute coordinates. Shared by the
// offer cards (origin 0,0 and cellSize 1 inside a "0 0 5 5" viewBox) and the
// on-map ghost (origin at the block corner, cellSize = tile size).
export function progressiveCellRects(
  catalog: BlockTemplate[],
  templateIndex: number,
  rotation: number,
  originX: number,
  originY: number,
  cellSize: number,
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
    // Ignored on the kind: "catalog" path: localTile reads the baked
    // template.tiles, which already carry each template's rolled height pattern.
    heightPattern: "slope",
    flatHeight: 1,
    peakCorner: 0,
  };
  const tiles: ReturnType<typeof localTile>[][] = [];
  let cells = "";
  for (let localY = 0; localY < PROGRESSIVE_BLOCK_SIZE; localY++) {
    const row: ReturnType<typeof localTile>[] = [];
    for (let localX = 0; localX < PROGRESSIVE_BLOCK_SIZE; localX++) {
      const tile = localTile(catalog, block, localX, localY);
      row.push(tile);
      const fill = progressivePreviewFill(tile ?? { type: "terrain", height: 1 }, regionVisual);
      const cellX = originX + localX * cellSize;
      const cellY = originY + localY * cellSize;
      cells += `<rect x="${cellX}" y="${cellY}" width="${cellSize}" height="${cellSize}" fill="${fill}" />`;
    }
    tiles.push(row);
  }
  return cells + progressivePathContourMarkup(tiles, originX, originY, cellSize);
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
  const cells = progressiveCellRects(catalog, templateIndex, rotation, originX, originY, cellSize, regionVisual);
  const size = PROGRESSIVE_BLOCK_SIZE * cellSize;
  const stroke = selected
    ? `<rect x="${originX}" y="${originY}" width="${size}" height="${size}" fill="none" stroke="var(--color-accent)" stroke-width="3" />`
    : "";
  const opacity = selected ? 0.75 : 0.45;
  return `<g opacity="${opacity}">${cells}${stroke}</g>`;
}
