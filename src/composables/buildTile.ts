export interface BuildTileRef {
  tileX: number;
  tileY: number;
}

// The highlighted build tile: the hover tile while the pointer or the arrow
// keys have set one, else the map center the build preview snaps to first. One
// owner for that resolution, shared by the Enter key, the arrow-key step, the
// SVG preview, and the site tooltip, so the four cannot drift apart. The grid
// parameter is structural — the store's Pinia-unwrapped grid and the input
// stub both carry width and height, which is all the fallback needs.
export function currentBuildTile(
  grid: { width: number; height: number } | null,
  hoverTile: BuildTileRef | null,
): BuildTileRef | null {
  if (hoverTile) return hoverTile;
  if (!grid) return null;
  return { tileX: Math.floor(grid.width / 2), tileY: Math.floor(grid.height / 2) };
}
