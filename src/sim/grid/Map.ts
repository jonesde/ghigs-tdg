// Procedural map definitions for 3 regions × 12 maps each = 36 maps.

import { getGameContent } from "@/content/gameContent.js";
import type { MapsContent } from "@/content/schemas/maps.js";
import type { MapThemeData } from "@/render/themes/index.js";

export function progressiveMapDisplayName(regionId: number, entryCount: number, theme: MapThemeData | null): string {
  const region = theme?.regions.find((regionEntry) => regionEntry.id === regionId);
  const regionName = region?.name ?? `Region ${regionId + 1}`;
  return `${regionName} Progressive ${entryCount}`;
}

export function getMapDisplayName(map: GeneratedMap | null, theme: MapThemeData | null): string {
  if (!map) return "";
  if (map.style === "progressive" && map.entryCount !== undefined) {
    return progressiveMapDisplayName(map.regionId, map.entryCount, theme);
  }
  if (!theme) return map.name || "Generated Map";
  const region = theme.regions.find((regionEntry) => regionEntry.id === map.regionId);
  if (region && map.level !== undefined) {
    return `${region.name} Map ${map.level}`;
  }
  return map.name || "Generated Map";
}

interface Tile {
  type: "terrain" | "path" | "base" | "spawn" | "void";
  height: number;
}

interface Point {
  x: number;
  y: number;
}

export interface MapSpawnPoint extends Point {
  id?: number;
  fixed?: boolean;
}

export interface GeneratedMap {
  regionId: number;
  level: number;
  style: string;
  width: number;
  height: number;
  tiles: Tile[][];
  spawns: MapSpawnPoint[];
  base: Point;
  name: string;
  bossCadence: number;
  seed: number;
  entryCount?: number;
  // Absolute tile coordinate of tiles[0][0]. World x of that corner is originTileX * 36.
  originTileX?: number;
  originTileY?: number;
}

function _carveStraight(tiles: Tile[][], from: Point, nextWaypoint: Point) {
  let curX = from.x;
  let curY = from.y;
  while (curY !== nextWaypoint.y) {
    tiles[curY]![curX]!.type = "path";
    tiles[curY]![curX]!.height = 1;
    curY += Math.sign(nextWaypoint.y - curY);
  }
  while (curX !== nextWaypoint.x) {
    tiles[curY]![curX]!.type = "path";
    tiles[curY]![curX]!.height = 1;
    curX += Math.sign(nextWaypoint.x - curX);
  }
  tiles[curY]![curX]!.type = "path";
}

// Carves an axis-aligned corridor between two points. `width` is the intended
// tile width of the corridor: width<=1 is a single tile, width 2-3 spans 3 tiles,
// width 4-5 spans 5, and so on (half-extent = floor(width/2)). The previous
// ceil(width/2) painted 3 tiles for width=1.
function carveWidePath(
  tiles: Tile[][],
  from: Point,
  nextWaypoint: Point,
  width: number = 1,
  isLandscape: boolean = false,
) {
  const pts: Point[] = [];
  let curX = from.x;
  let curY = from.y;
  pts.push({ x: curX, y: curY });
  if (isLandscape) {
    while (curY !== nextWaypoint.y) {
      curY += Math.sign(nextWaypoint.y - curY);
      pts.push({ x: curX, y: curY });
    }
    while (curX !== nextWaypoint.x) {
      curX += Math.sign(nextWaypoint.x - curX);
      pts.push({ x: curX, y: curY });
    }
  } else {
    while (curX !== nextWaypoint.x) {
      curX += Math.sign(nextWaypoint.x - curX);
      pts.push({ x: curX, y: curY });
    }
    while (curY !== nextWaypoint.y) {
      curY += Math.sign(nextWaypoint.y - curY);
      pts.push({ x: curX, y: curY });
    }
  }
  for (const pt of pts) {
    const halfW = Math.floor(width / 2);
    for (let deltaY = -halfW; deltaY <= halfW; deltaY++) {
      for (let deltaX = -halfW; deltaX <= halfW; deltaX++) {
        const neighborX = pt.x + deltaX;
        const neighborY = pt.y + deltaY;
        if (
          neighborX >= 0 &&
          neighborY >= 0 &&
          neighborX < tiles[0]!.length &&
          neighborY < tiles.length &&
          tiles[neighborY]![neighborX]!.type !== "base"
        ) {
          tiles[neighborY]![neighborX]!.type = "path";
          tiles[neighborY]![neighborX]!.height = 1;
        }
      }
    }
  }
}

