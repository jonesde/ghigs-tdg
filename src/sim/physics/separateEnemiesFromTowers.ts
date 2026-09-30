import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { Grid } from "@/sim/grid/Grid.js";
import { type CrowdManager, restoreCrowdAgentVelocity } from "@/sim/navmesh/CrowdManager.js";
import { toRecast } from "@/sim/navmesh/coords.js";
import type { Tower } from "@/sim/towers/Tower.js";

const NEIGHBOR_OFFSETS = [
  { tileX: 1, tileY: 0 },
  { tileX: -1, tileY: 0 },
  { tileX: 0, tileY: 1 },
  { tileX: 0, tileY: -1 },
];

function insideSquare(x: number, y: number, centerX: number, centerY: number, limit: number): boolean {
  return Math.abs(x - centerX) < limit && Math.abs(y - centerY) < limit;
}

function isOpenTile(grid: Grid, tileX: number, tileY: number): boolean {
  if (!grid.inBounds(tileX, tileY)) return false;
  const walkable = grid.isPath(tileX, tileY) || grid.isBase(tileX, tileY) || grid.isSpawn(tileX, tileY);
  return walkable && !grid.blocked.has(`${tileX},${tileY}`);
}

function placeEnemy(enemy: Enemy, landing: { x: number; y: number }, crowdManager: CrowdManager | null): void {
  enemy.x = landing.x;
  enemy.y = landing.y;
  enemy.centerX = landing.x;
  enemy.centerY = landing.y;
  enemy.body?.setTranslation({ x: landing.x, y: landing.y }, true);
  enemy.body?.setLinvel({ x: 0, y: 0 }, true);
  // Teleport zeroes Detour steering; restore the pre-teleport crowd velocity so
  // steering resumes in the same direction (mirrors Enemy.postPhysics resync).
  const crowdAgent = enemy.agent;
  if (crowdAgent && crowdManager) {
    const previousVelocity = crowdAgent.velocity();
    crowdManager.teleportAgent(enemy, landing);
    restoreCrowdAgentVelocity(crowdAgent, previousVelocity);
  } else {
    crowdManager?.teleportAgent(enemy, landing);
  }
  if (enemy.lastMoveTargetWorld && enemy.agent) {
    enemy.agent.requestMoveTarget(toRecast(enemy.lastMoveTargetWorld));
  }
}

// Moves enemies whose centers sit inside a live tower tile onto an adjacent
// walkable tile. Called when cuboids and obstacles have just been rebuilt, so
// a ghost restore or a build does not leave a body embedded in the new square.
// Face contact (center outside the square) is left alone.
export function separateEnemiesFromTowers(
  enemies: readonly Enemy[],
  towers: readonly Tower[],
  grid: Grid,
  crowdManager: CrowdManager | null,
): void {
  const liveTowers = towers.filter((tower) => !tower.isGhost);
  if (liveTowers.length === 0) return;
  const insideLimit = grid.tileSize / 2 - 0.5;

  for (const enemy of enemies) {
    if (enemy.removed || enemy.flyingHeight > 0) continue;
    const containing = liveTowers.find((tower) => insideSquare(enemy.x, enemy.y, tower.x, tower.y, insideLimit));
    if (!containing) continue;
    // Intentionally parked enemies (base attackers, siege contact) stay where the
    // contact logic put them: relocating them would break the siege/base attack
    // they are mid-animation on. An embedded center is always sub-tile here (the
    // insideSquare limit is tileSize/2), so the full-tile failsafe never fires —
    // it documents the same skip rule clampBallisticEnemiesToNavMesh uses.
    const intentionallyParked = enemy.attackingBase || enemy.motionLock === "park";
    const towerDistance = Math.hypot(enemy.x - containing.x, enemy.y - containing.y);
    if (intentionallyParked && towerDistance < grid.tileSize) continue;

    const backwardX = enemy.x - Math.cos(enemy.moveAngle);
    const backwardY = enemy.y - Math.sin(enemy.moveAngle);
    let landing: { x: number; y: number } | null = null;
    let bestDistance = Infinity;
    for (const offset of NEIGHBOR_OFFSETS) {
      const neighborX = containing.tileX + offset.tileX;
      const neighborY = containing.tileY + offset.tileY;
      if (!isOpenTile(grid, neighborX, neighborY)) continue;
      const candidate = grid.tileToWorld(neighborX, neighborY);
      const insideAnother = liveTowers.some((tower) =>
        insideSquare(candidate.x, candidate.y, tower.x, tower.y, insideLimit),
      );
      if (insideAnother) continue;
      const distance = Math.hypot(candidate.x - backwardX, candidate.y - backwardY);
      if (distance < bestDistance) {
        bestDistance = distance;
        landing = candidate;
      }
    }
    if (!landing) continue;
    placeEnemy(enemy, landing, crowdManager);
  }
}
