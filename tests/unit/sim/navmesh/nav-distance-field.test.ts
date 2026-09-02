import { beforeAll, describe, expect, it } from "vitest";
import { Grid } from "@/sim/grid/Grid.js";
import { NavDistanceField } from "@/sim/navmesh/NavDistanceField.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { initNavMesh } from "@/sim/navmesh/recastContext.js";
import { makeBastionMap } from "../../../helpers/mock-grid.js";

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
});
