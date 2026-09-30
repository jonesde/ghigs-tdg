// Procedural map definitions for 3 regions × 12 maps each = 36 maps.

import type { MapThemeData } from "@/render/themes/index.js";
import {
  HEIGHT_NOISE_DIVISOR,
  HEIGHT_NOISE_FREQ,
  MAP_LEVELS,
  SERPENTINE_DOWN_CAP,
  SERPENTINE_STEP,
} from "@/sim/Constants.js";
import { BOSS_CADENCE } from "@/sim/ConstantsEnemy.js";

export function getMapDisplayName(map: GeneratedMap | null, theme: MapThemeData | null): string {
  if (!map) return "";
  if (map.style === "progressive" && map.entryCount !== undefined) {
    const region = theme?.regions.find((regionEntry) => regionEntry.id === map.regionId);
    const regionName = region?.name ?? `Region ${map.regionId + 1}`;
    return `${regionName} Progressive ${map.entryCount}`;
  }
  if (!theme) return map.name || "Random Map";
  const region = theme.regions.find((regionEntry) => regionEntry.id === map.regionId);
  if (region && map.level !== undefined) {
    return `${region.name} Map ${map.level}`;
  }
  return map.name || "Random Map";
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
// semantics as carveWidePath). The corridor advances monotonically along the
// main axis and turns perpendicular by at most SERPENTINE_STEP each time, then
// descends by at most SERPENTINE_DOWN_CAP tiles, so spawn→base reachability is
// guaranteed by construction. (Historically this style ran three overlapping
// carve passes — cross/drift/down — all from the same spawn.)
function carveSerpentine(
  tiles: Tile[][],
  from: Point,
  nextWaypoint: Point,
  width: number = 1,
  isLandscape: boolean = false,
) {
  const widthLimit = tiles[0]!.length;
  const heightLimit = tiles.length;
  const halfExtent = Math.floor(width / 2);
  let curX = from.x;
  let curY = from.y;
  let dir = isLandscape ? (from.y < nextWaypoint.y ? 1 : -1) : from.x < nextWaypoint.x ? 1 : -1;
  const step = SERPENTINE_STEP;
  const mainBound = isLandscape ? nextWaypoint.x : nextWaypoint.y;
  const perpBound = isLandscape ? heightLimit : widthLimit;

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
    const targetPerp = dir > 0 ? Math.min(perpBound - 2, perpCoordinate + step) : Math.max(1, perpCoordinate - step);
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

function carveOpenArea(
  tiles: Tile[][],
  base: Point,
  openAreaHeight: number,
  openAreaWidth: number,
  shapeIndex: number,
  isLandscape: boolean = false,
) {
  const halfW = Math.floor(openAreaWidth / 2);
  const W = tiles[0]!.length;
  const H = tiles.length;

  if (isLandscape) {
    const leftEdge = base.x - openAreaHeight;
    for (let cx = Math.max(0, leftEdge); cx <= Math.min(W - 1, base.x); cx++) {
      for (let cy = Math.max(0, base.y - halfW); cy <= Math.min(H - 1, base.y + halfW); cy++) {
        const dx = cx - base.x;
        const dy = cy - base.y;
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
            const rowX = cx - leftEdge;
            const rowMaxHalfW = Math.floor((halfW * rowX) / openAreaHeight);
            inside = Math.abs(dy) <= rowMaxHalfW;
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
    const topEdge = base.y - openAreaHeight;

    for (let cy = Math.max(0, topEdge); cy <= Math.min(H - 1, base.y); cy++) {
      for (let cx = Math.max(0, base.x - halfW); cx <= Math.min(W - 1, base.x + halfW); cx++) {
        const dx = cx - base.x;
        const dy = cy - base.y;
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
            const rowY = cy - topEdge;
            const rowMaxHalfW = Math.floor((halfW * rowY) / openAreaHeight);
            inside = Math.abs(dx) <= rowMaxHalfW;
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
        const rowSpacing = 2 + Math.floor(rng() * 3);
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
        const rowSpacing = 2 + Math.floor(rng() * 3);
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
      if (isLandscape) {
        const spawn = { x: 1, y: Math.floor(height / 2) };
        spawns.push(spawn);
        const pathWidth = Math.round(rng() * 10) % 2 === 0 ? 3 : 2;
        carveWidePath(tiles, spawn, base, pathWidth, true);
        if (rng() > 0.5) {
          const midX = Math.floor(width * (0.25 + rng() * 0.5));
          const branchY = Math.floor(height * (0.2 + rng() * 0.6));
          for (let y = Math.max(0, branchY - 2); y <= Math.min(height - 1, branchY + 2); y++) {
            if (midX >= 0 && midX < width && tiles[y]![midX]!.type !== "base") {
              tiles[y]![midX]!.type = "path";
              tiles[y]![midX]!.height = 1;
            }
          }
          for (let x = Math.max(0, midX - 2); x <= Math.min(width - 1, midX + 2); x++) {
            const topY = Math.max(0, Math.floor(height / 2) - 3);
            const bottomY = Math.min(height - 1, Math.floor(height / 2) + 3);
            if (tiles[topY]![x]!.type !== "base") {
              tiles[topY]![x]!.type = "path";
              tiles[topY]![x]!.height = 1;
            }
            if (tiles[bottomY]![x]!.type !== "base") {
              tiles[bottomY]![x]!.type = "path";
              tiles[bottomY]![x]!.height = 1;
            }
          }
        }
      } else {
        const spawn = { x: Math.floor(width / 2), y: 1 };
        spawns.push(spawn);
        const pathWidth = Math.round(rng() * 10) % 2 === 0 ? 3 : 2;
        carveWidePath(tiles, spawn, base, pathWidth);
        if (rng() > 0.5) {
          const midY = Math.floor(height * (0.25 + rng() * 0.5));
          const branchX = Math.floor(width * (0.2 + rng() * 0.6));
          for (let x = Math.max(0, branchX - 2); x <= Math.min(width - 1, branchX + 2); x++) {
            if (midY >= 0 && midY < height && tiles[midY]![x]!.type !== "base") {
              tiles[midY]![x]!.type = "path";
              tiles[midY]![x]!.height = 1;
            }
          }
          for (let y = Math.max(0, midY - 2); y <= Math.min(height - 1, midY + 2); y++) {
            const leftX = Math.max(0, Math.floor(width / 2) - 3);
            const rightX = Math.min(width - 1, Math.floor(width / 2) + 3);
            if (tiles[y]![leftX]!.type !== "base") {
              tiles[y]![leftX]!.type = "path";
              tiles[y]![leftX]!.height = 1;
            }
            if (tiles[y]![rightX]!.type !== "base") {
              tiles[y]![rightX]!.type = "path";
              tiles[y]![rightX]!.height = 1;
            }
          }
        }
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
      break;
    }
    case "serpentine": {
      if (isLandscape) {
        const spawn = { x: Math.floor(width * (0.1 + rng() * 0.3)), y: Math.round(rng() * 2) };
        spawns.push(spawn);
        carveSerpentine(tiles, spawn, base, 1, true);
      } else {
        const spawn = { x: Math.round(rng() * 2), y: Math.floor(height * (0.1 + rng() * 0.3)) };
        spawns.push(spawn);
        carveSerpentine(tiles, spawn, base, 1);
      }
      break;
    }
    case "split": {
      if (isLandscape) {
        const spawn1 = { x: 1, y: 1 };
        const spawn2 = { x: 1, y: height - 2 };
        spawns.push(spawn1, spawn2);
        carveWidePath(tiles, spawn1, base, 1, true);
        carveWidePath(tiles, spawn2, base, 1, true);
      } else {
        const spawn1 = { x: 1, y: 1 };
        const spawn2 = { x: width - 2, y: 1 };
        spawns.push(spawn1, spawn2);
        carveWidePath(tiles, spawn1, base, 1);
        carveWidePath(tiles, spawn2, base, 1);
      }
      break;
    }
    case "bastion": {
      if (isLandscape) {
        const spawn = { x: 0, y: Math.floor(height / 2) };
        spawns.push(spawn);
        const openAreaHeight = Math.floor(height * (0.2 + rng() * 0.2));
        const openAreaWidthFactor = 0.8 + rng() * 0.6;
        const openAreaWidth = Math.floor(height * openAreaWidthFactor);
        const shapeIndex = Math.floor(rng() * 4);
        const leftEdge = base.x - openAreaHeight;
        for (let x = 0; x < leftEdge; x++) {
          if (tiles[spawn.y]![x]!.type !== "base") {
            tiles[spawn.y]![x]!.type = "path";
            tiles[spawn.y]![x]!.height = 1;
          }
        }
        carveOpenArea(tiles, base, openAreaHeight, openAreaWidth, shapeIndex, true);
      } else {
        const spawn = { x: Math.floor(width / 2), y: 0 };
        spawns.push(spawn);
        const openAreaHeight = Math.floor(height * (0.2 + rng() * 0.2));
        const openAreaWidthFactor = 0.8 + rng() * 0.6;
        const openAreaWidth = Math.floor(height * openAreaWidthFactor);
        const shapeIndex = Math.floor(rng() * 4);
        const topEdge = base.y - openAreaHeight;
        for (let y = 0; y < topEdge; y++) {
          if (tiles[y]![spawn.x]!.type !== "base") {
            tiles[y]![spawn.x]!.type = "path";
            tiles[y]![spawn.x]!.height = 1;
          }
        }
        carveOpenArea(tiles, base, openAreaHeight, openAreaWidth, shapeIndex);
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
  // Inset every spawn one tile from the map border. Styles could place a spawn on
  // row/column 0 (bastion, serpentine); the carve always passes through the
  // adjacent inset tile, so moving the spawn keeps it on the corridor.
  for (const spawn of spawns) {
    spawn.x = Math.max(1, Math.min(width - 2, spawn.x));
    spawn.y = Math.max(1, Math.min(height - 2, spawn.y));
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
    name: level > 0 ? `Region ${regionId + 1} Map ${level}` : "Random Map",
    bossCadence: BOSS_CADENCE[regionId]!,
    seed,
  };
}
