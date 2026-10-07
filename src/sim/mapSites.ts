import type { TowerId } from "@/sim/ConstantsTower.js";
import { mulberry32 } from "@/sim/grid/Map.js";
import { blockCoordinateForTile } from "@/sim/grid/ProgressiveMap.js";
import type { BonusOffer } from "@/sim/runBonuses.js";

export const BUILDING_KINDS = ["armory", "magazine", "beacon", "foundry", "clocktower", "aviary"] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

// Which tower stat a kind multiplies. Adjacent towers take `adjacentMult` per
// building they touch. A building that has a live tower beside it is powered, and
// every powered building pays one of two whole-board halves to every tower:
// `activeMult` per powered building of its own kind, or `boardRampMult` raised to
// the count of every powered building on the board. A kind with no adjacent effect
// (a foundry, a clocktower) is a tether: nothing at all until a tower is built
// next to it.
export type BuildingBonusField = "damageMult" | "fireRateMult" | "rangeMult" | "flyingDamageMult";

export interface BuildingEffect {
  field: BuildingBonusField;
  // × per powered building, for the towers touching it.
  adjacentMult: number;
  // × per powered building of this kind, to every tower. Half the adjacent bonus, so
  // powering a building is worth something to the whole board without matching the
  // towers standing on it. 1 when the kind's whole-board half is a board ramp.
  activeMult: number;
  // × per powered building of ANY kind, to every tower, applied once while at least
  // one building of this kind is powered. A foundry counts the whole board, not just
  // the other foundries. 1 unless this kind is a ramp.
  boardRampMult: number;
}

export const BUILDING_EFFECTS: Record<BuildingKind, BuildingEffect> = {
  armory: { field: "damageMult", adjacentMult: 1.2, activeMult: 1.1, boardRampMult: 1 },
  magazine: { field: "fireRateMult", adjacentMult: 1.2, activeMult: 1.1, boardRampMult: 1 },
  beacon: { field: "rangeMult", adjacentMult: 1.15, activeMult: 1.075, boardRampMult: 1 },
  foundry: { field: "damageMult", adjacentMult: 1, activeMult: 1, boardRampMult: 1.01 },
  clocktower: { field: "fireRateMult", adjacentMult: 1, activeMult: 1, boardRampMult: 1.01 },
  aviary: { field: "flyingDamageMult", adjacentMult: 1.2, activeMult: 1.1, boardRampMult: 1 },
};

// Chebyshev gap so two buildings' 8-neighborhoods do not share a tile.
const BUILDING_CLEARANCE = 3;
const BUILDING_NEIGHBOR_MINIMUM = 3;
// One ring serves both rules on purpose: a tower is adjacent to a building exactly
// when it is on one of the 8 tiles that can power it, so widening one widens both.
export const BUILDING_NEIGHBOR_RING = 1;
export const PACKAGE_CLICK_RADIUS_TILES = 0.75;

// Spacing a board is asked for, best first, and how far it may give way when the
// board cannot fit its quota at that spacing. The measured capacity of the
// smallest catalog boards (15x10, 10x15) is 2 caches at 6 tiles apart, so without
// the ladder those boards finish a third of their cache quota unfilled.
const CACHE_CLEARANCE_LADDER = [6, 5, 4, 3, 2];
// Outer rung of the two, because cache-to-cache spacing gives up first: two caches
// close together only costs spread, while a cache beside a building takes one of
// the eight tower slots the building buffs.
const CACHE_BUILDING_CLEARANCE_LADDER = [2, 1];
const CACHE_BUILDING_CLEARANCE = CACHE_BUILDING_CLEARANCE_LADDER[0]!;

interface SiteClearances {
  // Tiles between a cache tile and the nearest path tile. 0 puts a cache directly
  // beside the corridor, which a progressive block needs; candidates already
  // require terrain, so 0 rejects only a direct collision, not anything go.
  cachePathGap: number;
  cacheBase: number;
  cacheSpawn: number;
  buildingBase: number;
  buildingSpawn: number;
}

const GENERATED_CLEARANCES: SiteClearances = {
  cachePathGap: 2,
  // Capped so the base ring and the spawn ring leave at least one clear column on
  // the smallest catalog boards (15x10, 10x15).
  cacheBase: 4,
  cacheSpawn: 4,
  buildingBase: 3,
  buildingSpawn: 3,
};

// A progressive board is 5x5 blocks, and a block's terrain hugs the corridor that
// runs through it, so the rings a generated board can afford leave no legal tile
// inside a block at all: a cache pool of zero on all 12 variants. Every ring that
// pushes a site away from the corridor, the base, or a spawn drops to 0 here.
// Building clearance and the building neighbor minimum stay put, so a building
// still needs room for the tower that powers it.
const PROGRESSIVE_CLEARANCES: SiteClearances = {
  cachePathGap: 0,
  cacheBase: 0,
  cacheSpawn: 0,
  buildingBase: 0,
  buildingSpawn: 0,
};

