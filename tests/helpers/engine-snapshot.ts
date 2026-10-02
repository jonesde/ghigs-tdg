import { GameEngine } from "@/sim/GameEngine.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { createTestPersistState, createTestThemeBundle, MockHostBindings, mockDefaultTheme } from "./mock-stores";

// Shared factory for Tier 1 white-box test cleanup: produce SimulationSnapshots
// only through the sanctioned serializer (buildSnapshot) from a real GameEngine,
// never hand-built wire literals. Internal engine/entity fields may still be set
// as input fixtures — the boundary rule only forbids hand-building the format.

export function createTestEngine(mapIndex = 0): GameEngine {
  const engine = new GameEngine(
    createTestPersistState(),
    createTestThemeBundle(mockDefaultTheme),
    new MockHostBindings(),
    mapIndex,
  );
  engine.loadMap(mapIndex);
  return engine;
}

export function buildTestTower(engine: GameEngine, type = "basic"): Tower {
  const grid = engine.grid;
  if (!grid) throw new Error("engine has no grid; call loadMap first");
  for (let tileX = 0; tileX < grid.width; tileX++) {
    for (let tileY = 0; tileY < grid.height; tileY++) {
      if (grid.canBuild(tileX, tileY)) {
        const tower = engine.towerManager!.build(type, tileX, tileY, engine.persistState, grid);
        if (tower) return tower;
      }
    }
  }
  throw new Error("no buildable tile found");
}

export function selectTestTower(engine: GameEngine, tower: Tower): void {
  engine.selectTowerById(String(tower.id));
}

// Builds real towers into a live engine at the given tile coordinates so tests
// can drive tower navigation through the public snapshot path (Input.ts reads
// getLatestSnapshot().towers) instead of injecting an internal store field.
// Throws if a coordinate is not buildable, so callers must use real buildable
// tiles (callers use real buildable tiles from the loaded map).
export function buildTestTowers(
  engine: GameEngine,
  specs: Array<{ type?: string; tileX: number; tileY: number }>,
): void {
  const grid = engine.grid;
  if (!grid) throw new Error("engine has no grid; call loadMap first");
  for (const spec of specs) {
    const tower = engine.towerManager!.build(spec.type ?? "basic", spec.tileX, spec.tileY, engine.persistState, grid);
    if (!tower) throw new Error(`could not build tower at ${spec.tileX},${spec.tileY}`);
  }
}
