import type { TowerId } from "@/sim/ConstantsTower.js";
import { mulberry32 } from "@/sim/grid/Map.js";
import { blockCoordinateForTile } from "@/sim/grid/ProgressiveMap.js";
import type { BonusOffer } from "@/sim/runBonuses.js";

export const BUILDING_KINDS = ["armory", "magazine", "ward", "beacon"] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

export const BUILDING_DAMAGE_MULT = 1.2;
export const BUILDING_FIRE_RATE_MULT = 1.2;
export const BUILDING_HEALTH_MULT = 1.25;
export const BUILDING_RANGE_MULT = 1.15;

// Chebyshev gap so two buildings' 8-neighborhoods do not share a tile.
const BUILDING_CLEARANCE = 3;
const BUILDING_NEIGHBOR_MINIMUM = 3;
const CACHE_CLEARANCE = 6;
const CACHE_SPAWN_CLEARANCE = 4;
// Capped so the base ring and the spawn ring (CACHE_SPAWN_CLEARANCE) leave at
// least one clear column on the smallest catalog boards (15x10, 10x15).
const CACHE_BASE_CLEARANCE = 4;
const CACHE_BUILDING_CLEARANCE = 2;
const CACHE_PATH_GAP = 2;
export const PACKAGE_CLICK_RADIUS_TILES = 0.75;
const SITE_RANK_TAG = 0xc0de;
const BUILDING_STAMP_TAG = 0xb1d;
const CACHE_STAMP_TAG = 0xcace;
const REGION_COUNT = 3;
const MAPS_PER_REGION = 12;
const MAX_BUILDINGS = 20;
const MAX_CACHES = 10;

export const BUILDING_LABELS: Record<BuildingKind, string> = {
  armory: "Armory",
  magazine: "Magazine",
  ward: "Ward",
  beacon: "Beacon",
};

export const BUILDING_COLORS: Record<BuildingKind, string> = {
  armory: "#e07040",
  magazine: "#d0a040",
  ward: "#40c0a0",
  beacon: "#70a0e0",
};

// Text-presentation-default code points so an SVG <text> draws them monochrome
// instead of as color emoji. Theme JSON stays untouched: these are procedural marks.
export const BUILDING_ICONS: Record<BuildingKind, string> = { armory: "⚔", magazine: "✸", ward: "⛨", beacon: "✦" };

export const CACHE_ICON = "▣";

export const BUILDING_DETAILS: Record<BuildingKind, string> = {
  armory: "adjacent towers deal ×1.20 damage",
  magazine: "adjacent towers fire ×1.20 faster",
  ward: "adjacent towers have ×1.25 health",
  beacon: "adjacent towers have ×1.15 range",
};

export function buildingBlurb(kind: BuildingKind): string {
  return `${BUILDING_LABELS[kind]}: ${BUILDING_DETAILS[kind]}`;
}

export interface MapBuildingSite {
  id: number;
  kind: BuildingKind;
  tileX: number;
  tileY: number;
}

export interface MapCacheSite {
  id: number;
  tileX: number;
  tileY: number;
  hp: number;
  maxHp: number;
  offer: BonusOffer;
  // Cards stay hidden until the player unlocks the cache, either by paying the
  // wave-scaled fee or by breaking it open with tower fire. Breaking sets hp to 0
  // and unlocks it for free; a gold unlock keeps the site intact but paid-for, so
  // a dismiss and reopen never charges twice.
  unlocked: boolean;
  // Drawn on first open and kept on the site so a dismiss and reopen cannot reroll
  // the specialist type the offer's typed cards promise. Absent until first open.
  specialistType?: TowerId;
}

export interface SupplyDropSite {
  id: number;
  tileX: number;
  tileY: number;
  offer: BonusOffer;
  specialistType?: TowerId;
}