function siteClearancesFor(mapStyle: string | undefined): SiteClearances {
  return mapStyle === "progressive" ? PROGRESSIVE_CLEARANCES : GENERATED_CLEARANCES;
}

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
  beacon: "Beacon",
  foundry: "Foundry",
  clocktower: "Clocktower",
  aviary: "Aviary",
};

export const BUILDING_COLORS: Record<BuildingKind, string> = {
  armory: "#e07040",
  magazine: "#d0a040",
  beacon: "#70a0e0",
  foundry: "#d05050",
  clocktower: "#b070e0",
  aviary: "#40c0a0",
};

// Text-presentation-default code points so an SVG <text> draws them monochrome
// instead of as color emoji. Theme JSON stays untouched: these are procedural marks.
export const BUILDING_ICONS: Record<BuildingKind, string> = {
  armory: "⚔",
  magazine: "✸",
  beacon: "✦",
  foundry: "⚒",
  clocktower: "⧗",
  aviary: "⟁",
};

export const CACHE_ICON = "▣";

// What the kind does to the towers touching it, then what it does to the whole
// board while powered. A tethered kind states only the powered half.
export const BUILDING_DETAILS: Record<BuildingKind, { adjacent: string; active: string }> = {
  armory: { adjacent: "adjacent towers deal ×1.20 damage", active: "×1.10 damage to every tower while active" },
  magazine: { adjacent: "adjacent towers fire ×1.20 faster", active: "×1.10 fire rate to every tower while active" },
  beacon: { adjacent: "adjacent towers have ×1.15 range", active: "×1.075 range to every tower while active" },
  foundry: { adjacent: "", active: "every active building adds ×1.01 damage to all towers while a Foundry is active" },
  clocktower: {
    adjacent: "",
    active: "every active building adds ×1.01 fire rate to all towers while a Clocktower is active",
  },
  aviary: {
    adjacent: "adjacent towers deal ×1.20 damage to flyers",
    active: "×1.10 to flyers from every tower while active",
  },
};

export const BUILDING_INACTIVE_DETAIL = "inactive — no tower beside it";

function capitalize(detail: string): string {
  return `${detail.charAt(0).toUpperCase()}${detail.slice(1)}`;
}

// One line per half, then the powered state. This is the whole copy source for the
// hover tooltip and the glyph aria-label, so they cannot drift apart.
export function buildingDetailLines(kind: BuildingKind, active: boolean): string[] {
  const details = BUILDING_DETAILS[kind];
  const lines: string[] = [];
  if (details.adjacent) lines.push(`${capitalize(details.adjacent)}.`);
  if (details.active) lines.push(`${capitalize(details.active)}.`);
  if (!active) lines.push(`${capitalize(BUILDING_INACTIVE_DETAIL)}.`);
  return lines;
}

export function buildingBlurb(kind: BuildingKind, active: boolean): string {
  return `${BUILDING_LABELS[kind]}: ${buildingDetailLines(kind, active).join(" ")}`;
}

