export interface TilePoint {
  x: number;
  y: number;
}

export interface FlightGrid {
  tileSize: number;
  width: number;
  height: number;
  inBounds(tileX: number, tileY: number): boolean;
  isPath(tileX: number, tileY: number): boolean;
  isSpawn(tileX: number, tileY: number): boolean;
  isBase(tileX: number, tileY: number): boolean;
  isVoid(tileX: number, tileY: number): boolean;
  getHeight(tileX: number, tileY: number): number;
  tileToWorld(tileX: number, tileY: number): { x: number; y: number };
  worldOriginX?: number;
  worldOriginY?: number;
}

export type LiveTowerAt = (tileX: number, tileY: number) => boolean;

const ORTHOGONAL_OFFSETS: readonly TilePoint[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const DIAGONAL_OFFSETS: readonly TilePoint[] = [
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

export function readFlyingHeight(meta: { flyingHeight?: number } | null | undefined): number {
  return meta?.flyingHeight ?? 0;
}

export function effectiveHeight(grid: FlightGrid, tileX: number, tileY: number, liveTowerAt: LiveTowerAt): number {
  const towerBonus = liveTowerAt(tileX, tileY) ? 1 : 0;
  return grid.getHeight(tileX, tileY) + towerBonus;
}

export function canTraverseTile(
  grid: FlightGrid,
  tileX: number,
  tileY: number,
  flyingHeight: number,
  liveTowerAt: LiveTowerAt,
): boolean {
  if (!grid.inBounds(tileX, tileY)) return false;
  if (flyingHeight <= 0) return grid.isPath(tileX, tileY) || grid.isSpawn(tileX, tileY) || grid.isBase(tileX, tileY);
  if (grid.isVoid(tileX, tileY)) return false;
  return effectiveHeight(grid, tileX, tileY, liveTowerAt) <= flyingHeight;
}

// Every tile the world segment touches, including a tile the segment only
// grazes at a corner. Orthogonal steps between adjacent tile centers stay
// inside those two tiles.
export function tilesTouchedBySegment(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  tileSize: number,
  worldOriginX = 0,
  worldOriginY = 0,
): TilePoint[] {
  const originX = (startX - worldOriginX) / tileSize;
  const originY = (startY - worldOriginY) / tileSize;
  const targetX = (endX - worldOriginX) / tileSize;
  const targetY = (endY - worldOriginY) / tileSize;
  let tileX = Math.floor(originX);
  let tileY = Math.floor(originY);
  const endTileX = Math.floor(targetX);
  const endTileY = Math.floor(targetY);
  const tiles: TilePoint[] = [{ x: tileX, y: tileY }];
  if (tileX === endTileX && tileY === endTileY) return tiles;

  const deltaX = targetX - originX;
  const deltaY = targetY - originY;
  const stepX = Math.sign(deltaX);
  const stepY = Math.sign(deltaY);
  const tileStepX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / deltaX);
  const tileStepY = stepY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / deltaY);
  const boundaryX = stepX > 0 ? tileX + 1 : tileX;
  const boundaryY = stepY > 0 ? tileY + 1 : tileY;
  let timeToVertical = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs((boundaryX - originX) / deltaX);
  let timeToHorizontal = stepY === 0 ? Number.POSITIVE_INFINITY : Math.abs((boundaryY - originY) / deltaY);
  const maxSteps = (Math.abs(endTileX - tileX) + Math.abs(endTileY - tileY) + 2) * 3;

  for (let step = 0; step < maxSteps && (tileX !== endTileX || tileY !== endTileY); step++) {
    if (Math.abs(timeToVertical - timeToHorizontal) <= 1e-9) {
      const sideX = tileX + stepX;
      const sideY = tileY + stepY;
      tiles.push({ x: sideX, y: tileY });
      tiles.push({ x: tileX, y: sideY });
      tileX = sideX;
      tileY = sideY;
      tiles.push({ x: tileX, y: tileY });
      timeToVertical += tileStepX;
      timeToHorizontal += tileStepY;
    } else if (timeToVertical < timeToHorizontal) {
      tileX += stepX;
      timeToVertical += tileStepX;
      tiles.push({ x: tileX, y: tileY });
    } else {
      tileY += stepY;
      timeToHorizontal += tileStepY;
      tiles.push({ x: tileX, y: tileY });
    }
  }
  return tiles;
}

