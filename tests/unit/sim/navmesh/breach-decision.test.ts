import { describe, expect, it } from "vitest";
import {
  type BreachGrid,
  blockersOnThroughPath,
  buildThroughField,
  decideBreach,
} from "@/sim/navmesh/BreachDecision.js";

// `#` path, `B` base, `W` live blocking tower, `.` terrain.
function gridFromRows(rows: string[]): BreachGrid {
  const height = rows.length;
  const width = rows[0]!.length;
  const blocked = new Set<string>();
  for (let tileY = 0; tileY < height; tileY++) {
    for (let tileX = 0; tileX < width; tileX++) {
      if (rows[tileY]![tileX] === "W") blocked.add(`${tileX},${tileY}`);
    }
  }
  return {
    width,
    height,
    blocked,
    inBounds(tileX: number, tileY: number): boolean {
      return tileX >= 0 && tileY >= 0 && tileX < width && tileY < height;
    },
    isPath(tileX: number, tileY: number): boolean {
      const symbol = rows[tileY]?.[tileX];
      return symbol === "#" || symbol === "W";
    },
    isBase(tileX: number, tileY: number): boolean {
      return rows[tileY]?.[tileX] === "B";
    },
    isSpawn(): boolean {
      return false;
    },
  };
}

const BASE_OPTIONS = {
  enemyDamagePerSecond: 4,
  enemySpeedTilesPerSecond: 1,
  hysteresisSeconds: 0,
  currentlySieging: false,
};

describe("buildThroughField", () => {
  it("treats blocked tiles as traversable while the open field does not", () => {
    const grid = gridFromRows(["###W###B"]);
    const through = buildThroughField(grid);
    expect(through[0]![0]).toBe(7);
    expect(through[0]![3]).toBe(4);
    expect(through[0]![7]).toBe(0);
  });

  it("leaves walls of terrain unreachable unlike blocked path tiles", () => {
    const grid = gridFromRows(["##.##B"]);
    const through = buildThroughField(grid);
    expect(through[0]![0]).toBe(-1);
    expect(through[0]![5]).toBe(0);
  });
});

