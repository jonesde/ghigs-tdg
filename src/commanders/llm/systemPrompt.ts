import { formatEnemyLevelHpMult } from "@/content/formulas.js";
import { getGameContent } from "@/content/gameContent.js";
import {
  BETWEEN_WAVES_TIMER,
  ENEMY_TYPES,
  ENEMY_WAVE_DAMAGE_MULT,
  PRE_EMPTIVE_WAVE_TIMER,
  VICTORY_WAVE,
} from "@/sim/Constants.js";
import {
  TOWER_BASE,
  TOWER_LEVEL_DMG_MULT,
  TOWER_LEVEL_RANGE_MULT,
  TOWER_LEVEL_RATE_MULT,
  TOWER_META,
} from "@/sim/ConstantsTower.js";
import type { LlmCommanderConfig } from "./types.js";

function describeEnemyTypes(): string {
  const lines: string[] = [];
  for (const [typeName, meta] of Object.entries(ENEMY_TYPES)) {
    lines.push(
      `- ${typeName}: baseHp=${meta.baseHp}, speed=${meta.speed}, bounty=${meta.bounty}, attackDamage=${meta.attackDamage}, attackSpeed=${meta.attackSpeed}` +
        (meta.shield ? `, shield=${meta.shield}` : "") +
        (meta.heal ? `, heal=${meta.heal}` : ""),
    );
  }
  return lines.join("\n");
}

function describeTowerTypes(): string {
  const lines: string[] = [];
  for (const [towerName, meta] of Object.entries(TOWER_META)) {
    const base = TOWER_BASE[towerName];
    if (!base) continue;
    lines.push(
      `- ${towerName}: cost=${meta.cost}, range=${base.range}, damage=${base.damage}, fireRate=${base.fireRate}, health=${base.health}`,
    );
  }
  return lines.join("\n");
}

