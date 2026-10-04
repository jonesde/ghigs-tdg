import { expect } from "vitest";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import { GameEngine } from "@/sim/GameEngine.js";
import type { Grid } from "@/sim/grid/Grid.js";
import { type MapBuildingSite, type MapCacheSite, reconcileMapSites } from "@/sim/mapSites.js";
import type { BonusId, BonusOffer } from "@/sim/runBonuses.js";
import type { Tower } from "@/sim/towers/Tower.js";
import type { WaveManager } from "@/sim/waves/WaveManager.js";
import { createTestPersistState, createTestThemeBundle, MockHostBindings } from "./mock-stores";

export function freshEngine(mapIndex = 0): GameEngine {
  const engine = new GameEngine(createTestPersistState(), createTestThemeBundle(), new MockHostBindings(), mapIndex);
  engine.loadMap(mapIndex);
  return engine;
}

export function waveManagerOf(engine: GameEngine): WaveManager {
  return engine.waveManager as unknown as WaveManager;
}

export function firstTile(
  grid: Grid,
  accept: (tileX: number, tileY: number) => boolean,
): { x: number; y: number } | null {
  for (let tileY = 0; tileY < grid.height; tileY++) {
    for (let tileX = 0; tileX < grid.width; tileX++) {
      if (accept(tileX, tileY)) return { x: tileX, y: tileY };
    }
  }
  return null;
}

export function pick(engine: GameEngine, bonusId: BonusId): void {
  engine.runState.bonusPicker = {
    source: "drop",
    id: -1,
    offer: [bonusId, "smallPurse", "largePurse"],
    wasPlaying: false,
    specialistType: "basic",
  };
  expect(engine.pickBonus(0)).toBe(true);
}

export function buildBasic(engine: GameEngine): Tower {
  const grid = engine.grid;
  const towers = engine.towerManager;
  if (!grid || !towers) throw new Error("engine has no grid");
  const tile = firstTile(grid, (tileX, tileY) => grid.isTerrain(tileX, tileY) && grid.canBuild(tileX, tileY));
  if (!tile) throw new Error("no buildable terrain");
  const tower = towers.build("basic", tile.x, tile.y, engine.persistState, grid, 0);
  if (!tower) throw new Error("build failed");
  return tower;
}

function chebyshevDistance(leftX: number, leftY: number, rightX: number, rightY: number): number {
  return Math.max(Math.abs(leftX - rightX), Math.abs(leftY - rightY));
}

export function nearestPathDistance(grid: Grid, tileX: number, tileY: number): number {
  let nearest = Infinity;
  for (let scanY = 0; scanY < grid.height; scanY++) {
    for (let scanX = 0; scanX < grid.width; scanX++) {
      if (!grid.isPath(scanX, scanY)) continue;
      const distance = chebyshevDistance(tileX, tileY, scanX, scanY);
      if (distance < nearest) nearest = distance;
    }
  }
  return nearest;
}

export function buildableTileNear(
  grid: Grid,
  tileX: number,
  tileY: number,
  rangeTiles: number,
): { x: number; y: number } | null {
  const cacheWorld = grid.tileToWorld(tileX, tileY);
  const rangePixels = rangeTiles * grid.tileSize;
  let closest: { x: number; y: number; distance: number } | null = null;
  for (let scanY = 0; scanY < grid.height; scanY++) {
    for (let scanX = 0; scanX < grid.width; scanX++) {
      if (!grid.isTerrain(scanX, scanY) || !grid.canBuild(scanX, scanY)) continue;
      const world = grid.tileToWorld(scanX, scanY);
      const deltaX = world.x - cacheWorld.x;
      const deltaY = world.y - cacheWorld.y;
      const distance = Math.hypot(deltaX, deltaY);
      if (distance === 0 || distance > rangePixels) continue;
      if (closest && distance >= closest.distance) continue;
      closest = { x: scanX, y: scanY, distance };
    }
  }
  return closest ? { x: closest.x, y: closest.y } : null;
}

export function pinEnemy(enemy: Enemy, worldX: number, worldY: number): void {
  enemy.x = worldX;
  enemy.y = worldY;
  enemy.centerX = worldX;
  enemy.centerY = worldY;
  enemy.body?.setTranslation({ x: worldX, y: worldY }, true);
  enemy.body?.setLinvel({ x: 0, y: 0 }, true);
}

export function sampleOffer(): BonusOffer {
  return ["sharpened", "smallPurse", "largePurse"];
}

export function reconcileSample(
  grid: Grid,
  map: { seed: number; regionId: number; level: number },
  buildings: MapBuildingSite[],
  caches: MapCacheSite[],
  previousWorldKeys: ReadonlySet<string> | null,
  placedBlocks: number,
  stampWorldKeys: ReadonlySet<string> | null,
  allocateId: () => number,
): void {
  reconcileMapSites({
    grid,
    seed: map.seed,
    regionId: map.regionId,
    mapLevel: map.level,
    buildings,
    caches,
    previousWorldKeys,
    placedBlocks,
    stampWorldKeys,
    allocateId,
    rollOffer: sampleOffer,
  });
}