export interface SiteGrid {
  width: number;
  height: number;
  tileSize: number;
  worldOriginX: number;
  worldOriginY: number;
  spawns: { x: number; y: number }[];
  base: { x: number; y: number };
  inBounds(tileX: number, tileY: number): boolean;
  isPath(tileX: number, tileY: number): boolean;
  isTerrain(tileX: number, tileY: number): boolean;
  tileToWorld(tileX: number, tileY: number): { x: number; y: number };
  worldToTile(worldX: number, worldY: number): { x: number; y: number };
}

export interface NeighborBonus {
  damageMult: number;
  fireRateMult: number;
  healthMult: number;
  rangeMult: number;
}

export function freshNeighborBonus(): NeighborBonus {
  return { damageMult: 1, fireRateMult: 1, healthMult: 1, rangeMult: 1 };
}

export function buildingCountFor(regionId: number, level: number): number {
  return clamp(1 + Math.round((MAX_BUILDINGS - 1) * regionLevelProgress(regionId, level)), 1, MAX_BUILDINGS);
}

export function cacheCountFor(regionId: number, level: number): number {
  return clamp(1 + Math.round((MAX_CACHES - 1) * regionLevelProgress(regionId, level)), 1, MAX_CACHES);
}

export function cacheMaxHealth(mapLevel: number): number {
  return 60 + 20 * (mapLevel - 1);
}

// Block 1 is 5%. Block 17 and later are 85%. Zero blocks is the initial fill, which does not roll.
export function progressiveSiteChance(placedBlocks: number): number {
  if (placedBlocks <= 0) return 0;
  return clamp(placedBlocks / 20, 0.05, 0.85);
}

export function playerPlacedBlockCount(stamps: readonly { fill: boolean }[]): number {
  let count = 0;
  for (const stamp of stamps) if (!stamp.fill) count++;
  return count;
}

function regionLevelProgress(regionId: number, level: number): number {
  const region = clamp(Math.floor(regionId), 0, REGION_COUNT - 1);
  const mapLevel = clamp(Math.floor(level), 1, MAPS_PER_REGION);
  const index = region * MAPS_PER_REGION + (mapLevel - 1);
  return index / (REGION_COUNT * MAPS_PER_REGION - 1);
}

// Multiplied per adjacent building. BUILDING_CLEARANCE keeps two buildings' rings
// from overlapping, so a tower tile can sit next to at most one building and this
// loop never stacks two factors for the same stat.
export function neighborBonus(tileX: number, tileY: number, buildings: readonly MapBuildingSite[]): NeighborBonus {
  const bonus = freshNeighborBonus();
  for (const building of buildings) {
    if (chebyshev(tileX, tileY, building.tileX, building.tileY) !== 1) continue;
    if (building.kind === "armory") bonus.damageMult *= BUILDING_DAMAGE_MULT;
    else if (building.kind === "magazine") bonus.fireRateMult *= BUILDING_FIRE_RATE_MULT;
    else if (building.kind === "ward") bonus.healthMult *= BUILDING_HEALTH_MULT;
    else bonus.rangeMult *= BUILDING_RANGE_MULT;
  }
  return bonus;
}

// Nearest path tile to (tileX, tileY), preferring the smallest Chebyshev then the
// smallest squared distance. `isFree` skips taken tiles (towers under a package,
// an existing package) so two callers racing for the same corridor do not stack;
// the caller falls back to an unfiltered pass when nothing free is left.
export function nearestPathTile(
  grid: SiteGrid,
  tileX: number,
  tileY: number,
  isFree?: (scanX: number, scanY: number) => boolean,
): { x: number; y: number } | null {
  if (grid.isPath(tileX, tileY) && (isFree?.(tileX, tileY) ?? true)) return { x: tileX, y: tileY };
  let best: { x: number; y: number } | null = null;
  let bestChebyshev = Infinity;
  let bestEuclidean = Infinity;
  for (let scanY = 0; scanY < grid.height; scanY++) {
    for (let scanX = 0; scanX < grid.width; scanX++) {
      if (!grid.isPath(scanX, scanY)) continue;
      if (isFree && !isFree(scanX, scanY)) continue;
      const distance = chebyshev(tileX, tileY, scanX, scanY);
      const deltaX = scanX - tileX;
      const deltaY = scanY - tileY;
      const euclidean = deltaX * deltaX + deltaY * deltaY;
      if (distance < bestChebyshev || (distance === bestChebyshev && euclidean < bestEuclidean)) {
        bestChebyshev = distance;
        bestEuclidean = euclidean;
        best = { x: scanX, y: scanY };
      }
    }
  }
  return best;
}

