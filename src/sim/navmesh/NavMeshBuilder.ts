import {
  getNavMeshPositionsAndIndices,
  type NavMesh,
  NavMeshQuery,
  type Obstacle,
  type ObstacleRef,
  type TileCache,
  type Vector3,
} from "recast-navigation";
import { generateTileCache, type TileCacheGeneratorConfig } from "recast-navigation/generators";
import type { Grid } from "@/sim/grid/Grid.js";
import { fromRecast, toRecast } from "./coords.js";
import { getRecast } from "./recastContext.js";

export interface WorldPoint {
  x: number;
  y: number;
}

export class NavMeshBuilder {
  private grid: Grid;
  private navMesh: NavMesh | null = null;
  private tileCache: TileCache | null = null;
  private buildSuccess = false;
  private buildError: string | undefined;
  // Persistent query reused by findPath (avoid construct/destroy per call).
  private navMeshQuery: NavMeshQuery | null = null;
  // Tracks the full obstacle object each occupied tower tile currently holds,
  // keyed by `"tileX,tileY"`. Removal must pass the WHOLE obstacle to
  // `tileCache.removeObstacle`.
  private obstacleRefs = new Map<string, Obstacle>();

  constructor(grid: Grid) {
    // Init-first gate: fail fast when initNavMesh() has not resolved instead of
    // touching unloaded WASM further down.
    void getRecast();
    this.grid = grid;
    this.build();
  }

  private isWalkableTile(x: number, y: number): boolean {
    return this.grid.isPath(x, y) || this.grid.isBase(x, y) || this.grid.isSpawn(x, y);
  }

  // Voxel size passed to the tile-cache generator as `cs`. Obstacle rasterization
  // in addTowerObstacleInternal is written against this same size.
  private navmeshCellSize(): number {
    return this.grid.tileSize / 4;
  }

  private build(): void {
    const tileSize = this.grid.tileSize;
    const cellSize = this.navmeshCellSize();
    // Recast erodes by whole voxels. One voxel is `cellSize` (tileSize/4) and
    // severs a 1-wide bend, so spawn can no longer reach the base. Any
    // walkableRadius below 1 voxel builds the same mesh as 0. Inside-corner
    // clearance is the corridor-wall chamfer, not this radius.
    const walkableRadius = 0;

    const config: Partial<TileCacheGeneratorConfig> = {
      expectedLayersPerTile: 1,
      cs: cellSize,
      ch: 1,
      walkableRadius,
      walkableHeight: 2,
      walkableClimb: 1,
      maxObstacles: 1024,
      tileSize: 8,
    };

    const positions: number[] = [];
    const indices: number[] = [];
    for (let tileY = 0; tileY < this.grid.height; tileY++) {
      for (let tileX = 0; tileX < this.grid.width; tileX++) {
        if (!this.isWalkableTile(tileX, tileY)) continue;
        const baseVertex = positions.length / 3;
        const corners: Vector3[] = [
          toRecast({ x: tileX * tileSize, y: tileY * tileSize }),
          toRecast({ x: (tileX + 1) * tileSize, y: tileY * tileSize }),
          toRecast({ x: (tileX + 1) * tileSize, y: (tileY + 1) * tileSize }),
          toRecast({ x: tileX * tileSize, y: (tileY + 1) * tileSize }),
        ];
        for (const corner of corners) {
          positions.push(corner.x, corner.y, corner.z);
        }
        // Upward-facing winding (CCW about +Y) so Recast rasterizes the span.
        indices.push(baseVertex, baseVertex + 2, baseVertex + 1);
        indices.push(baseVertex, baseVertex + 3, baseVertex + 2);
      }
    }

    const result = generateTileCache(positions, indices, config);
    if (result.success) {
      this.navMesh = result.navMesh;
      this.tileCache = result.tileCache;
      this.navMeshQuery = new NavMeshQuery(result.navMesh);
      this.buildSuccess = true;
    } else {
      this.navMesh = null;
      this.tileCache = null;
      this.navMeshQuery = null;
      this.buildSuccess = false;
      this.buildError = result.error;
    }
  }

  getNavMesh(): NavMesh | null {
    return this.navMesh;
  }

  getTileCache(): TileCache | null {
    return this.tileCache;
  }

  isSuccess(): boolean {
    return this.buildSuccess;
  }

  getError(): string | undefined {
    return this.buildError;
  }

