// Procedural map definitions for 3 regions × 12 maps each = 36 maps.

import type { MapThemeData } from "@/render/themes/index.js";
import { HEIGHT_NOISE_DIVISOR, HEIGHT_NOISE_FREQ, MAP_LEVELS, SERPENTINE_DOWN_CAP } from "@/sim/Constants.js";
import { BOSS_CADENCE } from "@/sim/ConstantsEnemy.js";

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

// Single-pass serpentine: one continuous winding corridor from spawn to base.
// `width` is the corridor width in tiles (half-extent = floor(width/2), same
// semantics as carveWidePath). `amplitude` is the lateral swing in tiles,
// scaled by the caller to the map's minor axis so the corridor fills the board.
// The corridor advances monotonically along the main axis, turns perpendicular
// by at most `amplitude` each time, then descends by at most SERPENTINE_DOWN_CAP
// tiles, so spawn→base reachability is guaranteed by construction.
function carveSerpentine(
  tiles: Tile[][],
  from: Point,
  nextWaypoint: Point,
  width: number = 1,
  isLandscape: boolean = false,
  amplitude: number = 4,
) {
  const widthLimit = tiles[0]!.length;
  const heightLimit = tiles.length;
  const halfExtent = Math.floor(width / 2);
  let curX = from.x;
  let curY = from.y;
  let dir = isLandscape ? (from.y < nextWaypoint.y ? 1 : -1) : from.x < nextWaypoint.x ? 1 : -1;
  const mainBound = isLandscape ? nextWaypoint.x : nextWaypoint.y;
  const perpBound = isLandscape ? heightLimit : widthLimit;
  const step = Math.max(2, Math.min(amplitude, (perpBound - 4) / 2));

  const carveAt = (centerX: number, centerY: number) => {
    for (let deltaY = -halfExtent; deltaY <= halfExtent; deltaY++) {
      for (let deltaX = -halfExtent; deltaX <= halfExtent; deltaX++) {
        const tileX = centerX + deltaX;
        const tileY = centerY + deltaY;
        if (tileX < 0 || tileY < 0 || tileX >= widthLimit || tileY >= heightLimit) continue;
        if (tiles[tileY]![tileX]!.type === "base") continue;
        tiles[tileY]![tileX]!.type = "path";
        tiles[tileY]![tileX]!.height = 1;
      }
    }
  };

  while ((isLandscape ? curX : curY) < mainBound) {
    const perpCoordinate = isLandscape ? curY : curX;
    const upBound = perpBound - 2 - halfExtent;
    const lowBound = 1 + halfExtent;
    if (upBound < lowBound) {
      carveAt(curX, curY);
      if (isLandscape) curX++;
      else curY++;
      continue;
    }
    const targetPerp = dir > 0 ? Math.min(upBound, perpCoordinate + step) : Math.max(lowBound, perpCoordinate - step);
    while ((isLandscape ? curY : curX) !== targetPerp) {
      carveAt(curX, curY);
      if (isLandscape) curY += dir;
      else curX += dir;
    }
    const mainRemaining = mainBound - (isLandscape ? curX : curY);
    const descentSteps = Math.min(SERPENTINE_DOWN_CAP, mainRemaining);
    for (let descent = 0; descent < descentSteps; descent++) {
      carveAt(curX, curY);
      if (isLandscape) curX++;
      else curY++;
    }
    dir *= -1;
  }

  while ((isLandscape ? curY : curX) !== (isLandscape ? nextWaypoint.y : nextWaypoint.x)) {
    carveAt(curX, curY);
    if (isLandscape) curY += Math.sign(nextWaypoint.y - curY);
    else curX += Math.sign(nextWaypoint.x - curX);
  }
  while ((isLandscape ? curX : curY) !== (isLandscape ? nextWaypoint.x : nextWaypoint.y)) {
    carveAt(curX, curY);
    if (isLandscape) curX += Math.sign(nextWaypoint.x - curX);
    else curY += Math.sign(nextWaypoint.y - curY);
  }
  carveAt(curX, curY);
}