export function worldKey(grid: SiteGrid, tileX: number, tileY: number): string {
  const world = grid.tileToWorld(tileX, tileY);
  return `${Math.round(world.x)},${Math.round(world.y)}`;
}

// Every world tile that belongs to one progressive block, so a reconcile can tell
// which sites a stamped block is allowed to place.
export function stampWorldKeysForBlock(grid: SiteGrid, blockX: number, blockY: number): Set<string> {
  const originTileX = Math.round(grid.worldOriginX / grid.tileSize);
  const originTileY = Math.round(grid.worldOriginY / grid.tileSize);
  const keys = new Set<string>();
  for (let tileY = 0; tileY < grid.height; tileY++) {
    for (let tileX = 0; tileX < grid.width; tileX++) {
      const block = blockCoordinateForTile(originTileX, originTileY, tileX, tileY);
      if (block.blockX !== blockX || block.blockY !== blockY) continue;
      keys.add(worldKey(grid, tileX, tileY));
    }
  }
  return keys;
}

export interface PlannedBuildingSite extends MapBuildingSite {
  worldX: number;
  worldY: number;
}

export interface PlannedCacheSite extends MapCacheSite {
  worldX: number;
  worldY: number;
}

export interface StampedBoardSitesInput {
  grid: SiteGrid;
  map: { readonly seed: number; readonly regionId: number; readonly level: number };
  buildings: MapBuildingSite[];
  caches: MapCacheSite[];
  previousWorldKeys: ReadonlySet<string>;
  placedBlocks: number;
  stampWorldKeys: ReadonlySet<string>;
  rollOffer: (packageId: number) => BonusOffer;
}

// Reconciles a candidate stamped board's site lists and returns only the sites the
// stamp adds, in world coordinates for drawing. The progressive ghost preview runs
// this against copies of the live lists, so it must never mutate them.
export function planSitesForStampedBoard(input: StampedBoardSitesInput): {
  buildings: PlannedBuildingSite[];
  caches: PlannedCacheSite[];
} {
  let nextLocalId = 1;
  reconcileMapSites({
    grid: input.grid,
    seed: input.map.seed,
    regionId: input.map.regionId,
    mapLevel: input.map.level,
    buildings: input.buildings,
    caches: input.caches,
    previousWorldKeys: input.previousWorldKeys,
    placedBlocks: input.placedBlocks,
    stampWorldKeys: input.stampWorldKeys,
    allocateId: () => nextLocalId++,
    rollOffer: input.rollOffer,
  });
  const added = (site: { tileX: number; tileY: number }): boolean =>
    !input.previousWorldKeys.has(worldKey(input.grid, site.tileX, site.tileY));
  return {
    buildings: input.buildings.filter(added).map((building) => atWorld(input.grid, building)),
    caches: input.caches.filter(added).map((cache) => atWorld(input.grid, cache)),
  };
}

function atWorld<T extends { tileX: number; tileY: number }>(
  grid: SiteGrid,
  site: T,
): T & { worldX: number; worldY: number } {
  const world = grid.tileToWorld(site.tileX, site.tileY);
  return { ...site, worldX: world.x, worldY: world.y };
}

export function collectWorldKeys(grid: SiteGrid): Set<string> {
  const keys = new Set<string>();
  for (let tileY = 0; tileY < grid.height; tileY++) {
    for (let tileX = 0; tileX < grid.width; tileX++) {
      if (!grid.inBounds(tileX, tileY)) continue;
      keys.add(worldKey(grid, tileX, tileY));
    }
  }
  return keys;
}