// Reverts degree-0/1 path tiles to terrain, then drops path tiles that cannot
// reach a spawn. The base center is an anchor before the 3x3 stamp (it is still
// terrain). After the stamp the whole base 3x3 is walkable, so the collar tile
// in front of the gate is not eaten as a spur.
function pruneDeadEnds(tiles: Tile[][], spawns: Point[], base: Point): void {
  const mapWidth = tiles[0]!.length;
  const mapHeight = tiles.length;
  const spawnKeys = new Set(spawns.map((spawn) => `${spawn.x},${spawn.y}`));
  const baseKey = `${base.x},${base.y}`;
  const isAnchor = (tileX: number, tileY: number): boolean => {
    if (tileX < 0 || tileY < 0 || tileX >= mapWidth || tileY >= mapHeight) return false;
    const key = `${tileX},${tileY}`;
    if (spawnKeys.has(key) || key === baseKey) return true;
    return tiles[tileY]![tileX]!.type === "spawn";
  };
  const isWalkablePath = (tileX: number, tileY: number): boolean => {
    if (tileX < 0 || tileY < 0 || tileX >= mapWidth || tileY >= mapHeight) return false;
    if (isAnchor(tileX, tileY)) return true;
    const tileType = tiles[tileY]![tileX]!.type;
    return tileType === "path" || tileType === "base";
  };
  const walkableDegree = (tileX: number, tileY: number): number => {
    let degree = 0;
    if (isWalkablePath(tileX + 1, tileY)) degree++;
    if (isWalkablePath(tileX - 1, tileY)) degree++;
    if (isWalkablePath(tileX, tileY + 1)) degree++;
    if (isWalkablePath(tileX, tileY - 1)) degree++;
    return degree;
  };
  const toTerrain = (tileX: number, tileY: number): void => {
    if (isAnchor(tileX, tileY)) return;
    tiles[tileY]![tileX]!.type = "terrain";
    tiles[tileY]![tileX]!.height = 2;
  };
  for (;;) {
    let pruned = false;
    for (let tileY = 0; tileY < mapHeight; tileY++) {
      for (let tileX = 0; tileX < mapWidth; tileX++) {
        if (tiles[tileY]![tileX]!.type !== "path") continue;
        if (isAnchor(tileX, tileY)) continue;
        if (walkableDegree(tileX, tileY) <= 1) {
          toTerrain(tileX, tileY);
          pruned = true;
        }
      }
    }
    if (!pruned) break;
  }
  const reached = new Set<string>();
  const queue: Point[] = [];
  for (const spawn of spawns) {
    if (spawn.x < 0 || spawn.y < 0 || spawn.x >= mapWidth || spawn.y >= mapHeight) continue;
    const key = `${spawn.x},${spawn.y}`;
    reached.add(key);
    queue.push({ x: spawn.x, y: spawn.y });
  }
  let head = 0;
  while (head < queue.length) {
    const current = queue[head]!;
    head += 1;
    for (const neighbor of [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ]) {
      if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= mapWidth || neighbor.y >= mapHeight) continue;
      const key = `${neighbor.x},${neighbor.y}`;
      if (reached.has(key)) continue;
      if (key !== baseKey && !isWalkablePath(neighbor.x, neighbor.y)) continue;
      reached.add(key);
      queue.push(neighbor);
    }
  }
  if (!reached.has(baseKey)) return;
  for (let tileY = 0; tileY < mapHeight; tileY++) {
    for (let tileX = 0; tileX < mapWidth; tileX++) {
      if (tiles[tileY]![tileX]!.type !== "path") continue;
      if (isAnchor(tileX, tileY)) continue;
      if (!reached.has(`${tileX},${tileY}`)) toTerrain(tileX, tileY);
    }
  }
}

interface TileRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface RailSpan {
  mainStart: number;
  mainEnd: number;
  perp: number;
  foldIndex: number;
}

interface FoldedCorridorResult {
  rungMains: number[];
  rails: RailSpan[];
}

interface PerpBand {
  low: number;
  high: number;
}

interface WideRail {
  foldIndex: number;
  length: number;
}

interface BastionIsland {
  frontMain: number;
  islandMainStart: number;
  islandMainEnd: number;
  backMain: number;
  approachEnd: number;
  perpStart: number;
  perpEnd: number;
}

function rectContains(rect: TileRect, tileX: number, tileY: number): boolean {
  return tileX >= rect.minX && tileX <= rect.maxX && tileY >= rect.minY && tileY <= rect.maxY;
}

function axisPoint(isLandscape: boolean, main: number, perp: number): Point {
  return isLandscape ? { x: main, y: perp } : { x: perp, y: main };
}

function paintPathDisk(
  tiles: Tile[][],
  centerX: number,
  centerY: number,
  pathWidth: number,
  reserved: TileRect | null,
): void {
  const mapWidth = tiles[0]!.length;
  const mapHeight = tiles.length;
  const halfExtent = Math.floor(pathWidth / 2);
  for (let deltaY = -halfExtent; deltaY <= halfExtent; deltaY++) {
    for (let deltaX = -halfExtent; deltaX <= halfExtent; deltaX++) {
      const tileX = centerX + deltaX;
      const tileY = centerY + deltaY;
      if (tileX < 0 || tileY < 0 || tileX >= mapWidth || tileY >= mapHeight) continue;
      if (tiles[tileY]![tileX]!.type === "base") continue;
      if (reserved && rectContains(reserved, tileX, tileY)) continue;
      tiles[tileY]![tileX]!.type = "path";
      tiles[tileY]![tileX]!.height = 1;
    }
  }
}

function paintTerrainTile(tiles: Tile[][], tileX: number, tileY: number, heightValue: number): void {
  const mapWidth = tiles[0]!.length;
  const mapHeight = tiles.length;
  if (tileX < 0 || tileY < 0 || tileX >= mapWidth || tileY >= mapHeight) return;
  if (tiles[tileY]![tileX]!.type === "base") return;
  tiles[tileY]![tileX]!.type = "terrain";
  tiles[tileY]![tileX]!.height = heightValue;
}

