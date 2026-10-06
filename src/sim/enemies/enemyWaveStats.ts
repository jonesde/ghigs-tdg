import { DIFFICULTY_MULT_TICK } from "@/sim/Constants.js";
import {
  ENEMY_LEVEL_DAMAGE_MULT,
  ENEMY_LEVEL_HP_MULT,
  ENEMY_WAVE_DAMAGE_MULT,
  ENEMY_WAVE_HP_MULT,
  enemyLevelBounty,
  LATE_WAVE_DAMAGE_GROWTH,
  LATE_WAVE_HP_GROWTH,
  LATE_WAVE_START_WAVE,
} from "@/sim/ConstantsEnemy.js";

interface EnemyCombatMeta {
  baseHp: number;
  bounty: number;
  attackDamage: number;
  attackSpeed: number;
  shield?: number;
}

export interface EnemyWaveStats {
  maxHp: number;
  attackDamage: number;
  attackDps: number;
  bounty: number;
  shield: number;
}

// HP and damage scale independently: each has its own level coefficients
// (linear in level) and its own wave coefficient (linear in wave), plus a late
// exponential steepening that starts at LATE_WAVE_START_WAVE and leaves
// earlier waves bit-identical. Difficulty is a single shared multiplier over both.
// HP = baseHp * ENEMY_LEVEL_HP_MULT(level) * (1 + ENEMY_WAVE_HP_MULT*(wave-1)) * lateHpMult(wave) * diffMult
// Damage = attackDamage * ENEMY_LEVEL_DAMAGE_MULT(level) * (1 + ENEMY_WAVE_DAMAGE_MULT*(wave-1)) * lateDamageMult(wave) * diffMult
// Shield scales with exactly the same HP factors: shielded types carry a shield
// instead of health, so the shield:HP ratio is constant across the run.
export function lateHpMult(wave: number): number {
  const pastStart = Math.max(0, wave - LATE_WAVE_START_WAVE);
  return (1 + LATE_WAVE_HP_GROWTH) ** pastStart;
}

export function lateDamageMult(wave: number): number {
  const pastStart = Math.max(0, wave - LATE_WAVE_START_WAVE);
  return (1 + LATE_WAVE_DAMAGE_GROWTH) ** pastStart;
}

export function computeEnemyWaveStats(
  meta: EnemyCombatMeta,
  level: number,
  wave: number,
  difficultyTick: number,
): EnemyWaveStats {
  const waveHpMult = 1 + ENEMY_WAVE_HP_MULT * (wave - 1);
  const waveDamageMult = 1 + ENEMY_WAVE_DAMAGE_MULT * (wave - 1);
  const diffMult = (difficultyTick || 0) * DIFFICULTY_MULT_TICK + 1;
  const hpMult = ENEMY_LEVEL_HP_MULT(level) * waveHpMult * lateHpMult(wave) * diffMult;
  const attackDamage =
    meta.attackDamage * ENEMY_LEVEL_DAMAGE_MULT(level) * waveDamageMult * lateDamageMult(wave) * diffMult;
  return {
    maxHp: meta.baseHp * hpMult,
    attackDamage,
    attackDps: attackDamage * meta.attackSpeed,
    bounty: enemyLevelBounty(meta.bounty, level, wave),
    shield: meta.shield ? meta.shield * hpMult : 0,
  };
}