describe("blockersOnThroughPath", () => {
  it("lists the enemy-side wall first on a two-wall series", () => {
    const grid = gridFromRows(["S##WW##B"]);
    const through = buildThroughField(grid);
    expect(blockersOnThroughPath(grid, through, 1, 0)).toEqual([
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it("returns no blockers on a clear through-path", () => {
    const grid = gridFromRows(["#######B"]);
    const through = buildThroughField(grid);
    expect(blockersOnThroughPath(grid, through, 0, 0)).toEqual([]);
  });

  it("includes the start tile when the enemy stands on a tower tile", () => {
    const grid = gridFromRows(["###W##B"]);
    const through = buildThroughField(grid);
    expect(blockersOnThroughPath(grid, through, 3, 0)).toEqual([{ x: 3, y: 0 }]);
  });

  it("returns nothing when the start tile cannot reach the base or is out of bounds", () => {
    const grid = gridFromRows(["##.##B"]);
    const through = buildThroughField(grid);
    expect(blockersOnThroughPath(grid, through, 0, 0)).toEqual([]);
    expect(blockersOnThroughPath(grid, through, -1, 0)).toEqual([]);
  });
});

describe("decideBreach", () => {
  it("sieges a cheap wall on the short leg and detours around an expensive one", () => {
    const cheap = decideBreach({
      ...BASE_OPTIONS,
      openDistanceTiles: 20,
      throughDistanceTiles: 6,
      blockers: [{ tileX: 3, tileY: 0, health: 20, breachable: true }],
    });
    expect(cheap.breachSeconds).toBeCloseTo(5, 6);
    expect(cheap.throughTotalSeconds).toBeCloseTo(11, 6);
    expect(cheap.openWalkSeconds).toBeCloseTo(20, 6);
    expect(cheap.decision).toBe("siege");
    expect(cheap.siegeTile).toEqual({ x: 3, y: 0 });

    const expensive = decideBreach({
      ...BASE_OPTIONS,
      openDistanceTiles: 20,
      throughDistanceTiles: 6,
      blockers: [{ tileX: 3, tileY: 0, health: 200, breachable: true }],
    });
    expect(expensive.decision).toBe("detour");
    expect(expensive.siegeTile).toBeNull();
  });

  it("splits boss and minion DPS on the same wall", () => {
    const blockers = [{ tileX: 3, tileY: 0, health: 200, breachable: true }];
    const boss = decideBreach({
      ...BASE_OPTIONS,
      openDistanceTiles: 20,
      throughDistanceTiles: 6,
      blockers,
      enemyDamagePerSecond: 40,
    });
    const minion = decideBreach({
      ...BASE_OPTIONS,
      openDistanceTiles: 20,
      throughDistanceTiles: 6,
      blockers,
      enemyDamagePerSecond: 2,
    });
    expect(boss.decision).toBe("siege");
    expect(minion.decision).toBe("detour");
  });

  it("sums multi-wall breach costs and keeps enemy-side order for the siege tile", () => {
    const result = decideBreach({
      ...BASE_OPTIONS,
      openDistanceTiles: 40,
      throughDistanceTiles: 8,
      blockers: [
        { tileX: 3, tileY: 0, health: 20, breachable: true },
        { tileX: 4, tileY: 0, health: 12, breachable: true },
      ],
    });
    expect(result.breachSeconds).toBeCloseTo(8, 6);
    expect(result.decision).toBe("siege");
    expect(result.siegeTile).toEqual({ x: 3, y: 0 });
  });

  it("always breaches a sealed open route and never breaches an impossible through route", () => {
    const sealed = decideBreach({
      ...BASE_OPTIONS,
      openDistanceTiles: -1,
      throughDistanceTiles: 6,
      blockers: [{ tileX: 3, tileY: 0, health: 20, breachable: true }],
    });
    expect(sealed.openWalkSeconds).toBe(Number.POSITIVE_INFINITY);
    expect(sealed.decision).toBe("siege");

    const impossible = decideBreach({
      ...BASE_OPTIONS,
      openDistanceTiles: 20,
      throughDistanceTiles: -1,
      blockers: [{ tileX: 3, tileY: 0, health: 20, breachable: true }],
    });
    expect(impossible.decision).toBe("detour");
  });

  it("treats immune towers and zero DPS as impossible through routes", () => {
    const immune = decideBreach({
      ...BASE_OPTIONS,
      openDistanceTiles: -1,
      throughDistanceTiles: 6,
      blockers: [{ tileX: 3, tileY: 0, health: 20, breachable: false }],
    });
    expect(immune.breachSeconds).toBe(Number.POSITIVE_INFINITY);
    expect(immune.decision).toBe("detour");

    const pacifist = decideBreach({
      ...BASE_OPTIONS,
      openDistanceTiles: -1,
      throughDistanceTiles: 6,
      blockers: [{ tileX: 3, tileY: 0, health: 20, breachable: true }],
      enemyDamagePerSecond: 0,
    });
    expect(pacifist.decision).toBe("detour");
  });

  it("detours an open through-path with no blockers", () => {
    const result = decideBreach({ ...BASE_OPTIONS, openDistanceTiles: 10, throughDistanceTiles: 10, blockers: [] });
    expect(result.breachSeconds).toBe(0);
    expect(result.throughTotalSeconds).toBeCloseTo(10, 6);
    expect(result.decision).toBe("detour");
  });

  it("holds the current mode inside the hysteresis band and flips outside it", () => {
    const margin = {
      ...BASE_OPTIONS,
      hysteresisSeconds: 2,
      openDistanceTiles: 10,
      throughDistanceTiles: 6,
      blockers: [{ tileX: 3, tileY: 0, health: 16, breachable: true }],
    };
    expect(decideBreach(margin).decision).toBe("detour");
    expect(decideBreach({ ...margin, currentlySieging: true }).decision).toBe("siege");

    const clearSiegeWin = { ...margin, blockers: [{ tileX: 3, tileY: 0, health: 4, breachable: true }] };
    expect(decideBreach(clearSiegeWin).decision).toBe("siege");
    const clearDetourWin = {
      ...margin,
      currentlySieging: true,
      blockers: [{ tileX: 3, tileY: 0, health: 40, breachable: true }],
    };
    const clearDetourResult = decideBreach(clearDetourWin);
    expect(clearDetourResult.throughTotalSeconds).toBeCloseTo(16, 6);
    expect(clearDetourResult.decision).toBe("detour");
  });
});