function carveCanyon(
  tiles: Tile[][],
  from: Point,
  nextWaypoint: Point,
  rng: () => number,
  isLandscape: boolean = false,
) {
  const W = tiles[0]!.length;
  const H = tiles.length;
  const targetMain = isLandscape ? nextWaypoint.x - 1 : nextWaypoint.y - 1;
  const nextMain = isLandscape ? nextWaypoint.x : nextWaypoint.y;
  const nextPerp = isLandscape ? nextWaypoint.y : nextWaypoint.x;
  let curX = from.x;
  let curY = from.y;
  let segmentCount = 0;
  const maxSegments = isLandscape ? W * 3 : H * 3;

  const carveAt = (x: number, y: number, width: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const halfW = Math.floor(width / 2);
    for (let deltaY = -halfW; deltaY <= halfW; deltaY++) {
      for (let deltaX = -halfW; deltaX <= halfW; deltaX++) {
        const neighborX = x + deltaX;
        const neighborY = y + deltaY;
        if (
          neighborX >= 0 &&
          neighborY >= 0 &&
          neighborX < W &&
          neighborY < H &&
          tiles[neighborY]![neighborX]!.type !== "base"
        ) {
          tiles[neighborY]![neighborX]!.type = "path";
          tiles[neighborY]![neighborX]!.height = 1;
        }
      }
    }
  };

  while ((isLandscape ? curX : curY) < targetMain && segmentCount < maxSegments) {
    const segmentLength = 6 + Math.floor(rng() * 5);
    const currentWidth = rng() > 0.5 ? 3 : 1;

    let targetPerp: number;
    if (segmentCount % 2 === 0) {
      targetPerp = Math.floor((isLandscape ? H : W) / 2) + Math.floor(rng() * 4 - 2);
    } else {
      targetPerp = isLandscape ? (curY > Math.floor(H / 2) ? 1 : H - 2) : curX > Math.floor(W / 2) ? 1 : W - 2;
    }

    const mainDir = 1;
    const perpDir = targetPerp > (isLandscape ? curY : curX) ? 1 : targetPerp < (isLandscape ? curY : curX) ? -1 : 0;

    for (let step = 0; step < segmentLength; step++) {
      carveAt(curX, curY, currentWidth);

      const mainRemaining = targetMain - (isLandscape ? curX : curY);
      const perpRemaining = targetPerp - (isLandscape ? curY : curX);

      const moveMain =
        mainRemaining !== 0 && (perpRemaining === 0 || Math.abs(mainRemaining) >= Math.abs(perpRemaining) * 2);
      const movePerp =
        perpRemaining > 0 && (mainRemaining === 0 || Math.abs(perpRemaining) > Math.abs(mainRemaining) * 0.5);

      if (moveMain)
        if (isLandscape) curX += mainDir;
        else curY += mainDir;
      if (movePerp)
        if (isLandscape) curY += perpDir;
        else curX += perpDir;
      if (isLandscape) {
        curX = Math.max(0, Math.min(W - 1, curX));
        curY = Math.max(1, Math.min(H - 2, curY));
      } else {
        curX = Math.max(1, Math.min(W - 2, curX));
        curY = Math.max(0, Math.min(H - 1, curY));
      }

      if ((isLandscape ? curX : curY) >= targetMain && Math.abs(targetPerp - (isLandscape ? curY : curX)) <= 1) break;
    }
    carveAt(curX, curY, currentWidth);

    segmentCount++;
  }

  let horizontalSteps = 0;
  while ((isLandscape ? curY : curX) !== nextPerp && horizontalSteps < (isLandscape ? H : W)) {
    carveAt(curX, curY, 1);
    if (isLandscape) curY += Math.sign(nextWaypoint.y - curY);
    else curX += Math.sign(nextWaypoint.x - curX);
    horizontalSteps++;
  }

  while ((isLandscape ? curX : curY) !== nextMain) {
    carveAt(curX, curY, 1);
    if (isLandscape) curX += Math.sign(nextWaypoint.x - curX);
    else curY += Math.sign(nextWaypoint.y - curY);
  }

  carveAt(curX, curY, 1);
}

