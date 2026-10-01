import type { Grid } from "@/sim/grid/Grid.js";
import { corridorWallInsetWorld } from "@/sim/navmesh/navmeshConfig.js";

export interface CorridorSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function isWalkable(grid: Grid, tileX: number, tileY: number): boolean {
  return grid.isPath(tileX, tileY) || grid.isBase(tileX, tileY) || grid.isSpawn(tileX, tileY);
}

// Walkable-tile outline: one segment per edge facing a non-walkable neighbor,
// shortened at convex grid vertices, plus a diagonal chamfer at those vertices.
// Same containment as the old per-tile cuboid forest; packed as a polyline later.
export function buildCorridorSegments(grid: Grid): CorridorSegment[] {
  const tileSize = grid.tileSize;
  const originX = grid.worldOriginX;
  const originY = grid.worldOriginY;
  const inset = corridorWallInsetWorld(tileSize);
  const segments: CorridorSegment[] = [];

  const convexDirs = new Map<string, { sx: number; sy: number }>();
  const cornerKey = (gridI: number, gridJ: number): string => `${gridI},${gridJ}`;
  for (let gridJ = 1; gridJ < grid.height; gridJ++) {
    for (let gridI = 1; gridI < grid.width; gridI++) {
      const northwest = isWalkable(grid, gridI - 1, gridJ - 1);
      const northeast = isWalkable(grid, gridI, gridJ - 1);
      const southwest = isWalkable(grid, gridI - 1, gridJ);
      const southeast = isWalkable(grid, gridI, gridJ);
      let sx = 0;
      let sy = 0;
      if (!northwest && northeast && southwest) {
        sx = 1;
        sy = 1;
      } else if (!northeast && northwest && southeast) {
        sx = -1;
        sy = 1;
      } else if (!southwest && northwest && southeast) {
        sx = 1;
        sy = -1;
      } else if (!southeast && northeast && southwest) {
        sx = -1;
        sy = -1;
      }
      if (sx !== 0) convexDirs.set(cornerKey(gridI, gridJ), { sx, sy });
    }
  }

  const neighbors = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  for (let tileY = 0; tileY < grid.height; tileY++) {
    for (let tileX = 0; tileX < grid.width; tileX++) {
      if (!isWalkable(grid, tileX, tileY)) continue;
      for (const neighbor of neighbors) {
        const neighborX = tileX + neighbor.dx;
        const neighborY = tileY + neighbor.dy;
        if (isWalkable(grid, neighborX, neighborY)) continue;

        let x1: number;
        let y1: number;
        let x2: number;
        let y2: number;
        let corner1I: number;
        let corner1J: number;
        let corner2I: number;
        let corner2J: number;
        if (neighbor.dy !== 0) {
          const y = originY + (neighbor.dy < 0 ? tileY * tileSize : (tileY + 1) * tileSize);
          x1 = originX + tileX * tileSize;
          y1 = y;
          corner1I = tileX;
          corner1J = neighbor.dy < 0 ? tileY : tileY + 1;
          x2 = originX + (tileX + 1) * tileSize;
          y2 = y;
          corner2I = tileX + 1;
          corner2J = corner1J;
        } else {
          const x = originX + (neighbor.dx < 0 ? tileX * tileSize : (tileX + 1) * tileSize);
          x1 = x;
          y1 = originY + tileY * tileSize;
          corner1I = neighbor.dx < 0 ? tileX : tileX + 1;
          corner1J = tileY;
          x2 = x;
          y2 = originY + (tileY + 1) * tileSize;
          corner2I = corner1I;
          corner2J = tileY + 1;
        }

        const length = tileSize;
        const originX1 = x1;
        const originY1 = y1;
        const originX2 = x2;
        const originY2 = y2;
        const corner1Convex = convexDirs.has(cornerKey(corner1I, corner1J));
        const corner2Convex = convexDirs.has(cornerKey(corner2I, corner2J));
        if (corner1Convex) {
          const insetFraction = inset / length;
          x1 = originX1 + (originX2 - originX1) * insetFraction;
          y1 = originY1 + (originY2 - originY1) * insetFraction;
        }
        if (corner2Convex) {
          const insetFraction = inset / length;
          x2 = originX2 + (originX1 - originX2) * insetFraction;
          y2 = originY2 + (originY1 - originY2) * insetFraction;
        }
        // Both chamfers consume this edge. The remainder would be a cuboid facing
        // backwards across the walkable tile; the two diagonals already close the corners.
        if (corner1Convex && corner2Convex && inset * 2 >= length) continue;
        segments.push({ x1, y1, x2, y2 });
      }
    }
  }

  for (const [key, dir] of convexDirs) {
    const parts = key.split(",");
    const gridI = Number(parts[0]);
    const gridJ = Number(parts[1]);
    const vertexX = originX + gridI * tileSize;
    const vertexY = originY + gridJ * tileSize;
    segments.push({ x1: vertexX - dir.sx * inset, y1: vertexY, x2: vertexX, y2: vertexY - dir.sy * inset });
  }

  return segments;
}

export function corridorSegmentsToPolyline(segments: CorridorSegment[]): {
  vertices: Float32Array;
  indices: Uint32Array;
} {
  const vertices = new Float32Array(segments.length * 4);
  const indices = new Uint32Array(segments.length * 2);
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex]!;
    const vertexIndex = segmentIndex * 2;
    vertices[vertexIndex * 2] = segment.x1;
    vertices[vertexIndex * 2 + 1] = segment.y1;
    vertices[vertexIndex * 2 + 2] = segment.x2;
    vertices[vertexIndex * 2 + 3] = segment.y2;
    indices[segmentIndex * 2] = vertexIndex;
    indices[segmentIndex * 2 + 1] = vertexIndex + 1;
  }
  return { vertices, indices };
}
