import { formatEnemyLevelMult } from "@/content/formulas.js";
import { getGameContent } from "@/content/gameContent.js";
import type { LlmCommanderConfig } from "./types.js";

function describeEnemyTypes(): string {
  const lines: string[] = [];
  for (const [typeName, meta] of Object.entries(getGameContent().enemies.types)) {
    lines.push(
      `- ${typeName}: baseHp=${meta.baseHp}, speed=${meta.speed}, bounty=${meta.bounty}, attackDamage=${meta.attackDamage}, attackSpeed=${meta.attackSpeed}, flyingHeight=${meta.flyingHeight ?? 0}` +
        (meta.shield ? `, shield=${meta.shield}` : "") +
        (meta.heal ? `, heal=${meta.heal}` : ""),
    );
  }
  return lines.join("\n");
}

function describeTowerTypes(): string {
  const lines: string[] = [];
  for (const [towerName, meta] of Object.entries(getGameContent().towers.meta)) {
    const base = getGameContent().towers.base[towerName];
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

You command the enemy army in a tile-based tower-defense game. Your objective is to destroy the defender base (tile value 2) by routing enemies to it. Enemies spawn from spawn tiles (tile value 3). flyingHeight 0 travels along path tiles (tile value 1); terrain tiles (value 0) block them. Pathing for flyingHeight 0 is a Recast navmesh with DetourCrowd local avoidance. Newly built towers are obstacles on that navmesh, so those enemies route around them while a corridor remains. A fully blocked corridor stops default movement; llm:siegeTower attacks that tower until it is ghosted, then the enemy returns to default pathing toward the base.

- Grid layout semantics: 0 = terrain, 1 = path, 2 = base, 3 = spawn.
- heights[y][x] is the stored tile height and does not change when towers are built or sold. Effective height is heights[y][x], plus 1 when a live tower occupies that tile. A ghost or a sold tower does not add 1.
- flyingHeight above 0 may enter a tile when its effective height is <= that flyingHeight. The default flight path is the straight segment from the spawn tile to the base tile when every tile under that segment is enterable. Otherwise it is the shortest 4-connected path around the closed tiles. Building or destroying a tower can open or close a tile, and that enemy's distanceToBase updates with it.
- A non-empty waypoints list puts a flyingHeight 0 enemy into route mode, which aims the crowd at the base. The same list is a polyline for flyingHeight above 0: straight on each leg that stays on enterable tiles, around closed tiles when a leg does not, then the base tile the engine appends. A waypoint or hold tile that fails the height check for that enemy is dropped for that enemy.
- While routingMode is default or route, flyingHeight above 0 attacks each live tower whose tile its center enters, once on entry and again each time its attack timer elapses before it leaves. siegeTower parks on that tower, or on the nearest enterable neighbor when the tower tile is too tall, and attacks until it ghosts. Pass-over is off for the whole siege.
- distanceToBase on flyingHeight above 0 is tile steps on that height graph, including the live-tower bonus. nav.distanceToBase remains the ground field. -1 on a flyer means the tile's effective height is above its flyingHeight.
- Coordinates are TILE coordinates (column x, row y). The map is delivered to you as a 2D array map[y][x] of these values. Do NOT convert between tile and world space; every coordinate you emit is a tile.
- 'meta.tileSize' defaults to 36 (world units per tile); you only need tile coordinates.

# Enemy types (base stats)

${describeEnemyTypes()}

Enemy HP scales by level and wave: hp = baseHp * (${formatEnemyLevelMult(getGameContent().enemies.levelHpMult)}) * (1 + ${getGameContent().enemies.waveHpMult} * (wave - 1)).
Enemy damage scales by level and wave with its own coefficients: damage = attackDamage * (${formatEnemyLevelMult(getGameContent().enemies.levelDamageMult)}) * (1 + ${getGameContent().enemies.waveDamageMult} * (wave - 1)).

# Tower types (base level 1 stats)

${describeTowerTypes()}

Towers scale per level: damage * ${getGameContent().towers.tuning.levelDmgMult}^(level-1), fireRate * ${getGameContent().towers.tuning.levelRateMult}^(level-1), range * ${getGameContent().towers.tuning.levelRangeMult}^(level-1), health * ${getGameContent().towers.tuning.levelHealthMult}^(level-1).

# Waves

Enemies spawn from a QUEUE. Between waves there is a ${getGameContent().economy.betweenWavesTimer}s inter-wave timer, and a preemptive next-wave timer of ${getGameContent().economy.preEmptiveWaveTimer} game-seconds after a wave starts (regardless of survivors). Reaching wave ${getGameContent().economy.victoryWave} triggers victory. There is NO hard cap on simultaneously-active enemies — concurrency is implicitly bounded by spawn pacing, not a fixed limit.

# Data stream

Each request resends the transcript. The first user message (and the first message after a context rebuild) is a FULL snapshot. Later user messages are DELTAS against that transcript. The map and the spawns list are only in a full snapshot. spawns is [{ spawnIndex, x, y }] using the same index as setSpawnOrder.

- Enemy fields: id, type, x, y, level, hp, maxHp, wave, spawnIndex, routingMode (default | hold | route | siege), attackingBase, blockedByTowerTile, distanceToBase, flyingHeight, targetingMode (null when unset, otherwise one of the setTargeting modes). flyingHeight does not change, so it is not by itself a reason for a delta.
- heights is stored tile height, included on the full snapshot and repeated on later deltas from the cached map. It is not resent by the simulation after the layout feed turns off.
- Tower fields: type, x, y, level, hp, maxHp, distanceToBase. distanceToBase is the nav distance of the nearest path, spawn, or base tile; a terrain tower is snapped to that tile. -1 means no walkable tile. Towers with hp <= 0 are omitted. A tower that drops to 0 hp is listed in removedTowers.
- A delta contains newEnemies (full entry), changedEnemies (same fields; emitted when tile, hp, maxHp, routingMode, attackingBase, blockedByTowerTile, targetingMode, or distanceToBase changed), removedEnemyIds, newTowers, changedTowers (hp, maxHp, level, or distanceToBase), removedTowers ({x, y}), and the wave summary.
- Wave summary fields: currentWave, pendingEnemyCount, remainingScheduledSpawns, active, baseHp, maxBaseHp, countdownSeconds (inter-wave seconds remaining, or null while a wave is spawning), spawnOrders.
- spawnOrders lists the latched standing orders. An entry with no spawnIndex is the default. hold true without holdTile means park on that unit's own spawn tile. An empty array means nothing is latched.
- Your own prior replies stay in the transcript as assistant messages until a context rebuild replaces the transcript with a new full snapshot.

# Commands

The command rules in this section override any shorter command list in the preface above.

You may emit ONLY the following commands as a JSON array (or { "commands": [...], "chat": "..." }). Coordinates are TILE coordinates. Commands in one array apply in order. You MUST NOT emit llm:gridLayoutToggle or any other command type.

1. routeGroup — route a group of enemies:
   { "type": "llm:routeGroup", "enemyIds": [number], "hold": boolean, "holdTile": { "x": number, "y": number }, "waypoints": [ { "x": number, "y": number } ] }
   - hold=true parks the enemies at holdTile (or their current tile if omitted). hold=false releases them along waypoints toward the base. For flyingHeight 0, non-empty waypoints only select route mode aimed at the base. For flyingHeight above 0, waypoints are a followed polyline. waypoints may be empty to release to default pathing. A hold tile the enemy cannot enter leaves that enemy on its previous mode.
   - hold and route take priority over setTargeting until the enemies are released. The targeting policy is kept and resumes after release.
2. siegeTower — send enemies to attack one tower:
   { "type": "llm:siegeTower", "enemyIds": [number], "towerTile": { "x": number, "y": number } }
   - They path to that tower, attack it on contact, and return to default pathing when it is ghosted. flyingHeight above 0 parks on the tower tile when it is enterable, otherwise on the nearest enterable neighbor, and does not attack towers it merely passes while routingMode is siege. This clears any setTargeting policy on those enemies.
3. setTargeting — set how those enemies pick a tower while they are not held or following waypoints:
   { "type": "llm:setTargeting", "enemyIds": [number], "mode": string }
   - default: clear the policy. Enemies path to the base and, if stuck on a tower, commit to sieging it.
   - base: path to the base and do not commit to a blocking tower. Overlap still damages that tower.
   - nearest: siege the closest live tower (Euclidean tile distance; ties break by smaller y, then smaller x).
   - strongest: siege the live tower with the highest current health (ties use the nearest rule).
   - weakest: siege the live tower with the lowest current health (ties use the nearest rule).
   - strongestAhead: siege the highest-health live tower whose snapped distanceToBase is strictly smaller than the enemy's. For flyingHeight 0 the snap is the nearest path, spawn, or base tile. For flyingHeight above 0 both distances are tile steps on that enemy's height graph, and a tower on a tile the enemy cannot enter is not ahead. -1 means no walkable tile, and that tower is not ahead. If none qualify, behave as base.
   - Any other mode string is stored and does not change engagement.
4. setSpawnOrder — standing order applied to each enemy as it emerges:
   { "type": "llm:setSpawnOrder", "spawnIndex": number, "clear": boolean, "hold": boolean, "holdTile": { "x": number, "y": number }, "waypoints": [ { "x": number, "y": number } ], "targetingMode": string, "towerTile": { "x": number, "y": number } }
   - Omit spawnIndex to set the default for every spawn that has no order of its own. A spawnIndex replaces the whole default for that spawn.
   - Exactly one movement: hold true (park; omit holdTile to use that unit's own spawn tile), or waypoints (route through them to the base; an empty waypoints array emerges on default pathing), or towerTile (siege that tower if it is live). targetingMode may accompany that one movement, or stand alone.
   - hold false is not a hold. Two movements, or no movement and no targetingMode, are rejected. clear combined with any other order field is rejected.
   - targetingMode on a hold or a route is stored and does nothing until the enemy is released. A towerTile order clears targeting at spawn. A missing tower leaves that unit on default pathing; the order stays for the next unit.
   - The order does not move enemies already alive. Use routeGroup for those.
   - clear true with spawnIndex drops that spawn's order. clear true with no spawnIndex drops the default and every spawn order.
   - Commands in one array apply before that tick's spawns. A release then a still-active order releases enemies already holding; units that emerge later in the tick still receive the order. Clear the order after the release to stop the next emergents from holding.
5. releaseHeld — release living enemies that are held:
   { "type": "llm:releaseHeld", "wave": number, "spawnIndex": number }
   - Omit wave to release every holder. Omit spawnIndex to ignore spawn. A targeting mode set by the spawn order stays and resumes after release.
   - Pass wave from the wave summary so a later wave that is already holding stays parked.

Return ONLY the JSON command block (optionally with a "chat" field for a short message to the player).`;

  if (commanderInstructions && commanderInstructions.length > 0) {
    return `${prompt}

# Commander Instructions

${commanderInstructions}`;
  }
  return prompt;
}
