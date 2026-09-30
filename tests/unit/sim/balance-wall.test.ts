// @ts-nocheck
/** @vitest-environment node */

// Map-0 placement oracle for the first two bosses.
// Path tiles are excluded: a tower built on the corridor blocks the walk this
// measures, and a boss hit removes that tower before the crossing finishes.
// Time-on-target is the ordered-path length inside each tower range, at boss
// speed, and at ice's effective slowFactor while the boss is inside any ice range.
// Raw damage on that crossing clears non-boss HP and shields first. The remainder
// hits the boss after resist. Gold is starting gold plus earlier bounties.

import { describe, expect, it } from "vitest";
import { getGameContent } from "@/content/gameContent.js";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import { WaveManager } from "@/sim/waves/WaveManager.js";
import { orderedPath } from "../../helpers/navmesh-test-utils.js";

const content = getGameContent();
const enemiesContent = content.enemies;
const towersContent = content.towers;
const economyContent = content.economy;
const skillTreeContent = content.skillTree;
const towerTuning = towersContent.tuning;

const BASIC_TYPE = "basic";
const ICE_TYPE = "ice";
const BOSS_TYPE = "boss";
const MAP_INDEX = 0;
const BOSS_ONE_WAVE = 10;
const BOSS_TWO_WAVE = 20;
const REMAINING_HP_FRACTION = 0.25;
const MILESTONE_REFERENCE_WAVES = 20;
const DAMAGE_EPSILON = 1e-6;

interface SegmentHit {
  segmentIndex: number;
  start: number;
  end: number;
}

interface Interval {
  start: number;
  end: number;
}

interface PlacedTower {
  type: typeof BASIC_TYPE | typeof ICE_TYPE;
  level: number;
  tileX: number;
  tileY: number;
  dps: number;
  coverage: SegmentHit[];
}

interface TerrainTile {
  tileX: number;
  tileY: number;
}

interface WaveEnemy {
  type: string;
  level: number;
  maxHp: number;
  shield: number;
}

interface FightResult {
  label: string;
  bossHp: number;
  trashHp: number;
  rawDamage: number;
  bossDamage: number;
  damageRatio: number;
  remainingRatio: number;
  startingGold: number;
  killGold: number;
  budget: number;
  goldRemaining: number;
  basicCount: number;
  iceCount: number;
  basicLevel3Count: number;
}

interface PathGeometry {
  segments: { startX: number; startY: number; endX: number; endY: number }[];
}

const mapData = getMap(MAP_INDEX);
const grid = new Grid(mapData);
const pathTiles = orderedPath(grid, 0);
const pathGeometry: PathGeometry = { segments: [] };
for (let pathIndex = 0; pathIndex < pathTiles.length - 1; pathIndex++) {
  const startTile = pathTiles[pathIndex]!;
  const endTile = pathTiles[pathIndex + 1]!;
  pathGeometry.segments.push({
    startX: startTile.x + 0.5,
    startY: startTile.y + 0.5,
    endX: endTile.x + 0.5,
    endY: endTile.y + 0.5,
  });
}

const terrainTiles: TerrainTile[] = [];
for (let tileY = 0; tileY < grid.height; tileY++) {
  for (let tileX = 0; tileX < grid.width; tileX++) {
    if (grid.tiles[tileY]![tileX]!.type === "terrain") terrainTiles.push({ tileX, tileY });
  }
}

const waveManager = new WaveManager(mapData, {} as never);
const compositions: { type: string; level: number }[][] = [];
for (let wave = 1; wave <= MILESTONE_REFERENCE_WAVES; wave++) {
  compositions.push(waveManager.generateWave(wave));
}

const statCache = new Map<string, { maxHp: number; shield: number; bounty: number }>();

function enemyStats(type: string, level: number, wave: number): { maxHp: number; shield: number; bounty: number } {
  const cacheKey = `${type}:${level}:${wave}`;
  const cached = statCache.get(cacheKey);
  if (cached) return cached;
  const enemy = new Enemy(type, level, 0, grid, wave, 0);
  const stats = { maxHp: enemy.maxHp, shield: enemy.shield, bounty: enemy.bounty };
  statCache.set(cacheKey, stats);
  return stats;
}