function reservedFromMain(isLandscape: boolean, mainMin: number, mapWidth: number, mapHeight: number): TileRect {
  if (isLandscape) return { minX: mainMin, minY: 0, maxX: mapWidth - 1, maxY: mapHeight - 1 };
  return { minX: 0, minY: mainMin, maxX: mapWidth - 1, maxY: mapHeight - 1 };
}

// Folds alternate between the perp edges, then a width-1 run enters `to`.
// `advance` is the main-axis distance between rung centers. With a corridor half-extent H the
// interior gap is advance-2H-1, so the rungs cannot merge into one room. gateRun 3 puts the
// width-1 alignment on baseMain-3: a wide disk there cannot reach the center collar tiles.
function carveFoldedCorridor(
  tiles: Tile[][],
  from: Point,
  to: Point,
  isLandscape: boolean,
  widthAt: (foldIndex: number) => number,
  advance: number,
  firstDirection: number,
  reserved: TileRect | null,
  gateRun: number,
  band: PerpBand | null,
  wideRail: WideRail | null,
): FoldedCorridorResult {
  const mapWidth = tiles[0]!.length;
  const mapHeight = tiles.length;
  const mainLimit = isLandscape ? mapWidth : mapHeight;
  const perpLimit = isLandscape ? mapHeight : mapWidth;
  const fromMain = isLandscape ? from.x : from.y;
  const toMain = isLandscape ? to.x : to.y;
  const toPerp = isLandscape ? to.y : to.x;
  const mainSign = Math.sign(toMain - fromMain) || 1;
  const mainAdvance = Math.max(2, advance);
  const alignMain = toMain - mainSign * Math.max(0, gateRun);
  let cursorMain = fromMain;
  let cursorPerp = isLandscape ? from.y : from.x;
  let direction = firstDirection >= 0 ? 1 : -1;
  let foldIndex = 0;
  const rungMains: number[] = [];
  const rails: RailSpan[] = [];

  const paintDiskAt = (main: number, perp: number, pathWidth: number) => {
    const halfExtent = Math.floor(pathWidth / 2);
    const inwardLow = 1 + halfExtent;
    const inwardHigh = perpLimit - 2 - halfExtent;
    for (let deltaPerp = -halfExtent; deltaPerp <= halfExtent; deltaPerp++) {
      for (let deltaMain = -halfExtent; deltaMain <= halfExtent; deltaMain++) {
        const paintPerp = perp + deltaPerp;
        // The shoulder past the fold edge is two steps from the inside lane, so it
        // is wasted path. The disk center itself still paints, including a spawn
        // that sits on that edge.
        if (deltaPerp !== 0 && (paintPerp < inwardLow || paintPerp > inwardHigh)) continue;
        const point = axisPoint(isLandscape, main + deltaMain, paintPerp);
        if (point.x < 0 || point.y < 0 || point.x >= mapWidth || point.y >= mapHeight) continue;
        if (tiles[point.y]![point.x]!.type === "base") continue;
        if (reserved && rectContains(reserved, point.x, point.y)) continue;
        tiles[point.y]![point.x]!.type = "path";
        tiles[point.y]![point.x]!.height = 1;
      }
    }
  };
  const blockedCenter = (main: number, perp: number, allowDestination: boolean): boolean => {
    if (allowDestination && main === toMain && perp === toPerp) return false;
    const point = axisPoint(isLandscape, main, perp);
    if (point.x < 0 || point.y < 0 || point.x >= mapWidth || point.y >= mapHeight) return true;
    if (tiles[point.y]![point.x]!.type === "base") return true;
    if (reserved && rectContains(reserved, point.x, point.y)) return true;
    return false;
  };
  const sweepPerpTo = (targetPerp: number, pathWidth: number) => {
    const perpStep = Math.sign(targetPerp - cursorPerp);
    if (perpStep === 0) return;
    while (cursorPerp !== targetPerp) {
      paintDiskAt(cursorMain, cursorPerp, pathWidth);
      cursorPerp += perpStep;
    }
    paintDiskAt(cursorMain, cursorPerp, pathWidth);
  };

  paintDiskAt(cursorMain, cursorPerp, 1);

  while (mainSign * (alignMain - cursorMain) > 0 && cursorMain > 0 && cursorMain < mainLimit - 1) {
    const remaining = mainSign * (alignMain - cursorMain);
    if (remaining < mainAdvance) break;
    const foldWidth = Math.max(1, widthAt(foldIndex));
    const halfExtent = Math.floor(foldWidth / 2);
    const boardLow = 1 + halfExtent;
    const boardHigh = perpLimit - 2 - halfExtent;
    const perpLow = Math.max(boardLow, band?.low ?? boardLow);
    const perpHigh = Math.min(boardHigh, band?.high ?? boardHigh);
    if (perpHigh < perpLow) break;

    const targetPerp = direction > 0 ? perpHigh : perpLow;
    // A swing that is already on its edge still crosses the band, then returns, so the rung
    // covers the entry column and the rail stays on the requested edge.
    if (targetPerp === cursorPerp) {
      const oppositePerp = direction > 0 ? perpLow : perpHigh;
      sweepPerpTo(oppositePerp, foldWidth);
      sweepPerpTo(targetPerp, foldWidth);
    } else {
      sweepPerpTo(targetPerp, foldWidth);
    }
    rungMains.push(cursorMain);

    const railStart = cursorMain;
    let advanced = 0;
    while (advanced < mainAdvance) {
      const nextMain = cursorMain + mainSign;
      if (mainSign * (nextMain - alignMain) > 0) break;
      if (blockedCenter(nextMain, cursorPerp, false)) break;
      const useWide = wideRail !== null && wideRail.foldIndex === foldIndex && advanced < wideRail.length;
      const stepWidth = useWide ? Math.max(foldWidth, 3) : foldWidth;
      cursorMain = nextMain;
      paintDiskAt(cursorMain, cursorPerp, stepWidth);
      advanced += 1;
    }
    rails.push({ mainStart: railStart, mainEnd: cursorMain, perp: cursorPerp, foldIndex });
    direction = -direction;
    foldIndex += 1;
    if (advanced === 0) break;
  }

  while (mainSign * (alignMain - cursorMain) > 0) {
    const nextMain = cursorMain + mainSign;
    if (blockedCenter(nextMain, cursorPerp, false)) break;
    cursorMain = nextMain;
    paintDiskAt(cursorMain, cursorPerp, 1);
  }
  while (cursorPerp !== toPerp) {
    const nextPerp = cursorPerp + Math.sign(toPerp - cursorPerp);
    if (blockedCenter(cursorMain, nextPerp, false)) break;
    cursorPerp = nextPerp;
    paintDiskAt(cursorMain, cursorPerp, 1);
  }
  while (cursorMain !== toMain) {
    const nextMain = cursorMain + Math.sign(toMain - cursorMain);
    if (blockedCenter(nextMain, cursorPerp, true)) break;
    cursorMain = nextMain;
    paintDiskAt(cursorMain, cursorPerp, 1);
  }
  if (cursorMain === toMain && cursorPerp === toPerp) paintDiskAt(toMain, toPerp, 1);
  return { rungMains, rails };
}