export interface ReconcileSitesInput {
  grid: SiteGrid;
  seed: number;
  regionId: number;
  mapLevel: number;
  buildings: MapBuildingSite[];
  caches: MapCacheSite[];
  // Null places against the whole board. A set is the world keys that already
  // existed, so a grown board only fills tiles that were not in that set.
  previousWorldKeys: ReadonlySet<string> | null;
  // Zero is the initial fill. A positive count rolls one building and one cache
  // onto stampWorldKeys instead of topping the board up to the target.
  placedBlocks: number;
  stampWorldKeys: ReadonlySet<string> | null;
  allocateId: () => number;
  rollOffer: (packageId: number) => BonusOffer;
}

// Drops sites whose tile is gone, then fills the quota from eligible tiles.
// Existing sites keep their ids and offers. The rank is a hash of the world
// position, so an origin shift does not reshuffle a tile that is still there.
export function reconcileMapSites(input: ReconcileSitesInput): void {
  const grid = input.grid;
  retainValid(
    input.buildings,
    (site) => grid.inBounds(site.tileX, site.tileY) && grid.isTerrain(site.tileX, site.tileY),
  );
  retainValid(input.caches, (site) => grid.inBounds(site.tileX, site.tileY) && grid.isTerrain(site.tileX, site.tileY));

  const occupied = occupiedKeys(input.buildings, input.caches);
  if (input.previousWorldKeys === null) {
    fillSiteQuota(input, occupied);
    return;
  }
  rollStampSites(input, occupied);
}

interface RankedTile {
  tileX: number;
  tileY: number;
  rank: number;
  kind: BuildingKind;
}

function buildingCandidates(input: ReconcileSitesInput, occupied: Set<string>): RankedTile[] {
  const candidates: RankedTile[] = [];
  const grid = input.grid;
  for (let tileY = 0; tileY < grid.height; tileY++) {
    for (let tileX = 0; tileX < grid.width; tileX++) {
      if (!grid.isTerrain(tileX, tileY) || occupied.has(tileKey(tileX, tileY))) continue;
      if (!tileIsNew(input, tileX, tileY)) continue;
      if (!tileOnStamp(input, tileX, tileY)) continue;
      if (!clearOfPoint(tileX, tileY, grid.base, BUILDING_CLEARANCE)) continue;
      if (!clearOfPoints(tileX, tileY, grid.spawns, BUILDING_CLEARANCE)) continue;
      if (!clearOf(tileX, tileY, input.buildings, BUILDING_CLEARANCE)) continue;
      // The mirror of the cache-side check below: a building stamped onto an
      // existing board must not sit a cache's ring away, or the cache ends up
      // occupying a slot the building's buff promised the player.
      if (!clearOf(tileX, tileY, input.caches, CACHE_BUILDING_CLEARANCE)) continue;
      if (buildableNeighborCount(grid, tileX, tileY, occupied) < BUILDING_NEIGHBOR_MINIMUM) continue;
      const rolled = rollSite(input.seed, grid, tileX, tileY);
      candidates.push({ tileX, tileY, rank: rolled.rank, kind: rolled.kind });
    }
  }
  candidates.sort(compareRanked);
  return candidates;
}

function cacheCandidates(input: ReconcileSitesInput, occupied: Set<string>): RankedTile[] {
  const candidates: RankedTile[] = [];
  const grid = input.grid;
  for (let tileY = 0; tileY < grid.height; tileY++) {
    for (let tileX = 0; tileX < grid.width; tileX++) {
      if (!grid.isTerrain(tileX, tileY) || occupied.has(tileKey(tileX, tileY))) continue;
      if (!tileIsNew(input, tileX, tileY)) continue;
      if (!tileOnStamp(input, tileX, tileY)) continue;
      if (pathWithinOne(grid, tileX, tileY)) continue;
      if (chebyshev(tileX, tileY, grid.base.x, grid.base.y) <= CACHE_BASE_CLEARANCE) continue;
      if (!spawnClear(grid, tileX, tileY)) continue;
      if (!clearOf(tileX, tileY, input.caches, CACHE_CLEARANCE)) continue;
      // A cache two tiles from a building would sit in the ring of buffed tower
      // slots, so the player could never build there without dropping the buff.
      if (!clearOf(tileX, tileY, input.buildings, CACHE_BUILDING_CLEARANCE)) continue;
      const rolled = rollSite(input.seed, grid, tileX, tileY);
      candidates.push({ tileX, tileY, rank: rolled.rank, kind: rolled.kind });
    }
  }
  candidates.sort(compareRanked);
  return candidates;
}

