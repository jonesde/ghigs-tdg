export interface TargetingTower {
  tileX: number;
  tileY: number;
  health: number;
}

const ENGAGEMENT_POLICIES = new Set(["base", "nearest", "strongest", "weakest", "strongestAhead"]);

// Modes that replace the stuck auto-siege. Unknown strings and "default" (stored as null) do not.
export function isEngagementPolicy(mode: string | null): boolean {
  return mode !== null && ENGAGEMENT_POLICIES.has(mode);
}

function tileDistanceSquared(originX: number, originY: number, tileX: number, tileY: number): number {
  const deltaX = originX - tileX;
  const deltaY = originY - tileY;
  return deltaX * deltaX + deltaY * deltaY;
}

// Strictly nearer, then smaller tileY, then smaller tileX. Equal tiles keep the current choice.
function isNearerTieBreak<T extends TargetingTower>(
  enemyTileX: number,
  enemyTileY: number,
  candidate: T,
  current: T,
): boolean {
  const candidateDistance = tileDistanceSquared(enemyTileX, enemyTileY, candidate.tileX, candidate.tileY);
  const currentDistance = tileDistanceSquared(enemyTileX, enemyTileY, current.tileX, current.tileY);
  if (candidateDistance !== currentDistance) return candidateDistance < currentDistance;
  if (candidate.tileY !== current.tileY) return candidate.tileY < current.tileY;
  return candidate.tileX < current.tileX;
}

// Picks the live tower an engagement policy sieges. "base", "default", and unknown modes return null
// (the caller paths to the base). strongestAhead requires both distances >= 0 and a tower strictly
// closer to the base. A distance of -1 is not ahead; the caller snaps terrain tiles before the call.
export function selectTargetingTower<T extends TargetingTower>(
  mode: string | null,
  enemyTileX: number,
  enemyTileY: number,
  enemyDistanceToBase: number,
  towers: readonly T[],
  distanceAt: (tileX: number, tileY: number) => number,
): T | null {
  if (mode !== "nearest" && mode !== "strongest" && mode !== "weakest" && mode !== "strongestAhead") {
    return null;
  }
  let chosen: T | null = null;
  for (const tower of towers) {
    if (mode === "strongestAhead") {
      const towerDistance = distanceAt(tower.tileX, tower.tileY);
      if (towerDistance < 0 || enemyDistanceToBase < 0 || !(towerDistance < enemyDistanceToBase)) continue;
    }
    if (!chosen) {
      chosen = tower;
      continue;
    }
    if (mode === "strongest" || mode === "strongestAhead") {
      if (tower.health !== chosen.health) {
        if (tower.health > chosen.health) chosen = tower;
        continue;
      }
    } else if (mode === "weakest") {
      if (tower.health !== chosen.health) {
        if (tower.health < chosen.health) chosen = tower;
        continue;
      }
    }
    if (isNearerTieBreak(enemyTileX, enemyTileY, tower, chosen)) chosen = tower;
  }
  return chosen;
}
