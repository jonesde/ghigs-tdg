import { type BlockTemplate, localTile, type PlacedBlock, PROGRESSIVE_BLOCK_SIZE } from "@/sim/grid/ProgressiveMap.js";

const PATH_FILL = "#d7b072";
const TERRAIN_FILLS = ["#6e8f7a", "#4d6658", "#2c3a32", "#1b2620"];

export function progressivePreviewFill(tile: { type: string; height: number }): string {
  if (tile.type === "path") return PATH_FILL;
  const heightStep = Math.min(4, Math.max(1, Math.round(tile.height)));
  return TERRAIN_FILLS[heightStep - 1] ?? TERRAIN_FILLS[2]!;
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
  let cells = "";
  for (let localY = 0; localY < PROGRESSIVE_BLOCK_SIZE; localY++) {
    for (let localX = 0; localX < PROGRESSIVE_BLOCK_SIZE; localX++) {
      const tile = localTile(catalog, block, localX, localY);
      const fill = progressivePreviewFill(tile ?? { type: "terrain", height: 1 });
      const cellX = originX + localX * cellSize;
      const cellY = originY + localY * cellSize;
      cells += `<rect x="${cellX}" y="${cellY}" width="${cellSize}" height="${cellSize}" fill="${fill}" />`;
    }
  }
  return cells;
}

export function progressivePatternMarkup(
  catalog: BlockTemplate[],
  templateIndex: number,
  rotation: number,
  originX: number,
  originY: number,
  cellSize: number,
  selected: boolean,
): string {
  const cells = progressiveCellRects(catalog, templateIndex, rotation, originX, originY, cellSize);
  const size = PROGRESSIVE_BLOCK_SIZE * cellSize;
  const stroke = selected
    ? `<rect x="${originX}" y="${originY}" width="${size}" height="${size}" fill="none" stroke="var(--color-accent)" stroke-width="3" />`
    : "";
  const opacity = selected ? 0.75 : 0.45;
  return `<g opacity="${opacity}">${cells}${stroke}</g>`;
}