function tileIsNew(input: ReconcileSitesInput, tileX: number, tileY: number): boolean {
  if (input.previousWorldKeys === null) return true;
  return !input.previousWorldKeys.has(worldKey(input.grid, tileX, tileY));
}

function tileOnStamp(input: ReconcileSitesInput, tileX: number, tileY: number): boolean {
  if (input.stampWorldKeys === null) return true;
  return input.stampWorldKeys.has(worldKey(input.grid, tileX, tileY));
}

function fillSiteQuota(input: ReconcileSitesInput, occupied: Set<string>): void {
  const buildingTarget = buildingCountFor(input.regionId, input.mapLevel);
  const cacheTarget = cacheCountFor(input.regionId, input.mapLevel);
  placeBuildings(input, occupied, buildingTarget);
  placeCaches(input, occupied, cacheTarget);
}

function rollStampSites(input: ReconcileSitesInput, occupied: Set<string>): void {
  const stamp = input.stampWorldKeys;
  if (!stamp || stamp.size === 0) return;
  const chance = progressiveSiteChance(input.placedBlocks);
  if (chance <= 0) return;
  const buildingTarget = buildingCountFor(input.regionId, input.mapLevel);
  const cacheTarget = cacheCountFor(input.regionId, input.mapLevel);
  if (
    input.buildings.length < buildingTarget &&
    stampRoll(input.seed, input.placedBlocks, BUILDING_STAMP_TAG) < chance
  ) {
    placeBuildings(input, occupied, input.buildings.length + 1);
  }
  if (input.caches.length < cacheTarget && stampRoll(input.seed, input.placedBlocks, CACHE_STAMP_TAG) < chance) {
    placeCaches(input, occupied, input.caches.length + 1);
  }
}

function placeBuildings(input: ReconcileSitesInput, occupied: Set<string>, target: number): void {
  if (input.buildings.length >= target) return;
  const candidates = buildingCandidates(input, occupied);
  for (const candidate of candidates) {
    if (input.buildings.length >= target) break;
    if (!clearOf(candidate.tileX, candidate.tileY, input.buildings, BUILDING_CLEARANCE)) continue;
    const id = input.allocateId();
    input.buildings.push({ id, kind: candidate.kind, tileX: candidate.tileX, tileY: candidate.tileY });
    occupied.add(tileKey(candidate.tileX, candidate.tileY));
  }
}

function placeCaches(input: ReconcileSitesInput, occupied: Set<string>, target: number): void {
  if (input.caches.length >= target) return;
  const candidates = cacheCandidates(input, occupied);
  for (const candidate of candidates) {
    if (input.caches.length >= target) break;
    if (!clearOf(candidate.tileX, candidate.tileY, input.caches, CACHE_CLEARANCE)) continue;
    const id = input.allocateId();
    const maxHp = cacheMaxHealth(input.mapLevel);
    input.caches.push({
      id,
      tileX: candidate.tileX,
      tileY: candidate.tileY,
      hp: maxHp,
      maxHp,
      offer: input.rollOffer(id),
      unlocked: false,
    });
    occupied.add(tileKey(candidate.tileX, candidate.tileY));
  }
}

function stampRoll(seed: number, placedBlocks: number, kindTag: number): number {
  let mixed = Math.imul(seed ^ kindTag, 0x9e3779b1);
  mixed ^= Math.imul(placedBlocks, 0x85ebca6b);
  return mulberry32(mixed >>> 0)();
}

