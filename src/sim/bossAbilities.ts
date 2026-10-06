import type { Enemy } from "@/sim/enemies/Enemy.js";
import { mulberry32 } from "@/sim/grid/Map.js";

// Separate from WaveManager's mulberry32(map.seed) stream. Drawing an ability
// must not change which units a wave rolls.
export const BOSS_ABILITY_IDS = ["none", "spawnMinions", "healAura", "speedAura", "shieldPulse", "towerShot"] as const;

export type BossAbilityId = (typeof BOSS_ABILITY_IDS)[number];

const ABILITY_POOL: BossAbilityId[] = ["spawnMinions", "healAura", "speedAura", "shieldPulse", "towerShot"];
const ABILITY_ROLL_TAG = 0xb055;

export const MINION_INTERVAL_SECONDS = 3;
export const MINION_FIRST_DELAY_SECONDS = 3;
export const MINION_CAP = 10;
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

// Trickle spawner accounting: one child per pulse while the spawner is under
// its own live-child cap and the run is under the gameplay enemy cap.
// Otherwise the pulse is skipped (never queued).
export function trickleSpawnCount(spawnCap: number, liveChildren: number, liveTotal: number, enemyCap: number): number {
  if (spawnCap <= 0 || liveChildren >= spawnCap) return 0;
  if (liveTotal >= enemyCap) return 0;
  return 1;
}

export interface MendSource {
  id: number;
  x: number;
  y: number;
  removed: boolean;
  healSelf: boolean;
  antiHealTimer: number;
}

// The eligible Mend sources as of one tick, in the shape the suppress check reads.
// GameEngine rebuilds this list once per tick and the per-ally check walks it, so
// a heal tick costs O(sources) per ally instead of O(enemies).
export interface ActiveMendSource {
  id: number;
  x: number;
  y: number;
}

export function collectMendSources(enemies: readonly MendSource[]): ActiveMendSource[] {
  return collectMendSourcesInto(enemies, []);
}

// Same list as collectMendSources, written into a caller-owned buffer. GameEngine
// rebuilds it once per tick, so the per-tick path keeps the array and the source
// objects off the allocation path the way the cache shot-target buffer does.
// Entries are only read within the same tick (the Mend heal tick), before the next
// rebuild overwrites them.
export function collectMendSourcesInto(
  enemies: readonly MendSource[],
  sources: ActiveMendSource[],
): ActiveMendSource[] {
  let count = 0;
  for (const enemy of enemies) {
    if (enemy.removed || !enemy.healSelf || enemy.antiHealTimer > 0) continue;
    const existing = sources[count];
    if (existing) {
      existing.id = enemy.id;
      existing.x = enemy.x;
      existing.y = enemy.y;
    } else {
      sources.push({ id: enemy.id, x: enemy.x, y: enemy.y });
    }
    count += 1;
  }
  sources.length = count;
  return sources;
}

