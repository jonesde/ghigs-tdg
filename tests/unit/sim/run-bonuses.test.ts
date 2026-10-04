/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  bossAbilityLabel,
  configureBossAbility,
  minionPulseCount,
  nearerMendBlocks,
  rollBossAbilities,
} from "@/sim/bossAbilities.js";
import { FIXED_DT, GameState, STARTING_BASE_HEALTH } from "@/sim/Constants.js";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import { GameEngine } from "@/sim/GameEngine.js";
import type { Grid } from "@/sim/grid/Grid.js";
import {
  buildingCountFor,
  CACHE_OPEN_GOLD,
  cacheCountFor,
  collectWorldKeys,
  type MapBuildingSite,
  type MapCacheSite,
  playerPlacedBlockCount,
  progressiveSiteChance,
  reconcileMapSites,
  worldKey,
} from "@/sim/mapSites.js";
import type { BonusId, BonusOffer } from "@/sim/runBonuses.js";
import { rollBonusOfferFor } from "@/sim/runBonuses.js";
import type { Tower } from "@/sim/towers/Tower.js";
import type { WaveManager } from "@/sim/waves/WaveManager.js";
import { createTestPersistState, createTestThemeBundle, MockHostBindings } from "../../helpers/mock-stores";

function freshEngine(): GameEngine {
  const engine = new GameEngine(createTestPersistState(), createTestThemeBundle(), new MockHostBindings(), 0);
  engine.loadMap(0);
  return engine;
}

function waveManagerOf(engine: GameEngine): WaveManager {
  return engine.waveManager as unknown as WaveManager;
}

function firstTile(grid: Grid, accept: (tileX: number, tileY: number) => boolean): { x: number; y: number } | null {
  for (let tileY = 0; tileY < grid.height; tileY++) {
    for (let tileX = 0; tileX < grid.width; tileX++) {
      if (accept(tileX, tileY)) return { x: tileX, y: tileY };
    }
  }
  return null;
}

function pick(engine: GameEngine, bonusId: BonusId): void {
  engine.runState.bonusPicker = {
    source: "drop",
    id: -1,
    offer: [bonusId, "smallPurse", "largePurse"],
    wasPlaying: false,
  };
  expect(engine.pickBonus(0)).toBe(true);
}

