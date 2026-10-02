import { enemyBounty as computeEnemyBounty, enemyLevelHpMult as computeEnemyLevelHpMult } from "@/content/formulas.js";
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

// HP = baseHp * ENEMY_LEVEL_HP_MULT(level) * (1 + waveDamageMult*(wave-1))
export const ENEMY_LEVEL_HP_MULT = (level: number): number =>
  computeEnemyLevelHpMult(level, getGameContent().enemies.levelHpMult);

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