// Inverted bastion: a large triangle of buildable terrain around the base with a
// single 1-wide notch entry at the triangle apex, a big rectangular open staging
// area outside the apex, and a narrow 1-wide arc above the staging area that
// enemies must walk around to reach the staging sides. `variantWallArc` picks
// the arc construction: false carves the arc as a path corridor, true raises a
// height-4 terrain wall (flyer/aegis must route around, jet can cross) with the
// walkable arc threaded just outside it.
function carveInvertedBastion(
  tiles: Tile[][],
  base: Point,
  spawn: Point,
  rng: () => number,
  isLandscape: boolean,
  variantWallArc: boolean,
) {
  const mapWidth = tiles[0]!.length;
  const mapHeight = tiles.length;

  const paintPath = (tileX: number, tileY: number, pathWidth: number = 1) => {
    const halfW = Math.floor(pathWidth / 2);
    for (let deltaY = -halfW; deltaY <= halfW; deltaY++) {
      for (let deltaX = -halfW; deltaX <= halfW; deltaX++) {
        const neighborX = tileX + deltaX;
        const neighborY = tileY + deltaY;
        if (neighborX < 0 || neighborY < 0 || neighborX >= mapWidth || neighborY >= mapHeight) continue;
        if (tiles[neighborY]![neighborX]!.type === "base") continue;
        tiles[neighborY]![neighborX]!.type = "path";
        tiles[neighborY]![neighborX]!.height = 1;
      }
    }
  };

  const paintTerrain = (tileX: number, tileY: number, heightValue: number) => {
    if (tileX < 0 || tileY < 0 || tileX >= mapWidth || tileY >= mapHeight) return;
    if (tiles[tileY]![tileX]!.type === "base") return;
    tiles[tileY]![tileX]!.type = "terrain";
    tiles[tileY]![tileX]!.height = heightValue;
  };

  const walkTo = (fromX: number, fromY: number, targetX: number, targetY: number, pathWidth: number = 1) => {
    let curX = fromX;
    let curY = fromY;
    paintPath(curX, curY, pathWidth);
    while (curX !== targetX || curY !== targetY) {
      if (curX !== targetX) curX += Math.sign(targetX - curX);
      else if (curY !== targetY) curY += Math.sign(targetY - curY);
      paintPath(curX, curY, pathWidth);
    }
  };

  if (isLandscape) {
    // Base sits at the east edge; the triangle apex points west.
    const apronDepth = Math.max(4, Math.min(Math.floor(mapWidth * 0.3), base.x - 1));
    const apexX = base.x - apronDepth;
    const baseRow = base.y;
    const maxHalf = Math.max(3, Math.floor(mapHeight * 0.3));
    // Triangle apron: rows from apex (1 wide) widening to the base row.
    for (let step = 0; step <= apronDepth; step++) {
      const rowX = apexX + step;
      const half = Math.max(0, Math.floor((maxHalf * step) / apronDepth));
      for (let deltaY = -half; deltaY <= half; deltaY++) {
        const inside = step === 0 && deltaY === 0;
        if (inside) paintPath(rowX, baseRow + deltaY);
        else paintTerrain(rowX, baseRow + deltaY, 2 + Math.floor(rng() * 2));
      }
    }
    // Notch entry through the apex.
    paintPath(apexX, baseRow);
    // Rectangular staging area west of the apex, full apron width, clamped so
    // rows never leave the board.
    const stagingDepth = Math.max(4, Math.floor(mapWidth * 0.2));
    const stagingWest = Math.max(1, apexX - stagingDepth);
    const stagingNorth = Math.max(1, baseRow - maxHalf);
    const stagingSouth = Math.min(mapHeight - 2, baseRow + maxHalf);
    // The apex row between staging and apron is the single ground entrance.
    for (let rowX = stagingWest; rowX <= apexX; rowX++) paintPath(rowX, baseRow);
    for (let rowX = stagingWest; rowX < apexX; rowX++) {
      for (let rowY = stagingNorth; rowY <= stagingSouth; rowY++) paintPath(rowX, rowY);
    }
    walkTo(stagingWest, baseRow, apexX, baseRow);
    // Arc: from the west spawn around the north/south flanks into the staging
    // sides. Clamped to the staging rectangle so the detour hugs it instead of
    // wandering to the map's far side.
    const arcX = stagingWest;
    const arcTop = stagingNorth;
    const arcBottom = stagingSouth;
    if (variantWallArc) {
      for (let rowY = arcTop; rowY <= arcBottom; rowY++) paintTerrain(arcX, rowY, 4);
      for (let rowY = arcTop; rowY <= arcBottom; rowY++) paintPath(arcX - 1 >= 1 ? arcX - 1 : arcX + 1, rowY);
    }
    walkTo(spawn.x, spawn.y, arcX, arcTop, 1);
    walkTo(arcX, arcTop, arcX, arcBottom, 1);
    walkTo(arcX, arcTop, arcX + 2, arcTop, 1);
    walkTo(arcX, arcBottom, arcX + 2, arcBottom, 1);
  } else {
    // Base sits at the south edge; the triangle apex points north.
    const apronDepth = Math.max(4, Math.min(Math.floor(mapHeight * 0.3), base.y - 1));
    const apexY = base.y - apronDepth;
    const baseCol = base.x;
    const maxHalf = Math.max(3, Math.floor(mapWidth * 0.3));
    // Triangle apron: rows from apex (1 wide) widening to the base row.
    for (let step = 0; step <= apronDepth; step++) {
      const rowY = apexY + step;
      const half = Math.max(0, Math.floor((maxHalf * step) / apronDepth));
      for (let deltaX = -half; deltaX <= half; deltaX++) {
        const inside = step === 0 && deltaX === 0;
        if (inside) paintPath(baseCol + deltaX, rowY);
        else paintTerrain(baseCol + deltaX, rowY, 2 + Math.floor(rng() * 2));
      }
    }
    // Notch entry through the apex.
    paintPath(baseCol, apexY);
    // Rectangular staging area north of the apex, full apron width, clamped so
    // columns never leave the board.
    const stagingDepth = Math.max(4, Math.floor(mapHeight * 0.2));
    const stagingNorth = Math.max(1, apexY - stagingDepth);
    const stagingWest = Math.max(1, baseCol - maxHalf);
    const stagingEast = Math.min(mapWidth - 2, baseCol + maxHalf);
    // The apex column between staging and apron is the single ground entrance.
    for (let rowY = stagingNorth; rowY <= apexY; rowY++) paintPath(baseCol, rowY);
    for (let rowY = stagingNorth; rowY < apexY; rowY++) {
      for (let rowX = stagingWest; rowX <= stagingEast; rowX++) paintPath(rowX, rowY);
    }
    walkTo(baseCol, stagingNorth, baseCol, apexY);
    // Arc: from the north spawn around the west/east flanks into the staging sides.
    // The arc runs at/above the staging north edge and its legs clamp to the
    // staging side columns, so the detour hugs the staging area instead of
    // wandering to the map's far side. The legs dock onto the staging sides one
    // row below the arc so staging↔arc connectivity survives the spawn inset.
    const arcY = stagingNorth;
    const arcLeft = stagingWest;
    const arcRight = stagingEast;
    if (variantWallArc) {
      for (let colX = arcLeft; colX <= arcRight; colX++) paintTerrain(colX, arcY, 4);
      for (let colX = arcLeft; colX <= arcRight; colX++) paintPath(colX, arcY - 1 >= 1 ? arcY - 1 : arcY + 1);
    }
    walkTo(spawn.x, spawn.y, arcLeft, arcY, 1);
    walkTo(arcLeft, arcY, arcRight, arcY, 1);
    walkTo(arcRight, arcY, arcRight, arcY + 2, 1);
    walkTo(arcLeft, arcY, arcLeft, arcY + 2, 1);
  }
}
function carveOpenAreaAt(
  tiles: Tile[][],
  center: Point,
  openAreaHeight: number,
  openAreaWidth: number,
  shapeIndex: number,
  isLandscape: boolean = false,
) {
  const halfW = Math.floor(openAreaWidth / 2);
  const W = tiles[0]!.length;
  const H = tiles.length;

  if (isLandscape) {
    const leftEdge = center.x - openAreaHeight;
    for (let cx = Math.max(0, leftEdge); cx <= Math.min(W - 1, center.x + openAreaHeight); cx++) {
      for (let cy = Math.max(0, center.y - halfW); cy <= Math.min(H - 1, center.y + halfW); cy++) {
        const dx = cx - center.x;
        const dy = cy - center.y;
        let inside = false;

        switch (shapeIndex) {
          case 0:
            inside = Math.abs(dx) <= openAreaHeight && Math.abs(dy) <= halfW;
            break;
          case 1:
            if (openAreaHeight > 0 && halfW > 0)
              inside = (dx * dx) / (openAreaHeight * openAreaHeight) + (dy * dy) / (halfW * halfW) <= 1;
            break;
          case 2:
            if (openAreaHeight > 0 && halfW > 0) inside = Math.abs(dx) / openAreaHeight + Math.abs(dy) / halfW <= 1;
            break;
          case 3: {
            const distFromCenter = Math.abs(dx);
            const rowMaxHalfW = Math.floor((halfW * (openAreaHeight - distFromCenter)) / (openAreaHeight || 1));
            inside = Math.abs(dy) <= Math.max(0, rowMaxHalfW);
            break;
          }
          default:
            inside = Math.abs(dx) <= openAreaHeight && Math.abs(dy) <= halfW;
            break;
        }

        if (inside && tiles[cy]![cx]!.type !== "base") {
          tiles[cy]![cx]!.type = "path";
          tiles[cy]![cx]!.height = 1;
        }
      }
    }
  } else {
    const startY = Math.max(0, center.y - openAreaHeight);
    const endY = Math.min(H - 1, center.y + openAreaHeight);

    for (let cy = startY; cy <= endY; cy++) {
      for (let cx = Math.max(0, center.x - halfW); cx <= Math.min(W - 1, center.x + halfW); cx++) {
        const dx = cx - center.x;
        const dy = cy - center.y;
        let inside = false;

        switch (shapeIndex) {
          case 0:
            inside = Math.abs(dx) <= halfW && Math.abs(dy) <= openAreaHeight;
            break;
          case 1:
            if (halfW > 0 && openAreaHeight > 0)
              inside = (dx * dx) / (halfW * halfW) + (dy * dy) / (openAreaHeight * openAreaHeight) <= 1;
            break;
          case 2:
            if (halfW > 0 && openAreaHeight > 0) inside = Math.abs(dx) / halfW + Math.abs(dy) / openAreaHeight <= 1;
            break;
          case 3: {
            const distFromCenter = Math.abs(dy);
            const rowMaxHalfW = Math.floor((halfW * (openAreaHeight - distFromCenter)) / (openAreaHeight || 1));
            inside = Math.abs(dx) <= Math.max(0, rowMaxHalfW);
            break;
          }
          default:
            inside = Math.abs(dx) <= halfW && Math.abs(dy) <= openAreaHeight;
            break;
        }

        if (inside && tiles[cy]![cx]!.type !== "base") {
          tiles[cy]![cx]!.type = "path";
          tiles[cy]![cx]!.height = 1;
        }
      }
    }
  }
}

