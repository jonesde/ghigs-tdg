import type { Grid } from "@/sim/grid/Grid.js";
import type { NavMeshBuilder, WorldPoint } from "./NavMeshBuilder.js";

export interface PathMetric {
  spawnIndex: number;
  pathLengthWorld: number;
  reachable: boolean;
  chokeTile?: { x: number; y: number };
}

export interface NavFieldSnapshot {
  pathVersion: number;
  distanceToBase: number[][];
  spawnReachable: boolean[];
  pathMetrics: PathMetric[];
  spawnPaths?: Array<Array<{ x: number; y: number }>>;
}

// Tower-aware tile distance-to-base field + per-spawn path metrics. Walkable =
// path|base|spawn tiles that are not in grid.blocked (live path towers). This is
// the commander source of truth (replaces Stubbs' ignore-towers BFS).
export class NavDistanceField {
  private grid: Grid;
  private navMeshBuilder: NavMeshBuilder | null;
  private pathVersion = -1;
  private distanceToBase: number[][] = [];
  private spawnReachable: boolean[] = [];
  private pathMetrics: PathMetric[] = [];
  private spawnPaths: Array<Array<{ x: number; y: number }>> = [];

  constructor(grid: Grid, navMeshBuilder: NavMeshBuilder | null = null) {
    this.grid = grid;
    this.navMeshBuilder = navMeshBuilder;
  }

  setNavMeshBuilder(navMeshBuilder: NavMeshBuilder | null): void {
    this.navMeshBuilder = navMeshBuilder;
  }

  // Rebuilds when pathVersion changed (or force). Safe to call every tick.
  ensureUpToDate(force = false): void {
    if (!force && this.grid.pathVersion === this.pathVersion && this.distanceToBase.length > 0) {
      return;
    }
    this.rebuild();
  }

  rebuild(): void {
    this.pathVersion = this.grid.pathVersion;
    this.distanceToBase = this.computeDistanceToBase();
    this.pathMetrics = [];
    this.spawnReachable = [];
    this.spawnPaths = [];
    const base = this.grid.getBase();
    const baseWorld = this.grid.tileToWorld(base.x, base.y);
    for (let spawnIndex = 0; spawnIndex < this.grid.spawns.length; spawnIndex++) {
      const spawn = this.grid.spawns[spawnIndex]!;
      const spawnWorld = this.grid.tileToWorld(spawn.x, spawn.y);
      let reachable = false;
      let pathLengthWorld = 0;
      let tilePath: Array<{ x: number; y: number }> = [];
      if (this.navMeshBuilder) {
        const worldPath = this.navMeshBuilder.findPath(spawnWorld, baseWorld);
        reachable = worldPath.length > 0;
        if (reachable) {
          pathLengthWorld = polylineLength(worldPath);
          tilePath = worldPath.map((point) => ({
            x: Math.floor(point.x / this.grid.tileSize),
            y: Math.floor(point.y / this.grid.tileSize),
          }));
        }
      } else {
        const tileDistance = this.distanceToBase[spawn.y]?.[spawn.x] ?? -1;
        reachable = tileDistance >= 0;
        pathLengthWorld = reachable ? tileDistance * this.grid.tileSize : 0;
      }
      this.spawnReachable.push(reachable);
      const chokeTile = findChokeTile(tilePath, this.grid);
      const metric: PathMetric = { spawnIndex, pathLengthWorld, reachable };
      if (chokeTile) metric.chokeTile = chokeTile;
      this.pathMetrics.push(metric);
      this.spawnPaths.push(tilePath);
    }
  }

  getDistanceToBase(tileX: number, tileY: number): number {
    if (tileY < 0 || tileY >= this.distanceToBase.length) return -1;
    const row = this.distanceToBase[tileY];
    if (!row || tileX < 0 || tileX >= row.length) return -1;
    return row[tileX] ?? -1;
  }

  isSpawnReachable(spawnIndex: number): boolean {
    return this.spawnReachable[spawnIndex] ?? false;
  }

  getPathMetrics(): PathMetric[] {
    return this.pathMetrics;
  }

  getSnapshot(): NavFieldSnapshot {
    return {
      pathVersion: this.pathVersion,
      distanceToBase: this.distanceToBase,
      spawnReachable: this.spawnReachable,
      pathMetrics: this.pathMetrics,
      spawnPaths: this.spawnPaths,
    };
  }

  // Multi-source BFS from every base tile over walkable non-blocked tiles.
  private computeDistanceToBase(): number[][] {
    const width = this.grid.width;
    const height = this.grid.height;
    const distances: number[][] = Array.from({ length: height }, () => Array(width).fill(-1) as number[]);
    const queue: Array<{ x: number; y: number }> = [];
    for (let tileY = 0; tileY < height; tileY++) {
      for (let tileX = 0; tileX < width; tileX++) {
        if (!this.grid.isBase(tileX, tileY)) continue;
        distances[tileY]![tileX] = 0;
        queue.push({ x: tileX, y: tileY });
      }
    }
    const offsets = [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ];
    let queueHead = 0;
    while (queueHead < queue.length) {
      const current = queue[queueHead]!;
      queueHead += 1;
      const currentDistance = distances[current.y]![current.x]!;
      for (const offset of offsets) {
        const nextX = current.x + offset.x;
        const nextY = current.y + offset.y;
        if (!this.grid.inBounds(nextX, nextY)) continue;
        if (!this.isWalkableForField(nextX, nextY)) continue;
        if (distances[nextY]![nextX] !== -1) continue;
        distances[nextY]![nextX] = currentDistance + 1;
        queue.push({ x: nextX, y: nextY });
      }
    }
    return distances;
  }

  private isWalkableForField(tileX: number, tileY: number): boolean {
    if (!this.grid.isPath(tileX, tileY) && !this.grid.isBase(tileX, tileY) && !this.grid.isSpawn(tileX, tileY)) {
      return false;
    }
    // Live path towers block the field (maze-aware). Base/spawn never blocked.
    if (this.grid.isPath(tileX, tileY) && this.grid.blocked.has(`${tileX},${tileY}`)) {
      return false;
    }
    return true;
  }
}

function polylineLength(points: WorldPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    length += Math.hypot(current.x - previous.x, current.y - previous.y);
  }
  return length;
}

function findChokeTile(tilePath: Array<{ x: number; y: number }>, grid: Grid): { x: number; y: number } | undefined {
  const neighborOffsets = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ];
  for (const tile of tilePath) {
    for (const offset of neighborOffsets) {
      const neighborX = tile.x + offset.x;
      const neighborY = tile.y + offset.y;
      if (grid.blocked.has(`${neighborX},${neighborY}`)) return tile;
    }
  }
  return undefined;
}
