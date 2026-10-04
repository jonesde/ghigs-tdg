/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  buildingCountFor,
  cacheCountFor,
  collectWorldKeys,
  type MapBuildingSite,
  type MapCacheSite,
  playerPlacedBlockCount,
  progressiveSiteChance,
  worldKey,
} from "@/sim/mapSites.js";
import type { BonusOffer } from "@/sim/runBonuses.js";
import { freshEngine, nearestPathDistance, reconcileSample } from "../../helpers/simFixtures";

function chebyshev(left: { tileX: number; tileY: number }, right: { tileX: number; tileY: number }): number {
  return Math.max(Math.abs(left.tileX - right.tileX), Math.abs(left.tileY - right.tileY));
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
    for (const cache of engine.mapCaches) {
      for (const building of buildings) {
        expect(chebyshev(cache, building)).toBeGreaterThanOrEqual(2);
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
    expect(cappedBuildings.length).toBeLessThanOrEqual(buildingTarget);
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
});