function rollSite(seed: number, grid: SiteGrid, tileX: number, tileY: number): { rank: number; kind: BuildingKind } {
  const world = grid.tileToWorld(tileX, tileY);
  let mixed = Math.imul(seed ^ SITE_RANK_TAG, 0x9e3779b1);
  mixed ^= Math.imul(Math.round(world.x), 0x85ebca6b);
  mixed = Math.imul(mixed, 0xc2b2ae35) ^ Math.imul(Math.round(world.y), 0x27d4eb2f);
  const rng = mulberry32(mixed >>> 0);
  const rank = rng();
  const kind = BUILDING_KINDS[Math.floor(rng() * BUILDING_KINDS.length)] ?? "armory";
  return { rank, kind };
}

function compareRanked(left: RankedTile, right: RankedTile): number {
  if (left.rank !== right.rank) return left.rank - right.rank;
  if (left.tileY !== right.tileY) return left.tileY - right.tileY;
  return left.tileX - right.tileX;
}

function buildableNeighborCount(grid: SiteGrid, tileX: number, tileY: number, occupied: Set<string>): number {
  let count = 0;
  for (let deltaY = -1; deltaY <= 1; deltaY++) {
    for (let deltaX = -1; deltaX <= 1; deltaX++) {
      if (deltaX === 0 && deltaY === 0) continue;
      const neighborX = tileX + deltaX;
      const neighborY = tileY + deltaY;
      if (!grid.inBounds(neighborX, neighborY)) continue;
      if (occupied.has(tileKey(neighborX, neighborY))) continue;
      if (grid.isTerrain(neighborX, neighborY) || grid.isPath(neighborX, neighborY)) count++;
    }
  }
  return count;
}

function pathWithinOne(grid: SiteGrid, tileX: number, tileY: number): boolean {
  const reach = CACHE_PATH_GAP - 1;
  for (let deltaY = -reach; deltaY <= reach; deltaY++) {
    for (let deltaX = -reach; deltaX <= reach; deltaX++) {
      if (deltaX === 0 && deltaY === 0) continue;
      if (grid.isPath(tileX + deltaX, tileY + deltaY)) return true;
    }
  }
  return false;
}

function spawnClear(grid: SiteGrid, tileX: number, tileY: number): boolean {
  for (const spawn of grid.spawns) {
    if (chebyshev(tileX, tileY, spawn.x, spawn.y) <= CACHE_SPAWN_CLEARANCE) return false;
  }
  return true;
}

function clearOf(
  tileX: number,
  tileY: number,
  sites: readonly { tileX: number; tileY: number }[],
  clearance: number,
): boolean {
  for (const site of sites) {
    if (chebyshev(tileX, tileY, site.tileX, site.tileY) < clearance) return false;
  }
  return true;
}

function clearOfPoint(tileX: number, tileY: number, point: { x: number; y: number }, clearance: number): boolean {
  return chebyshev(tileX, tileY, point.x, point.y) >= clearance;
}

function clearOfPoints(
  tileX: number,
  tileY: number,
  points: readonly { x: number; y: number }[],
  clearance: number,
): boolean {
  for (const point of points) {
    if (chebyshev(tileX, tileY, point.x, point.y) < clearance) return false;
  }
  return true;
}

function occupiedKeys(buildings: readonly MapBuildingSite[], caches: readonly MapCacheSite[]): Set<string> {
  const occupied = new Set<string>();
  for (const building of buildings) occupied.add(tileKey(building.tileX, building.tileY));
  for (const cache of caches) occupied.add(tileKey(cache.tileX, cache.tileY));
  return occupied;
}

function retainValid<T>(sites: T[], keep: (site: T) => boolean): void {
  for (let index = sites.length - 1; index >= 0; index--) {
    if (!keep(sites[index]!)) sites.splice(index, 1);
  }
}

function tileKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}

function chebyshev(leftX: number, leftY: number, rightX: number, rightY: number): number {
  return Math.max(Math.abs(leftX - rightX), Math.abs(leftY - rightY));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