function buildBasic(engine: GameEngine): Tower {
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

function nearestPathDistance(grid: Grid, tileX: number, tileY: number): number {
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

function buildableTileNear(
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

function pinEnemy(enemy: Enemy, worldX: number, worldY: number): void {
  enemy.x = worldX;
  enemy.y = worldY;
  enemy.centerX = worldX;
  enemy.centerY = worldY;
  enemy.body?.setTranslation({ x: worldX, y: worldY }, true);
  enemy.body?.setLinvel({ x: 0, y: 0 }, true);
}

function sampleOffer(): BonusOffer {
  return ["sharpened", "smallPurse", "largePurse"];
}

function reconcileSample(
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

describe("bonus offers", () => {
  it("draws three distinct cards from the map seed and the package id", () => {
    const first = rollBonusOfferFor(10112, 4);
    const second = rollBonusOfferFor(10112, 4);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(3);
    expect(rollBonusOfferFor(10112, 5)).not.toEqual(first);
  });

  it("stacks persistent cards by multiplication and scales base health with the ratio", () => {
    const engine = freshEngine();
    const tower = buildBasic(engine);
    const unbuffed = tower.stats.damage;
    pick(engine, "sharpened");
    expect(tower.stats.damage / unbuffed).toBeCloseTo(1.1, 5);
    pick(engine, "sharpened");
    expect(engine.runState.runBonuses.damageMult).toBeCloseTo(1.21, 5);
    expect(tower.stats.damage / unbuffed).toBeCloseTo(1.21, 5);

    const healthBefore = engine.runState.baseHealth;
    const maxBefore = engine.runState.maxBaseHealth;
    pick(engine, "fortify");
    expect(engine.runState.maxBaseHealth / maxBefore).toBeCloseTo(1.1, 5);
    expect(engine.runState.baseHealth / engine.runState.maxBaseHealth).toBeCloseTo(healthBefore / maxBefore, 5);
    expect(engine.runState.maxBaseHealth).toBeCloseTo(STARTING_BASE_HEALTH * 1.1, 5);
  });

  it("cuts enemy attack damage before it lands on a tower or the base", () => {
    const engine = freshEngine();
    const tower = buildBasic(engine);
    const attack = { flyingHeight: 0 } as Enemy;
    tower.health = tower.maxHealth;
    tower.takeDamage(100, attack);
    const unarmoredLoss = tower.maxHealth - tower.health;
    tower.health = tower.maxHealth;
    pick(engine, "armor");
    tower.takeDamage(100, attack);
    expect(tower.maxHealth - tower.health).toBeCloseTo(unarmoredLoss * 0.9, 5);

    const base = engine.enemyManager?.baseTarget;
    if (!base) throw new Error("no base");
    const baseBefore = engine.runState.baseHealth;
    base.takeDamage(100, attack);
    expect(baseBefore - engine.runState.baseHealth).toBeCloseTo(90, 5);
  });

  it("pays multiplied kill gold and nothing for a summoned minion", () => {
    const engine = freshEngine();
    const minion = engine.enemyManager?.spawn("minion", 1, 0, 1);
    if (!minion) throw new Error("no minion");
    const listed = minion.bounty || 1;
    const before = engine.runState.gold;
    engine.onEnemyKill(minion);
    expect(engine.runState.gold - before).toBe(listed);

    pick(engine, "bounty");
    const again = engine.runState.gold;
    engine.onEnemyKill(minion);
    expect(engine.runState.gold - again).toBeCloseTo(listed * 1.1, 5);

    minion.summoned = true;
    minion.bounty = 0;
    const held = engine.runState.gold;
    engine.onEnemyKill(minion);
    expect(engine.runState.gold).toBe(held);
  });
});

describe("supply drops and the bonus picker", () => {
  it("drops a package on the death path tile and snaps back onto a path", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    if (!grid) throw new Error("no grid");
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!boss) throw new Error("no boss");
    const path = firstTile(grid, (tileX, tileY) => grid.isPath(tileX, tileY));
    const terrain = firstTile(grid, (tileX, tileY) => grid.isTerrain(tileX, tileY));
    if (!path || !terrain) throw new Error("map has no path");
    const pathWorld = grid.tileToWorld(path.x, path.y);
    boss.x = pathWorld.x;
    boss.y = pathWorld.y;
    engine.onEnemyKill(boss);
    expect(engine.supplyDrops).toHaveLength(1);
    expect(engine.supplyDrops[0]).toMatchObject({ tileX: path.x, tileY: path.y });

    const terrainWorld = grid.tileToWorld(terrain.x, terrain.y);
    boss.x = terrainWorld.x;
    boss.y = terrainWorld.y;
    engine.onEnemyKill(boss);
    const snapped = engine.supplyDrops[1];
    if (!snapped) throw new Error("second drop missing");
    expect(grid.isPath(snapped.tileX, snapped.tileY)).toBe(true);
  });

  it("pauses only when the run was playing, and dismiss leaves the package", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!grid || !boss) throw new Error("no boss");
    engine.onEnemyKill(boss);
    const drop = engine.supplyDrops[0];
    if (!drop) throw new Error("no drop");
    const world = grid.tileToWorld(drop.tileX, drop.tileY);

    engine.runState.state = GameState.PLAYING;
    engine.handleClick(world.x, world.y);
    expect(engine.runState.state).toBe(GameState.PAUSED);
    expect(engine.runState.bonusPicker?.id).toBe(drop.id);
    expect(engine.dismissBonus()).toBe(true);
    expect(engine.runState.state).toBe(GameState.PLAYING);
    expect(engine.supplyDrops).toHaveLength(1);
    expect(engine.runState.bonusPicker).toBeNull();

    engine.runState.state = GameState.PAUSED;
    engine.handleClick(world.x, world.y);
    expect(engine.runState.bonusPicker).not.toBeNull();
    engine.dismissBonus();
    expect(engine.runState.state).toBe(GameState.PAUSED);
    expect(engine.supplyDrops).toHaveLength(1);

    engine.handleClick(world.x, world.y);
    const gold = engine.runState.gold;
    engine.pickBonus(0);
    expect(engine.supplyDrops).toHaveLength(0);
    expect(engine.runState.bonusPicker).toBeNull();
    expect(engine.runState.state).toBe(GameState.PAUSED);
    expect(engine.runState.gold).toBeGreaterThanOrEqual(gold);
  });
});