// Assembles the system prompt at runtime from real constants so the numbers the
// model sees can never drift from the engine. The data-stream + command sections
// describe the exact JSON the brain sends/accepts.
export function buildSystemPrompt(config: LlmCommanderConfig, instructionsOverride?: string): string {
  const commanderInstructions =
    instructionsOverride && instructionsOverride.length > 0 ? instructionsOverride : config.commanderInstructions;

  const prompt = `${config.systemPrompt}

# World

You command the enemy army in a tile-based tower-defense game. Your objective is to destroy the defender base (tile value 2) by routing enemies to it. Enemies spawn from spawn tiles (tile value 3) and travel along path tiles (tile value 1); terrain tiles (value 0) are impassable. Pathing is a Recast navmesh with DetourCrowd local avoidance. Newly built towers are obstacles, so enemies route around them while a corridor remains. A fully blocked corridor stops default movement; llm:siegeTower attacks that tower until it is ghosted, then the enemy returns to default pathing toward the base.

- Grid layout semantics: 0 = terrain, 1 = path, 2 = base, 3 = spawn.
- Coordinates are TILE coordinates (column x, row y). The map is delivered to you as a 2D array map[y][x] of these values. Do NOT convert between tile and world space; every coordinate you emit is a tile.
- 'meta.tileSize' defaults to 36 (world units per tile); you only need tile coordinates.

# Enemy types (base stats)

${describeEnemyTypes()}

Enemy HP scales by level and wave: hp = baseHp * (${formatEnemyLevelHpMult(getGameContent().enemies.levelHpMult)}) * (1 + ${ENEMY_WAVE_DAMAGE_MULT} * (wave - 1)).

# Tower types (base level 1 stats)

${describeTowerTypes()}

Towers scale per level: damage * ${TOWER_LEVEL_DMG_MULT}^(level-1), fireRate * ${TOWER_LEVEL_RATE_MULT}^(level-1), range * ${TOWER_LEVEL_RANGE_MULT}^(level-1).

# Waves

Enemies spawn from a QUEUE. Between waves there is a ${BETWEEN_WAVES_TIMER}s inter-wave timer, and a preemptive next-wave timer of ${PRE_EMPTIVE_WAVE_TIMER} game-seconds after a wave starts (regardless of survivors). Reaching wave ${VICTORY_WAVE} triggers victory. There is NO hard cap on simultaneously-active enemies — concurrency is implicitly bounded by spawn pacing, not a fixed limit.

# Data stream

Each request resends the transcript. The first user message (and the first message after a context rebuild) is a FULL snapshot. Later user messages are DELTAS against that transcript. The map is only in a full snapshot.

- Enemy fields: id, type, x, y, level, hp, maxHp, routingMode (default | hold | route | siege), attackingBase, blockedByTowerTile, distanceToBase, targetingMode (null when unset, otherwise one of the setTargeting modes).
- Tower fields: type, x, y, level, hp, maxHp, distanceToBase. distanceToBase is the nav distance of the nearest path, spawn, or base tile; a terrain tower is snapped to that tile. -1 means no walkable tile. Towers with hp <= 0 are omitted. A tower that drops to 0 hp is listed in removedTowers.
- A delta contains newEnemies (full entry), changedEnemies (same fields; emitted when tile, hp, maxHp, routingMode, attackingBase, blockedByTowerTile, targetingMode, or distanceToBase changed), removedEnemyIds, newTowers, changedTowers (hp, maxHp, level, or distanceToBase), removedTowers ({x, y}), and the wave summary.
- Wave summary fields: currentWave, pendingEnemyCount, remainingScheduledSpawns, active, baseHp, maxBaseHp, countdownSeconds (inter-wave seconds remaining, or null while a wave is spawning).
- Your own prior replies stay in the transcript as assistant messages until a context rebuild replaces the transcript with a new full snapshot.

# Commands

The command rules in this section override any shorter command list in the preface above.

You may emit ONLY the following commands as a JSON array (or { "commands": [...], "chat": "..." }). Coordinates are TILE coordinates. Commands in one array apply in order. You MUST NOT emit llm:gridLayoutToggle or any other command type.

1. routeGroup — route a group of enemies:
   { "type": "llm:routeGroup", "enemyIds": [number], "hold": boolean, "holdTile": { "x": number, "y": number }, "waypoints": [ { "x": number, "y": number } ] }
   - hold=true parks the enemies at holdTile (or their current tile if omitted). hold=false releases them along waypoints (tile path) toward the base. waypoints may be empty to release to default pathing.
   - hold and route take priority over setTargeting until the enemies are released. The targeting policy is kept and resumes after release.
2. siegeTower — send enemies to attack one tower:
   { "type": "llm:siegeTower", "enemyIds": [number], "towerTile": { "x": number, "y": number } }
   - They path to that tower, attack it on contact, and return to default pathing when it is ghosted. This clears any setTargeting policy on those enemies.
3. setTargeting — set how those enemies pick a tower while they are not held or following waypoints:
   { "type": "llm:setTargeting", "enemyIds": [number], "mode": string }
   - default: clear the policy. Enemies path to the base and, if stuck on a tower, commit to sieging it.
   - base: path to the base and do not commit to a blocking tower. Overlap still damages that tower.
   - nearest: siege the closest live tower (Euclidean tile distance; ties break by smaller y, then smaller x).
   - strongest: siege the live tower with the highest current health (ties use the nearest rule).
   - weakest: siege the live tower with the lowest current health (ties use the nearest rule).
   - strongestAhead: siege the highest-health live tower whose snapped distanceToBase is strictly smaller than the enemy's. The snap is the nearest path, spawn, or base tile. -1 means no walkable tile, and that tower is not ahead. If none qualify, behave as base.
   - Any other mode string is stored and does not change engagement.

Return ONLY the JSON command block (optionally with a "chat" field for a short message to the player).`;

  if (commanderInstructions && commanderInstructions.length > 0) {
    return `${prompt}

# Commander Instructions

${commanderInstructions}`;
  }
  return prompt;
}
