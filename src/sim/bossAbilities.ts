import type { Enemy } from "@/sim/enemies/Enemy.js";
import { mulberry32 } from "@/sim/grid/Map.js";

// Separate from WaveManager's mulberry32(map.seed) stream. Drawing an ability
// must not change which units a wave rolls.
export const BOSS_ABILITY_IDS = ["none", "spawnMinions", "healAura", "speedAura", "shieldPulse", "towerShot"] as const;

export type BossAbilityId = (typeof BOSS_ABILITY_IDS)[number];

const ABILITY_POOL: BossAbilityId[] = ["spawnMinions", "healAura", "speedAura", "shieldPulse", "towerShot"];
const ABILITY_ROLL_TAG = 0xb055;

export const MINION_INTERVAL_SECONDS = 30;
export const MINION_CAP = 8;
export const HEAL_AURA_FRACTION_PER_SECOND = 0.02;
export const HEAL_AURA_RANGE_TILES = 2.5;
export const HASTE_BOSS_FACTOR = 1.2;
export const HASTE_AURA_FACTOR = 1.5;
export const HASTE_AURA_RANGE_TILES = 3;
export const SHIELD_INTERVAL_SECONDS = 15;
export const SHIELD_FIRST_DELAY_SECONDS = 2;
export const SHIELD_FRACTION = 0.25;
export const SHIELD_RANGE_TILES = 2.5;
export const BOMBARD_INTERVAL_SECONDS = 18;
export const BOMBARD_FIRST_DELAY_SECONDS = 12;
export const BOMBARD_RANGE_TILES = 6;
export const BOMBARD_DAMAGE_FRACTION = 0.3;
export const BOMBARD_TELEGRAPH_SECONDS = 1.5;

const ABILITY_LABELS: Record<BossAbilityId, string> = {
  none: "Boss",
  spawnMinions: "Minions",
  healAura: "Mend",
  speedAura: "Haste",
  shieldPulse: "Shield",
  towerShot: "Bombard",
};

export function bossAbilityLabel(ability: BossAbilityId): string {
  return ABILITY_LABELS[ability];
}

export function bossAbilitySeed(mapSeed: number, waveNumber: number): number {
  let mixed = Math.imul(mapSeed ^ ABILITY_ROLL_TAG, 0x9e3779b1);
  mixed ^= Math.imul(waveNumber + 1, 0x85ebca6b);
  return mixed >>> 0;
}

// Without replacement inside one wave. vanillaFirst forces index 0 to none and
// does not consume a pool entry, so the first boss of a run still leaves four
// real abilities for a later four-boss wave.
export function rollBossAbilities(
  mapSeed: number,
  waveNumber: number,
  count: number,
  vanillaFirst: boolean,
): BossAbilityId[] {
  if (count <= 0) return [];
  const rng = mulberry32(bossAbilitySeed(mapSeed, waveNumber));
  const pool = [...ABILITY_POOL];
  const abilities: BossAbilityId[] = [];
  for (let index = 0; index < count; index++) {
    if (vanillaFirst && index === 0) {
      abilities.push("none");
      continue;
    }
    if (pool.length === 0) {
      abilities.push("none");
      continue;
    }
    const pick = Math.floor(rng() * pool.length);
    const ability = pool.splice(pick, 1)[0];
    abilities.push(ability ?? "none");
  }
  return abilities;
}

export function minionPulseCount(waveNumber: number, liveCount: number, enemyCap: number): number {
  const wanted = Math.min(MINION_CAP, Math.max(1, Math.round(waveNumber * 0.5)));
  const slack = Math.max(0, enemyCap - liveCount);
  return Math.min(wanted, slack);
}

export interface MendSource {
  id: number;
  x: number;
  y: number;
  removed: boolean;
  healSelf: boolean;
  antiHealTimer: number;
}

// Two Mend bosses do not add their rates. The nearer living source wins. A
// normal healer has healSelf false and is ignored here, so its aura still stacks.
export function nearerMendBlocks(source: MendSource, ally: MendSource, enemies: readonly MendSource[]): boolean {
  let nearestId = -1;
  let nearestDistance = Infinity;
  for (const enemy of enemies) {
    if (enemy.removed || !enemy.healSelf || enemy.antiHealTimer > 0) continue;
    const deltaX = enemy.x - ally.x;
    const deltaY = enemy.y - ally.y;
    const distance = deltaX * deltaX + deltaY * deltaY;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestId = enemy.id;
    }
  }
  return nearestId !== -1 && nearestId !== source.id;
}

// Writes the ability's runtime fields. Call this when the boss body is created,
// not when the wave is planned, so a boss that never leaves the pending queue
// does not consume the vanilla-first slot.
export function configureBossAbility(enemy: Enemy, ability: BossAbilityId, tileSize: number): void {
  enemy.bossAbility = ability;
  if (ability === "healAura") {
    enemy.heal = HEAL_AURA_FRACTION_PER_SECOND;
    enemy.healRange = HEAL_AURA_RANGE_TILES * tileSize;
    enemy.healSelf = true;
  }
  if (ability === "speedAura") enemy.hasteFactor = HASTE_BOSS_FACTOR;
  if (ability === "spawnMinions") enemy.minionTimer = MINION_INTERVAL_SECONDS;
  if (ability === "shieldPulse") enemy.shieldTimer = SHIELD_FIRST_DELAY_SECONDS;
  if (ability === "towerShot") enemy.bombardTimer = BOMBARD_FIRST_DELAY_SECONDS;
}