// Paints a terrain ridge line that blocks low flyers: everything above
// `flyingHeight` is untraversable for flyer (2) / aegis (3) but open to jet (5).
// Towers built on the ridge (+1 effective height) gate even jets, which keeps
// the ridge tactically live after the player builds on it.
function paintRidge(
  tiles: Tile[][],
  from: Point,
  nextWaypoint: Point,
  heightValue: number,
  gapCenter: Point | null,
  gapRadius: number,
) {
  let curX = from.x;
  let curY = from.y;
  for (;;) {
    const inGap = gapCenter !== null && Math.hypot(curX - gapCenter.x, curY - gapCenter.y) <= gapRadius;
    if (
      !inGap &&
      curX >= 0 &&
      curY >= 0 &&
      curX < tiles[0]!.length &&
      curY < tiles.length &&
      tiles[curY]![curX]!.type === "terrain"
    ) {
      tiles[curY]![curX]!.height = heightValue;
    }
    if (curX === nextWaypoint.x && curY === nextWaypoint.y) break;
    if (curX !== nextWaypoint.x) curX += Math.sign(nextWaypoint.x - curX);
    else if (curY !== nextWaypoint.y) curY += Math.sign(nextWaypoint.y - curY);
  }
}

// Generated maps are cached per MAP_LEVELS index. The pack is immutable content
// loaded once, so entries never go stale in a normal run. Tests that remap an
// index (or swap map content) call invalidateMapCache() to drop prior layouts.
const mapCache = new Map<number, GeneratedMap>();