function carveRing(tiles: Tile[][], island: TileRect, interiorHeight: number): void {
  const mapWidth = tiles[0]!.length;
  const mapHeight = tiles.length;
  const outerMinX = island.minX - 1;
  const outerMaxX = island.maxX + 1;
  const outerMinY = island.minY - 1;
  const outerMaxY = island.maxY + 1;
  for (let tileY = outerMinY; tileY <= outerMaxY; tileY++) {
    for (let tileX = outerMinX; tileX <= outerMaxX; tileX++) {
      const onBorder = tileX === outerMinX || tileX === outerMaxX || tileY === outerMinY || tileY === outerMaxY;
      if (!onBorder) continue;
      if (tileX < 0 || tileY < 0 || tileX >= mapWidth || tileY >= mapHeight) continue;
      if (tiles[tileY]![tileX]!.type === "base") continue;
      tiles[tileY]![tileX]!.type = "path";
      tiles[tileY]![tileX]!.height = 1;
    }
  }
  for (let tileY = island.minY; tileY <= island.maxY; tileY++) {
    for (let tileX = island.minX; tileX <= island.maxX; tileX++) paintTerrainTile(tiles, tileX, tileY, interiorHeight);
  }
}

function punchRailIsland(tiles: Tile[][], rail: RailSpan, isLandscape: boolean, interiorHeight: number): boolean {
  if (Math.abs(rail.mainEnd - rail.mainStart) < 6) return false;
  const mapWidth = tiles[0]!.length;
  const mapHeight = tiles.length;
  const mainLimit = isLandscape ? mapWidth : mapHeight;
  const perpLimit = isLandscape ? mapHeight : mapWidth;
  const centerMain = Math.round((rail.mainStart + rail.mainEnd) / 2);
  if (centerMain - 2 < 0 || centerMain + 2 >= mainLimit) return false;
  if (rail.perp - 2 < 0 || rail.perp + 2 >= perpLimit) return false;
  for (let deltaMain = -2; deltaMain <= 2; deltaMain++) {
    for (let deltaPerp = -2; deltaPerp <= 2; deltaPerp++) {
      const point = axisPoint(isLandscape, centerMain + deltaMain, rail.perp + deltaPerp);
      const inner = Math.abs(deltaMain) <= 1 && Math.abs(deltaPerp) <= 1;
      if (inner) paintTerrainTile(tiles, point.x, point.y, interiorHeight);
      else paintPathDisk(tiles, point.x, point.y, 1, null);
    }
  }
  return true;
}

function findBandEdgePath(
  tiles: Tile[][],
  isLandscape: boolean,
  main: number,
  perpStart: number,
  perpEnd: number,
  preferHigh: boolean,
): Point | null {
  const mapWidth = tiles[0]!.length;
  const mapHeight = tiles.length;
  const low = Math.min(perpStart, perpEnd);
  const high = Math.max(perpStart, perpEnd);
  let found: Point | null = null;
  for (let perp = low; perp <= high; perp++) {
    const point = axisPoint(isLandscape, main, perp);
    if (point.x < 0 || point.y < 0 || point.x >= mapWidth || point.y >= mapHeight) continue;
    const tileType = tiles[point.y]![point.x]!.type;
    if (tileType !== "path" && tileType !== "spawn") continue;
    found = point;
    if (!preferHigh) return point;
  }
  return found;
}