  // Releases the WASM-backed NavMesh and TileCache. These are not reclaimed by
  // JavaScript GC automatically, so the engine must call this on dispose (and any
  // throwaway builder must free itself) to avoid leaking WASM memory.
  destroy(): void {
    this.navMeshQuery?.destroy();
    this.navMeshQuery = null;
    this.navMesh?.destroy();
    this.tileCache?.destroy();
    this.navMesh = null;
    this.tileCache = null;
    // Tracked obstacles reference destroyed WASM state; holding them would hand a
    // dangling obstacle to a later removeObstacle call.
    this.obstacleRefs.clear();
  }

  // Returns a world-space polyline (game coordinates) from start to goal, or []
  // when no corridor connects them. `start`/`goal` are game-plane points.
  // `goalDistanceTolerance` is the max distance the clamped end point may sit from
  // `goalWorld` and still count as a real path; beyond it the path is treated as the
  // degenerate "goal clamped to start island" case and rejected. Callers that route
  // to an exact target (e.g. a waypoint) should tighten this; the default keeps the
  // full-tile tolerance used by the spawn→base reachability guard.
  findPath(
    startWorld: WorldPoint,
    goalWorld: WorldPoint,
    goalDistanceTolerance: number = this.grid.tileSize,
  ): WorldPoint[] {
    if (!this.navMeshQuery) return [];
    const halfExtents: Vector3 = { x: this.grid.tileSize, y: this.grid.tileSize, z: this.grid.tileSize };
    const result = this.navMeshQuery.computePath(toRecast(startWorld), toRecast(goalWorld), { halfExtents });
    if (!result.success || result.path.length === 0) return [];
    const path = result.path.map(fromRecast);
    // computePath clamps the goal to the start poly when start and goal lie in
    // disconnected navmesh islands; treat that as "no path".
    const lastPoint = path[path.length - 1]!;
    const goalDistance = Math.hypot(lastPoint.x - goalWorld.x, lastPoint.y - goalWorld.y);
    if (goalDistance > goalDistanceTolerance) return [];
    return path;
  }

  isReachable(startWorld: WorldPoint, goalWorld: WorldPoint): boolean {
    return this.findPath(startWorld, goalWorld).length > 0;
  }

  nearestWalkableWorld(point: WorldPoint): WorldPoint | null {
    if (!this.navMeshQuery) return null;
    const halfExtents: Vector3 = { x: this.grid.tileSize, y: this.grid.tileSize, z: this.grid.tileSize };
    const result = this.navMeshQuery.findNearestPoly(toRecast(point), { halfExtents });
    if (!result.success) return null;
    return fromRecast(result.nearestPoint);
  }

  // Flattened walkable-corridor triangle mesh in game coordinates: `positions`
  // is `[x0, y0, x1, y1, …]` (2 per vertex) and `indices` are triangle indices
  // into that vertex list. Returned to the snapshot for the minimap highlight.
  // Recast emits vertices as (x, height≈0, z); this map is flat so we drop the
  // middle height component and take the third as game y.
  getCorridorGeometry(): { positions: number[]; indices: number[] } | null {
    if (!this.navMesh) return null;
    const [rawPositions, rawIndices] = getNavMeshPositionsAndIndices(this.navMesh);
    const positions: number[] = [];
    for (let i = 0; i < rawPositions.length; i += 3) {
      positions.push(rawPositions[i]!, rawPositions[i + 2]!);
    }
    return { positions, indices: rawIndices };
  }

  // Applies every queued obstacle request to the live navmesh. `tileCache.update`
  // rebuilds up to 64 affected tiles per call and reports `upToDate` once the
  // queue is drained, so we must loop until it settles (capped to avoid a hang if
  // the navmesh never converges). Returns whether the queue converged; callers
  // force a distance-field refresh + crowd re-request on false instead of routing
  // on a half-applied obstacle set.
  private applyTileCacheUpdates(): boolean {
    if (!this.tileCache || !this.navMesh) return false;
    const maxUpdateIterations = 16;
    let updateResult = { upToDate: false };
    for (let iteration = 0; iteration < maxUpdateIterations; iteration++) {
      updateResult = this.tileCache.update(this.navMesh);
      if (updateResult.upToDate) return true;
    }
    if (!updateResult.upToDate) {
      console.warn("NavMeshBuilder: tileCache.update did not converge after", maxUpdateIterations, "iterations");
    }
    return updateResult.upToDate;
  }

