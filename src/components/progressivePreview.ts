const PATH_FILL = "#d7b072";
const TERRAIN_FILLS = ["#6e8f7a", "#4d6658", "#2c3a32", "#1b2620"];

export function progressivePreviewFill(tile: { type: string; height: number }): string {
  if (tile.type === "path") return PATH_FILL;
  const heightStep = Math.min(4, Math.max(1, Math.round(tile.height)));
  return TERRAIN_FILLS[heightStep - 1] ?? TERRAIN_FILLS[2]!;
}