function paintFlyerGapRidge(tiles: Tile[][], isLandscape: boolean, mainValue: number, gapPerp: number): void {
  const mapWidth = tiles[0]!.length;
  const mapHeight = tiles.length;
  const perpLimit = isLandscape ? mapHeight : mapWidth;
  for (let perp = 0; perp < perpLimit; perp++) {
    const point = axisPoint(isLandscape, mainValue, perp);
    if (point.x < 0 || point.y < 0 || point.x >= mapWidth || point.y >= mapHeight) continue;
    if (tiles[point.y]![point.x]!.type !== "terrain") continue;
    const inGap = perp === gapPerp || perp === gapPerp + 1;
    tiles[point.y]![point.x]!.height = inGap ? 1 : 4;
  }
}

// Keeps the open collar run that the walk actually reaches and closes every other
// collar tile. Runs after the 3x3 stamp: the door is outside the stamp, and a
// later prune only keeps it because base tiles count as walkable.
function sealBaseCollar(tiles: Tile[][], spawns: Point[], base: Point, sealedHeight: number): void {
  const mapWidth = tiles[0]!.length;
  const mapHeight = tiles.length;
  const sides = new Map<string, Point[]>();
  const addCollar = (side: string, tileX: number, tileY: number) => {
    if (tileX < 0 || tileY < 0 || tileX >= mapWidth || tileY >= mapHeight) return;
    const list = sides.get(side) ?? [];
    list.push({ x: tileX, y: tileY });
    sides.set(side, list);
  };
  for (let offset = -1; offset <= 1; offset++) {
    addCollar("west", base.x - 2, base.y + offset);
    addCollar("east", base.x + 2, base.y + offset);
    addCollar("north", base.x + offset, base.y - 2);
    addCollar("south", base.x + offset, base.y + 2);
  }

  const distance = new Map<string, number>();
  const queue: Point[] = [];
  for (const spawn of spawns) {
    if (spawn.x < 0 || spawn.y < 0 || spawn.x >= mapWidth || spawn.y >= mapHeight) continue;
    const key = `${spawn.x},${spawn.y}`;
    if (distance.has(key)) continue;
    distance.set(key, 0);
    queue.push({ x: spawn.x, y: spawn.y });
  }
  let head = 0;
  while (head < queue.length) {
    const current = queue[head]!;
    head += 1;
    const currentDistance = distance.get(`${current.x},${current.y}`)!;
    for (const neighbor of [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ]) {
      if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= mapWidth || neighbor.y >= mapHeight) continue;
      const key = `${neighbor.x},${neighbor.y}`;
      if (distance.has(key)) continue;
      const tileType = tiles[neighbor.y]![neighbor.x]!.type;
      if (tileType !== "path" && tileType !== "spawn" && tileType !== "base") continue;
      distance.set(key, currentDistance + 1);
      queue.push(neighbor);
    }
  }

  const isOpenCollar = (tile: Point): boolean => {
    const tileType = tiles[tile.y]![tile.x]!.type;
    return tileType === "path" || tileType === "spawn";
  };
  let gate: Point | null = null;
  let gateSide = "";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [side, sideTiles] of sides) {
    for (const tile of sideTiles) {
      if (!isOpenCollar(tile)) continue;
      const tileDistance = distance.get(`${tile.x},${tile.y}`);
      if (tileDistance === undefined || tileDistance >= bestDistance) continue;
      bestDistance = tileDistance;
      gate = tile;
      gateSide = side;
    }
  }
  if (!gate) return;

  const sideTiles = sides.get(gateSide) ?? [];
  const alongX = sideTiles.length > 0 && sideTiles.every((tile) => tile.y === sideTiles[0]!.y);
  const sorted = [...sideTiles].sort((left, right) => (alongX ? left.x - right.x : left.y - right.y));
  const coordinate = (tile: Point) => (alongX ? tile.x : tile.y);
  const gateIndex = sorted.findIndex((tile) => tile.x === gate.x && tile.y === gate.y);
  const keep = new Set<string>();
  if (gateIndex >= 0) {
    keep.add(`${gate.x},${gate.y}`);
    for (let index = gateIndex - 1; index >= 0; index--) {
      const tile = sorted[index]!;
      if (!isOpenCollar(tile)) break;
      if (coordinate(sorted[index + 1]!) - coordinate(tile) !== 1) break;
      keep.add(`${tile.x},${tile.y}`);
    }
    for (let index = gateIndex + 1; index < sorted.length; index++) {
      const tile = sorted[index]!;
      if (!isOpenCollar(tile)) break;
      if (coordinate(tile) - coordinate(sorted[index - 1]!) !== 1) break;
      keep.add(`${tile.x},${tile.y}`);
    }
  }

  for (const sideTiles of sides.values()) {
    for (const tile of sideTiles) {
      if (!isOpenCollar(tile)) continue;
      if (tiles[tile.y]![tile.x]!.type === "spawn") continue;
      if (keep.has(`${tile.x},${tile.y}`)) continue;
      paintTerrainTile(tiles, tile.x, tile.y, sealedHeight);
    }
  }
}

function carveSerpentine(tiles: Tile[][], spawns: Point[], base: Point, rng: () => number, isLandscape: boolean): void {
  const mapWidth = tiles[0]!.length;
  const mapHeight = tiles.length;
  const perpLimit = isLandscape ? mapHeight : mapWidth;
  const minorAxis = Math.min(mapWidth, mapHeight);
  const jitter = 1 + Math.floor(rng() * 3);
  const spawnPerp = Math.max(1, Math.min(perpLimit - 2, jitter));
  const spawn = axisPoint(isLandscape, 1, spawnPerp);
  spawns.push(spawn);
  const wideRail = minorAxis >= 20 ? { foldIndex: 0, length: 4 } : null;
  carveFoldedCorridor(tiles, spawn, base, isLandscape, () => 1, 4, 1, null, 3, null, wideRail);
}

