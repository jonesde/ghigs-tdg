// Breach-vs-detour decision for ground enemies in default routing mode.
//
// A single comparator replaces the old two-regime behavior (walk around any
// open path no matter how long, or blindly siege once the path seals). It
// compares the open walk time against walking straight through blocking towers
// plus the time to destroy them at the deciding enemy's own DPS:
//
//   throughWalkSeconds + breachSeconds  vs  openWalkSeconds
//
// All distances are tile steps on 4-connected BFS fields anchored at the
// deciding enemy's current tile, so commander-displaced enemies decide from
// wherever they stand. No Detour queries here: both legs are O(1) field reads
// plus one greedy descent, keeping per-enemy cost off the navmesh.

export interface BreachGrid {
  width: number;
  height: number;
  inBounds(tileX: number, tileY: number): boolean;
  isPath(tileX: number, tileY: number): boolean;
  isBase(tileX: number, tileY: number): boolean;
  isSpawn(tileX: number, tileY: number): boolean;
  blocked: Set<string>;
}

export interface ThroughBlocker {
  tileX: number;
  tileY: number;
  // Remaining tower health. Breach cost is health / enemy DPS.
  health: number;
  // False when the tile cannot be breached (tower gone, ghosted, or immune),
  // which makes the whole through route impossible.
  breachable: boolean;
}

export type BreachRouteDecision = "detour" | "siege";

export interface BreachEvaluation {
  openWalkSeconds: number;
  throughWalkSeconds: number;
  breachSeconds: number;
  throughTotalSeconds: number;
  decision: BreachRouteDecision;
  siegeTile: { x: number; y: number } | null;
}

export interface BreachOptions {
  openDistanceTiles: number;
  throughDistanceTiles: number;
  blockers: ThroughBlocker[];
  enemyDamagePerSecond: number;
  enemySpeedTilesPerSecond: number;
  hysteresisSeconds: number;
  currentlySieging: boolean;
}

const NEIGHBOR_OFFSETS = [
  { deltaX: 1, deltaY: 0 },
  { deltaX: -1, deltaY: 0 },
  { deltaX: 0, deltaY: 1 },
  { deltaX: 0, deltaY: -1 },
];

function isThroughWalkable(grid: BreachGrid, tileX: number, tileY: number): boolean {
  return grid.isPath(tileX, tileY) || grid.isBase(tileX, tileY) || grid.isSpawn(tileX, tileY);
}

function isBlockedTile(grid: BreachGrid, tileX: number, tileY: number): boolean {
  return grid.isPath(tileX, tileY) && grid.blocked.has(`${tileX},${tileY}`);
}

// Multi-source BFS from every base tile over walkable tiles, treating live
// blocking towers as traversable. Mirrors the open distance field except
// blocked tiles are enterable, so the result measures the shortest route that
// walks straight through walls.
export function buildThroughField(grid: BreachGrid): number[][] {
  const distances: number[][] = Array.from({ length: grid.height }, () => Array(grid.width).fill(-1));
  const queue: Array<{ tileX: number; tileY: number }> = [];
  for (let tileY = 0; tileY < grid.height; tileY++) {
    for (let tileX = 0; tileX < grid.width; tileX++) {
      if (!grid.isBase(tileX, tileY)) continue;
      distances[tileY]![tileX] = 0;
      queue.push({ tileX, tileY });
    }
  }
  let queueHead = 0;
  while (queueHead < queue.length) {
    const current = queue[queueHead]!;
    queueHead += 1;
    const currentDistance = distances[current.tileY]![current.tileX]!;
    for (const offset of NEIGHBOR_OFFSETS) {
      const nextTileX = current.tileX + offset.deltaX;
      const nextTileY = current.tileY + offset.deltaY;
      if (!grid.inBounds(nextTileX, nextTileY)) continue;
      if (!isThroughWalkable(grid, nextTileX, nextTileY)) continue;
      if (distances[nextTileY]![nextTileX] !== -1) continue;
      distances[nextTileY]![nextTileX] = currentDistance + 1;
      queue.push({ tileX: nextTileX, tileY: nextTileY });
    }
  }
  return distances;
}