describe("map sites", () => {
  it("scales building and cache counts with region and level", () => {
    expect(buildingCountFor(0, 1)).toBe(1);
    expect(buildingCountFor(0, 6)).toBe(4);
    expect(buildingCountFor(0, 12)).toBe(7);
    expect(buildingCountFor(1, 1)).toBe(8);
    expect(buildingCountFor(1, 12)).toBe(13);
    expect(buildingCountFor(2, 1)).toBe(14);
    expect(buildingCountFor(2, 12)).toBe(20);
    expect(buildingCountFor(0, 0)).toBe(buildingCountFor(0, 1));
    expect(buildingCountFor(9, 12)).toBe(20);
    expect(cacheCountFor(0, 1)).toBe(1);
    expect(cacheCountFor(0, 6)).toBe(2);
    expect(cacheCountFor(0, 12)).toBe(4);
    expect(cacheCountFor(1, 1)).toBe(4);
    expect(cacheCountFor(1, 12)).toBe(7);
    expect(cacheCountFor(2, 1)).toBe(7);
    expect(cacheCountFor(2, 12)).toBe(10);
    expect(buildingCountFor(0, 6)).toBeGreaterThan(buildingCountFor(0, 1));
    expect(cacheCountFor(0, 12)).toBeGreaterThan(cacheCountFor(0, 1));
    expect(buildingCountFor(1, 6)).toBeGreaterThan(buildingCountFor(0, 6));
    expect(cacheCountFor(2, 1)).toBeGreaterThan(cacheCountFor(1, 1));
    expect(progressiveSiteChance(0)).toBe(0);
    expect(progressiveSiteChance(1)).toBeCloseTo(0.05, 5);
    expect(progressiveSiteChance(10)).toBeCloseTo(0.5, 5);
    expect(progressiveSiteChance(17)).toBeCloseTo(0.85, 5);
    expect(progressiveSiteChance(40)).toBeCloseTo(0.85, 5);
    expect(playerPlacedBlockCount([{ fill: false }, { fill: true }, { fill: false }])).toBe(2);
    expect(CACHE_OPEN_GOLD).toBe(50);
  });

  it("keeps a generated cache on terrain off the path and out of the navmesh", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const map = engine.runState.map;
    if (!grid || !map) throw new Error("no grid");
    expect(engine.mapBuildings.length).toBeGreaterThan(0);
    expect(engine.mapCaches.length).toBeGreaterThan(0);
    expect(engine.mapBuildings.length).toBeLessThanOrEqual(buildingCountFor(map.regionId, map.level));
    expect(engine.mapCaches.length).toBeLessThanOrEqual(cacheCountFor(map.regionId, map.level));
    const cache = engine.mapCaches[0];
    if (!cache) throw new Error("no cache");
    expect(grid.isTerrain(cache.tileX, cache.tileY)).toBe(true);
    expect(grid.canBuild(cache.tileX, cache.tileY)).toBe(false);
    expect(grid.blocked.has(`${cache.tileX},${cache.tileY}`)).toBe(false);
    expect(nearestPathDistance(grid, cache.tileX, cache.tileY)).toBeGreaterThanOrEqual(2);
  });

  it("spends 50 gold when a cache card is taken and nothing when the offer is declined", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const cache = engine.mapCaches[0];
    if (!grid || !cache) throw new Error("no cache");
    const world = grid.tileToWorld(cache.tileX, cache.tileY);
    const host = engine.host as MockHostBindings;
    engine.runState.state = GameState.PLAYING;
    engine.runState.gold = CACHE_OPEN_GOLD - 1;
    engine.handleClick(world.x, world.y);
    expect(engine.runState.bonusPicker).toBeNull();
    expect(engine.runState.gold).toBe(CACHE_OPEN_GOLD - 1);
    expect(engine.runState.state).toBe(GameState.PLAYING);
    expect(
      host.uiEvents.some(
        (event) => event.type === "showNotification" && event.message === "50 gold is required to open a cache.",
      ),
    ).toBe(true);

    engine.runState.gold = CACHE_OPEN_GOLD;
    engine.handleClick(world.x, world.y);
    expect(engine.runState.bonusPicker?.source).toBe("cache");
    expect(engine.runState.state).toBe(GameState.PAUSED);
    expect(engine.dismissBonus()).toBe(true);
    expect(engine.runState.gold).toBe(CACHE_OPEN_GOLD);
    expect(engine.mapCaches.some((site) => site.id === cache.id)).toBe(true);
    expect(engine.runState.state).toBe(GameState.PLAYING);
    expect(grid.canBuild(cache.tileX, cache.tileY)).toBe(false);

    engine.handleClick(world.x, world.y);
    const picker = engine.runState.bonusPicker;
    if (!picker) throw new Error("picker did not open");
    engine.runState.gold = CACHE_OPEN_GOLD - 1;
    expect(engine.pickBonus(0)).toBe(false);
    expect(engine.runState.bonusPicker?.id).toBe(cache.id);
    expect(engine.mapCaches.some((site) => site.id === cache.id)).toBe(true);
    expect(engine.runState.gold).toBe(CACHE_OPEN_GOLD - 1);

    engine.runState.gold = CACHE_OPEN_GOLD;
    picker.offer = sampleOffer();
    expect(engine.pickBonus(0)).toBe(true);
    expect(engine.runState.gold).toBe(0);
    expect(engine.runState.runBonuses.damageMult).toBeCloseTo(1.1, 5);
    expect(engine.mapCaches.some((site) => site.id === cache.id)).toBe(false);
    expect(grid.canBuild(cache.tileX, cache.tileY)).toBe(true);
    expect(engine.runState.state).toBe(GameState.PLAYING);

    const dropEngine = freshEngine();
    const dropGrid = dropEngine.grid;
    const boss = dropEngine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!dropGrid || !boss) throw new Error("no boss");
    dropEngine.onEnemyKill(boss);
    const drop = dropEngine.supplyDrops[0];
    if (!drop) throw new Error("no drop");
    const dropWorld = dropGrid.tileToWorld(drop.tileX, drop.tileY);
    const goldBeforeDrop = dropEngine.runState.gold;
    dropEngine.runState.state = GameState.PLAYING;
    dropEngine.handleClick(dropWorld.x, dropWorld.y);
    const dropPicker = dropEngine.runState.bonusPicker;
    if (!dropPicker) throw new Error("drop picker did not open");
    dropPicker.offer = sampleOffer();
    expect(dropEngine.pickBonus(0)).toBe(true);
    expect(dropEngine.runState.gold).toBe(goldBeforeDrop);
    expect(dropEngine.supplyDrops).toHaveLength(0);
    expect(dropEngine.runState.runBonuses.damageMult).toBeCloseTo(1.1, 5);
  });

  it("lets an idle tower break a cache and leaves the cache alone while an enemy is in range", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const towers = engine.towerManager;
    const cache = engine.mapCaches[0];
    if (!grid || !towers || !cache) throw new Error("no cache");
    const tile = buildableTileNear(grid, cache.tileX, cache.tileY, 2.5);
    if (!tile) throw new Error("no tower tile in range of the cache");
    const tower = towers.build("basic", tile.x, tile.y, engine.persistState, grid, 0);
    if (!tower) throw new Error("build failed");
    const minion = engine.enemyManager?.spawn("minion", 1, 0, 1);
    if (!minion) throw new Error("no minion");
    minion.attackDamage = 0;
    minion.hp = 100000;
    minion.maxHp = 100000;
    waveManagerOf(engine).advanceHeld = true;
    const beside = grid.tileToWorld(tower.tileX, tower.tileY);
    const besideX = beside.x + grid.tileSize * 0.4;
    const healthAtStart = cache.hp;
    const goldAtStart = engine.runState.gold;
    const shotDamage = tower.stats.damage;
    // A cache shot fired on the first tick would land inside this window. Pinning
    // the minion keeps it inside range, so the tower keeps firing at the minion.
    for (let frame = 0; frame < 90; frame++) {
      pinEnemy(minion, besideX, beside.y);
      engine.update(FIXED_DT);
    }
    expect(cache.hp).toBe(healthAtStart);
    expect(engine.runState.gold).toBe(goldAtStart);

    const far = firstTile(grid, (tileX, tileY) => {
      const world = grid.tileToWorld(tileX, tileY);
      return Math.hypot(world.x - tower.x, world.y - tower.y) > grid.tileSize * 6;
    });
    if (!far) throw new Error("no tile outside tower range");
    const farWorld = grid.tileToWorld(far.x, far.y);
    tower.cooldown = 0;
    let healthDropped = false;
    for (let frame = 0; frame < 120 && !healthDropped; frame++) {
      pinEnemy(minion, farWorld.x, farWorld.y);
      engine.update(FIXED_DT);
      if (cache.hp < healthAtStart) healthDropped = true;
    }
    expect(healthDropped).toBe(true);
    expect(healthAtStart - cache.hp).toBeCloseTo(shotDamage, 5);
    expect(engine.runState.gold).toBe(goldAtStart);

    cache.hp = shotDamage;
    tower.cooldown = 0;
    for (let frame = 0; frame < 120 && engine.mapCaches.some((site) => site.id === cache.id); frame++) {
      pinEnemy(minion, farWorld.x, farWorld.y);
      engine.update(FIXED_DT);
    }
    expect(engine.mapCaches.some((site) => site.id === cache.id)).toBe(false);
    expect(engine.runState.gold).toBe(goldAtStart);
    expect(grid.canBuild(cache.tileX, cache.tileY)).toBe(true);
    const rebuilt = towers.build("basic", cache.tileX, cache.tileY, engine.persistState, grid, 0);
    expect(rebuilt).toBeTruthy();
  });

  it("fills the opening board to the target and stamps later blocks without passing it", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const map = engine.runState.map;
    if (!grid || !map) throw new Error("no map");
    const buildingTarget = buildingCountFor(map.regionId, map.level);
    const cacheTarget = cacheCountFor(map.regionId, map.level);
    const buildings: MapBuildingSite[] = [];
    const caches: MapCacheSite[] = [];
    let nextSiteId = 1;
    const allocateId = (): number => nextSiteId++;
    reconcileSample(grid, map, buildings, caches, null, 0, null, allocateId);
    expect(buildings.length).toBeGreaterThan(0);
    expect(caches.length).toBeGreaterThan(0);
    expect(buildings.length).toBeLessThanOrEqual(buildingTarget);
    expect(caches.length).toBeLessThanOrEqual(cacheTarget);
    const filledBuildings = buildings.map((building) => ({ ...building }));
    const filledCaches = caches.map((cache) => ({ ...cache, offer: [...cache.offer] as BonusOffer }));
    nextSiteId = 1;
    const againBuildings: MapBuildingSite[] = [];
    const againCaches: MapCacheSite[] = [];
    reconcileSample(grid, map, againBuildings, againCaches, null, 99, null, allocateId);
    expect(againBuildings).toEqual(filledBuildings);
    expect(againCaches).toEqual(filledCaches);

    const previousWorldKeys = new Set<string>();
    const stampWorldKeys = new Set<string>();
    for (let tileY = 0; tileY < grid.height; tileY++) {
      for (let tileX = 0; tileX < grid.width; tileX++) {
        const key = worldKey(grid, tileX, tileY);
        if (tileX < Math.floor(grid.width / 2)) previousWorldKeys.add(key);
        else stampWorldKeys.add(key);
      }
    }
    const stampedBuildings: MapBuildingSite[] = [];
    const stampedCaches: MapCacheSite[] = [];
    nextSiteId = 1;
    reconcileSample(grid, map, stampedBuildings, stampedCaches, previousWorldKeys, 0, stampWorldKeys, allocateId);
    expect(stampedBuildings).toHaveLength(0);
    expect(stampedCaches).toHaveLength(0);

    nextSiteId = 1;
    reconcileSample(grid, map, stampedBuildings, stampedCaches, previousWorldKeys, 20, stampWorldKeys, allocateId);
    expect(stampedBuildings.length).toBeLessThanOrEqual(1);
    expect(stampedCaches.length).toBeLessThanOrEqual(1);
    expect(stampedBuildings.length).toBeLessThanOrEqual(buildingTarget);
    expect(stampedCaches.length).toBeLessThanOrEqual(cacheTarget);
    for (const building of stampedBuildings) {
      const key = worldKey(grid, building.tileX, building.tileY);
      expect(stampWorldKeys.has(key)).toBe(true);
      expect(previousWorldKeys.has(key)).toBe(false);
    }
    for (const cache of stampedCaches) {
      const key = worldKey(grid, cache.tileX, cache.tileY);
      expect(stampWorldKeys.has(key)).toBe(true);
      expect(previousWorldKeys.has(key)).toBe(false);
      expect(nearestPathDistance(grid, cache.tileX, cache.tileY)).toBeGreaterThanOrEqual(2);
    }
    const firstBuildings = stampedBuildings.map((building) => ({ ...building }));
    const firstCaches = stampedCaches.map((cache) => ({ ...cache, offer: [...cache.offer] as BonusOffer }));
    stampedBuildings.length = 0;
    stampedCaches.length = 0;
    nextSiteId = 1;
    reconcileSample(grid, map, stampedBuildings, stampedCaches, previousWorldKeys, 20, stampWorldKeys, allocateId);
    expect(stampedBuildings).toEqual(firstBuildings);
    expect(stampedCaches).toEqual(firstCaches);

    const cappedBuildings = filledBuildings.map((building) => ({ ...building }));
    const cappedCaches = filledCaches.map((cache) => ({ ...cache, offer: [...cache.offer] as BonusOffer }));
    const cappedBuildingCount = cappedBuildings.length;
    const cappedCacheCount = cappedCaches.length;
    reconcileSample(grid, map, cappedBuildings, cappedCaches, previousWorldKeys, 20, stampWorldKeys, allocateId);
    expect(cappedBuildings.length).toBeLessThanOrEqual(buildingTarget);
    expect(cappedCaches.length).toBeLessThanOrEqual(cacheTarget);
    expect(cappedBuildings.length).toBeGreaterThanOrEqual(cappedBuildingCount);
    expect(cappedCaches.length).toBeGreaterThanOrEqual(cappedCacheCount);

    const untouchedBuildings: MapBuildingSite[] = [];
    const untouchedCaches: MapCacheSite[] = [];
    reconcileSample(grid, map, untouchedBuildings, untouchedCaches, collectWorldKeys(grid), 20, null, allocateId);
    expect(untouchedBuildings).toHaveLength(0);
    expect(untouchedCaches).toHaveLength(0);
  });
});