function carveEdgeFold(
  tiles: Tile[][],
  spawns: Point[],
  base: Point,
  rng: () => number,
  isLandscape: boolean,
  widthAt: (foldIndex: number) => number,
  advance: number,
): void {
  const perpLimit = isLandscape ? tiles.length : tiles[0]!.length;
  const startOnHighEdge = rng() > 0.5;
  const spawnPerp = startOnHighEdge ? Math.max(1, perpLimit - 2) : 1;
  const spawn = axisPoint(isLandscape, 1, spawnPerp);
  spawns.push(spawn);
  carveFoldedCorridor(tiles, spawn, base, isLandscape, widthAt, advance, startOnHighEdge ? -1 : 1, null, 3, null, null);
}

function carveBattlefield(
  tiles: Tile[][],
  spawns: Point[],
  base: Point,
  rng: () => number,
  isLandscape: boolean,
): void {
  carveEdgeFold(tiles, spawns, base, rng, isLandscape, (foldIndex) => (foldIndex % 2 === 0 ? 3 : 1), 5);
}

function carveCanyon(tiles: Tile[][], spawns: Point[], base: Point, rng: () => number, isLandscape: boolean): void {
  carveEdgeFold(tiles, spawns, base, rng, isLandscape, (foldIndex) => (foldIndex % 2 === 0 ? 3 : 1), 4);
}

function carveOpen(tiles: Tile[][], spawns: Point[], base: Point, rng: () => number, isLandscape: boolean): void {
  const mapWidth = tiles[0]!.length;
  const mapHeight = tiles.length;
  const perpLimit = isLandscape ? mapHeight : mapWidth;
  const startOnHighEdge = rng() > 0.5;
  const islandHeight = rng() > 0.5 ? 3 : 2;
  const gapPerp = Math.min(Math.floor(rng() * Math.max(1, perpLimit - 1)), Math.max(0, perpLimit - 2));
  const spawnPerp = startOnHighEdge ? Math.max(1, perpLimit - 2) : 1;
  const spawn = axisPoint(isLandscape, 1, spawnPerp);
  spawns.push(spawn);
  const carved = carveFoldedCorridor(
    tiles,
    spawn,
    base,
    isLandscape,
    () => 3,
    6,
    startOnHighEdge ? -1 : 1,
    null,
    3,
    null,
    null,
  );
  const mainLimit = isLandscape ? mapWidth : mapHeight;
  const boardMid = (mainLimit - 1) / 2;
  const candidates = carved.rails
    .filter((rail) => Math.abs(rail.mainEnd - rail.mainStart) >= 6)
    .sort((left, right) => {
      const leftDistance = Math.abs((left.mainStart + left.mainEnd) / 2 - boardMid);
      const rightDistance = Math.abs((right.mainStart + right.mainEnd) / 2 - boardMid);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      return left.foldIndex - right.foldIndex;
    });
  for (const rail of candidates) {
    if (punchRailIsland(tiles, rail, isLandscape, islandHeight)) break;
  }
  const firstRung = carved.rungMains[0];
  // Half of a width-3 rung is 1, so the first all-terrain column beside it is rung+2.
  if (firstRung !== undefined) paintFlyerGapRidge(tiles, isLandscape, firstRung + 2, gapPerp);
}

function carveSplit(tiles: Tile[][], spawns: Point[], base: Point, rng: () => number, isLandscape: boolean): void {
  const mapWidth = tiles[0]!.length;
  const mapHeight = tiles.length;
  const crossLimit = isLandscape ? mapHeight : mapWidth;
  const mid = Math.floor(crossLimit / 2);
  const lowBand = { low: 1, high: Math.max(1, mid - 2) };
  const highBand = { low: Math.min(Math.max(1, crossLimit - 2), mid + 2), high: Math.max(1, crossLimit - 2) };
  const inward = rng() > 0.5;
  const lowSpawn = axisPoint(isLandscape, 1, 1);
  const highSpawn = axisPoint(isLandscape, 1, Math.max(1, crossLimit - 2));
  spawns.push(lowSpawn, highSpawn);
  const lowDirection = inward ? 1 : -1;
  const lowCarved = carveFoldedCorridor(
    tiles,
    lowSpawn,
    base,
    isLandscape,
    () => 1,
    4,
    lowDirection,
    null,
    3,
    lowBand,
    null,
  );
  const highCarved = carveFoldedCorridor(
    tiles,
    highSpawn,
    base,
    isLandscape,
    () => 1,
    4,
    -lowDirection,
    null,
    3,
    highBand,
    null,
  );
  const sharedMains = lowCarved.rungMains.filter((main) => highCarved.rungMains.includes(main));
  if (sharedMains.length === 0) return;
  const linkMain = sharedMains[Math.floor((sharedMains.length - 1) / 2)]!;
  const lowJoin = findBandEdgePath(tiles, isLandscape, linkMain, lowBand.low, lowBand.high, true);
  const highJoin = findBandEdgePath(tiles, isLandscape, linkMain, highBand.low, highBand.high, false);
  if (!lowJoin || !highJoin) return;
  carveWidePath(tiles, lowJoin, highJoin, 1, isLandscape);
}