function waveEnemies(wave: number): WaveEnemy[] {
  return compositions[wave - 1]!.map((entry) => {
    const stats = enemyStats(entry.type, entry.level, wave);
    return { type: entry.type, level: entry.level, maxHp: stats.maxHp, shield: stats.shield };
  });
}

function budgetBefore(wave: number): { startingGold: number; killGold: number; budget: number } {
  const startingGold = economyContent.startingGoldByRegion[mapData.regionId] ?? 0;
  let killGold = 0;
  for (let earlierWave = 1; earlierWave < wave; earlierWave++) {
    for (const entry of compositions[earlierWave - 1]!) {
      killGold += enemyStats(entry.type, entry.level, earlierWave).bounty;
    }
  }
  return { startingGold, killGold, budget: startingGold + killGold };
}

const bossMeta = enemiesContent.types.boss;
const bossResist = bossMeta.resist ?? 0;
const bossSpeed = bossMeta.speed;
const bossSlowResist = bossMeta.slowResist ?? 0;
const iceBase = towersContent.base.ice;
const iceSlowAmount = iceBase.slowAmt ?? 0;
const slowFactor = Math.max(enemiesContent.minSlowFactor, 1 - iceSlowAmount * (1 - bossSlowResist));
const slowedBossSpeed = bossSpeed * slowFactor;
const minionSpeed = enemiesContent.types.minion.speed;

const coverageCache = new Map<string, SegmentHit[]>();

function coverageOnSegment(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  towerX: number,
  towerY: number,
  range: number,
): Interval | null {
  const stepX = endX - startX;
  const stepY = endY - startY;
  const offsetX = startX - towerX;
  const offsetY = startY - towerY;
  const quadraticA = stepX * stepX + stepY * stepY;
  if (quadraticA === 0) return null;
  const quadraticB = 2 * (offsetX * stepX + offsetY * stepY);
  const quadraticC = offsetX * offsetX + offsetY * offsetY - range * range;
  const discriminant = quadraticB * quadraticB - 4 * quadraticA * quadraticC;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const enter = Math.max(0, (-quadraticB - root) / (2 * quadraticA));
  const exit = Math.min(1, (-quadraticB + root) / (2 * quadraticA));
  if (exit - enter <= 1e-9) return null;
  const segmentLength = Math.sqrt(quadraticA);
  return { start: enter * segmentLength, end: exit * segmentLength };
}

function coverageFor(tileX: number, tileY: number, range: number): SegmentHit[] {
  const cacheKey = `${tileX},${tileY},${range}`;
  const cached = coverageCache.get(cacheKey);
  if (cached) return cached;
  const towerX = tileX + 0.5;
  const towerY = tileY + 0.5;
  const hits: SegmentHit[] = [];
  for (let segmentIndex = 0; segmentIndex < pathGeometry.segments.length; segmentIndex++) {
    const segment = pathGeometry.segments[segmentIndex]!;
    const interval = coverageOnSegment(
      segment.startX,
      segment.startY,
      segment.endX,
      segment.endY,
      towerX,
      towerY,
      range,
    );
    if (interval) hits.push({ segmentIndex, start: interval.start, end: interval.end });
  }
  coverageCache.set(cacheKey, hits);
  return hits;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) merged.push({ start: interval.start, end: interval.end });
    else last.end = Math.max(last.end, interval.end);
  }
  return merged;
}

function overlapLength(interval: Interval, blocks: Interval[]): number {
  let covered = 0;
  for (const block of blocks) {
    const start = Math.max(interval.start, block.start);
    const end = Math.min(interval.end, block.end);
    if (end > start) covered += end - start;
  }
  return covered;
}

function towerCombat(type: typeof BASIC_TYPE | typeof ICE_TYPE, level: number): { dps: number; range: number } {
  const base = towersContent.base[type]!;
  const levelSteps = level - 1;
  const damage = base.damage * towerTuning.levelDmgMult ** levelSteps;
  const fireRate = base.fireRate * towerTuning.levelRateMult ** levelSteps;
  const range = base.range * towerTuning.levelRangeMult ** levelSteps;
  return { dps: damage * fireRate, range };
}