describe("boss abilities", () => {
  it("does not consume the wave composition stream", () => {
    const first = freshEngine();
    const second = freshEngine();
    const planned = waveManagerOf(first).generateWave(10);
    waveManagerOf(first).queue.push(...planned);
    first.onWaveStart(10);
    const other = waveManagerOf(second).generateWave(10);
    expect(other.map((entry) => [entry.type, entry.level, entry.delay])).toEqual(
      planned.map((entry) => [entry.type, entry.level, entry.delay]),
    );
    const bosses = waveManagerOf(first).queue.filter((entry) => entry.type === "boss");
    expect(bosses.length).toBeGreaterThan(0);
    expect(bosses.every((entry) => entry.bossAbility !== undefined)).toBe(true);
    expect(other.every((entry) => entry.bossAbility === undefined)).toBe(true);
  });

  it("gives the first boss of a run no ability and draws the rest without replacement", () => {
    const vanilla = rollBossAbilities(10112, 10, 4, true);
    expect(vanilla[0]).toBe("none");
    expect(new Set(vanilla.slice(1)).size).toBe(3);
    expect(vanilla.slice(1).includes("none")).toBe(false);
    const drawn = rollBossAbilities(10112, 20, 4, false);
    expect(new Set(drawn).size).toBe(4);
    expect(drawn.includes("none")).toBe(false);
    expect(bossAbilityLabel("healAura")).toBe("Mend");
  });

  it("emits capped minions at the boss with no bounty", () => {
    expect(minionPulseCount(10, 0, 100)).toBe(5);
    expect(minionPulseCount(16, 0, 100)).toBe(8);
    expect(minionPulseCount(10, 97, 100)).toBe(3);
    expect(minionPulseCount(10, 100, 100)).toBe(0);

    const engine = freshEngine();
    const grid = engine.grid;
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!grid || !boss || !engine.waveManager) throw new Error("no boss");
    engine.waveManager.currentWave = 10;
    configureBossAbility(boss, "spawnMinions", grid.tileSize);
    boss.minionTimer = FIXED_DT;
    const farPath = firstTile(grid, (tileX, tileY) => {
      if (!grid.isPath(tileX, tileY)) return false;
      const world = grid.tileToWorld(tileX, tileY);
      return Math.hypot(world.x - boss.x, world.y - boss.y) > grid.tileSize * 4;
    });
    if (!farPath) throw new Error("no distant path");
    const destination = grid.tileToWorld(farPath.x, farPath.y);
    boss.x = destination.x;
    boss.y = destination.y;
    const pendingBefore = engine.enemyManager?.getTotalPendingCount() ?? 0;
    engine.update(FIXED_DT);
    const minions = (engine.enemyManager?.enemies ?? []).filter((enemy) => enemy !== boss && enemy.type === "minion");
    expect(minions).toHaveLength(5);
    for (const minion of minions) {
      expect(minion.bounty).toBe(0);
      expect(minion.summoned).toBe(true);
      expect(Math.hypot(minion.x - destination.x, minion.y - destination.y)).toBeLessThan(grid.tileSize);
    }
    expect(engine.enemyManager?.getTotalPendingCount()).toBe(pendingBefore);
  });

  it("lets the nearer Mend source heal and suppresses a farther one", () => {
    const source = { id: 1, x: 0, y: 0, removed: false, healSelf: true, antiHealTimer: 0 };
    const ally = { id: 2, x: 10, y: 0, removed: false, healSelf: false, antiHealTimer: 0 };
    const nearer = { id: 3, x: 9, y: 0, removed: false, healSelf: true, antiHealTimer: 0 };
    expect(nearerMendBlocks(source, ally, [source, ally, nearer])).toBe(true);
    expect(nearerMendBlocks(nearer, ally, [source, ally, nearer])).toBe(false);

    const engine = freshEngine();
    const grid = engine.grid;
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!grid || !boss || !engine.enemyManager) throw new Error("no boss");
    configureBossAbility(boss, "healAura", grid.tileSize);
    boss.mendSuppresses = (mendSource, mendAlly) =>
      nearerMendBlocks(mendSource, mendAlly, engine.enemyManager?.enemies ?? []);
    boss.hp = boss.maxHp * 0.5;
    engine.update(FIXED_DT);
    engine.update(FIXED_DT);
    expect(boss.hp).toBeGreaterThan(boss.maxHp * 0.5);
    const healed = boss.hp;
    boss.antiHealTimer = 5;
    engine.update(FIXED_DT);
    expect(boss.hp).toBeCloseTo(healed, 5);
  });

  it("hastens the boss by 1.2 and other enemies in range by 1.5", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    const near = engine.enemyManager?.spawn("minion", 1, 0, 10);
    const far = engine.enemyManager?.spawn("minion", 1, 0, 10);
    if (!grid || !boss || !near || !far) throw new Error("no enemies");
    configureBossAbility(boss, "speedAura", grid.tileSize);
    near.x = boss.x;
    near.y = boss.y;
    far.x = boss.x + grid.tileSize * 10;
    far.y = boss.y;
    engine.update(FIXED_DT);
    expect(boss.hasteFactor).toBeCloseTo(1.2, 5);
    expect(near.hasteFactor).toBeCloseTo(1.5, 5);
    expect(far.hasteFactor).toBe(1);
  });
});