// Three terrain tiles between the lanes so a tower on the center is in basic range of both.
// Arm is symmetric, and the ring stays inside [1, crossLimit-2].
function planBastionIsland(
  baseMain: number,
  basePerp: number,
  crossLimit: number,
  thickness: number,
): BastionIsland | null {
  const frontMain = baseMain - 5;
  const islandMainEnd = frontMain - 1;
  const islandMainStart = islandMainEnd - (thickness - 1);
  const backMain = islandMainStart - 1;
  const approachEnd = backMain - 2;
  const crossArm = Math.min(basePerp - 2, crossLimit - 3 - basePerp);
  if (crossArm < 1) return null;
  if (backMain < 2 || approachEnd < 1 || islandMainStart < 1 || frontMain < 2) return null;
  return {
    frontMain,
    islandMainStart,
    islandMainEnd,
    backMain,
    approachEnd,
    perpStart: basePerp - crossArm,
    perpEnd: basePerp + crossArm,
  };
}

function carveBastion(tiles: Tile[][], spawns: Point[], base: Point, rng: () => number, isLandscape: boolean): void {
  const mapWidth = tiles[0]!.length;
  const mapHeight = tiles.length;
  const crossLimit = isLandscape ? mapHeight : mapWidth;
  const baseMain = isLandscape ? base.x : base.y;
  const basePerp = isLandscape ? base.y : base.x;
  const islandHeight = rng() > 0.5 ? 3 : 2;
  const firstDirection = rng() > 0.5 ? 1 : -1;
  const apronMain0 = baseMain - 4;
  for (let perp = 0; perp < crossLimit; perp++) {
    for (let main = apronMain0; main <= apronMain0 + 2; main++) {
      const point = axisPoint(isLandscape, main, perp);
      paintTerrainTile(tiles, point.x, point.y, 4);
    }
  }
  for (let deltaMain = -1; deltaMain <= 1; deltaMain++) {
    for (let deltaPerp = -1; deltaPerp <= 1; deltaPerp++) {
      const point = axisPoint(isLandscape, baseMain + deltaMain, basePerp + deltaPerp);
      paintTerrainTile(tiles, point.x, point.y, 4);
    }
  }

  const spawnPerp = Math.max(1, Math.min(crossLimit - 2, basePerp));
  const spawn = axisPoint(isLandscape, 1, spawnPerp);
  spawns.push(spawn);
  const island =
    planBastionIsland(baseMain, basePerp, crossLimit, 3) ?? planBastionIsland(baseMain, basePerp, crossLimit, 1);
  if (!island) {
    const approachMain = Math.max(1, apronMain0 - 1);
    const reserved = reservedFromMain(isLandscape, apronMain0, mapWidth, mapHeight);
    carveFoldedCorridor(
      tiles,
      spawn,
      axisPoint(isLandscape, approachMain, basePerp),
      isLandscape,
      () => 1,
      4,
      firstDirection,
      reserved,
      0,
      null,
      null,
    );
    carveWidePath(tiles, axisPoint(isLandscape, approachMain, basePerp), base, 1, isLandscape);
    return;
  }

  // Reserve the back lane's spawn side so the folds cannot bore the island or the apron.
  // The dock itself is one tile, painted after the fold stops.
  const reserved = reservedFromMain(isLandscape, island.backMain - 1, mapWidth, mapHeight);
  carveFoldedCorridor(
    tiles,
    spawn,
    axisPoint(isLandscape, island.approachEnd, basePerp),
    isLandscape,
    () => 1,
    4,
    firstDirection,
    reserved,
    0,
    null,
    null,
  );
  carveWidePath(
    tiles,
    axisPoint(isLandscape, island.approachEnd, basePerp),
    axisPoint(isLandscape, island.backMain, basePerp),
    1,
    isLandscape,
  );
  const islandRect: TileRect = isLandscape
    ? { minX: island.islandMainStart, maxX: island.islandMainEnd, minY: island.perpStart, maxY: island.perpEnd }
    : { minX: island.perpStart, maxX: island.perpEnd, minY: island.islandMainStart, maxY: island.islandMainEnd };
  carveRing(tiles, islandRect, islandHeight);
  carveWidePath(tiles, axisPoint(isLandscape, island.frontMain, basePerp), base, 1, isLandscape);
}

// Generated maps are cached per (catalog, index) pair. Each catalog is frozen
// immutable content resolved once per theme world, so entries never go stale in
// a normal run. The outer key is the catalog object identity: the default maps
// pack and each theme's resolved maps get their own inner cache, so two
// worlds sharing an index keep distinct layouts. Tests that remap an index (or
// swap map content) call invalidateMapCache() to drop prior layouts.
const mapCache = new Map<MapsContent, Map<number, GeneratedMap>>();

export function invalidateMapCache(): void {
  mapCache.clear();
}

export function getMap(index: number, maps: MapsContent = getGameContent().maps): GeneratedMap {
  let perCatalog = mapCache.get(maps);
  if (!perCatalog) {
    perCatalog = new Map<number, GeneratedMap>();
    mapCache.set(maps, perCatalog);
  }
  const cached = perCatalog.get(index);
  if (cached) return cached;
  const config = maps.levels[index]!;
  const map = generateRandomMap(
    config.width,
    config.height,
    config.style,
    config.regionId,
    config.level,
    config.seed,
    maps,
  );
  perCatalog.set(index, map);
  return map;
}

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let hash = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    hash = (hash + Math.imul(hash ^ (hash >>> 7), 61 | hash)) ^ hash;
    return ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
  };
}