  // Registers a tower box obstacle covering the same tile square as the physics cuboid.
  // Returns the obstacle ref (for later removal) or null when the tilecache is
  // unavailable / the add failed.
  addTowerObstacle(tileX: number, tileY: number): ObstacleRef | null {
    const reference = this.addTowerObstacleInternal(tileX, tileY);
    if (reference !== null) this.applyTileCacheUpdates();
    return reference;
  }

  // Angle-0 oriented box keeps cell i when |i - centerVoxel| <= halfExtents/cellSize + 0.5.
  // i is the cell's minimum corner. Shift centerVoxel by -0.5 and set that threshold to
  // cellsPerTile/2 so the included indices are [i0, i0 + cellsPerTile - 1].
  private towerObstacleBox(tileX: number, tileY: number): { boxCenter: Vector3; halfExtents: Vector3 } {
    const tileSize = this.grid.tileSize;
    const cellSize = this.navmeshCellSize();
    const cellsPerTile = tileSize / cellSize;
    const center = toRecast(this.grid.tileToWorld(tileX, tileY));
    const horizontalHalfExtent = (cellsPerTile / 2 - 0.5) * cellSize;
    const verticalHalfExtent = tileSize / 2;
    const boxCenter: Vector3 = { x: center.x - cellSize / 2, y: verticalHalfExtent, z: center.z - cellSize / 2 };
    const halfExtents: Vector3 = { x: horizontalHalfExtent, y: verticalHalfExtent, z: horizontalHalfExtent };
    return { boxCenter, halfExtents };
  }

  private addTowerObstacleInternal(tileX: number, tileY: number): ObstacleRef | null {
    if (!this.tileCache) return null;
    const { boxCenter, halfExtents } = this.towerObstacleBox(tileX, tileY);
    const result = this.tileCache.addBoxObstacle(boxCenter, halfExtents, 0);
    if (!result.success) {
      console.error(
        "NavMeshBuilder: addBoxObstacle failed for tile",
        tileX,
        tileY,
        "(maxObstacles cap or request queue full)",
      );
      return null;
    }
    // Store the WHOLE obstacle object — removal passes it back to
    // `tileCache.removeObstacle`, which fails if given only `.ref` (the raw
    // ObstacleRef is itself an object in this build).
    this.obstacleRefs.set(`${tileX},${tileY}`, result.obstacle);
    return result.obstacle.ref;
  }

  removeTowerObstacle(tileX: number, tileY: number): void {
    this.removeTowerObstacleInternal(tileX, tileY);
    this.applyTileCacheUpdates();
  }

  private removeTowerObstacleInternal(tileX: number, tileY: number): void {
    const key = `${tileX},${tileY}`;
    const obstacle = this.obstacleRefs.get(key);
    if (obstacle === undefined) return;
    // Removal against a stale or already-destroyed tile cache reports failure;
    // surfacing it keeps the obstacleRefs map honest instead of silently leaking.
    const removal = this.tileCache?.removeObstacle(obstacle);
    if (removal && !removal.success) {
      console.warn("NavMeshBuilder: removeObstacle failed for tile", tileX, tileY, "status", removal.status);
    }
    this.obstacleRefs.delete(key);
  }

  // Reconciles the live obstacle set with the current tower set. Any non-ghost
  // tower whose tile has no obstacle yet gets one; any tracked obstacle whose
  // tower was sold or ghosted is removed. All queue changes are flushed with a
  // single `tileCache.update` loop at the end. Returns false when an obstacle add
  // failed or the update queue did not converge, so the caller can force a
  // distance-field refresh + crowd re-request instead of proceeding silently.
  syncTowers(towers: { id: string | number; tileX: number; tileY: number; isGhost: boolean }[]): boolean {
    if (!this.tileCache) return false;
    let allAddsSucceeded = true;
    const liveObstacleTiles = new Set<string>();
    for (const tower of towers) {
      if (tower.isGhost) continue;
      const key = `${tower.tileX},${tower.tileY}`;
      liveObstacleTiles.add(key);
      if (!this.obstacleRefs.has(key)) {
        if (this.addTowerObstacleInternal(tower.tileX, tower.tileY) === null) allAddsSucceeded = false;
      }
    }
    for (const key of Array.from(this.obstacleRefs.keys())) {
      if (!liveObstacleTiles.has(key)) {
        const keyParts = key.split(",");
        const tileX = Number(keyParts[0]);
        const tileY = Number(keyParts[1]);
        this.removeTowerObstacleInternal(tileX, tileY);
      }
    }
    return this.applyTileCacheUpdates() && allAddsSucceeded;
  }
}
