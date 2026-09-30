interface Tile {
  type: "terrain" | "path" | "base" | "spawn";
  height: number;
}

interface Point {
  x: number;
  y: number;
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
  regionId: number = 0;
  // Bumped on every tower build/sell/ghost/restore, terrain included, so Rapier
  // tower colliders and navmesh TileCache obstacles rebuild and the EnemyManager
  // live-tower cache (keyed on this value) refreshes. Corridor walls are static
  // per map.
  pathVersion: number = 0;
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
    this.regionId = map.regionId ?? 0;
    this.pathVersion = 0;
  }

  get blockCount(): number {
    return this._blockCount;
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
    if (tileType.type === "terrain") return !this.terrainTowers.has(`${x},${y}`);
    if (tileType.type === "path") {
      return !this.blocked.has(`${x},${y}`) && !this.ghostTowers.has(`${x},${y}`);
    }
    if (tileType.type === "spawn") return false;
    return false;
  }

  registerTower(x: number, y: number): boolean {
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
  // A restore that is not in `ghostTowers` (a terrain tower) only bumps
  // pathVersion so the cuboid comes back without joining the path-block set.
  clearTowerGhost(x: number, y: number): void {
    const towerKey = `${x},${y}`;
    if (!this.ghostTowers.delete(towerKey)) {
      this.pathVersion++;
      return;
    }
    this.blocked.add(towerKey);
    this._blockCount++;
    this.pathVersion++;
  }

  // Bulk restore of every ghosted path tower. Bumping pathVersion once triggers
  // the navmesh obstacle re-sync + collider refresh at update() time so N ghost
  // towers do not each re-sync. The bump still happens when the set is empty:
  // wave start clears isGhost on terrain towers before calling this, and those
  // towers are not in the set.
  batchClearGhosts(): void {
    for (const key of this.ghostTowers) {
      this.blocked.add(key);
    }
    this._blockCount += this.ghostTowers.size;
    this.ghostTowers.clear();
    this.pathVersion++;
  }

  worldToTile(wx: number, wy: number): Point {
    return { x: Math.floor(wx / this.tileSize), y: Math.floor(wy / this.tileSize) };
  }

  tileToWorld(tx: number, ty: number): Point {
    return { x: tx * this.tileSize + this.tileSize / 2, y: ty * this.tileSize + this.tileSize / 2 };
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
      if (this.inBounds(tile.x, tile.y)) goalTiles.push(tile);
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
          const y1 = tile.y * this.tileSize;
          const y2 = (tile.y + 1) * this.tileSize;
          segments.push({ x1: edgeX, y1, x2: edgeX, y2 });
        } else {
          const edgeY = center.y + side.dy * half;
          const x1 = tile.x * this.tileSize;
          const x2 = (tile.x + 1) * this.tileSize;
          segments.push({ x1, y1: edgeY, x2, y2: edgeY });
        }
      }
    }
    return segments;
  }
}
