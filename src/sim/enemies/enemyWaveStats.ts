import { DIFFICULTY_MULT_TICK } from "@/sim/Constants.js";
import {
  ENEMY_LEVEL_DAMAGE_MULT,
  ENEMY_LEVEL_HP_MULT,
  ENEMY_WAVE_DAMAGE_MULT,
  ENEMY_WAVE_HP_MULT,
  enemyLevelBounty,
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
// (linear in level) and its own wave coefficient (linear in wave). Difficulty is
// a single shared multiplier over both.
// HP = baseHp * ENEMY_LEVEL_HP_MULT(level) * (1 + ENEMY_WAVE_HP_MULT*(wave-1)) * diffMult
// Damage = attackDamage * ENEMY_LEVEL_DAMAGE_MULT(level) * (1 + ENEMY_WAVE_DAMAGE_MULT*(wave-1)) * diffMult
export function computeEnemyWaveStats(
  meta: EnemyCombatMeta,
  level: number,
  wave: number,
  difficultyTick: number,
): EnemyWaveStats {
  const waveHpMult = 1 + ENEMY_WAVE_HP_MULT * (wave - 1);
  const waveDamageMult = 1 + ENEMY_WAVE_DAMAGE_MULT * (wave - 1);
  const diffMult = (difficultyTick || 0) * DIFFICULTY_MULT_TICK + 1;
  const attackDamage = meta.attackDamage * ENEMY_LEVEL_DAMAGE_MULT(level) * waveDamageMult * diffMult;
  return {
    maxHp: meta.baseHp * ENEMY_LEVEL_HP_MULT(level) * waveHpMult * diffMult,
    attackDamage,
    attackDps: attackDamage * meta.attackSpeed,
    bounty: enemyLevelBounty(meta.bounty, level, wave),
    shield: meta.shield ? meta.shield * level : 0,
  };
}