// Derives a per-run sim seed from the map seed and the engine runId, so two
// runs of the same map draw different combat rolls while the same (map, runId)
// pair replays identically. Consumed by GameEngine for its ProjectileManager /
// ParticleSystem RNG forks (WaveManager keeps its own map-seed stream so wave
// composition stays stable across runs of the same map).
export function forkRunSeed(mapSeed: number, runId: number): number {
  return (mapSeed ^ Math.imul(runId + 1, 0x9e3779b1)) >>> 0;
}

export function generateRandomMap(
  width: number,
  height: number,
  style: string,
  regionId: number,
  level: number,
  seed: number,
  maps: MapsContent = getGameContent().maps,
): GeneratedMap {
  const rng = mulberry32(seed);

  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x++) {
      const heightVal = Math.max(
        1,
        Math.min(
          4,
          1 +
            Math.floor(
              (Math.sin(x * maps.heightNoiseFreq) + Math.cos(y * maps.heightNoiseFreq) + 2 + (regionId === 2 ? 1 : 0)) /
                maps.heightNoiseDivisor,
            ),
        ),
      );
      row.push({ type: "terrain", height: heightVal });
    }
    tiles.push(row);
  }

  const portraitBase: Point = { x: Math.floor(width / 2), y: height - 2 };
  const base: Point = width > height ? { x: width - 2, y: Math.floor(height / 2) } : portraitBase;
  const isLandscape = width > height;
  const spawns: Point[] = [];

  switch (style) {
    case "serpentine":
      carveSerpentine(tiles, spawns, base, rng, isLandscape);
      break;
    case "battlefield":
      carveBattlefield(tiles, spawns, base, rng, isLandscape);
      break;
    case "canyon":
      carveCanyon(tiles, spawns, base, rng, isLandscape);
      break;
    case "open":
      carveOpen(tiles, spawns, base, rng, isLandscape);
      break;
    case "split":
      carveSplit(tiles, spawns, base, rng, isLandscape);
      break;
    case "bastion":
      carveBastion(tiles, spawns, base, rng, isLandscape);
      break;
  }

  // Inset every spawn one tile from the map border, then walk a spawn that
  // still sits on terrain back onto the carved corridor. The carve paints the
  // inset tile, so a spawn already on the corridor stays put. Bastion is
  // exempt from that center walk: its approach starts on the inset spawn, and
  // a center walk would pull it off the corridor.
  for (const spawn of spawns) {
    spawn.x = Math.max(1, Math.min(width - 2, spawn.x));
    spawn.y = Math.max(1, Math.min(height - 2, spawn.y));
    if (style !== "bastion" && tiles[spawn.y]![spawn.x]!.type === "terrain") {
      const centerX = Math.floor(width / 2);
      const centerY = Math.floor(height / 2);
      let guard = 0;
      while (guard < Math.max(width, height)) {
        const cell = tiles[spawn.y]![spawn.x]!;
        if (cell.type !== "terrain") break;
        if (spawn.x !== centerX) spawn.x += Math.sign(centerX - spawn.x);
        else if (spawn.y !== centerY) spawn.y += Math.sign(centerY - spawn.y);
        else break;
        spawn.x = Math.max(1, Math.min(width - 2, spawn.x));
        spawn.y = Math.max(1, Math.min(height - 2, spawn.y));
        guard++;
      }
    }
    tiles[spawn.y]![spawn.x]!.type = "spawn";
  }

  // First prune, while the base center is still the anchor and the ring is not
  // base yet. sealBaseCollar runs a second prune after the stamp.
  pruneDeadEnds(tiles, spawns, base);

  for (let deltaY = -1; deltaY <= 1; deltaY++)
    for (let deltaX = -1; deltaX <= 1; deltaX++) {
      const baseX = base.x + deltaX;
      const baseY = base.y + deltaY;
      if (baseX < 0 || baseY < 0 || baseX >= width || baseY >= height) continue;
      const cell = tiles[baseY]![baseX]!;
      cell.type = "base";
      // Flight goals are this center. A stored height above a flyer's flyingHeight makes the goal
      // illegal, so the center stays at 1 while the ring keeps its terrain height.
      if (deltaX === 0 && deltaY === 0) cell.height = 1;
    }

  // The carve aims a width-1 run at the base center. Anything else it opened on
  // the collar becomes terrain here, so the 3x3 keeps a single door. Bastion
  // seals at height 4 so a closed collar tile is not a flyer hole in the apron.
  // The second prune drops spurs the seal just created. Base tiles stay walkable
  // or this prune would eat the door.
  sealBaseCollar(tiles, spawns, base, style === "bastion" ? 4 : 2);
  pruneDeadEnds(tiles, spawns, base);

  return {
    regionId,
    level,
    style,
    width,
    height,
    tiles,
    spawns,
    base,
    name: level > 0 ? `Region ${regionId + 1} Map ${level}` : "Generated Map",
    bossCadence: getGameContent().enemies.bossCadence[regionId]!,
    seed,
  };
}
