import { describe, expect, it } from "vitest";
import { ENEMY_TYPES } from "@/sim/ConstantsEnemy.js";
import { Grid } from "@/sim/grid/Grid.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import {
  corridorWallHalfThicknessWorld,
  corridorWallInsetWorld,
  maxGroundEnemyRadiusWorld,
} from "@/sim/navmesh/navmeshConfig.js";
import {
  buildCorridorSegments,
  type CorridorSegment,
  corridorSegmentsToPolyline,
} from "@/sim/physics/corridorWalls.js";
import { makeBastionMap, makeOneWideCornerMap, makeSerpentineMap } from "../../../helpers/mock-grid.js";

const ENDPOINT_EPSILON = 1e-6;

function isDiagonal(segment: CorridorSegment): boolean {
  return segment.x1 !== segment.x2 && segment.y1 !== segment.y2;
}

function distancePointToSegment(pointX: number, pointY: number, segment: CorridorSegment): number {
  const deltaX = segment.x2 - segment.x1;
  const deltaY = segment.y2 - segment.y1;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const unclampedFraction = ((pointX - segment.x1) * deltaX + (pointY - segment.y1) * deltaY) / lengthSquared;
  const clampedFraction = Math.max(0, Math.min(1, unclampedFraction));
  const closestX = segment.x1 + clampedFraction * deltaX;
  const closestY = segment.y1 + clampedFraction * deltaY;
  return Math.hypot(pointX - closestX, pointY - closestY);
}

function nearestOtherEndpoint(
  pointX: number,
  pointY: number,
  segment: CorridorSegment,
  segments: CorridorSegment[],
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const other of segments) {
    if (other === segment) continue;
    nearest = Math.min(
      nearest,
      Math.hypot(other.x1 - pointX, other.y1 - pointY),
      Math.hypot(other.x2 - pointX, other.y2 - pointY),
    );
  }
  return nearest;
}

function endpointMeetsDiagonal(pointX: number, pointY: number, diagonals: CorridorSegment[]): boolean {
  return diagonals.some(
    (diagonal) =>
      Math.hypot(diagonal.x1 - pointX, diagonal.y1 - pointY) < ENDPOINT_EPSILON ||
      Math.hypot(diagonal.x2 - pointX, diagonal.y2 - pointY) < ENDPOINT_EPSILON,
  );
}

// Flag-independent: getCorridorGeometry reads straight off the built navmesh, so
// it exercises the navmesh corridor shipping shape.
describe("NavMeshBuilder.getCorridorGeometry", () => {
  it("returns a walkable triangle mesh in game coordinates within map bounds", () => {
    const grid = new Grid(makeBastionMap());
    const builder = new NavMeshBuilder(grid);
    expect(builder.isSuccess()).toBe(true);

    const corridor = builder.getCorridorGeometry();
    expect(corridor).not.toBeNull();
    if (!corridor) throw new Error("expected corridor geometry");

    const { positions, indices } = corridor;
    // Flat (x, y) pairs: even length, and non-empty (walkable tiles produce tris).
    expect(positions.length % 2).toBe(0);
    expect(positions.length).toBeGreaterThan(0);
    // Triangle index list: a whole number of triangles.
    expect(indices.length % 3).toBe(0);
    expect(indices.length).toBeGreaterThan(0);

    const maxX = grid.width * grid.tileSize;
    const maxY = grid.height * grid.tileSize;
    for (let i = 0; i < positions.length; i += 2) {
      const x = positions[i]!;
      const y = positions[i + 1]!;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(maxX);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(maxY);
    }
  });
});

describe("walkable-tile corridor wall outline", () => {
  it("emits chamfered boundary segments packed as a polyline", () => {
    const grid = new Grid(makeBastionMap());
    const segments = buildCorridorSegments(grid);
    expect(segments.length).toBeGreaterThan(0);
    const polyline = corridorSegmentsToPolyline(segments);
    expect(polyline.vertices.length).toBe(segments.length * 4);
    expect(polyline.indices.length).toBe(segments.length * 2);
  });
});

// The diagonal cuboid is centered in the non-walkable quadrant. Its face toward
// the vertex is one half-thickness inside the centerline, and that face is what
// a body swings into. Measure the segment PhysicsWorld builds, not the inset formula.
describe("inside-corner chamfer clearance", () => {
  it("the built diagonal's inner face clears the boss on the 1-wide L", () => {
    const grid = new Grid(makeOneWideCornerMap());
    const tileSize = grid.tileSize;
    const segments = buildCorridorSegments(grid);
    // Southwest corner of path tile (7, 4): the turn. The 3×3 base adds other diagonals.
    const vertexX = 7 * tileSize;
    const vertexY = 5 * tileSize;
    const nearVertex = segments.filter(
      (segment) => isDiagonal(segment) && distancePointToSegment(vertexX, vertexY, segment) < tileSize / 2,
    );
    expect(nearVertex).toHaveLength(1);
    const diagonal = nearVertex[0];
    if (!diagonal) throw new Error("expected the L inside-corner diagonal");

    const innerFace = distancePointToSegment(vertexX, vertexY, diagonal) - corridorWallHalfThicknessWorld(tileSize);
    const bossMeta = ENEMY_TYPES.boss;
    if (!bossMeta) throw new Error("expected boss enemy type");
    const bossRadius = bossMeta.radius * tileSize * 0.5;

    expect(maxGroundEnemyRadiusWorld(tileSize)).toBeGreaterThanOrEqual(bossRadius);
    expect(innerFace).toBeGreaterThan(bossRadius);
    expect(nearestOtherEndpoint(diagonal.x1, diagonal.y1, diagonal, segments)).toBeLessThan(ENDPOINT_EPSILON);
    expect(nearestOtherEndpoint(diagonal.x2, diagonal.y2, diagonal, segments)).toBeLessThan(ENDPOINT_EPSILON);
  });

  it("meets both ends of a peninsula wall with the diagonals", () => {
    const grid = new Grid(makeSerpentineMap());
    const tileSize = grid.tileSize;
    const segments = buildCorridorSegments(grid);
    const diagonals = segments.filter(isDiagonal);
    expect(diagonals.length).toBeGreaterThan(0);
    for (const diagonal of diagonals) {
      expect(nearestOtherEndpoint(diagonal.x1, diagonal.y1, diagonal, segments)).toBeLessThan(ENDPOINT_EPSILON);
      expect(nearestOtherEndpoint(diagonal.x2, diagonal.y2, diagonal, segments)).toBeLessThan(ENDPOINT_EPSILON);
    }

    const bothEndWalls = segments.filter(
      (segment) =>
        !isDiagonal(segment) &&
        endpointMeetsDiagonal(segment.x1, segment.y1, diagonals) &&
        endpointMeetsDiagonal(segment.x2, segment.y2, diagonals),
    );
    expect(bothEndWalls).toHaveLength(2);
    const expectedLength = tileSize - 2 * corridorWallInsetWorld(tileSize);
    expect(expectedLength).toBeGreaterThan(0);
    for (const wall of bothEndWalls) {
      expect(Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1)).toBeCloseTo(expectedLength, 6);
    }
  });
});
