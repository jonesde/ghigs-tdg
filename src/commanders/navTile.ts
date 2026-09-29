export interface GridCoordinate {
  x: number;
  y: number;
}

const WALKABLE_TILE_VALUES = [1, 2, 3];

function isWalkableTile(tileValue: number): boolean {
  return WALKABLE_TILE_VALUES.includes(tileValue);
}

// Nearest path, spawn, or base tile (Euclidean). Towers may sit on terrain, so a
// distance read has to use a tile the nav field actually covers. A walkable tile
// snaps to itself. Equal distances keep the first row-major tile.
export function nearestPathTileTo(tileX: number, tileY: number, gridLayout: number[][]): GridCoordinate | null {
  const rowCount = gridLayout.length;
  const columnCount = gridLayout[0]?.length ?? 0;
  if (rowCount === 0 || columnCount === 0) return null;
  let bestTile: GridCoordinate | null = null;
  let bestSquaredDistance = Infinity;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const gridRow = gridLayout[rowIndex];
    if (!gridRow) continue;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      const tileValue = gridRow[columnIndex];
      if (tileValue === undefined || !isWalkableTile(tileValue)) continue;
      const deltaX = columnIndex - tileX;
      const deltaY = rowIndex - tileY;
      const squaredDistance = deltaX * deltaX + deltaY * deltaY;
      if (squaredDistance < bestSquaredDistance) {
        bestSquaredDistance = squaredDistance;
        bestTile = { x: columnIndex, y: rowIndex };
      }
    }
  }
  return bestTile;
}
