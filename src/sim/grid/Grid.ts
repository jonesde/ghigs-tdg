interface Tile {
  type: "terrain" | "path" | "base" | "spawn" | "void";
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface GridLayoutSnapshot {
  width: number;
  height: number;
  tiles: Tile[][];
  spawns: Point[];
  base: Point;
  blocked: Set<string>;
  terrainTowers: Set<string>;
  ghostTowers: Set<string>;
  reservedTerrain: Set<string>;
  worldOriginX: number;
  worldOriginY: number;
  pathVersion: number;
  blockCount: number;
}

interface MapData {
  regionId?: number;
  level?: number;
  bossCadence?: number;
  width: number;
  height: number;
  tiles: unknown[][];
  spawns: { x: number; y: number }[];
  base: { x: number; y: number };
  originTileX?: number;
  originTileY?: number;
}

export class Grid {
  width: number;
  height: number;
  tileSize: number;
  tiles: Tile[][];
  spawns: Point[];
  base: Point;
  blocked: Set<string>;
  terrainTowers: Set<string>;
  ghostTowers: Set<string>;
  // Terrain tiles a building or an unopened cache occupies. Not a nav obstacle.
  reservedTerrain: Set<string> = new Set();
  regionId: number = 0;
  // World position of tiles[0][0]'s minimum corner. West/north growth lowers this
  // and shifts tile indices so an existing tile keeps the same world position.
  worldOriginX: number = 0;
  worldOriginY: number = 0;
  // Bumped on every tower build/sell/ghost/restore, terrain included, so Rapier
  // tower colliders and navmesh TileCache obstacles rebuild and the EnemyManager
  // live-tower cache (keyed on this value) refreshes. Corridor walls are static
  // per map. Map buildings and caches do not bump this: they never enter `blocked`.
  pathVersion: number = 0;
  private reservedSignature = "";
  private _blockCount: number = 0;

  constructor(map: MapData) {
    this.width = map.width;
    this.height = map.height;
    this.tileSize = 36;
    this.tiles = map.tiles as Tile[][];
    this.spawns = map.spawns as Point[];
    this.base = map.base as Point;
    this.blocked = new Set();
    this.terrainTowers = new Set();
    this.ghostTowers = new Set();
    this.reservedTerrain = new Set();
    this.regionId = map.regionId ?? 0;
    this.worldOriginX = (map.originTileX ?? 0) * this.tileSize;
    this.worldOriginY = (map.originTileY ?? 0) * this.tileSize;
    this.pathVersion = 0;
  }

  // Swaps in a grown progressive layout. Returns the tile-index shift applied to
  // every key that was stored against the previous rectangle. Callers shift
  // tower and route indices by the same amount and leave world positions alone.
  replaceFromMap(map: MapData): { shiftX: number; shiftY: number } {
    const nextOriginX = (map.originTileX ?? 0) * this.tileSize;
    const nextOriginY = (map.originTileY ?? 0) * this.tileSize;
    const shiftX = Math.round((this.worldOriginX - nextOriginX) / this.tileSize);
    const shiftY = Math.round((this.worldOriginY - nextOriginY) / this.tileSize);
    if (shiftX !== 0 || shiftY !== 0) {
      this.blocked = shiftKeySet(this.blocked, shiftX, shiftY);
      this.terrainTowers = shiftKeySet(this.terrainTowers, shiftX, shiftY);
      this.ghostTowers = shiftKeySet(this.ghostTowers, shiftX, shiftY);
      this.reservedTerrain = shiftKeySet(this.reservedTerrain, shiftX, shiftY);
      this.reservedSignature = "";
    }
    this.worldOriginX = nextOriginX;
    this.worldOriginY = nextOriginY;
    this.width = map.width;
    this.height = map.height;
    this.tiles = map.tiles as Tile[][];
    this.spawns = map.spawns.map((spawn) => ({ x: spawn.x, y: spawn.y }));
    this.base = { x: map.base.x, y: map.base.y };
    this.pathVersion++;
    return { shiftX, shiftY };
  }

  // PhysicsWorld, NavDistanceField, and FlightDistanceField hold this grid.
  // A failed progressive placement restores these fields in place so those
  // owners keep the pre-place layout instead of a second grid instance.
  captureLayout(): GridLayoutSnapshot {
    return {
      width: this.width,
      height: this.height,
      tiles: this.tiles,
      spawns: this.spawns,
      base: this.base,
      blocked: this.blocked,
      terrainTowers: this.terrainTowers,
      ghostTowers: this.ghostTowers,
      reservedTerrain: this.reservedTerrain,
      worldOriginX: this.worldOriginX,
      worldOriginY: this.worldOriginY,
      pathVersion: this.pathVersion,
      blockCount: this._blockCount,
    };
  }

  // Writes a captureLayout() snapshot back onto this instance. The physics
  // world keeps this object, so a rejected placement must not replace it.
  restoreLayout(snapshot: GridLayoutSnapshot): void {
    this.width = snapshot.width;
    this.height = snapshot.height;
    this.tiles = snapshot.tiles;
    this.spawns = snapshot.spawns;
    this.base = snapshot.base;
    this.blocked = snapshot.blocked;
    this.terrainTowers = snapshot.terrainTowers;
    this.ghostTowers = snapshot.ghostTowers;
    this.reservedTerrain = snapshot.reservedTerrain;
    this.reservedSignature = "";
    this.worldOriginX = snapshot.worldOriginX;
    this.worldOriginY = snapshot.worldOriginY;
    this.pathVersion = snapshot.pathVersion;
    this._blockCount = snapshot.blockCount;
  }

  get blockCount(): number {
    return this._blockCount;
  }

  // Replaces the reservation set without bumping pathVersion. The main thread
  // calls this from the snapshot so the build preview matches the worker.
  setReservedTerrain(keys: readonly string[]): void {
    const signature = keys.join("|");
    if (this.reservedSignature === signature) return;
    this.reservedSignature = signature;
    this.reservedTerrain = new Set(keys);
  }

  isPath(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y]![x]!.type === "path";
  }

  isTerrain(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y]![x]!.type === "terrain";
  }

  isBase(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y]![x]!.type === "base";
  }

  isSpawn(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y]![x]!.type === "spawn";
  }

  isVoid(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y]![x]!.type === "void";
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  getHeight(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.tiles[y]![x]!.height;
  }

  canBuild(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const tileType = this.tiles[y]![x]!;
    if (tileType.type === "base") return false;
    const tileKey = `${x},${y}`;
    // Buildings, unopened caches, and supply drops reserve the tile. They stay out
    // of `blocked` so enemy routing and the navmesh keep the corridor they already
    // had. A reserved corridor tile blocks the build so a tower cannot land on top
    // of a package the player still has to click.
    if (tileType.type === "terrain" || tileType.type === "path") {
      if (this.reservedTerrain.has(tileKey)) return false;
    }
    if (tileType.type === "terrain") return !this.terrainTowers.has(tileKey);
    if (tileType.type === "path") return !this.blocked.has(tileKey) && !this.ghostTowers.has(tileKey);
    if (tileType.type === "spawn" || tileType.type === "void") return false;
    return false;
  }

  registerTower(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const tileType = this.tiles[y]![x]!;
    if (tileType.type === "path") {
      const towerKey = `${x},${y}`;
      if (this.blocked.has(towerKey)) return false;
      this.blocked.add(towerKey);
      this._blockCount++;
      this.pathVersion++;
      return true;
    } else {
      const towerKey = `${x},${y}`;
      if (this.terrainTowers.has(towerKey)) return false;
      this.terrainTowers.add(towerKey);
      // Terrain towers do not enter `blocked` (findChokeTile treats every blocked
      // neighbor as a maze choke), but this is still a tower-membership change:
      // bump so the physics/navmesh rebuild gate and the EnemyManager live-tower
      // cache both refresh on this terrain build.
      this.pathVersion++;
      return true;
    }
  }

  unregisterTower(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const tileType = this.tiles[y]![x]!;
    if (tileType.type === "path") {
      const towerKey = `${x},${y}`;
      // The tower may be live (in `blocked`) or already destroyed/ghosted (in
      // `ghostTowers`); resolve from whichever holds it so a ghosted tower can
      // still be sold/unregistered instead of leaking forever.
      if (!this.blocked.has(towerKey) && !this.ghostTowers.has(towerKey)) return false;
      this.blocked.delete(towerKey);
      this.ghostTowers.delete(towerKey);
      this._blockCount--;
      this.pathVersion++;
      return true;
    } else {
      const towerKey = `${x},${y}`;
      if (!this.terrainTowers.has(towerKey)) return false;
      this.terrainTowers.delete(towerKey);
      // Same terrain-membership reasoning as registerTower: not a path block, but
      // the physics/navmesh rebuild gate and the EnemyManager live-tower cache
      // must both refresh on this terrain sell.
      this.pathVersion++;
      return true;
    }
  }

  // A path-tile tower that has been destroyed becomes a ghost: it no longer
  // blocks routing, so the key moves from `blocked` to `ghostTowers` and the
  // navmesh obstacle for it is removed at update() time via pathVersion.
  // Terrain towers are not path blocks. They still bump pathVersion so the
  // cuboid and obstacle refresh, but they must not enter `blocked` —
  // findChokeTile treats every blocked neighbor as a maze choke.
  setTowerGhost(x: number, y: number): void {
    if (!this.isPath(x, y)) {
      this.pathVersion++;
      return;
    }
    const towerKey = `${x},${y}`;
    if (this.blocked.delete(towerKey)) this._blockCount--;
    this.ghostTowers.add(towerKey);
    this.pathVersion++;
  }

  // A ghosted path tower is restored to a live blocking state: the key moves
  // back into `blocked` and the navmesh obstacle is re-added at update() time.
  // A restore after a batch clear arrives with the key already out of
  // ghostTowers, so a path tile always re-blocks idempotently here and the
  // count only moves when the key was actually missing. Terrain towers never
  // join `blocked`; the pathVersion bump still refreshes their cuboid.
  clearTowerGhost(x: number, y: number): void {
    const towerKey = `${x},${y}`;
    this.ghostTowers.delete(towerKey);
    if (this.isPath(x, y) && !this.blocked.has(towerKey)) {
      this.blocked.add(towerKey);
      this._blockCount++;
    }
    this.pathVersion++;
  }

  // Bulk restore of every ghosted path tower. Bumping pathVersion once triggers
  // the navmesh obstacle re-sync + collider refresh at update() time so N ghost
  // towers do not each re-sync. The bump still happens when the set is empty:
  // wave start clears isGhost on terrain towers before calling this, and those
  // towers are not in the set.
  batchClearGhosts(): void {
    for (const key of this.ghostTowers) {
      // Set add is idempotent but the count is not: only count a key that was
      // not already blocked (e.g. a re-ghosted tile after a prior batch clear).
      if (this.blocked.has(key)) continue;
      this.blocked.add(key);
      this._blockCount++;
    }
    this.ghostTowers.clear();
    this.pathVersion++;
  }

  worldToTile(wx: number, wy: number): Point {
    return {
      x: Math.floor((wx - this.worldOriginX) / this.tileSize),
      y: Math.floor((wy - this.worldOriginY) / this.tileSize),
    };
  }

  tileToWorld(tx: number, ty: number): Point {
    return {
      x: this.worldOriginX + tx * this.tileSize + this.tileSize / 2,
      y: this.worldOriginY + ty * this.tileSize + this.tileSize / 2,
    };
  }

  getBase(): Point {
    return this.base;
  }

  getBaseGoalTiles(): Point[] {
    const { x, y } = this.base;
    const goalTiles: Point[] = [{ x, y }];
    const ring = [
      { x: x - 1, y: y - 1 },
      { x, y: y - 1 },
      { x: x + 1, y: y - 1 },
      { x: x - 1, y },
      { x: x + 1, y },
      { x: x - 1, y: y + 1 },
      { x, y: y + 1 },
      { x: x + 1, y: y + 1 },
    ];
    for (const tile of ring) {
      if (!this.inBounds(tile.x, tile.y)) continue;
      // Walkable-only: goals steer crowds/paths, so a terrain ring tile would
      // send a goal (and a path ending) onto a wall.
      if (!(this.isPath(tile.x, tile.y) || this.isSpawn(tile.x, tile.y) || this.isBase(tile.x, tile.y))) {
        continue;
      }
      goalTiles.push(tile);
    }
    return goalTiles;
  }

  // Base perimeter segments in world coordinates: one 1-tile-wide axis-aligned
  // segment per base tile whose outward-adjacent tile is traversable. Used by the
  // SVG red target-edge overlay (not by enemy attack acquisition — that is Rapier
  // contacts).
  getBaseEdgeSegments(): Array<{ x1: number; y1: number; x2: number; y2: number }> {
    return this.getSquareEdgeSegments(this.base, 1.5 * this.tileSize);
  }

  // Shared implementation for getBaseEdgeSegments: computes axis-aligned 1-tile edge
  // segments around a square centered at `centerTile` with the given half-extent,
  // including only sides whose outward-adjacent tile is traversable.
  private getSquareEdgeSegments(
    centerTile: { x: number; y: number },
    half: number,
  ): Array<{ x1: number; y1: number; x2: number; y2: number }> {
    const center = this.tileToWorld(centerTile.x, centerTile.y);
    const sides = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
    ];
    const offsets = [-1, 0, 1];
    const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (const side of sides) {
      for (const offset of offsets) {
        const tile =
          side.dx === 0
            ? { x: centerTile.x + offset, y: centerTile.y + side.dy }
            : { x: centerTile.x + side.dx, y: centerTile.y + offset };
        const outwardX = tile.x + side.dx;
        const outwardY = tile.y + side.dy;
        if (!this.inBounds(outwardX, outwardY)) continue;
        if (this.isTerrain(outwardX, outwardY)) continue;
        if (side.dx !== 0) {
          const edgeX = center.x + side.dx * half;
          const y1 = this.worldOriginY + tile.y * this.tileSize;
          const y2 = this.worldOriginY + (tile.y + 1) * this.tileSize;
          segments.push({ x1: edgeX, y1, x2: edgeX, y2 });
        } else {
          const edgeY = center.y + side.dy * half;
          const x1 = this.worldOriginX + tile.x * this.tileSize;
          const x2 = this.worldOriginX + (tile.x + 1) * this.tileSize;
          segments.push({ x1, y1: edgeY, x2, y2: edgeY });
        }
      }
    }
    return segments;
  }
}

function shiftKeySet(keys: Set<string>, shiftX: number, shiftY: number): Set<string> {
  const shifted = new Set<string>();
  for (const key of keys) {
    const separator = key.indexOf(",");
    const tileX = Number(key.slice(0, separator));
    const tileY = Number(key.slice(separator + 1));
    shifted.add(`${tileX + shiftX},${tileY + shiftY}`);
  }
  return shifted;
}
