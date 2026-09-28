import type { Vector3 } from "recast-navigation";
import { describe, expect, it } from "vitest";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { makeBastionMap, makeMapData } from "../../../helpers/mock-grid.js";

type TileType = "terrain" | "path" | "base" | "spawn";

// A synthetic L-shaped 1-tile-wide corridor: a horizontal run, then a vertical run
// to the base. This is the riskiest tuning case (1-wide connectivity with a bend).
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

// A large contiguous open field of walkable tiles (no thin corridors) so the
// navmesh is built over an arbitrary connected polygon and must connect spawn to
// base across open space — the "more options" payoff of a real mesh.
function makeOpenFieldMap() {
  const width = 12;
  const height = 10;
  const tiles: { type: TileType; height: number }[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: { type: TileType; height: number }[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) {
      row.push({ type: "path", height: 1 });
    }
    tiles.push(row);
  }
  return makeMapData({
    width,
    height,
    tiles,
    spawns: [{ x: 0, y: 0 }],
    base: { x: width - 1, y: height - 1 },
    regionId: 0,
    level: 1,
    style: "open",
  });
}

function worldVector(grid: Grid, tileX: number, tileY: number): Vector3 {
  const center = grid.tileToWorld(tileX, tileY);
  return { x: center.x, y: center.y, z: 0 };
}

function connectivityPath(grid: Grid): { x: number; y: number }[] {
  const builder = new NavMeshBuilder(grid);
  expect(builder.isSuccess()).toBe(true);
  const start = grid.spawns[0];
  const base = grid.getBase();
  if (!start || !base) throw new Error("map missing spawn or base");
  return builder.findPath(worldVector(grid, start.x, start.y), worldVector(grid, base.x, base.y));
}

describe("NavMeshBuilder", () => {
  it("builds a connected navmesh over a known map (getMap(0))", () => {
    const grid = new Grid(getMap(0));
    const path = connectivityPath(grid);
    expect(path.length).toBeGreaterThan(0);
  });

  it("builds and connects a 1-wide corridor (bastion)", () => {
    const grid = new Grid(makeBastionMap());
    const path = connectivityPath(grid);
    expect(path.length).toBeGreaterThan(0);
  });

  it("keeps a synthetic 1-wide L-shaped corridor navigable (bend gate)", () => {
    const grid = new Grid(makeOneWideCorridorMap());
    const path = connectivityPath(grid);
    expect(path.length).toBeGreaterThan(0);
  });

  it("keeps the 1-wide L-corridor navigable with no voxel erosion", () => {
    // walkableRadius is 0. One voxel of erosion severs this bend. This guards
    // that the generator stays at 0 so spawn can still reach the base.
    const grid = new Grid(makeOneWideCorridorMap());
    const builder = new NavMeshBuilder(grid);
    expect(builder.isSuccess()).toBe(true);
    const start = grid.spawns[0];
    const base = grid.getBase();
    if (!start || !base) throw new Error("map missing spawn or base");
    const path = builder.findPath(worldVector(grid, start.x, start.y), worldVector(grid, base.x, base.y));
    expect(path.length).toBeGreaterThan(0);
  });

  it("builds successfully over an open-area map and connects spawn to base", () => {
    const grid = new Grid(makeOpenFieldMap());
    const path = connectivityPath(grid);
    expect(path.length).toBeGreaterThan(0);
  });

  it("returns a polyline whose endpoints bracket start and goal", () => {
    const grid = new Grid(makeBastionMap());
    const path = connectivityPath(grid);
    const start = grid.tileToWorld(grid.spawns[0]!.x, grid.spawns[0]!.y);
    const base = grid.tileToWorld(grid.getBase().x, grid.getBase().y);
    const first = path[0]!;
    const last = path[path.length - 1]!;
    expect(Math.hypot(first.x - start.x, first.y - start.y)).toBeLessThan(grid.tileSize);
    expect(Math.hypot(last.x - base.x, last.y - base.y)).toBeLessThan(grid.tileSize);
  });

  it("returns an empty path when spawn and base regions are disconnected", () => {
    const width = 10;
    const height = 10;
    const tiles: { type: TileType; height: number }[][] = [];
    for (let rowIndex = 0; rowIndex < height; rowIndex++) {
      const row: { type: TileType; height: number }[] = [];
      for (let colIndex = 0; colIndex < width; colIndex++) {
        row.push({ type: "terrain", height: 1 });
      }
      tiles.push(row);
    }
    // Isolated spawn tile, separated from the base by terrain.
    tiles[0]![0]!.type = "path";
    const grid = new Grid(
      makeMapData({
        width,
        height,
        tiles,
        spawns: [{ x: 0, y: 0 }],
        base: { x: width - 1, y: height - 1 },
        regionId: 0,
        level: 1,
        style: "bastion",
      }),
    );
    const builder = new NavMeshBuilder(grid);
    expect(builder.isSuccess()).toBe(true);
    const start = grid.spawns[0]!;
    const base = grid.getBase();
    const path = builder.findPath(worldVector(grid, start.x, start.y), worldVector(grid, base.x, base.y));
    expect(path).toEqual([]);
  });
});