function makeTower(
  type: typeof BASIC_TYPE | typeof ICE_TYPE,
  level: number,
  tileX: number,
  tileY: number,
): PlacedTower {
  const combat = towerCombat(type, level);
  return { type, level, tileX, tileY, dps: combat.dps, coverage: coverageFor(tileX, tileY, combat.range) };
}

function upgradeCost(type: typeof BASIC_TYPE | typeof ICE_TYPE, nextLevel: number): number {
  const buildCost = towersContent.meta[type]!.cost;
  return Math.round(buildCost * towerTuning.upgradeCostBase ** (nextLevel - 2));
}

function rawDamage(towers: PlacedTower[]): number {
  const slowIntervals: Interval[][] = pathGeometry.segments.map(() => []);
  for (const tower of towers) {
    if (tower.type !== ICE_TYPE) continue;
    for (const hit of tower.coverage) {
      slowIntervals[hit.segmentIndex]!.push({ start: hit.start, end: hit.end });
    }
  }
  const mergedSlow = slowIntervals.map((intervals) => mergeIntervals(intervals));
  let total = 0;
  for (const tower of towers) {
    for (const hit of tower.coverage) {
      const slowed = overlapLength(hit, mergedSlow[hit.segmentIndex]!);
      const span = hit.end - hit.start;
      const time = (span - slowed) / bossSpeed + slowed / slowedBossSpeed;
      total += tower.dps * time;
    }
  }
  return total;
}

function bossDamageFromRaw(raw: number, trashHp: number): number {
  return Math.max(0, raw - trashHp) * (1 - bossResist);
}

interface SpendCandidate {
  marginal: number;
  cost: number;
  upgrade: boolean;
  type: typeof BASIC_TYPE | typeof ICE_TYPE;
  tileX: number;
  tileY: number;
  nextTowers: PlacedTower[];
}

function betterCandidate(candidate: SpendCandidate, best: SpendCandidate): boolean {
  const candidateRatio = candidate.marginal / candidate.cost;
  const bestRatio = best.marginal / best.cost;
  if (candidateRatio > bestRatio + 1e-9) return true;
  if (bestRatio > candidateRatio + 1e-9) return false;
  if (candidate.cost !== best.cost) return candidate.cost < best.cost;
  if (candidate.upgrade !== best.upgrade) return candidate.upgrade;
  if (candidate.type !== best.type) return candidate.type === BASIC_TYPE;
  if (candidate.tileY !== best.tileY) return candidate.tileY < best.tileY;
  return candidate.tileX < best.tileX;
}

function spendGold(
  budget: number,
  basicLevelCap: number,
  iceLevelCap: number,
): { towers: PlacedTower[]; goldRemaining: number; rawDamage: number } {
  const towers: PlacedTower[] = [];
  const occupied = new Set<string>();
  let goldRemaining = budget;
  let currentRaw = 0;
  const stepLimit = terrainTiles.length * 3;
  for (let step = 0; step < stepLimit; step++) {
    let best: SpendCandidate | null = null;
    for (const tile of terrainTiles) {
      const tileKey = `${tile.tileX},${tile.tileY}`;
      if (occupied.has(tileKey)) continue;
      for (const type of [BASIC_TYPE, ICE_TYPE] as const) {
        const cost = towersContent.meta[type]!.cost;
        if (cost > goldRemaining) continue;
        const placed = makeTower(type, 1, tile.tileX, tile.tileY);
        const nextTowers = towers.concat(placed);
        const nextRaw = rawDamage(nextTowers);
        const marginal = nextRaw - currentRaw;
        if (marginal <= DAMAGE_EPSILON) continue;
        const candidate: SpendCandidate = {
          marginal,
          cost,
          upgrade: false,
          type,
          tileX: tile.tileX,
          tileY: tile.tileY,
          nextTowers,
        };
        if (!best || betterCandidate(candidate, best)) best = candidate;
      }
    }
    for (let towerIndex = 0; towerIndex < towers.length; towerIndex++) {
      const tower = towers[towerIndex]!;
      const levelCap = tower.type === BASIC_TYPE ? basicLevelCap : iceLevelCap;
      if (tower.level >= levelCap) continue;
      const cost = upgradeCost(tower.type, tower.level + 1);
      if (cost > goldRemaining) continue;
      const upgraded = makeTower(tower.type, tower.level + 1, tower.tileX, tower.tileY);
      const nextTowers = towers.slice();
      nextTowers[towerIndex] = upgraded;
      const nextRaw = rawDamage(nextTowers);
      const marginal = nextRaw - currentRaw;
      if (marginal <= DAMAGE_EPSILON) continue;
      const candidate: SpendCandidate = {
        marginal,
        cost,
        upgrade: true,
        type: tower.type,
        tileX: tower.tileX,
        tileY: tower.tileY,
        nextTowers,
      };
      if (!best || betterCandidate(candidate, best)) best = candidate;
    }
    if (!best) break;
    towers.length = 0;
    towers.push(...best.nextTowers);
    occupied.clear();
    for (const tower of towers) occupied.add(`${tower.tileX},${tower.tileY}`);
    goldRemaining -= best.cost;
    currentRaw += best.marginal;
  }
  return { towers, goldRemaining, rawDamage: currentRaw };
}