export function breadthFirstTilePath(
  grid: FlightGrid,
  start: TilePoint,
  goal: TilePoint,
  flyingHeight: number,
  liveTowerAt: LiveTowerAt,
): TilePoint[] | null {
  if (!canTraverseTile(grid, start.x, start.y, flyingHeight, liveTowerAt)) return null;
  if (!canTraverseTile(grid, goal.x, goal.y, flyingHeight, liveTowerAt)) return null;
  if (start.x === goal.x && start.y === goal.y) return [start];

  const width = grid.width;
  const previous = new Map<number, number>();
  const startKey = start.y * width + start.x;
  const goalKey = goal.y * width + goal.x;
  previous.set(startKey, -1);
  const queue: TilePoint[] = [start];
  let head = 0;
  let reached = false;
  while (head < queue.length) {
    const current = queue[head]!;
    head++;
    if (current.x === goal.x && current.y === goal.y) {
      reached = true;
      break;
    }
    for (const offset of ORTHOGONAL_OFFSETS) {
      const nextX = current.x + offset.x;
      const nextY = current.y + offset.y;
      if (!canTraverseTile(grid, nextX, nextY, flyingHeight, liveTowerAt)) continue;
      const nextKey = nextY * width + nextX;
      if (previous.has(nextKey)) continue;
      previous.set(nextKey, current.y * width + current.x);
      queue.push({ x: nextX, y: nextY });
    }
  }
  if (!reached || !previous.has(goalKey)) return null;

  const reversed: TilePoint[] = [];
  let cursorKey = goalKey;
  while (cursorKey !== -1) {
    const tileY = Math.floor(cursorKey / width);
    const tileX = cursorKey - tileY * width;
    reversed.push({ x: tileX, y: tileY });
    const parentKey = previous.get(cursorKey);
    if (parentKey === undefined) break;
    cursorKey = parentKey;
  }
  reversed.reverse();
  return reversed;
}

function straightLeg(
  grid: FlightGrid,
  from: TilePoint,
  to: TilePoint,
  flyingHeight: number,
  liveTowerAt: LiveTowerAt,
): TilePoint[] | null {
  if (from.x === to.x && from.y === to.y) return [from];
  const fromWorld = grid.tileToWorld(from.x, from.y);
  const toWorld = grid.tileToWorld(to.x, to.y);
  const touched = tilesTouchedBySegment(
    fromWorld.x,
    fromWorld.y,
    toWorld.x,
    toWorld.y,
    grid.tileSize,
    grid.worldOriginX ?? 0,
    grid.worldOriginY ?? 0,
  );
  for (const tile of touched) {
    if (!canTraverseTile(grid, tile.x, tile.y, flyingHeight, liveTowerAt)) return null;
  }
  return [from, to];
}

export function planFlightLeg(
  grid: FlightGrid,
  from: TilePoint,
  to: TilePoint,
  flyingHeight: number,
  liveTowerAt: LiveTowerAt,
): TilePoint[] | null {
  const straight = straightLeg(grid, from, to, flyingHeight, liveTowerAt);
  if (straight) return straight;
  return breadthFirstTilePath(grid, from, to, flyingHeight, liveTowerAt);
}

export function planFlightRoute(
  grid: FlightGrid,
  start: TilePoint,
  goals: readonly TilePoint[],
  flyingHeight: number,
  liveTowerAt: LiveTowerAt,
): { x: number; y: number }[] {
  const tiles: TilePoint[] = [start];
  let cursor = start;
  for (const goal of goals) {
    if (!canTraverseTile(grid, goal.x, goal.y, flyingHeight, liveTowerAt)) continue;
    if (cursor.x === goal.x && cursor.y === goal.y) continue;
    const leg = planFlightLeg(grid, cursor, goal, flyingHeight, liveTowerAt);
    if (!leg || leg.length === 0) continue;
    for (let index = 1; index < leg.length; index++) tiles.push(leg[index]!);
    cursor = leg[leg.length - 1]!;
  }
  return tiles.map((tile) => grid.tileToWorld(tile.x, tile.y));
}

// Expanding Chebyshev rings produce the same tile the full-grid scan would: the
// running best is final once no later ring can beat or tie it, because every
// tile in ring r+1 has squared distance >= (r+1)^2. Containment events call this
// per flyer, so the typical cost is the small ball around the lost tile instead
// of width * height.
export function nearestTraversableTile(
  grid: FlightGrid,
  tileX: number,
  tileY: number,
  flyingHeight: number,
  liveTowerAt: LiveTowerAt,
): TilePoint | null {
  if (canTraverseTile(grid, tileX, tileY, flyingHeight, liveTowerAt)) return { x: tileX, y: tileY };
  let best: TilePoint | null = null;
  let bestDistance = Infinity;
  // Ring radius covers out-of-bounds queries too: the farthest in-bounds cell sits
  // within rectangle-gap + rectangle-diagonal Chebyshev steps of the query.
  const rectangleGap = Math.max(0, -tileX, tileX - (grid.width - 1), -tileY, tileY - (grid.height - 1));
  const maxRadius = rectangleGap + Math.max(grid.width, grid.height);
  for (let radius = 1; radius <= maxRadius; radius++) {
    const minimumX = tileX - radius;
    const maximumX = tileX + radius;
    const minimumY = tileY - radius;
    const maximumY = tileY + radius;
    for (let row = minimumY; row <= maximumY; row++) {
      for (let column = minimumX; column <= maximumX; column++) {
        const onBorder = row === minimumY || row === maximumY || column === minimumX || column === maximumX;
        if (!onBorder) continue;
        if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) continue;
        if (!canTraverseTile(grid, column, row, flyingHeight, liveTowerAt)) continue;
        const deltaX = column - tileX;
        const deltaY = row - tileY;
        const squared = deltaX * deltaX + deltaY * deltaY;
        const closer =
          squared < bestDistance ||
          (squared === bestDistance && best !== null && (row < best.y || (row === best.y && column < best.x)));
        if (!closer) continue;
        bestDistance = squared;
        best = { x: column, y: row };
      }
    }
    if (best && bestDistance < (radius + 1) * (radius + 1)) break;
  }
  return best;
}