export interface MapBuildingSite {
  id: number;
  kind: BuildingKind;
  tileX: number;
  tileY: number;
  // True while a live tower stands on one of the 8 tiles around it. Owned by the
  // engine (it is the one that knows the tower set); a reconciled site starts
  // inactive because nothing has recomputed it yet.
  active: boolean;
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

// What a building does to the towers around it, plus the whole-board half that
// every powered building pays. `healthMult` is gone: nothing grants tower health.
export interface NeighborBonus {
  damageMult: number;
  fireRateMult: number;
  rangeMult: number;
  flyingDamageMult: number;
}

export function freshNeighborBonus(): NeighborBonus {
  return { damageMult: 1, fireRateMult: 1, rangeMult: 1, flyingDamageMult: 1 };
}

// The whole-board half, plus how many buildings are paying it (for the HUD list).
export interface ActiveBuildingBonus extends NeighborBonus {
  activeCount: number;
}

export function freshActiveBuildingBonus(): ActiveBuildingBonus {
  return { ...freshNeighborBonus(), activeCount: 0 };
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

// A building is powered while a live tower stands within the 8-tile ring. A ghost
// does not count: losing the tower that powered a building drops its whole-board
// half, which is what makes the tether worth defending. Writes the answer back onto
// the site, because the render layer reads it from there.
export function refreshBuildingActivity(
  buildings: readonly MapBuildingSite[],
  hasLiveTowerAt: (tileX: number, tileY: number) => boolean,
): void {
  for (const building of buildings) {
    building.active = buildingIsActive(building, hasLiveTowerAt);
  }
}

export function buildingIsActive(
  building: MapBuildingSite,
  hasLiveTowerAt: (tileX: number, tileY: number) => boolean,
): boolean {
  for (let deltaY = -BUILDING_NEIGHBOR_RING; deltaY <= BUILDING_NEIGHBOR_RING; deltaY++) {
    for (let deltaX = -BUILDING_NEIGHBOR_RING; deltaX <= BUILDING_NEIGHBOR_RING; deltaX++) {
      if (deltaX === 0 && deltaY === 0) continue;
      if (hasLiveTowerAt(building.tileX + deltaX, building.tileY + deltaY)) return true;
    }
  }
  return false;
}

// The whole-board half of every powered building, paid by every tower and by the
// base sentries. Computed once per refresh, not per tower. A ramp field is collected
// first and applied once at the end, raised to the count of every powered building.
export function activeBuildingBonus(buildings: readonly MapBuildingSite[]): ActiveBuildingBonus {
  const bonus = freshActiveBuildingBonus();
  const rampMults = new Map<BuildingBonusField, number>();
  for (const building of buildings) {
    if (!building.active) continue;
    bonus.activeCount++;
    const effect = BUILDING_EFFECTS[building.kind];
    if (effect.boardRampMult !== 1) rampMults.set(effect.field, effect.boardRampMult);
    if (effect.activeMult !== 1) bonus[effect.field] *= effect.activeMult;
  }
  for (const [field, rampMult] of rampMults) {
    bonus[field] *= rampMult ** bonus.activeCount;
  }
  return bonus;
}

// The adjacent half, on top of the whole-board half. BUILDING_CLEARANCE keeps two
// buildings' rings from overlapping, so a tower tile can sit next to at most one
// building and this loop never stacks two factors for the same stat.
export function neighborBonus(
  tileX: number,
  tileY: number,
  buildings: readonly MapBuildingSite[],
  global: NeighborBonus = freshNeighborBonus(),
): NeighborBonus {
  const bonus: NeighborBonus = { ...global };
  for (const building of buildings) {
    if (chebyshev(tileX, tileY, building.tileX, building.tileY) !== BUILDING_NEIGHBOR_RING) continue;
    const effect = BUILDING_EFFECTS[building.kind];
    bonus[effect.field] *= effect.adjacentMult;
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
  map: {
    readonly seed: number;
    readonly regionId: number;
    readonly level: number;
    readonly style?: string | undefined;
  };
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
    mapStyle: input.map.style,
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

// The world keys the board has already materialized. A progressive rectangle is
// padded with a ring of void margin, and counting those would mark a freshly
// stamped block as pre-existing world, so tileIsNew would reject every tile of it
// and the stamp reconcile could place nothing. Generated boards have no void
// tiles, so for them this is every in-bounds tile as before.
export function collectWorldKeys(grid: SiteGrid): Set<string> {
  const keys = new Set<string>();
  for (let tileY = 0; tileY < grid.height; tileY++) {
    for (let tileX = 0; tileX < grid.width; tileX++) {
      if (!grid.isTerrain(tileX, tileY) && !grid.isPath(tileX, tileY)) continue;
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
  // Picks the clearance profile. Absent or anything but "progressive" is a
  // generated board.
  mapStyle?: string | undefined;
  buildings: MapBuildingSite[];
  caches: MapCacheSite[];
  // Null places against the whole board. A set is the world keys that already
  // existed, so a grown board only fills tiles that were not in that set.
  previousWorldKeys: ReadonlySet<string> | null;
  // Zero is the initial fill, which tops the board up to the region quota and
  // does not roll. A positive count rolls one building and one cache onto
  // stampWorldKeys. The building roll keeps going after the region quota; the
  // cache roll still stops at cacheCountFor.
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
}

interface RankedBuildingTile extends RankedTile {
  kind: BuildingKind;
}

function buildingCandidates(input: ReconcileSitesInput, occupied: Set<string>): RankedBuildingTile[] {
  const candidates: RankedBuildingTile[] = [];
  const clearances = siteClearancesFor(input.mapStyle);
  const grid = input.grid;
  for (let tileY = 0; tileY < grid.height; tileY++) {
    for (let tileX = 0; tileX < grid.width; tileX++) {
      if (!grid.isTerrain(tileX, tileY) || occupied.has(tileKey(tileX, tileY))) continue;
      if (!tileIsNew(input, tileX, tileY)) continue;
      if (!tileOnStamp(input, tileX, tileY)) continue;
      if (!clearOfPoint(tileX, tileY, grid.base, clearances.buildingBase)) continue;
      if (!clearOfPoints(tileX, tileY, grid.spawns, clearances.buildingSpawn)) continue;
      if (!clearOf(tileX, tileY, input.buildings, BUILDING_CLEARANCE)) continue;
      // The widest rung of the ladder, so a stamped building never lands inside a
      // cache's ring any closer than a generated board would allow. planCacheAdditions
      // re-tests this per rung when the board is short on room.
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
  const clearances = siteClearancesFor(input.mapStyle);
  const grid = input.grid;
  for (let tileY = 0; tileY < grid.height; tileY++) {
    for (let tileX = 0; tileX < grid.width; tileX++) {
      if (!grid.isTerrain(tileX, tileY) || occupied.has(tileKey(tileX, tileY))) continue;
      if (!tileIsNew(input, tileX, tileY)) continue;
      if (!tileOnStamp(input, tileX, tileY)) continue;
      if (pathWithin(grid, tileX, tileY, clearances.cachePathGap)) continue;
      if (chebyshev(tileX, tileY, grid.base.x, grid.base.y) <= clearances.cacheBase) continue;
      if (!spawnClear(grid, tileX, tileY, clearances.cacheSpawn)) continue;
      const rolled = rollSite(input.seed, grid, tileX, tileY);
      candidates.push({ tileX, tileY, rank: rolled.rank });
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
  const cacheTarget = cacheCountFor(input.regionId, input.mapLevel);
  // The region quota is the opening budget. Later blocks keep rolling a building
  // so a long progressive run grows past the start board.
  if (stampRoll(input.seed, input.placedBlocks, BUILDING_STAMP_TAG) < chance) {
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
    // Active is the engine's to compute: a site placed on a tile with a tower
    // beside it is only discovered powered once the next bonus refresh runs.
    input.buildings.push({ id, kind: candidate.kind, tileX: candidate.tileX, tileY: candidate.tileY, active: false });
    occupied.add(tileKey(candidate.tileX, candidate.tileY));
  }
}

function placeCaches(input: ReconcileSitesInput, occupied: Set<string>, target: number): void {
  for (const addition of planCacheAdditions(input, occupied, target - input.caches.length)) {
    const id = input.allocateId();
    const maxHp = cacheMaxHealth(input.mapLevel);
    input.caches.push({
      id,
      tileX: addition.tileX,
      tileY: addition.tileY,
      hp: maxHp,
      maxHp,
      offer: input.rollOffer(id),
      unlocked: false,
    });
    occupied.add(tileKey(addition.tileX, addition.tileY));
  }
}

// Picks the whole set of additions at one rung rather than filling in place, so a
// cache added at a wide rung never ends up crowding one added at a narrow one.
// Returns the first plan that reaches `needed`, or the longest plan when no rung
// fits the quota. Nothing is committed here, so a discarded rung costs no site id
// and no offer roll.
function planCacheAdditions(input: ReconcileSitesInput, occupied: Set<string>, needed: number): RankedTile[] {
  if (needed <= 0) return [];
  const candidates = cacheCandidates(input, occupied);
  let best: RankedTile[] = [];
  for (const buildingClearance of CACHE_BUILDING_CLEARANCE_LADDER) {
    for (const cacheClearance of CACHE_CLEARANCE_LADDER) {
      const plan = planCacheAdditionsAt(candidates, input, cacheClearance, buildingClearance, needed);
      if (plan.length > best.length) best = plan;
      if (best.length >= needed) return best;
    }
  }
  return best;
}

function planCacheAdditionsAt(
  candidates: readonly RankedTile[],
  input: ReconcileSitesInput,
  cacheClearance: number,
  buildingClearance: number,
  needed: number,
): RankedTile[] {
  const plan: RankedTile[] = [];
  while (plan.length < needed) {
    const next = candidates.find(
      (candidate) =>
        clearOf(candidate.tileX, candidate.tileY, input.caches, cacheClearance) &&
        // A cache two tiles from a building would sit in the ring of buffed tower
        // slots, so the player could never build there without dropping the buff.
        clearOf(candidate.tileX, candidate.tileY, input.buildings, buildingClearance) &&
        clearOf(candidate.tileX, candidate.tileY, plan, cacheClearance),
    );
    if (!next) break;
    plan.push(next);
  }
  return plan;
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

// True when a path tile sits within `gap - 1` tiles, so a gap of 2 keeps a cache
// one tile clear of the corridor and a gap of 0 rejects nothing.
function pathWithin(grid: SiteGrid, tileX: number, tileY: number, gap: number): boolean {
  const reach = gap - 1;
  for (let deltaY = -reach; deltaY <= reach; deltaY++) {
    for (let deltaX = -reach; deltaX <= reach; deltaX++) {
      if (deltaX === 0 && deltaY === 0) continue;
      if (grid.isPath(tileX + deltaX, tileY + deltaY)) return true;
    }
  }
  return false;
}

function spawnClear(grid: SiteGrid, tileX: number, tileY: number, clearance: number): boolean {
  for (const spawn of grid.spawns) {
    if (chebyshev(tileX, tileY, spawn.x, spawn.y) <= clearance) return false;
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
