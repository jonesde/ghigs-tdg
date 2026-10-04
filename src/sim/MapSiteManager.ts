import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { Grid } from "@/sim/grid/Grid.js";
import {
  type MapBuildingSite,
  type MapCacheSite,
  nearestPathTile,
  PACKAGE_CLICK_RADIUS_TILES,
  reconcileMapSites,
  type SupplyDropSite,
} from "@/sim/mapSites.js";
import { rollBonusOfferFor } from "@/sim/runBonuses.js";

export type SiteSource = "drop" | "cache";

export interface MapSiteSource {
  readonly seed: number;
  readonly regionId: number;
  readonly level: number;
}

// Owns the board's claimable sites: which tiles hold a building, an unopened
// cache, or a supply package, and which tiles are therefore reserved against
// construction. It knows nothing about what a site offers or what claiming one
// costs, so the engine keeps the bonus economy.
export class MapSiteManager {
  supplyDrops: SupplyDropSite[] = [];
  mapCaches: MapCacheSite[] = [];
  mapBuildings: MapBuildingSite[] = [];
  private nextSiteId = 1;

  reset(): void {
    this.supplyDrops = [];
    this.mapCaches = [];
    this.mapBuildings = [];
    this.nextSiteId = 1;
  }

  findSite(source: SiteSource, id: number): SupplyDropSite | MapCacheSite | null {
    if (source === "drop") return this.supplyDrops.find((drop) => drop.id === id) ?? null;
    return this.mapCaches.find((cache) => cache.id === id) ?? null;
  }

  siteExists(source: SiteSource, id: number): boolean {
    return this.findSite(source, id) !== null;
  }

  // Nearest unclaimed package within the click radius: the click test that decides
  // whether a press on the map opens the picker or falls through to a tower.
  nearestPackage(grid: Grid | null, worldX: number, worldY: number): { source: SiteSource; id: number } | null {
    if (!grid) return null;
    const radius = grid.tileSize * PACKAGE_CLICK_RADIUS_TILES;
    let bestDistance = radius * radius;
    let best: { source: SiteSource; id: number } | null = null;
    const consider = (source: SiteSource, id: number, tileX: number, tileY: number): void => {
      const world = grid.tileToWorld(tileX, tileY);
      const deltaX = world.x - worldX;
      const deltaY = world.y - worldY;
      const distance = deltaX * deltaX + deltaY * deltaY;
      if (distance > bestDistance) return;
      bestDistance = distance;
      best = { source, id };
    };
    for (const drop of this.supplyDrops) consider("drop", drop.id, drop.tileX, drop.tileY);
    for (const cache of this.mapCaches) consider("cache", cache.id, cache.tileX, cache.tileY);
    return best;
  }

  addSupplyDrop(grid: Grid | null, map: MapSiteSource | null, enemy: Enemy): void {
    if (!grid || !map) return;
    const tile = grid.worldToTile(enemy.x, enemy.y);
    const pathTile = this.freePathTile(grid, tile.x, tile.y);
    if (!pathTile) return;
    const id = this.nextSiteId++;
    this.supplyDrops.push({ id, tileX: pathTile.x, tileY: pathTile.y, offer: rollBonusOfferFor(map.seed, id) });
    this.syncReservedTiles(grid);
  }

  consume(grid: Grid | null, source: SiteSource, id: number): void {
    if (source === "drop") {
      this.supplyDrops = this.supplyDrops.filter((drop) => drop.id !== id);
    } else {
      this.mapCaches = this.mapCaches.filter((cache) => cache.id !== id);
    }
    this.syncReservedTiles(grid);
  }

  // Prefers a corridor tile with no tower and no package on it, so two bosses that
  // die on the same tile do not stack packages (the higher id would be unreachable)
  // and a package never lands under a tower the player still needs to select.
  freePathTile(grid: Grid, tileX: number, tileY: number): { x: number; y: number } | null {
    const isFree = (scanX: number, scanY: number): boolean => {
      const key = `${scanX},${scanY}`;
      if (grid.blocked.has(key) || grid.ghostTowers.has(key)) return false;
      return !this.supplyDrops.some((drop) => drop.tileX === scanX && drop.tileY === scanY);
    };
    return nearestPathTile(grid, tileX, tileY, isFree) ?? nearestPathTile(grid, tileX, tileY);
  }

  // Reconciles the site lists against the layout and re-derives the reserved tiles
  // from them. Returns false when there is no grid or map yet, so the caller can
  // skip the tower bonus refresh that follows a reconcile.
  syncMapSites(
    grid: Grid | null,
    map: MapSiteSource | null,
    previousWorldKeys: ReadonlySet<string> | null,
    placedBlocks = 0,
    stampWorldKeys: ReadonlySet<string> | null = null,
  ): boolean {
    if (!grid || !map) return false;
    reconcileMapSites({
      grid,
      seed: map.seed,
      regionId: map.regionId,
      mapLevel: map.level,
      buildings: this.mapBuildings,
      caches: this.mapCaches,
      previousWorldKeys,
      placedBlocks,
      stampWorldKeys,
      allocateId: () => this.nextSiteId++,
      rollOffer: (packageId) => rollBonusOfferFor(map.seed, packageId),
    });
    this.syncReservedTiles(grid);
    return true;
  }

  syncReservedTiles(grid: Grid | null): void {
    if (!grid) return;
    const keys: string[] = [];
    for (const building of this.mapBuildings) keys.push(`${building.tileX},${building.tileY}`);
    for (const cache of this.mapCaches) keys.push(`${cache.tileX},${cache.tileY}`);
    for (const drop of this.supplyDrops) keys.push(`${drop.tileX},${drop.tileY}`);
    grid.setReservedTerrain(keys);
  }

  shift(shiftX: number, shiftY: number): void {
    if (shiftX === 0 && shiftY === 0) return;
    for (const building of this.mapBuildings) {
      building.tileX += shiftX;
      building.tileY += shiftY;
    }
    for (const cache of this.mapCaches) {
      cache.tileX += shiftX;
      cache.tileY += shiftY;
    }
    for (const drop of this.supplyDrops) {
      drop.tileX += shiftX;
      drop.tileY += shiftY;
    }
  }

  // A layout change can move a corridor out from under a package; the package goes
  // back onto the nearest corridor rather than staying stranded on terrain.
  snapDropsToPath(grid: Grid): void {
    for (let index = this.supplyDrops.length - 1; index >= 0; index--) {
      const drop = this.supplyDrops[index]!;
      if (grid.isPath(drop.tileX, drop.tileY)) continue;
      const snapped = this.freePathTile(grid, drop.tileX, drop.tileY);
      if (!snapped) {
        this.supplyDrops.splice(index, 1);
        continue;
      }
      drop.tileX = snapped.x;
      drop.tileY = snapped.y;
    }
  }
}
