import { beforeAll, describe, expect, it } from "vitest";
import { Grid } from "@/sim/grid/Grid.js";
import { NavDistanceField } from "@/sim/navmesh/NavDistanceField.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { initNavMesh } from "@/sim/navmesh/recastContext.js";
import { makeBastionMap } from "../../../helpers/mock-grid.js";

// `#` path, `S` spawn, `B` base, `W` path tile registered as a live tower, `.` terrain.
function gridFromRows(rows: string[], spawn: { x: number; y: number }, base: { x: number; y: number }): Grid {
  const height = rows.length;
  const width = rows[0]!.length;
  const tiles = rows.map((row) =>
    [...row].map((symbol) => {
      const type = symbol === "B" ? "base" : symbol === "S" ? "spawn" : symbol === "." ? "terrain" : "path";
      return { type, height: 1 };
    }),
  );
  const grid = new Grid({ width, height, tiles, spawns: [spawn], base });
  for (let tileY = 0; tileY < height; tileY++) {
    for (let tileX = 0; tileX < width; tileX++) {
      if (rows[tileY]![tileX] === "W") grid.registerTower(tileX, tileY);
    }
  }
  return grid;
}

beforeAll(async () => {
  await initNavMesh();
});

describe("NavDistanceField", () => {
  it("distance to base is 0 on base tiles and increases along the path", () => {
    const grid = new Grid(makeBastionMap());
    const field = new NavDistanceField(grid, null);
    field.rebuild();
    const base = grid.getBase();
    expect(field.getDistanceToBase(base.x, base.y)).toBe(0);
    const spawn = grid.spawns[0]!;
    const spawnDistance = field.getDistanceToBase(spawn.x, spawn.y);
    expect(spawnDistance).toBeGreaterThan(0);
  });

  it("blocked path tiles are unreachable (-1) in the field", () => {
    const grid = new Grid(makeBastionMap());
    const spawn = grid.spawns[0]!;
    const base = grid.getBase();
    // Block a mid-path tile on the bastion straight corridor.
    const midX = Math.floor((spawn.x + base.x) / 2);
    const midY = spawn.y;
    expect(grid.isPath(midX, midY)).toBe(true);
    grid.registerTower(midX, midY);

    const field = new NavDistanceField(grid, null);
    field.rebuild();
    expect(field.getDistanceToBase(midX, midY)).toBe(-1);
    // Spawn side may still be reachable if not fully severed on multi-path maps;
    // on bastion single path, spawn becomes unreachable from base BFS.
    expect(field.getDistanceToBase(spawn.x, spawn.y)).toBe(-1);
  });

  it("path metrics mark spawn reachable when corridor is open", () => {
    const grid = new Grid(makeBastionMap());
    const builder = new NavMeshBuilder(grid);
    const field = new NavDistanceField(grid, builder);
    field.rebuild();
    expect(field.isSpawnReachable(0)).toBe(true);
    const metrics = field.getPathMetrics();
    expect(metrics[0]!.reachable).toBe(true);
    expect(metrics[0]!.pathLengthWorld).toBeGreaterThan(0);
    builder.destroy();
  });

  it("spawn reachability follows Recast findPath, not the tile BFS fallback", () => {
    const grid = new Grid(makeBastionMap());
    const spawn = grid.spawns[0]!;
    const base = grid.getBase();
    const midX = Math.floor((spawn.x + base.x) / 2);
    const midY = spawn.y;
    grid.registerTower(midX, midY);
    const builder = new NavMeshBuilder(grid);
    builder.addTowerObstacle(midX, midY);
    const field = new NavDistanceField(grid, builder);
    field.rebuild();
    expect(field.isSpawnReachable(0)).toBe(false);
    expect(field.getPathMetrics()[0]!.pathLengthWorld).toBe(0);
    builder.destroy();
  });

  it("aims a sealed return lane at the wall face, not the tile nearest the base", () => {
    // Outbound row 0, drop at x=6, return row 2 sealed by walls, down the left into the base.
    const grid = gridFromRows(
      ["S######.", "......#.", "WWWWWW#.", "#.......", "##B.....", "........"],
      { x: 0, y: 0 },
      { x: 2, y: 4 },
    );
    const field = new NavDistanceField(grid, null);
    field.rebuild();

    expect(field.getDistanceToBase(2, 0)).toBe(-1);
    const aboveBase = field.getBlockedApproach(2, 0);
    expect(aboveBase).not.toBeNull();
    expect(aboveBase!.siegeTile).toEqual({ x: 5, y: 2 });
    expect(aboveBase!.approachTile).toEqual({ x: 6, y: 2 });
    expect(aboveBase!.approachTile).not.toEqual({ x: 2, y: 0 });

    const approachCenter = grid.tileToWorld(6, 2);
    const siegeCenter = grid.tileToWorld(5, 2);
    const faceDistance = Math.hypot(
      aboveBase!.approachWorld.x - approachCenter.x,
      aboveBase!.approachWorld.y - approachCenter.y,
    );
    const siegeDistance = Math.hypot(
      aboveBase!.approachWorld.x - siegeCenter.x,
      aboveBase!.approachWorld.y - siegeCenter.y,
    );
    expect(faceDistance).toBeLessThan(grid.tileSize / 2);
    expect(siegeDistance).toBeGreaterThan(grid.tileSize / 2);
    expect(aboveBase!.approachWorld.x).toBeLessThan(approachCenter.x);

    expect(field.getDistanceToBase(0, 3)).toBeGreaterThanOrEqual(0);
    expect(field.getBlockedApproach(0, 3)).toBeNull();
    expect(field.getBlockedApproach(2, 4)).toBeNull();
  });

  it("a second wall in series is the one that touches the enemy, not the base", () => {
    const grid = gridFromRows(["S##WW#B"], { x: 0, y: 0 }, { x: 6, y: 0 });
    const field = new NavDistanceField(grid, null);
    field.rebuild();

    const enemySide = field.getBlockedApproach(2, 0);
    expect(enemySide).not.toBeNull();
    expect(enemySide!.siegeTile).toEqual({ x: 3, y: 0 });
    expect(enemySide!.approachTile).toEqual({ x: 2, y: 0 });
    expect(field.getBlockedApproach(0, 0)!.siegeTile).toEqual({ x: 3, y: 0 });

    expect(field.getDistanceToBase(5, 0)).toBeGreaterThanOrEqual(0);
    expect(field.getBlockedApproach(5, 0)).toBeNull();
  });

  it("clearing the seal restores a path to the base and drops the approach", () => {
    const grid = gridFromRows(
      ["S######.", "......#.", "WWWWWW#.", "#.......", "##B.....", "........"],
      { x: 0, y: 0 },
      { x: 2, y: 4 },
    );
    const field = new NavDistanceField(grid, null);
    field.rebuild();
    expect(field.getDistanceToBase(2, 0)).toBe(-1);

    for (let tileX = 0; tileX <= 5; tileX++) grid.unregisterTower(tileX, 2);
    field.rebuild();

    expect(field.getDistanceToBase(2, 0)).toBeGreaterThanOrEqual(0);
    expect(field.getBlockedApproach(2, 0)).toBeNull();
  });
});