function fight(label: string, wave: number, basicLevelCap: number, iceLevelCap: number): FightResult {
  const gold = budgetBefore(wave);
  const spent = spendGold(gold.budget, basicLevelCap, iceLevelCap);
  const enemies = waveEnemies(wave);
  let bossHp = 0;
  let trashHp = 0;
  for (const enemy of enemies) {
    if (enemy.type === BOSS_TYPE) bossHp += enemy.maxHp;
    else trashHp += enemy.maxHp + enemy.shield;
  }
  const bossDamage = bossDamageFromRaw(spent.rawDamage, trashHp);
  return {
    label,
    bossHp,
    trashHp,
    rawDamage: spent.rawDamage,
    bossDamage,
    damageRatio: bossHp > 0 ? bossDamage / bossHp : 0,
    remainingRatio: bossHp > 0 ? Math.max(0, bossHp - bossDamage) / bossHp : 0,
    startingGold: gold.startingGold,
    killGold: gold.killGold,
    budget: gold.budget,
    goldRemaining: spent.goldRemaining,
    basicCount: spent.towers.filter((tower) => tower.type === BASIC_TYPE).length,
    iceCount: spent.towers.filter((tower) => tower.type === ICE_TYPE).length,
    basicLevel3Count: spent.towers.filter((tower) => tower.type === BASIC_TYPE && tower.level >= 3).length,
  };
}

function bestBasicTile(level: number): TerrainTile {
  let bestTile = terrainTiles[0]!;
  let bestLength = -1;
  for (const tile of terrainTiles) {
    const combat = towerCombat(BASIC_TYPE, level);
    const hits = coverageFor(tile.tileX, tile.tileY, combat.range);
    let covered = 0;
    for (const hit of hits) covered += hit.end - hit.start;
    if (covered > bestLength + 1e-9) {
      bestLength = covered;
      bestTile = tile;
    }
  }
  return bestTile;
}

function dealtByOneCrossing(raw: number, trashHp: number, bossHp: number): number {
  const trashDealt = Math.min(raw, trashHp);
  const bossDealt = Math.min(bossHp, Math.max(0, raw - trashHp) * (1 - bossResist));
  return trashDealt + bossDealt;
}

function singleBasicDamageThrough(maxWave: number): number {
  const tile = bestBasicTile(2);
  const tower = makeTower(BASIC_TYPE, 2, tile.tileX, tile.tileY);
  let covered = 0;
  for (const hit of tower.coverage) covered += hit.end - hit.start;
  const windowSeconds = covered / minionSpeed;
  const rawPerWave = tower.dps * windowSeconds;
  let total = 0;
  for (let wave = 1; wave <= maxWave; wave++) {
    const enemies = waveEnemies(wave);
    let bossHp = 0;
    let trashHp = 0;
    for (const enemy of enemies) {
      if (enemy.type === BOSS_TYPE) bossHp += enemy.maxHp;
      else trashHp += enemy.maxHp + enemy.shield;
    }
    total += dealtByOneCrossing(rawPerWave, trashHp, bossHp);
  }
  return total;
}

