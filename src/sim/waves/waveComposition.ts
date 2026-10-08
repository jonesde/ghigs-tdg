import { getGameContent } from "@/content/gameContent.js";
import type { EnemiesContent } from "@/content/schemas/enemies.js";

type EnemyTierThreshold = EnemiesContent["tierThresholds"][number];

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

// Enemy level grows one tier per three waves over the map level. The wave
// generator and the help dialog's enemy table read the same progression.
export function enemyLevelForWave(wave: number, mapLevel: number): number {
  return Math.max(1, Math.floor(wave / 3) + mapLevel);
}

export function waveUnitCount(wave: number): number {
  return getGameContent().enemies.waveCountBase + Math.floor(wave * getGameContent().enemies.waveCountScale);
}

// Waves 1..15 on a progressive map ramp the map-level term from 1 up to the real
// map level, so a level-12 board does not open on level-12 minions. Wave 15
// matches enemyLevelForWave; later waves use that function unchanged.
export const progressiveEarlyWaveCount = 15;
const progressiveEarlyWaveSpan = progressiveEarlyWaveCount - 1;
const progressiveEarlyEntryWeight = 0.25;

export function progressiveEnemyLevel(wave: number, mapLevel: number): number {
  if (wave > progressiveEarlyWaveCount) return enemyLevelForWave(wave, mapLevel);
  const progress = (wave - 1) / progressiveEarlyWaveSpan;
  const rampedMapLevel = 1 + Math.round((mapLevel - 1) * progress);
  return Math.max(1, Math.floor(wave / 3) + rampedMapLevel);
}

// Count scale holds bounty steady while the level ramp is below the real map
// level (raw bounty factor, not the ceiled payout), then adds a quarter per
// entry past the first so each extra mouth still pays for a tower.
export function progressiveWaveUnitCount(wave: number, mapLevel: number, entryCount: number): number {
  const baseCount = waveUnitCount(wave);
  if (wave > progressiveEarlyWaveCount) return baseCount;
  const bountyLevelGrowth = getGameContent().enemies.bountyLevelGrowth;
  const normalFactor = 1 + bountyLevelGrowth * (enemyLevelForWave(wave, mapLevel) - 1);
  const rampedFactor = 1 + bountyLevelGrowth * (progressiveEnemyLevel(wave, mapLevel) - 1);
  const scale = normalFactor / rampedFactor;
  const safeEntryCount = Math.max(1, entryCount);
  const entryScale = 1 + progressiveEarlyEntryWeight * (safeEntryCount - 1);
  return Math.max(baseCount, Math.round(baseCount * scale * entryScale));
}

// Cadence waves carry a boss, and a second one once the wave number passes 30.
export function waveBossCount(wave: number, bossCadence: number): number {
  if (bossCadence <= 0 || wave % bossCadence !== 0) return 0;
  return 1 + Math.floor(wave / 30);
}