export function invalidateMapCache(): void {
  mapCache.clear();
}

export function getMap(index: number): GeneratedMap {
  const cached = mapCache.get(index);
  if (cached) return cached;
  const config = MAP_LEVELS[index]!;
  const map = generateRandomMap(config.width, config.height, config.style, config.regionId, config.level, config.seed);
  mapCache.set(index, map);
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
              (Math.sin(x * HEIGHT_NOISE_FREQ) + Math.cos(y * HEIGHT_NOISE_FREQ) + 2 + (regionId === 2 ? 1 : 0)) /
                HEIGHT_NOISE_DIVISOR,
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
    case "battlefield": {
      if (isLandscape) {
        const spawnY = Math.floor(height * (0.15 + rng() * 0.7));
        const spawn = { x: 1, y: spawnY };
        spawns.push(spawn);
        // Pitch 2-3 keeps every row pair covered; wider gaps left dead terrain.
        const rowSpacing = 2 + Math.floor(rng() * 2);
        const startDirection = rng() > 0.5 ? 1 : -1;

        const waypoints: Point[] = [spawn];
        let curX = 1;
        let direction = startDirection;

        curX += rowSpacing;
        waypoints.push({ x: curX, y: spawnY });

        while (curX + rowSpacing <= base.x) {
          direction = -direction;
          const edgeMargin = 0.1 + rng() * 0.15;
          const targetY = direction > 0 ? height - Math.floor(height * edgeMargin) : Math.floor(height * edgeMargin);
          waypoints.push({ x: curX, y: targetY });
          waypoints.push({ x: curX + rowSpacing, y: targetY });
          curX += rowSpacing;
        }

        waypoints.push({ x: curX, y: Math.floor(height / 2) });
        waypoints.push({ x: base.x, y: Math.floor(height / 2) });

        const segmentCount = waypoints.length - 1;
        const pathWidths: number[] = [];
        for (let i = 0; i < segmentCount; i++) {
          const r = rng();
          if (r > 0.8) pathWidths.push(3);
          else if (r > 0.45) pathWidths.push(2);
          else pathWidths.push(1);
        }

        for (let i = 0; i < waypoints.length - 1; i++) {
          const from = waypoints[i]!;
          const nextWaypoint = waypoints[i + 1]!;
          const pathWidth = pathWidths[i] || 2;
          let curX = from.x;
          let curY = from.y;
          while (curX !== nextWaypoint.x || curY !== nextWaypoint.y) {
            for (let deltaY = -Math.floor(pathWidth / 2); deltaY <= Math.floor(pathWidth / 2); deltaY++) {
              for (let deltaX = -Math.floor(pathWidth / 2); deltaX <= Math.floor(pathWidth / 2); deltaX++) {
                const neighborX = curX + deltaX;
                const neighborY = curY + deltaY;
                if (neighborX >= 0 && neighborX < width && neighborY >= 0 && neighborY < height) {
                  if (tiles[neighborY]![neighborX]!.type !== "base") {
                    tiles[neighborY]![neighborX]!.type = "path";
                    tiles[neighborY]![neighborX]!.height = 1;
                  }
                }
              }
            }
            if (curX !== nextWaypoint.x) curX += Math.sign(nextWaypoint.x - curX);
            if (curY !== nextWaypoint.y) curY += Math.sign(nextWaypoint.y - curY);
          }

          const isHorizontal = from.x === nextWaypoint.x;
          if (isHorizontal && rng() > 0.6) {
            const openAreaHeight = 3 + Math.floor(rng() * 4);
            const openAreaWidth = 3 + Math.floor(rng() * 4);
            const shapeIndex = Math.floor(rng() * 4);
            carveOpenAreaAt(
              tiles,
              { x: nextWaypoint.x, y: nextWaypoint.y },
              openAreaWidth,
              openAreaHeight,
              shapeIndex,
              true,
            );
          }
        }
      } else {
        const spawnX = Math.floor(width * (0.15 + rng() * 0.7));
        const spawn = { x: spawnX, y: 1 };
        spawns.push(spawn);
        // Pitch 2-3 keeps every row pair covered; wider gaps left dead terrain.
        const rowSpacing = 2 + Math.floor(rng() * 2);
        const startDirection = rng() > 0.5 ? 1 : -1;

        const waypoints: Point[] = [spawn];
        let curY = 1;
        let direction = startDirection;

        curY += rowSpacing;
        waypoints.push({ x: spawnX, y: curY });

        while (curY + rowSpacing <= base.y) {
          direction = -direction;
          const edgeMargin = 0.1 + rng() * 0.15;
          const targetX = direction > 0 ? width - Math.floor(width * edgeMargin) : Math.floor(width * edgeMargin);
          waypoints.push({ x: targetX, y: curY });
          waypoints.push({ x: targetX, y: curY + rowSpacing });
          curY += rowSpacing;
        }

        waypoints.push({ x: Math.floor(width / 2), y: curY });
        waypoints.push({ x: Math.floor(width / 2), y: base.y });

        const segmentCount = waypoints.length - 1;
        const pathWidths: number[] = [];
        for (let i = 0; i < segmentCount; i++) {
          const r = rng();
          if (r > 0.8) pathWidths.push(3);
          else if (r > 0.45) pathWidths.push(2);
          else pathWidths.push(1);
        }

        for (let i = 0; i < waypoints.length - 1; i++) {
          const from = waypoints[i]!;
          const nextWaypoint = waypoints[i + 1]!;
          const pathWidth = pathWidths[i] || 2;
          let curX = from.x;
          let curY = from.y;
          while (curX !== nextWaypoint.x || curY !== nextWaypoint.y) {
            for (let deltaY = -Math.floor(pathWidth / 2); deltaY <= Math.floor(pathWidth / 2); deltaY++) {
              for (let deltaX = -Math.floor(pathWidth / 2); deltaX <= Math.floor(pathWidth / 2); deltaX++) {
                const neighborX = curX + deltaX;
                const neighborY = curY + deltaY;
                if (neighborX >= 0 && neighborX < width && neighborY >= 0 && neighborY < height) {
                  if (tiles[neighborY]![neighborX]!.type !== "base") {
                    tiles[neighborY]![neighborX]!.type = "path";
                    tiles[neighborY]![neighborX]!.height = 1;
                  }
                }
              }
            }
            if (curX !== nextWaypoint.x) curX += Math.sign(nextWaypoint.x - curX);
            if (curY !== nextWaypoint.y) curY += Math.sign(nextWaypoint.y - curY);
          }

          const isHorizontal = from.y === nextWaypoint.y;
          if (isHorizontal && rng() > 0.6) {
            const openAreaHeight = 3 + Math.floor(rng() * 4);
            const openAreaWidth = 3 + Math.floor(rng() * 4);
            const shapeIndex = Math.floor(rng() * 4);
            carveOpenAreaAt(tiles, { x: nextWaypoint.x, y: nextWaypoint.y }, openAreaHeight, openAreaWidth, shapeIndex);
          }
        }
      }
      break;
    }
    case "open": {
      // Plaza: a wide main axis plus offset side blobs and a height-gated ridge
      // so ground and flying routes diverge and the mid-map blobs stage holds.
      if (isLandscape) {
        const spawn = { x: 1, y: Math.floor(height / 2) };
        spawns.push(spawn);
        const pathWidth = Math.round(rng() * 10) % 2 === 0 ? 3 : 2;
        carveWidePath(tiles, spawn, base, pathWidth, true);
        const midX = Math.floor(width * (0.3 + rng() * 0.4));
        const blobCount = width >= 30 || height >= 30 ? 2 : 1;
        for (let blob = 0; blob < blobCount; blob++) {
          const blobCenter = {
            x: Math.max(2, Math.min(width - 3, midX + Math.floor(rng() * 7 - 3) + blob * Math.floor(width / 4))),
            y: Math.floor(height * (0.2 + rng() * 0.6)),
          };
          const blobHeight = 3 + Math.floor(rng() * 3);
          const blobWidth = 4 + Math.floor(rng() * 4);
          carveOpenAreaAt(tiles, blobCenter, blobHeight, blobWidth, 1 + Math.floor(rng() * 2), true);
          carveWidePath(tiles, { x: blobCenter.x, y: Math.floor(height / 2) }, blobCenter, 2, true);
        }
        const ridgeY = rng() > 0.5 ? Math.floor(height * 0.25) : Math.floor(height * 0.75);
        const gapX = Math.floor(width * (0.3 + rng() * 0.4));
        paintRidge(tiles, { x: 1, y: ridgeY }, { x: width - 3, y: ridgeY }, 4, { x: gapX, y: ridgeY }, 1);
      } else {
        const spawn = { x: Math.floor(width / 2), y: 1 };
        spawns.push(spawn);
        const pathWidth = Math.round(rng() * 10) % 2 === 0 ? 3 : 2;
        carveWidePath(tiles, spawn, base, pathWidth);
        const midY = Math.floor(height * (0.3 + rng() * 0.4));
        const blobCount = width >= 30 || height >= 30 ? 2 : 1;
        for (let blob = 0; blob < blobCount; blob++) {
          const blobCenter = {
            x: Math.floor(width * (0.2 + rng() * 0.6)),
            y: Math.max(2, Math.min(height - 3, midY + Math.floor(rng() * 7 - 3) + blob * Math.floor(height / 4))),
          };
          const blobHeight = 4 + Math.floor(rng() * 4);
          const blobWidth = 3 + Math.floor(rng() * 3);
          carveOpenAreaAt(tiles, blobCenter, blobHeight, blobWidth, 1 + Math.floor(rng() * 2));
          carveWidePath(tiles, { x: Math.floor(width / 2), y: blobCenter.y }, blobCenter, 2);
        }
        const ridgeX = rng() > 0.5 ? Math.floor(width * 0.25) : Math.floor(width * 0.75);
        const gapY = Math.floor(height * (0.3 + rng() * 0.4));
        paintRidge(tiles, { x: ridgeX, y: 1 }, { x: ridgeX, y: height - 3 }, 4, { x: ridgeX, y: gapY }, 1);
      }
      break;
    }
    case "canyon": {
      if (isLandscape) {
        const spawnY = rng() > 0.5 ? 1 : height - 2;
        const spawn = { x: 1, y: spawnY };
        spawns.push(spawn);
        carveCanyon(tiles, spawn, base, rng, true);
      } else {
        const spawnX = rng() > 0.5 ? 1 : width - 2;
        const spawn = { x: spawnX, y: 1 };
        spawns.push(spawn);
        carveCanyon(tiles, spawn, base, rng);
      }
      // One side lobe off the canyon's widest stretch: congregation space that
      // the main walk keeps but flyers can cut across.
      {
        let lobeX = Math.floor(width / 2);
        let lobeY = Math.floor(height / 2);
        let bestRun = 0;
        if (isLandscape) {
          for (let scanX = 2; scanX < width - 2; scanX++) {
            let run = 0;
            for (let scanY = 0; scanY < height; scanY++) {
              if (tiles[scanY]![scanX]!.type === "path") run++;
            }
            if (run > bestRun) {
              bestRun = run;
              lobeX = scanX;
              lobeY = Math.floor(height / 2);
            }
          }
        } else {
          for (let scanY = 2; scanY < height - 2; scanY++) {
            let run = 0;
            for (let scanX = 0; scanX < width; scanX++) {
              if (tiles[scanY]![scanX]!.type === "path") run++;
            }
            if (run > bestRun) {
              bestRun = run;
              lobeX = Math.floor(width / 2);
              lobeY = scanY;
            }
          }
        }
        carveOpenAreaAt(
          tiles,
          { x: lobeX, y: lobeY },
          3 + Math.floor(rng() * 2),
          3 + Math.floor(rng() * 2),
          Math.floor(rng() * 3),
          isLandscape,
        );
      }
      break;
    }
    case "serpentine": {
      const minorAxis = isLandscape ? height : width;
      const amplitude = Math.max(3, Math.min(Math.floor(minorAxis * 0.3), Math.floor(minorAxis / 2) - 2));
      const corridorWidth = minorAxis >= 20 ? 2 : 1;
      if (isLandscape) {
        const spawn = { x: Math.floor(width * (0.1 + rng() * 0.3)), y: Math.round(rng() * 2) };
        spawns.push(spawn);
        carveSerpentine(tiles, spawn, base, corridorWidth, true, amplitude);
      } else {
        const spawn = { x: Math.round(rng() * 2), y: Math.floor(height * (0.1 + rng() * 0.3)) };
        spawns.push(spawn);
        carveSerpentine(tiles, spawn, base, corridorWidth, false, amplitude);
      }
      // One staging blob at a bend on boards with room for it.
      if (minorAxis >= 20) {
        carveOpenAreaAt(
          tiles,
          { x: Math.floor(width / 2), y: Math.floor(height / 2) },
          3,
          3,
          Math.floor(rng() * 3),
          isLandscape,
        );
      }
      break;
    }
    case "split": {
      if (isLandscape) {
        const spawn1 = { x: 1, y: 1 };
        const spawn2 = { x: 1, y: height - 2 };
        spawns.push(spawn1, spawn2);
        const wideTop = rng() > 0.5;
        carveWidePath(tiles, spawn1, base, wideTop ? 2 : 1, true);
        carveWidePath(tiles, spawn2, base, wideTop ? 1 : 2, true);
        // Cross-link joining the arms mid-map so the pincer interacts.
        const linkX = Math.floor(width * (0.4 + rng() * 0.2));
        carveWidePath(tiles, { x: linkX, y: 1 }, { x: linkX, y: height - 2 }, 1, true);
      } else {
        const spawn1 = { x: 1, y: 1 };
        const spawn2 = { x: width - 2, y: 1 };
        spawns.push(spawn1, spawn2);
        const wideLeft = rng() > 0.5;
        carveWidePath(tiles, spawn1, base, wideLeft ? 2 : 1);
        carveWidePath(tiles, spawn2, base, wideLeft ? 1 : 2);
        const linkY = Math.floor(height * (0.4 + rng() * 0.2));
        carveWidePath(tiles, { x: 1, y: linkY }, { x: width - 2, y: linkY }, 1);
      }
      break;
    }
    case "bastion": {
      const variantWallArc = rng() > 0.5;
      if (isLandscape) {
        const spawn = { x: 0, y: Math.floor(height / 2) };
        spawns.push(spawn);
        carveInvertedBastion(tiles, base, spawn, rng, true, variantWallArc);
      } else {
        const spawn = { x: Math.floor(width / 2), y: 0 };
        spawns.push(spawn);
        carveInvertedBastion(tiles, base, spawn, rng, false, variantWallArc);
      }
      break;
    }
  }

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
  // Walk the released spawn point back onto the existing carved corridor: step
  // toward the map center until walkable ground is reached, then stop. The
  // inset tile and the border tile differ by exactly one row/column, so this
  // docks the spawn without paving new corridors through terrain.
  const dockSpawn = (spawn: Point) => {
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
  };

  // Inset every spawn one tile from the map border. Styles place spawns on
  // row/column 0 or 1; the carve always passes through the adjacent inset
  // tile, so docking the spawn back onto walkable ground keeps it on the
  // corridor without paving new corridors through terrain.
  for (const spawn of spawns) {
    spawn.x = Math.max(1, Math.min(width - 2, spawn.x));
    spawn.y = Math.max(1, Math.min(height - 2, spawn.y));
    dockSpawn(spawn);
    tiles[spawn.y]![spawn.x]!.type = "spawn";
  }

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
    bossCadence: BOSS_CADENCE[regionId]!,
    seed,
  };
}
