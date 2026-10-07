/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { ThemeMapsOverrideSchema } from "@/content/schemas/maps.js";
import { resolveThemeMaps } from "@/content/themeMaps.js";
import chrithmathRaw from "@/render/themes/data/chrithmath.json";
import aftermathRaw from "@/render/themes/data/the-aftermath.json";
import { MAPS_CONTENT } from "@/sim/Constants.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap, mulberry32 } from "@/sim/grid/Map.js";
import { generateProgressiveMap, legalSites, replayProgressiveBoard } from "@/sim/grid/ProgressiveMap.js";
import {
  buildingCountFor,
  cacheCountFor,
  collectWorldKeys,
  type MapBuildingSite,
  type MapCacheSite,
  playerPlacedBlockCount,
  progressiveSiteChance,
  progressiveStampIndex,
  stampWorldKeysForBlock,
  worldKey,
} from "@/sim/mapSites.js";
import type { BonusOffer } from "@/sim/runBonuses.js";
import { freshEngine, nearestPathDistance, reconcileSample } from "../../helpers/simFixtures";

function chebyshev(left: { tileX: number; tileY: number }, right: { tileX: number; tileY: number }): number {
  return Math.max(Math.abs(left.tileX - right.tileX), Math.abs(left.tileY - right.tileY));
}

// Fills an opening board through reconcileMapSites directly, so every catalog map
// can be checked for its quota without standing up the engine (and the physics
// WASM) once per map.
function fillOpeningBoard(
  index: number,
  catalog?: typeof MAPS_CONTENT,
): { grid: Grid; map: ReturnType<typeof getMap>; buildings: MapBuildingSite[]; caches: MapCacheSite[] } {
  const map = getMap(index, catalog);
  const grid = new Grid(map);
  const buildings: MapBuildingSite[] = [];
  const caches: MapCacheSite[] = [];
  let nextSiteId = 1;
  reconcileSample(grid, map, buildings, caches, null, 0, null, () => nextSiteId++);
  return { grid, map, buildings, caches };
}