// Blocked tiles on one shortest through-path from the start tile to the base,
// enemy side first. Greedy descent on the through field: each step moves to a
// neighbor one step closer to the base, so the first blocked tile met is the
// wall facing the enemy and a second wall in series is listed after it. The
// start tile itself is included when blocked (enemy standing on a tower tile).
export function blockersOnThroughPath(
  grid: BreachGrid,
  throughDistances: number[][],
  startTileX: number,
  startTileY: number,
): Array<{ x: number; y: number }> {
  const blockers: Array<{ x: number; y: number }> = [];
  if (!grid.inBounds(startTileX, startTileY)) return blockers;
  const startDistance = throughDistances[startTileY]?.[startTileX] ?? -1;
  if (startDistance < 0) return blockers;
  let cursorX = startTileX;
  let cursorY = startTileY;
  let cursorDistance = startDistance;
  const maxSteps = grid.width * grid.height + 1;
  for (let step = 0; step < maxSteps; step++) {
    if (grid.isBase(cursorX, cursorY)) break;
    if (isBlockedTile(grid, cursorX, cursorY)) blockers.push({ x: cursorX, y: cursorY });
    if (cursorDistance <= 0) break;
    let nextX = -1;
    let nextY = -1;
    for (const offset of NEIGHBOR_OFFSETS) {
      const neighborX = cursorX + offset.deltaX;
      const neighborY = cursorY + offset.deltaY;
      if (!grid.inBounds(neighborX, neighborY)) continue;
      if ((throughDistances[neighborY]?.[neighborX] ?? -1) === cursorDistance - 1) {
        nextX = neighborX;
        nextY = neighborY;
        break;
      }
    }
    if (nextX < 0) break;
    cursorX = nextX;
    cursorY = nextY;
    cursorDistance -= 1;
  }
  return blockers;
}

function walkSeconds(distanceTiles: number, speedTilesPerSecond: number): number {
  if (distanceTiles < 0 || speedTilesPerSecond <= 0) return Number.POSITIVE_INFINITY;
  return distanceTiles / speedTilesPerSecond;
}

// Compares the open walk against the through walk plus the breach cost at the
// deciding enemy's own DPS. A sealed open leg (unreachable) is infinite walk
// time, so a sealed enemy always breaches when the through route is possible.
// Hysteresis forms a hold band around the current mode: a new siege needs to
// win by more than the margin, and a running siege holds until the open route
// wins by more than the margin.
export function decideBreach(options: BreachOptions): BreachEvaluation {
  const openWalkSeconds = walkSeconds(options.openDistanceTiles, options.enemySpeedTilesPerSecond);
  const throughWalkSeconds = walkSeconds(options.throughDistanceTiles, options.enemySpeedTilesPerSecond);
  const hasUnbreachable = options.blockers.some((blocker) => !blocker.breachable);
  const canDamage = options.enemyDamagePerSecond > 0;
  let breachSeconds = 0;
  if (options.blockers.length > 0 && (!canDamage || hasUnbreachable)) {
    breachSeconds = Number.POSITIVE_INFINITY;
  } else {
    for (const blocker of options.blockers) {
      breachSeconds += blocker.health / options.enemyDamagePerSecond;
    }
  }
  const throughTotalSeconds = throughWalkSeconds + breachSeconds;
  const hysteresisSeconds = Math.max(0, options.hysteresisSeconds);
  let decision: BreachRouteDecision;
  if (options.currentlySieging) {
    decision = openWalkSeconds < throughTotalSeconds - hysteresisSeconds ? "detour" : "siege";
  } else {
    decision = throughTotalSeconds < openWalkSeconds - hysteresisSeconds ? "siege" : "detour";
  }
  const firstBlocker = options.blockers[0];
  const siegeTile = decision === "siege" && firstBlocker ? { x: firstBlocker.tileX, y: firstBlocker.tileY } : null;
  return { openWalkSeconds, throughWalkSeconds, breachSeconds, throughTotalSeconds, decision, siegeTile };
}
