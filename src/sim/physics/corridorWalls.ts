import type { Grid } from "@/sim/grid/Grid.js";
import { corridorWallInsetWorld } from "@/sim/navmesh/navmeshConfig.js";

export interface CorridorConvexVertex {
  sx: number;
  sy: number;
}

export type TerrainTowerCorner = "northwest" | "northeast" | "southeast" | "southwest";

export interface CorridorSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function isWalkable(grid: Grid, tileX: number, tileY: number): boolean {
  return grid.isPath(tileX, tileY) || grid.isBase(tileX, tileY) || grid.isSpawn(tileX, tileY);
}

export function corridorVertexKey(gridI: number, gridJ: number): string {
  return `${gridI},${gridJ}`;
}

// Inside corners of the walkable corridor. sx/sy match the chamfer diagonal in
// buildCorridorSegments: the missing quadrant is the terrain side of the vertex.
export function corridorConvexVertices(grid: Grid): Map<string, CorridorConvexVertex> {
  const vertices = new Map<string, CorridorConvexVertex>();
  for (let gridJ = 1; gridJ < grid.height; gridJ++) {
    for (let gridI = 1; gridI < grid.width; gridI++) {
      const northwest = isWalkable(grid, gridI - 1, gridJ - 1);
      const northeast = isWalkable(grid, gridI, gridJ - 1);
      const southwest = isWalkable(grid, gridI - 1, gridJ);
      const southeast = isWalkable(grid, gridI, gridJ);
      let signX = 0;
      let signY = 0;
      if (!northwest && northeast && southwest) {
        signX = 1;
        signY = 1;
      } else if (!northeast && northwest && southeast) {
        signX = -1;
        signY = 1;
      } else if (!southwest && northwest && southeast) {
        signX = 1;
        signY = -1;
      } else if (!southeast && northeast && southwest) {
        signX = -1;
        signY = -1;
      }
      if (signX !== 0) vertices.set(corridorVertexKey(gridI, gridJ), { sx: signX, sy: signY });
    }
  }
  return vertices;
}

// Local-space outline (body origin at the tile center, +y south) for a terrain
// tower that owns a corridor convex vertex. Null keeps the full cuboid: path
// tiles must not open a gap, and a cut that consumes an edge would invert the face.
// The cut uses the corridor chamfer inset so the new diagonal lies on the wall
// the circle already slides. A square corner there pins the body, normal opposing
// the outgoing leg.
export function terrainTowerLocalOutline(
  tileSize: number,
  cutCorners: ReadonlySet<TerrainTowerCorner>,
): Float32Array | null {
  if (cutCorners.size === 0) return null;
  const inset = corridorWallInsetWorld(tileSize);
  if (inset * 2 >= tileSize) return null;
  const half = tileSize / 2;
  const left = -half;
  const right = half;
  const top = -half;
  const bottom = half;
  const coordinates: number[] = [];
  const push = (x: number, y: number) => {
    coordinates.push(x, y);
  };
  // CCW in the physics plane.
  if (cutCorners.has("northwest")) {
    push(left, top + inset);
    push(left + inset, top);
  } else {
    push(left, top);
  }
  if (cutCorners.has("northeast")) {
    push(right - inset, top);
    push(right, top + inset);
  } else {
    push(right, top);
  }
  if (cutCorners.has("southeast")) {
    push(right, bottom - inset);
    push(right - inset, bottom);
  } else {
    push(right, bottom);
  }
  if (cutCorners.has("southwest")) {
    push(left + inset, bottom);
    push(left, bottom - inset);
  } else {
    push(left, bottom);
  }
  return new Float32Array(coordinates);
}

export function terrainTowerCutCorners(
  grid: Grid,
  tileX: number,
  tileY: number,
  convexVertices: ReadonlyMap<string, CorridorConvexVertex>,
): Set<TerrainTowerCorner> | null {
  if (!grid.isTerrain(tileX, tileY)) return null;
  const cutCorners = new Set<TerrainTowerCorner>();
  if (convexVertices.has(corridorVertexKey(tileX, tileY))) cutCorners.add("northwest");
  if (convexVertices.has(corridorVertexKey(tileX + 1, tileY))) cutCorners.add("northeast");
  if (convexVertices.has(corridorVertexKey(tileX + 1, tileY + 1))) cutCorners.add("southeast");
  if (convexVertices.has(corridorVertexKey(tileX, tileY + 1))) cutCorners.add("southwest");
  if (cutCorners.size === 0) return null;
  return cutCorners;
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
  const convexDirs = corridorConvexVertices(grid);
  const cornerKey = corridorVertexKey;

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