function traversableOffsets(
  grid: FlightGrid,
  tileX: number,
  tileY: number,
  flyingHeight: number,
  liveTowerAt: LiveTowerAt,
  offsets: readonly TilePoint[],
): TilePoint[] {
  const candidates: TilePoint[] = [];
  for (const offset of offsets) {
    const nextX = tileX + offset.x;
    const nextY = tileY + offset.y;
    if (!canTraverseTile(grid, nextX, nextY, flyingHeight, liveTowerAt)) continue;
    candidates.push({ x: nextX, y: nextY });
  }
  return candidates;
}

function selectClosestTile(candidates: readonly TilePoint[], fromTile: TilePoint): TilePoint | null {
  let best: TilePoint | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const deltaX = candidate.x - fromTile.x;
    const deltaY = candidate.y - fromTile.y;
    const squared = deltaX * deltaX + deltaY * deltaY;
    const closer =
      squared < bestDistance ||
      (squared === bestDistance &&
        best !== null &&
        (candidate.y < best.y || (candidate.y === best.y && candidate.x < best.x)));
    if (!closer) continue;
    bestDistance = squared;
    best = candidate;
  }
  return best;
}

// Orthogonal neighbors first; the diagonal ring is used only when that ring is closed.
// Within the diagonal ring a candidate whose straight segment from fromTile touches
// only traversable tiles wins — the others force a BFS detour or cut an untraversable
// corner at plan time. A corner-cutting diagonal is still returned when nothing clean
// remains, so the substitution never shrinks reachability.
export function nearestTraversableNeighbor(
  grid: FlightGrid,
  tileX: number,
  tileY: number,
  flyingHeight: number,
  liveTowerAt: LiveTowerAt,
  fromTile: TilePoint,
): TilePoint | null {
  const orthogonal = selectClosestTile(
    traversableOffsets(grid, tileX, tileY, flyingHeight, liveTowerAt, ORTHOGONAL_OFFSETS),
    fromTile,
  );
  if (orthogonal) return orthogonal;
  const diagonals = traversableOffsets(grid, tileX, tileY, flyingHeight, liveTowerAt, DIAGONAL_OFFSETS);
  if (diagonals.length === 0) return null;
  const clean = diagonals.filter((tile) => straightLeg(grid, fromTile, tile, flyingHeight, liveTowerAt) !== null);
  return selectClosestTile(clean.length > 0 ? clean : diagonals, fromTile);
}

export function flightDistanceGrid(grid: FlightGrid, flyingHeight: number, liveTowerAt: LiveTowerAt): number[][] {
  const distances: number[][] = [];
  for (let tileY = 0; tileY < grid.height; tileY++) {
    distances.push(new Array<number>(grid.width).fill(-1));
  }
  const queue: TilePoint[] = [];
  for (let tileY = 0; tileY < grid.height; tileY++) {
    for (let tileX = 0; tileX < grid.width; tileX++) {
      if (!grid.isBase(tileX, tileY)) continue;
      if (!canTraverseTile(grid, tileX, tileY, flyingHeight, liveTowerAt)) continue;
      distances[tileY]![tileX] = 0;
      queue.push({ x: tileX, y: tileY });
    }
  }
  let head = 0;
  while (head < queue.length) {
    const current = queue[head]!;
    head++;
    const currentDistance = distances[current.y]![current.x]!;
    for (const offset of ORTHOGONAL_OFFSETS) {
      const nextX = current.x + offset.x;
      const nextY = current.y + offset.y;
      if (!canTraverseTile(grid, nextX, nextY, flyingHeight, liveTowerAt)) continue;
      if (distances[nextY]![nextX] !== -1) continue;
      distances[nextY]![nextX] = currentDistance + 1;
      queue.push({ x: nextX, y: nextY });
    }
  }
  return distances;
}

export function ballOverlapsTileSquare(
  centerX: number,
  centerY: number,
  radius: number,
  squareCenterX: number,
  squareCenterY: number,
  tileSize: number,
): boolean {
  const half = tileSize / 2;
  const closestX = Math.min(Math.max(centerX, squareCenterX - half), squareCenterX + half);
  const closestY = Math.min(Math.max(centerY, squareCenterY - half), squareCenterY + half);
  return Math.hypot(centerX - closestX, centerY - closestY) <= radius;
}
