import { NavMeshQuery } from "recast-navigation";
import { describe, expect, it } from "vitest";
import { Grid } from "@/sim/grid/Grid.js";
import { toRecast } from "@/sim/navmesh/coords.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { makeMapData } from "../../../helpers/mock-grid.js";
import { orderedPath } from "../../../helpers/navmesh-test-utils.js";

// True when the given game-world point sits over a walkable navmesh poly. Used to
// prove a tower obstacle carves its tile AND that removing it restores walkability.
function isOverPoly(builder: NavMeshBuilder, world: { x: number; y: number }): boolean {
  const navMesh = builder.getNavMesh();
  if (!navMesh) return false;
  const query = new NavMeshQuery(navMesh);
  const halfExtents = { x: 18, y: 18, z: 18 };
  const result = query.findNearestPoly(toRecast(world), { halfExtents });
  return result.success && result.isOverPoly;
}

type TileType = "terrain" | "path" | "base" | "spawn";

// A 1-tile-wide L-shaped corridor (horizontal run then vertical run to base) — the
// riskiest connectivity case, and every interior path tile is a choke that walls
// off the base if a tower is placed there.
function makeOneWideCorridorMap() {
  const width = 9;
  const height = 9;
  const tiles: { type: TileType; height: number }[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: { type: TileType; height: number }[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) {
      row.push({ type: "terrain", height: 1 });
    }
    tiles.push(row);
  }
  for (let colIndex = 0; colIndex < 7; colIndex++) tiles[4]![colIndex]!.type = "path";
  for (let rowIndex = 4; rowIndex < 8; rowIndex++) tiles[rowIndex]![7]!.type = "path";
  return makeMapData({
    width,
    height,
    tiles,
    spawns: [{ x: 0, y: 4 }],
    base: { x: 7, y: 7 },
    regionId: 0,
    level: 1,
    style: "bastion",
  });
}

// A 2-tile-wide horizontal corridor so a single tower obstacle forces a re-route
// around it (the maze tactic) instead of fully walling off the base. Row 4 and row
// 5 are path for the full width; spawn on the left, base on the right.
function makeTwoWideCorridorMap() {
  const width = 9;
  const height = 9;
  const tiles: { type: TileType; height: number }[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: { type: TileType; height: number }[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) {
      row.push({ type: "terrain", height: 1 });
    }
    tiles.push(row);
  }
  for (let colIndex = 0; colIndex < width; colIndex++) {
    tiles[4]![colIndex]!.type = "path";
    tiles[5]![colIndex]!.type = "path";
  }
  return makeMapData({
    width,
    height,
    tiles,
    spawns: [{ x: 0, y: 4 }],
    base: { x: 7, y: 5 },
    regionId: 0,
    level: 1,
    style: "bastion",
  });
}

function spawnBaseWorld(grid: Grid) {
  const spawn = grid.spawns[0]!;
  const base = grid.getBase();
  return { spawnWorld: grid.tileToWorld(spawn.x, spawn.y), baseWorld: grid.tileToWorld(base.x, base.y) };
}

