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
  spawnIntervalSeconds?: number;
  spawnCap?: number;
  spawnType?: string;
}

export type EnemyType =
  | "minion"
  | "runner"
  | "tank"
  | "shielded"
  | "healer"
  | "mender"
  | "skyhold"
  | "broodwing"
  | "boss"
  | "flyer"
  | "jet"
  | "aegis";

const enemies = getGameContent().enemies;

export const ENEMY_TYPES: Record<string, EnemyMeta> = enemies.types as Record<string, EnemyMeta>;

// HP and damage scale independently: each has its own level coefficients
// (linear in level) and its own wave coefficient (linear in wave), both listed
// in enemies.json, plus a late exponential that only bites past
// LATE_WAVE_START_WAVE so earlier waves are untouched. Difficulty is a single
// shared multiplier over both.
// HP = baseHp * ENEMY_LEVEL_HP_MULT(level) * (1 + ENEMY_WAVE_HP_MULT*(wave-1)) * lateHpMult(wave) * diffMult
// Damage = attackDamage * ENEMY_LEVEL_DAMAGE_MULT(level) * (1 + ENEMY_WAVE_DAMAGE_MULT*(wave-1)) * lateDamageMult(wave) * diffMult
// lateHpMult / lateDamageMult live in enemyWaveStats.ts, which is the only
// place the two curves are applied (to HP and to the shield as well).
export const ENEMY_LEVEL_HP_MULT = (level: number): number =>
  computeEnemyLevelMult(level, getGameContent().enemies.levelHpMult);

export const ENEMY_LEVEL_DAMAGE_MULT = (level: number): number =>
  computeEnemyLevelMult(level, getGameContent().enemies.levelDamageMult);

export interface EnemyTierThreshold {
  minWave: number;
  threshold: number;
  rampPerWave?: number | undefined;
  maxThreshold?: number | undefined;
  type: string;
}

// A tier band widens after its debut: threshold grows by rampPerWave per wave
// past minWave up to maxThreshold, so late intros (mender/skyhold/broodwing)
// start rare and end dominant. Bands without a ramp stay flat.
//
// The caps are also what retires the minion. WaveManager draws a type by walking
// the bands in order and taking the first whose cumulative mass the roll falls
// under, so the bands' total mass is a probability ceiling: the three caps
// (0.24 / 0.20 / 0.20) plus the flat bands reach 0.946 at wave 80 and 1.001 at
// wave 85. Past that the roll always lands inside a band and the minion — the
// type with no band of its own, the fallthrough at the end of rollType — stops
// appearing. Lowering a cap below that sum brings it back.
export function tierThresholdForWave(tier: EnemyTierThreshold, wave: number): number {
  if (wave < tier.minWave) return 0;
  if (!tier.rampPerWave || tier.rampPerWave <= 0) return tier.threshold;
  const cap = tier.maxThreshold ?? tier.threshold;
  return Math.min(cap, tier.threshold + tier.rampPerWave * (wave - tier.minWave));
}

// Order defines the cumulative draw bands; the healer entry is the one the
// wave generator staggers via HEALER_MIN_GAP.
export const ENEMY_TIER_THRESHOLDS: EnemyTierThreshold[] = enemies.tierThresholds;
export const HEALER_MIN_GAP = enemies.healerMinGap;

// The roster as the UI presents it: ground units, then the airborne types, then
// the boss. Written out rather than taken from the pack key order because the
// help table and the stats composition list both read it as the display order,
// and the pack interleaves the airborne types with the ground ones.
export const ENEMY_ORDER: readonly string[] = [
  "minion",
  "runner",
  "tank",
  "shielded",
  "healer",
  "mender",
  "flyer",
  "jet",
  "aegis",
  "skyhold",
  "broodwing",
  "boss",
];

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
export const STUN_CAP_PER_SECOND = enemies.stunCapPerSecond;
export const STUN_WINDOW_SECONDS = enemies.stunWindowSeconds;
export const LATE_WAVE_HP_GROWTH = enemies.lateWaveHpGrowth;
export const LATE_WAVE_START_WAVE = enemies.lateWaveStartWave;
export const LATE_WAVE_DAMAGE_GROWTH = enemies.lateWaveDamageGrowth;
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