export interface BossShotTarget {
  id: string;
  x: number;
  y: number;
  isGhost: boolean;
}

export interface BossTickContext {
  tileSize: number;
  towers: readonly BossShotTarget[];
  // Spawns only the slack under the live cap. Overflow is discarded, not queued.
  spawnMinions: (boss: Enemy) => void;
  damageTower: (towerId: string, amount: number, attacker: Enemy) => void;
}

export function tickBossAbilities(enemies: readonly Enemy[], dt: number, context: BossTickContext): void {
  resetHaste(enemies);
  applyHasteAuras(enemies, context.tileSize);
  for (const enemy of enemies) {
    if (enemy.removed || enemy.type !== "boss") continue;
    if (enemy.bossAbility === "spawnMinions") tickMinions(enemy, dt, context);
    if (enemy.bossAbility === "shieldPulse") tickShield(enemy, dt, enemies, context.tileSize);
    if (enemy.bossAbility === "towerShot") tickBombard(enemy, dt, context);
  }
}

function resetHaste(enemies: readonly Enemy[]): void {
  for (const enemy of enemies) {
    if (enemy.removed) continue;
    enemy.hasteFactor = enemy.bossAbility === "speedAura" ? HASTE_BOSS_FACTOR : 1;
  }
}

function applyHasteAuras(enemies: readonly Enemy[], tileSize: number): void {
  const radius = HASTE_AURA_RANGE_TILES * tileSize;
  const radiusSquared = radius * radius;
  for (const source of enemies) {
    if (source.removed || source.bossAbility !== "speedAura") continue;
    for (const other of enemies) {
      if (other.removed || other === source || other.bossAbility === "speedAura") continue;
      const deltaX = other.x - source.x;
      const deltaY = other.y - source.y;
      if (deltaX * deltaX + deltaY * deltaY > radiusSquared) continue;
      if (other.hasteFactor < HASTE_AURA_FACTOR) other.hasteFactor = HASTE_AURA_FACTOR;
    }
  }
}

function tickMinions(boss: Enemy, dt: number, context: BossTickContext): void {
  boss.minionTimer -= dt;
  if (boss.minionTimer > 0) return;
  boss.minionTimer = MINION_INTERVAL_SECONDS;
  // attackAnimTime is a timestamp. The render plays the boss attack frames from it.
  boss.attackAnimTime = boss.gameSeconds;
  context.spawnMinions(boss);
}

function tickShield(boss: Enemy, dt: number, enemies: readonly Enemy[], tileSize: number): void {
  boss.shieldTimer -= dt;
  if (boss.shieldTimer > 0) return;
  boss.shieldTimer = SHIELD_INTERVAL_SECONDS;
  const radius = SHIELD_RANGE_TILES * tileSize;
  const radiusSquared = radius * radius;
  for (const enemy of enemies) {
    if (enemy.removed) continue;
    if (enemy !== boss) {
      const deltaX = enemy.x - boss.x;
      const deltaY = enemy.y - boss.y;
      if (deltaX * deltaX + deltaY * deltaY > radiusSquared) continue;
    }
    const grant = enemy.maxHp * SHIELD_FRACTION;
    // Refresh up to a quarter of max HP. A larger shield the enemy already has stays.
    if (enemy.shield < grant) enemy.shield = grant;
    if (enemy.maxShield < enemy.shield) enemy.maxShield = enemy.shield;
  }
}

function tickBombard(boss: Enemy, dt: number, context: BossTickContext): void {
  if (boss.bombardTelegraphRemaining > 0) {
    // Stun freezes the telegraph. The shot does not resolve while the boss is stunned.
    if (boss.stunTimer > 0) return;
    boss.bombardTelegraphRemaining -= dt;
    if (boss.bombardTelegraphRemaining > 0) return;
    boss.bombardTelegraphRemaining = 0;
    const targetId = boss.bombardTargetId;
    boss.bombardTargetId = null;
    if (!targetId) return;
    const tower = context.towers.find((candidate) => candidate.id === targetId);
    if (!tower || tower.isGhost) return;
    context.damageTower(targetId, boss.attackDamage * BOMBARD_DAMAGE_FRACTION, boss);
    return;
  }
  boss.bombardTimer -= dt;
  if (boss.bombardTimer > 0) return;
  boss.bombardTimer = BOMBARD_INTERVAL_SECONDS;
  const target = nearestTower(boss, context.towers, BOMBARD_RANGE_TILES * context.tileSize);
  if (!target) return;
  boss.bombardTelegraphRemaining = BOMBARD_TELEGRAPH_SECONDS;
  boss.bombardTargetId = target.id;
  boss.bombardTargetX = target.x;
  boss.bombardTargetY = target.y;
  boss.attackAnimTime = boss.gameSeconds;
}

function nearestTower(boss: Enemy, towers: readonly BossShotTarget[], range: number): BossShotTarget | null {
  let nearest: BossShotTarget | null = null;
  let nearestDistance = range;
  for (const tower of towers) {
    if (tower.isGhost) continue;
    const distance = Math.hypot(tower.x - boss.x, tower.y - boss.y);
    if (distance > nearestDistance) continue;
    nearest = tower;
    nearestDistance = distance;
  }
  return nearest;
}
