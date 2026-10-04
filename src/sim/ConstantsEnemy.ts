import { enemyBounty as computeEnemyBounty, enemyLevelMult as computeEnemyLevelMult } from "@/content/formulas.js";
import { getGameContent } from "@/content/gameContent.js";

export interface EnemyMeta {
  baseHp: number;
  speed: number;
  bounty: number;
  radius: number;
  shield?: number;
  heal?: number;
  healRange?: number;
  resist?: number;
  slowResist?: number;
  attackDamage: number;
  attackSpeed: number;
  flyingHeight?: number;
}

export type EnemyType = "minion" | "runner" | "tank" | "shielded" | "healer" | "boss" | "flyer" | "jet" | "aegis";

const enemies = getGameContent().enemies;

export const ENEMY_TYPES: Record<string, EnemyMeta> = enemies.types as Record<string, EnemyMeta>;

// HP and damage scale independently: each has its own level coefficients
// (linear in level) and its own wave coefficient (linear in wave), both listed
// in enemies.json. Difficulty is a single shared multiplier over both.
// HP = baseHp * ENEMY_LEVEL_HP_MULT(level) * (1 + ENEMY_WAVE_HP_MULT*(wave-1)) * diffMult
// Damage = attackDamage * ENEMY_LEVEL_DAMAGE_MULT(level) * (1 + ENEMY_WAVE_DAMAGE_MULT*(wave-1)) * diffMult
export const ENEMY_LEVEL_HP_MULT = (level: number): number =>
  computeEnemyLevelMult(level, getGameContent().enemies.levelHpMult);

export const ENEMY_LEVEL_DAMAGE_MULT = (level: number): number =>
  computeEnemyLevelMult(level, getGameContent().enemies.levelDamageMult);

export interface EnemyTierThreshold {
  minWave: number;
  threshold: number;
  type: string;
}

// Order defines the cumulative draw bands; the healer entry is the one the
// wave generator staggers via HEALER_MIN_GAP.
export const ENEMY_TIER_THRESHOLDS: EnemyTierThreshold[] = enemies.tierThresholds;
export const HEALER_MIN_GAP = enemies.healerMinGap;

export const ENEMY_WAVE_HP_MULT = enemies.waveHpMult;
export const ENEMY_WAVE_DAMAGE_MULT = enemies.waveDamageMult;
export const BOUNTY_LEVEL_GROWTH = enemies.bountyLevelGrowth;
export const BOUNTY_FULL_THROUGH_WAVE = enemies.bountyFullThroughWave;
export const LATER_WAVE_BOUNTY_MULT = enemies.laterWaveBountyMult;

export function enemyLevelBounty(baseBounty: number, level: number, wave: number): number {
  return computeEnemyBounty(
    baseBounty,
    level,
    wave,
    BOUNTY_LEVEL_GROWTH,
    BOUNTY_FULL_THROUGH_WAVE,
    LATER_WAVE_BOUNTY_MULT,
  );
}

export const BOSS_STUN_REDUCTION = enemies.bossStunReduction;
export const MIN_SLOW_FACTOR = enemies.minSlowFactor;
export const MAX_BURN_STACKS = enemies.maxBurnStacks;
export const KNOCKBACK_BALLISTIC_SECONDS = enemies.knockbackBallisticSeconds;
export const AGENT_RESYNC_RADIUS_FRACTION = enemies.agentResyncRadiusFraction;
export const STUCK_RECOVERY_SECONDS = enemies.stuckRecoverySeconds;
export const BREACH_HYSTERESIS_SECONDS = enemies.breachHysteresisSeconds;
export const BREACH_REEVAL_SECONDS = enemies.breachReevalSeconds;
export const WAVE_COUNT_BASE = enemies.waveCountBase;
export const WAVE_COUNT_SCALE = enemies.waveCountScale;
export const BOSS_CADENCE = enemies.bossCadence;

// Enemy level grows one tier per three waves over the map level. The wave
// generator and the help dialog's enemy table read the same progression.
export function enemyLevelForWave(wave: number, mapLevel: number): number {
  return Math.max(1, Math.floor(wave / 3) + mapLevel);
}

export function waveUnitCount(wave: number): number {
  return WAVE_COUNT_BASE + Math.floor(wave * WAVE_COUNT_SCALE);
}

// Cadence waves carry a boss, and a second one once the wave number passes 30.
export function waveBossCount(wave: number, bossCadence: number): number {
  if (bossCadence <= 0 || wave % bossCadence !== 0) return 0;
  return 1 + Math.floor(wave / 30);
}