// Two Mend bosses do not add their rates: the nearest eligible source wins, so a
// second one is suppressed. A normal healer carries healSelf false and never enters
// the source list, which is what keeps its aura stacking with a Mend boss.
export function nearerMendBlocksIn(
  sources: readonly ActiveMendSource[],
  source: MendSource,
  ally: MendSource,
): boolean {
  let nearestId = -1;
  let nearestDistance = Infinity;
  for (const candidate of sources) {
    const deltaX = candidate.x - ally.x;
    const deltaY = candidate.y - ally.y;
    const distance = deltaX * deltaX + deltaY * deltaY;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestId = candidate.id;
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
  if (ability === "spawnMinions") enemy.minionTimer = MINION_FIRST_DELAY_SECONDS;
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
  // Resolved only when a towerShot boss arms a bombard. A wave without one never
  // asks, so the sim does not pay for a tower list on ticks that cannot use it.
  towers: () => readonly BossShotTarget[];
  // Emits one summoned child for a spawner pulse. The engine drops the pulse
  // when the spawner is at its live-child cap or the run is at the enemy cap.
  spawnMinions: (host: Enemy) => void;
  damageTower: (towerId: string, amount: number, attacker: Enemy) => void;
}

export interface BossAbilityServices {
  readonly towers: () => readonly BossShotTarget[];
  readonly spawnMinions: (host: Enemy) => void;
  readonly damageTower: (towerId: string, amount: number, attacker: Enemy) => void;
}

// Owns the services the ability ticks call back into for one run. Holding them
// across ticks keeps the per-tick path free of a context literal and closures;
// tileSize stays per tick because a grid resize can change it between ticks.
export class BossAbilityRuntime {
  private readonly context: BossTickContext;

  constructor(services: BossAbilityServices) {
    this.context = {
      tileSize: 0,
      towers: services.towers,
      spawnMinions: services.spawnMinions,
      damageTower: services.damageTower,
    };
  }

  tick(enemies: readonly Enemy[], dt: number, tileSize: number): void {
    this.context.tileSize = tileSize;
    tickBossAbilities(enemies, dt, this.context);
  }
}

export function tickBossAbilities(enemies: readonly Enemy[], dt: number, context: BossTickContext): void {
  resetHaste(enemies);
  applyHasteAuras(enemies, context.tileSize);
  for (const enemy of enemies) {
    if (enemy.removed || enemy.stunTimer > 0) continue;
    // Stun is a full action freeze: minion pulses, shield pulses, and the
    // bombard (armed and in flight) all hold while the source is stunned.
    if (enemy.type === "boss") {
      if (enemy.bossAbility === "spawnMinions") tickMinions(enemy, dt, context);
      if (enemy.bossAbility === "shieldPulse") tickShield(enemy, dt, enemies, context.tileSize);
      if (enemy.bossAbility === "towerShot") tickBombard(enemy, dt, context);
    } else if (enemy.spawnsMinions) {
      tickMinions(enemy, dt, context);
    }
  }
}

function resetHaste(enemies: readonly Enemy[]): void {
  for (const enemy of enemies) {
    if (enemy.removed) continue;
    // A stunned haste boss holds no aura, its own included, while frozen.
    enemy.hasteFactor = enemy.bossAbility === "speedAura" && enemy.stunTimer <= 0 ? HASTE_BOSS_FACTOR : 1;
  }
}

function applyHasteAuras(enemies: readonly Enemy[], tileSize: number): void {
  const radius = HASTE_AURA_RANGE_TILES * tileSize;
  const radiusSquared = radius * radius;
  for (const source of enemies) {
    if (source.removed || source.bossAbility !== "speedAura" || source.stunTimer > 0) continue;
    for (const other of enemies) {
      if (other.removed || other === source || other.bossAbility === "speedAura") continue;
      const deltaX = other.x - source.x;
      const deltaY = other.y - source.y;
      if (deltaX * deltaX + deltaY * deltaY > radiusSquared) continue;
      if (other.hasteFactor < HASTE_AURA_FACTOR) other.hasteFactor = HASTE_AURA_FACTOR;
    }
  }
}

function tickMinions(host: Enemy, dt: number, context: BossTickContext): void {
  host.minionTimer -= dt;
  if (host.minionTimer > 0) return;
  // Broodwings carry their own interval from the enemy meta; bosses use the
  // shared ability cadence. First delay is armed at construction/stamp time.
  host.minionTimer = host.spawnIntervalSeconds > 0 ? host.spawnIntervalSeconds : MINION_INTERVAL_SECONDS;
  // attackAnimTime is a timestamp. The render plays the attack frames from it.
  host.attackAnimTime = host.gameSeconds;
  context.spawnMinions(host);
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

// The loop in tickBossAbilities skips stunned bosses, so an armed telegraph holds
// its remaining time and the shot does not resolve while the boss is stunned.
function tickBombard(boss: Enemy, dt: number, context: BossTickContext): void {
  if (boss.bombardTelegraphRemaining > 0) {
    boss.bombardTelegraphRemaining -= dt;
    if (boss.bombardTelegraphRemaining > 0) return;
    boss.bombardTelegraphRemaining = 0;
    const targetId = boss.bombardTargetId;
    boss.bombardTargetId = null;
    if (!targetId) return;
    // damageTower drops the hit when the tower is gone or has become a ghost,
    // which is the same check the old id lookup into the tower list made.
    context.damageTower(targetId, boss.attackDamage * BOMBARD_DAMAGE_FRACTION, boss);
    return;
  }
  boss.bombardTimer -= dt;
  if (boss.bombardTimer > 0) return;
  boss.bombardTimer = BOMBARD_INTERVAL_SECONDS;
  const target = nearestTower(boss, context.towers(), BOMBARD_RANGE_TILES * context.tileSize);
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