describe("NavMeshBuilder tower obstacles", () => {
  it("places a tower obstacle and re-routes enemies around it", () => {
    const grid = new Grid(makeTwoWideCorridorMap());
    const builder = new NavMeshBuilder(grid);
    expect(builder.isSuccess()).toBe(true);

    const { spawnWorld, baseWorld } = spawnBaseWorld(grid);
    const baselinePath = builder.findPath(spawnWorld, baseWorld);
    expect(baselinePath.length).toBeGreaterThan(0);

    // Drop a tower on row 4 — the corridor is still open via row 5, so enemies
    // must reach the base by routing around the cylinder.
    const obstacleReference = builder.addTowerObstacle(3, 4);
    expect(obstacleReference).not.toBeNull();
    const reroutedPath = builder.findPath(spawnWorld, baseWorld);
    expect(reroutedPath.length).toBeGreaterThan(0);
  });

  it("a choke tower obstacle severs spawn→base on a 1-wide corridor", () => {
    const grid = new Grid(makeOneWideCorridorMap());
    const builder = new NavMeshBuilder(grid);
    expect(builder.isSuccess()).toBe(true);

    const { spawnWorld, baseWorld } = spawnBaseWorld(grid);
    expect(builder.findPath(spawnWorld, baseWorld).length).toBeGreaterThan(0);

    // Path-blocking towers are legal gameplay; the obstacle must cut the corridor
    // so enemies path into / attack the tower instead of walking through it.
    const choke = orderedPath(grid, 0)![3]!;
    expect(builder.addTowerObstacle(choke.x, choke.y)).not.toBeNull();
    expect(builder.findPath(spawnWorld, baseWorld).length).toBe(0);
  });

  it("syncTowers diffs the obstacle set against the live tower set", () => {
    const grid = new Grid(makeTwoWideCorridorMap());
    const builder = new NavMeshBuilder(grid);
    expect(builder.isSuccess()).toBe(true);

    const { spawnWorld, baseWorld } = spawnBaseWorld(grid);

    // No towers yet — no obstacles, corridor open.
    builder.syncTowers([]);
    expect(builder.findPath(spawnWorld, baseWorld).length).toBeGreaterThan(0);

    // Place two towers via sync; the corridor stays reachable (2-wide).
    builder.syncTowers([
      { id: 1, tileX: 2, tileY: 4, isGhost: false },
      { id: 2, tileX: 5, tileY: 4, isGhost: false },
    ]);
    expect(builder.findPath(spawnWorld, baseWorld).length).toBeGreaterThan(0);

    // Sell one tower (drop it from the set) — its obstacle is removed on next sync.
    builder.syncTowers([{ id: 2, tileX: 5, tileY: 4, isGhost: false }]);
    expect(builder.findPath(spawnWorld, baseWorld).length).toBeGreaterThan(0);

    // Ghosted towers do not carry obstacles; syncTowers clears it.
    builder.syncTowers([{ id: 2, tileX: 5, tileY: 4, isGhost: true }]);
    expect(builder.findPath(spawnWorld, baseWorld).length).toBeGreaterThan(0);
  });

  it("removing a tower obstacle restores walkability of that exact tile", () => {
    const grid = new Grid(makeTwoWideCorridorMap());
    const builder = new NavMeshBuilder(grid);
    expect(builder.isSuccess()).toBe(true);

    const obstacleCenter = grid.tileToWorld(3, 4);
    expect(isOverPoly(builder, obstacleCenter)).toBe(true);

    builder.addTowerObstacle(3, 4);
    expect(isOverPoly(builder, obstacleCenter)).toBe(false);

    builder.removeTowerObstacle(3, 4);
    // The carved tile must become walkable again after the obstacle is removed,
    // or selling a tower would permanently sever the maze at runtime.
    expect(isOverPoly(builder, obstacleCenter)).toBe(true);
  });

  it("carves each face of the tile flush with the physics cuboid", () => {
    const grid = new Grid(makeOpenPadMap());
    const builder = new NavMeshBuilder(grid);
    expect(builder.isSuccess()).toBe(true);

    const tileX = 4;
    const tileY = 4;
    expect(builder.addTowerObstacle(tileX, tileY)).not.toBeNull();
    expect(isOverPoly(builder, grid.tileToWorld(tileX, tileY))).toBe(false);

    const center = grid.tileToWorld(tileX, tileY);
    const half = grid.tileSize / 2;
    const faceDirections = [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ];
    for (const direction of faceDirections) {
      const probe = { x: center.x + direction.x * (half + 1), y: center.y + direction.y * (half + 1) };
      const nearest = builder.nearestWalkableWorld(probe);
      expect(nearest).not.toBeNull();
      // One cell of extra carve (the east/south failure) puts this about 9px
      // outside the cuboid. Flush means the probe, 1px outside, is walkable.
      expect(distanceToCuboid(nearest!, center, half)).toBeLessThan(2);
    }

    const cornerProbe = { x: center.x + half + 1, y: center.y + half + 1 };
    const cornerNearest = builder.nearestWalkableWorld(cornerProbe);
    expect(cornerNearest).not.toBeNull();
    expect(distanceToCuboid(cornerNearest!, center, half)).toBeLessThan(grid.tileSize / 8);
    builder.destroy();
  });
});

function distanceToCuboid(point: { x: number; y: number }, center: { x: number; y: number }, half: number): number {
  const deltaX = Math.abs(point.x - center.x) - half;
  const deltaY = Math.abs(point.y - center.y) - half;
  return Math.hypot(Math.max(deltaX, 0), Math.max(deltaY, 0));
}

// Solid walkable pad so a tower in the middle has a path neighbor on every side.
// Spawn and the 3×3 base sit in opposite corners and do not touch the tower tile.
function makeOpenPadMap() {
  const width = 9;
  const height = 9;
  const tiles: { type: TileType; height: number }[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: { type: TileType; height: number }[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) row.push({ type: "path", height: 1 });
    tiles.push(row);
  }
  return makeMapData({
    width,
    height,
    tiles,
    spawns: [{ x: 0, y: 0 }],
    base: { x: 8, y: 8 },
    regionId: 0,
    level: 1,
    style: "bastion",
  });
}