const bossOne = fight("wave 10, basic+ice, level <= 2", BOSS_ONE_WAVE, 2, 2);
const bossTwoLevel2 = fight("wave 20, basic+ice, level <= 2", BOSS_TWO_WAVE, 2, 2);
const bossTwoLevel3 = fight("wave 20, basic level <= 3, ice level <= 2", BOSS_TWO_WAVE, 3, 2);
const scenarioTable = [bossOne, bossTwoLevel2, bossTwoLevel3];

describe("map 0 boss placement oracle", () => {
  it("walks a corridor and has terrain beside it", () => {
    expect(pathGeometry.segments.length).toBeGreaterThan(2 * towersContent.base.basic.range);
    expect(terrainTiles.length).toBeGreaterThan(0);
  });

  it("keeps region-0 starting gold at 80 and funds boss 1 mostly from kills", () => {
    expect(economyContent.startingGoldByRegion).toEqual([80, 70, 60]);
    expect(bossOne.startingGold).toBe(80);
    expect(bossOne.killGold).toBeGreaterThan(bossOne.startingGold);
  });

  it("wave 10 dies to basic and ice with no gem purchase", () => {
    expect(bossOne.bossHp).toBeGreaterThan(0);
    expect(bossOne.damageRatio).toBeGreaterThanOrEqual(1);
    expect(bossOne.damageRatio).toBeLessThan(2);
  });

  it("wave 20 stays hard while basic is capped at level 2", () => {
    expect(bossTwoLevel2.basicLevel3Count).toBe(0);
    expect(bossTwoLevel2.damageRatio).toBeGreaterThanOrEqual(REMAINING_HP_FRACTION);
    expect(bossTwoLevel2.remainingRatio).toBeGreaterThanOrEqual(REMAINING_HP_FRACTION);
  });

  it("wave 20 dies once basic level 3 is available", () => {
    expect(bossTwoLevel3.basicLevel3Count).toBeGreaterThan(0);
    expect(bossTwoLevel3.damageRatio).toBeGreaterThanOrEqual(1);
    expect(skillTreeContent.levelCosts[2]).toBe(16);
  });

  it("reports the scenario table for audit", () => {
    console.table(
      scenarioTable.map((row) => ({
        label: row.label,
        bossHp: Math.round(row.bossHp),
        trashHp: Math.round(row.trashHp),
        raw: Math.round(row.rawDamage),
        bossDamage: Math.round(row.bossDamage),
        ratio: Number(row.damageRatio.toFixed(3)),
        remaining: Number(row.remainingRatio.toFixed(3)),
        budget: row.budget,
        killGold: row.killGold,
        goldLeft: row.goldRemaining,
        basic: row.basicCount,
        ice: row.iceCount,
        basicL3: row.basicLevel3Count,
      })),
    );
    expect(scenarioTable).toHaveLength(3);
  });
});

describe("milestone threshold", () => {
  it("matches one level-2 basic's damage across the first 20 waves, past wave 10", () => {
    const throughWave10 = singleBasicDamageThrough(BOSS_ONE_WAVE);
    const throughWave20 = singleBasicDamageThrough(MILESTONE_REFERENCE_WAVES);
    const modeledThreshold = Math.floor(throughWave20 / 1000) * 1000;
    expect(modeledThreshold).toBeGreaterThan(throughWave10);
    expect(modeledThreshold).toBeLessThanOrEqual(throughWave20);
    expect(economyContent.milestoneThreshold).toBe(modeledThreshold);
    expect(towerTuning.milestoneMaxTiers).toBe(5);
  });
});

describe("boss cadence", () => {
  it("keeps region cadences at 10, 8, and 5", () => {
    expect(enemiesContent.bossCadence).toEqual([10, 8, 5]);
  });
});