// Replays a progressive run the way GameEngine.commitPlacement does: capture the
// previous world keys, grow the rectangle, shift every site index by the returned
// shift, then reconcile against the stamped block's world keys.
function runProgressiveStamps(
  config: { regionId: number; level: number; entryCount: number; seed: number },
  stampCount: number,
  salt = 0,
): {
  grid: Grid;
  map: ReturnType<typeof generateProgressiveMap>;
  buildings: MapBuildingSite[];
  caches: MapCacheSite[];
} {
  const stamps: { templateIndex: number; rotation: number; blockX: number; blockY: number; fill: boolean }[] = [];
  const buildings: MapBuildingSite[] = [];
  const caches: MapCacheSite[] = [];
  let nextSiteId = 1;
  const map = generateProgressiveMap(config, stamps);
  const grid = new Grid(map);
  reconcileSample(grid, map, buildings, caches, null, 0, null, () => nextSiteId++);
  for (let step = 1; step <= stampCount; step++) {
    const replayed = replayProgressiveBoard(config, stamps);
    const options: { templateIndex: number; blockX: number; blockY: number; rotation: number }[] = [];
    for (let templateIndex = 0; templateIndex < replayed.catalog.length; templateIndex++) {
      for (const site of legalSites(replayed.board, replayed.catalog, templateIndex)) {
        options.push({ templateIndex, blockX: site.blockX, blockY: site.blockY, rotation: site.rotation });
      }
    }
    if (options.length === 0) break;
    const rng = mulberry32((config.seed ^ Math.imul(step, 0x9e3779b1) ^ salt) >>> 0);
    const chosen = options[Math.floor(rng() * options.length)];
    if (!chosen) break;
    stamps.push({ ...chosen, fill: false });
    const previousWorldKeys = collectWorldKeys(grid);
    const shift = grid.replaceFromMap(generateProgressiveMap(config, stamps));
    for (const building of buildings) {
      building.tileX += shift.shiftX;
      building.tileY += shift.shiftY;
    }
    for (const cache of caches) {
      cache.tileX += shift.shiftX;
      cache.tileY += shift.shiftY;
    }
    reconcileSample(
      grid,
      { seed: config.seed, regionId: config.regionId, level: config.level, style: "progressive" },
      buildings,
      caches,
      previousWorldKeys,
      progressiveStampIndex(config.entryCount, step),
      stampWorldKeysForBlock(grid, chosen.blockX, chosen.blockY),
      () => nextSiteId++,
    );
  }
  return { grid, map, buildings, caches };
}

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
    expect(progressiveStampIndex(1, 1)).toBe(3);
    expect(progressiveStampIndex(4, 1)).toBe(6);
  });

  it("fills every catalog map to its building and cache quota", () => {
    for (let index = 0; index < 36; index++) {
      const { map, buildings, caches } = fillOpeningBoard(index);
      const buildingTarget = buildingCountFor(map.regionId, map.level);
      const cacheTarget = cacheCountFor(map.regionId, map.level);
      expect(buildings.length).toBe(buildingTarget);
      expect(caches.length).toBe(cacheTarget);
    }
  });

  it("fills every aftermath and chrithmath catalog map to its building and cache quota", () => {
    for (const themeRaw of [aftermathRaw, chrithmathRaw]) {
      const catalog = resolveThemeMaps(ThemeMapsOverrideSchema.parse(themeRaw.maps));
      for (let index = 0; index < catalog.levels.length; index++) {
        const { map, buildings, caches } = fillOpeningBoard(index, catalog);
        const buildingTarget = buildingCountFor(map.regionId, map.level);
        const cacheTarget = cacheCountFor(map.regionId, map.level);
        expect(buildings.length).toBe(buildingTarget);
        expect(caches.length).toBe(cacheTarget);
      }
    }
  });

  it("places 20 buildings and 10 caches on the 30x20 Region 3 Level 12 board", () => {
    const index = 2 * 12 + 11;
    const { map, buildings, caches } = fillOpeningBoard(index);
    expect(map.regionId).toBe(2);
    expect(map.level).toBe(12);
    expect(map.width).toBe(30);
    expect(map.height).toBe(20);
    expect(buildings).toHaveLength(20);
    expect(caches).toHaveLength(10);
  });

  it("holds the clearance ladder guarantees on the boards that have to compress", () => {
    // Index 12 is Region 2 Level 1, a 15x10 board whose cache quota does not fit
    // at the widest rung, so it walks down the cache and cache-to-building ladders.
    const { grid, buildings, caches } = fillOpeningBoard(12);
    expect(buildings.length).toBeGreaterThan(0);
    expect(caches.length).toBeGreaterThan(1);
    for (let index = 0; index < caches.length; index++) {
      const cache = caches[index]!;
      for (let other = index + 1; other < caches.length; other++) {
        expect(chebyshev(cache, caches[other]!)).toBeGreaterThanOrEqual(2);
      }
      expect(nearestPathDistance(grid, cache.tileX, cache.tileY)).toBeGreaterThanOrEqual(2);
      for (const building of buildings) expect(chebyshev(cache, building)).toBeGreaterThanOrEqual(1);
    }
    for (let index = 0; index < buildings.length; index++) {
      for (let other = index + 1; other < buildings.length; other++) {
        expect(chebyshev(buildings[index]!, buildings[other]!)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps every building ring disjoint so one tower tile never stacks two site bonuses", () => {
    // Region 1, map 1 carries enough buildings for the clearance rules to bite.
    const engine = freshEngine(12);
    const grid = engine.grid;
    if (!grid) throw new Error("no grid");
    const buildings = engine.mapBuildings;
    expect(buildings.length).toBeGreaterThan(1);
    for (let index = 0; index < buildings.length; index++) {
      const building = buildings[index]!;
      for (let otherIndex = index + 1; otherIndex < buildings.length; otherIndex++) {
        const other = buildings[otherIndex]!;
        expect(chebyshev(building, other)).toBeGreaterThanOrEqual(3);
      }
    }
    for (let tileY = 0; tileY < grid.height; tileY++) {
      for (let tileX = 0; tileX < grid.width; tileX++) {
        if (!grid.isTerrain(tileX, tileY)) continue;
        let adjacent = 0;
        for (const building of buildings) {
          if (chebyshev({ tileX, tileY }, building) === 1) adjacent++;
        }
        expect(adjacent).toBeLessThanOrEqual(1);
      }
    }
    // A cache may only sit directly beside a building when the board is too small
    // to fit its cache quota any other way. Region 2 Level 1 is the 15x10 board
    // that has to drop to the last rung of the clearance ladder; every larger board
    // holds the cache two tiles clear so the building keeps all eight buffed slots.
    for (const cache of engine.mapCaches) {
      for (const building of buildings) {
        expect(chebyshev(cache, building)).toBeGreaterThanOrEqual(1);
      }
    }
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
    // A placed cache waits locked until the player pays or breaks it open.
    expect(cache.unlocked).toBe(false);
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
    // A stamp past the opening may add one building after the region quota is full.
    expect(cappedBuildings.length).toBeLessThanOrEqual(buildingTarget + 1);
    expect(cappedCaches.length).toBeLessThanOrEqual(cacheTarget);
    expect(cappedBuildings.length).toBeGreaterThanOrEqual(cappedBuildingCount);
    expect(cappedCaches.length).toBeGreaterThanOrEqual(cappedCacheCount);
    // The clearance rules are two-sided: a cache placed on the first board keeps a
    // later stamp from dropping a building next to it, and vice versa.
    for (const cache of cappedCaches) {
      for (const building of cappedBuildings) {
        expect(chebyshev(cache, building)).toBeGreaterThanOrEqual(2);
      }
    }

    const untouchedBuildings: MapBuildingSite[] = [];
    const untouchedCaches: MapCacheSite[] = [];
    reconcileSample(grid, map, untouchedBuildings, untouchedCaches, collectWorldKeys(grid), 20, null, allocateId);
    expect(untouchedBuildings).toHaveLength(0);
    expect(untouchedCaches).toHaveLength(0);
  });

  it("leaves the progressive margin out of the world keys so a stamped block is new world", () => {
    const config = MAPS_CONTENT.progressive.variants[11];
    if (!config) throw new Error("no progressive variant");
    const grid = new Grid(generateProgressiveMap(config, []));
    const keys = collectWorldKeys(grid);
    let voidTiles = 0;
    for (let tileY = 0; tileY < grid.height; tileY++) {
      for (let tileX = 0; tileX < grid.width; tileX++) {
        const isVoid = !grid.isTerrain(tileX, tileY) && !grid.isPath(tileX, tileY);
        if (isVoid) {
          voidTiles++;
          expect(keys.has(worldKey(grid, tileX, tileY))).toBe(false);
        } else expect(keys.has(worldKey(grid, tileX, tileY))).toBe(true);
      }
    }
    expect(voidTiles).toBeGreaterThan(0);
  });

  it("lets a progressive block host a cache beside the corridor and a building beside the base", () => {
    const config = MAPS_CONTENT.progressive.variants[11];
    if (!config) throw new Error("no progressive variant");
    const stamped = runProgressiveStamps(config, 20);
    expect(stamped.caches.length).toBeGreaterThan(0);
    for (const cache of stamped.caches) {
      expect(stamped.grid.isTerrain(cache.tileX, cache.tileY)).toBe(true);
    }
    // The generated profile holds a cache 2 tiles off the corridor and a building 3
    // off a spawn. On a 5x5 block that leaves no legal tile at all, so the
    // progressive profile drops both rings to a direct-collision check.
    const cacheToPath = stamped.caches.map((cache) => nearestPathDistance(stamped.grid, cache.tileX, cache.tileY));
    expect(Math.min(...cacheToPath)).toBe(1);
    const buildingToSpawn = stamped.buildings.map((building) =>
      Math.min(...stamped.grid.spawns.map((spawn) => chebyshev(building, { tileX: spawn.x, tileY: spawn.y }))),
    );
    expect(Math.min(...buildingToSpawn)).toBeLessThan(3);
    for (const building of stamped.buildings) {
      expect(stamped.grid.isTerrain(building.tileX, building.tileY)).toBe(true);
    }
  });

  it("rolls a progressive opening once per block instead of filling the quota", () => {
    const engine = freshEngine(36);
    const map = engine.runState.map;
    if (!map) throw new Error("no map");
    expect(map.style).toBe("progressive");
    const openingBlocks = 1 + (map.entryCount ?? 1);
    expect(engine.mapCaches.length).toBeLessThanOrEqual(openingBlocks);
    expect(engine.mapBuildings.length).toBeLessThanOrEqual(openingBlocks);
    expect(engine.mapCaches.length).toBeLessThanOrEqual(cacheCountFor(map.regionId, map.level));
    expect(engine.mapBuildings.length).toBeLessThanOrEqual(buildingCountFor(map.regionId, map.level));
  });

  it("keeps progressive stamps inside the cache quota without filling the opening", () => {
    const catalogs = [
      MAPS_CONTENT,
      resolveThemeMaps(ThemeMapsOverrideSchema.parse(aftermathRaw.maps)),
      resolveThemeMaps(ThemeMapsOverrideSchema.parse(chrithmathRaw.maps)),
    ];
    for (const catalog of catalogs) {
      for (const config of catalog.progressive.variants) {
        const buildingTarget = buildingCountFor(config.regionId, config.level);
        const cacheTarget = cacheCountFor(config.regionId, config.level);
        const openingBlocks = 1 + config.entryCount;
        const opening = runProgressiveStamps(config, 0);
        expect(opening.buildings.length).toBeLessThanOrEqual(openingBlocks);
        expect(opening.caches.length).toBeLessThanOrEqual(openingBlocks);
        expect(opening.buildings.length).toBeLessThanOrEqual(buildingTarget);
        expect(opening.caches.length).toBeLessThanOrEqual(cacheTarget);
        if (config.regionId === 2 && config.level === 12) {
          expect(opening.buildings.length).toBeLessThan(buildingTarget);
          expect(opening.caches.length).toBeLessThan(cacheTarget);
        }
        for (const salt of [0, 7, 13]) {
          const run = runProgressiveStamps(config, 20, salt);
          expect(run.caches.length).toBeLessThanOrEqual(cacheTarget);
          expect(run.buildings.length).toBeLessThanOrEqual(openingBlocks + 20);
          expect(run.buildings.length).toBeGreaterThanOrEqual(opening.buildings.length);
          if (config.regionId === 0) expect(run.buildings.length).toBeGreaterThan(opening.buildings.length);
        }
      }
    }
  });
});
