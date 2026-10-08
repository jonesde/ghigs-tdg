// @ts-nocheck
import { getGameContent } from "@/content/gameContent.js";

type TileType = "terrain" | "path" | "base" | "spawn";

interface Tile {
  type: TileType;
  height: number;
}

interface SpawnPoint {
  x: number;
  y: number;
}

interface BasePoint {
  x: number;
  y: number;
}

interface MapData {
  width: number;
  height: number;
  tiles: Tile[][];
  spawns: SpawnPoint[];
  base: BasePoint;
  regionId: number;
  level: number;
  style: string;
  gemReward: number;
  bossCadence: number;
  name: string;
  seed: number;
}

interface MakeMapDataOptions {
  width?: number;
  height?: number;
  spawns?: SpawnPoint[];
  base?: BasePoint;
  tiles?: Tile[][] | null;
  regionId?: number;
  level?: number;
  style?: string;
  gemReward?: number;
  bossCadence?: number;
  seed?: number;
}

export function makeMapData(options: MakeMapDataOptions): MapData {
  const {
    width = 10,
    height = 10,
    spawns = [{ x: 0, y: Math.floor(height / 2) }],
    base = { x: width - 1, y: Math.floor(height / 2) },
    tiles = null,
    regionId = 0,
    level = 1,
    style = "bastion",
    gemReward = getGameContent().economy.mapGemMultipliers[regionId] || 1,
    bossCadence = getGameContent().enemies.bossCadence[regionId],
    seed = 42,
  } = options;

  let mapTiles: Tile[][];
  if (!tiles) {
    mapTiles = [];
    for (let rowIndex = 0; rowIndex < height; rowIndex++) {
      const row: Tile[] = [];
      for (let colIndex = 0; colIndex < width; colIndex++) {
        row.push({ type: "terrain", height: 1 });
      }
      mapTiles.push(row);
    }
  } else {
    mapTiles = tiles;
  }

  for (const spawn of spawns) {
    if (spawn.y >= 0 && spawn.y < height && spawn.x >= 0 && spawn.x < width) {
      mapTiles[spawn.y][spawn.x].type = "spawn";
    }
  }

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bx = base.x + dx;
      const by = base.y + dy;
      if (bx >= 0 && by >= 0 && bx < width && by < height) {
        mapTiles[by][bx].type = "base";
      }
    }
  }

  return {
    width,
    height,
    tiles: mapTiles,
    spawns,
    base,
    regionId,
    level,
    style,
    gemReward,
    bossCadence,
    name: `Region ${level}`,
    seed,
  };
}

export function makeBastionMap(): MapData {
  const width = 8;
  const height = 6;
  const tiles: Tile[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: Tile[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) {
      row.push({ type: "terrain", height: 1 });
    }
    tiles.push(row);
  }
  for (let colIndex = 0; colIndex < width; colIndex++) {
    tiles[3][colIndex].type = "path";
    tiles[3][colIndex].height = 1;
  }
  const spawns: SpawnPoint[] = [{ x: 0, y: 3 }];
  const base: BasePoint = { x: width - 1, y: 3 };
  return makeMapData({ width, height, spawns, base, tiles, regionId: 0, level: 1, style: "bastion" });
}

export function makeSerpentineMap(): MapData {
  const width = 10;
  const height = 8;
  const tiles: Tile[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: Tile[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) {
      row.push({ type: "terrain", height: 1 });
    }
    tiles.push(row);
  }
  const pathTiles: number[][] = [
    [0, 4],
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
    [5, 4],
    [5, 3],
    [5, 2],
    [4, 2],
    [3, 2],
    [2, 2],
    [1, 2],
    [0, 2],
    [0, 1],
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
    [6, 0],
    [7, 0],
    [8, 0],
    [9, 0],
    [9, 1],
    [9, 2],
    [9, 3],
    [9, 4],
    [9, 5],
  ];
  for (const [colIndex, rowIndex] of pathTiles) {
    if (rowIndex < height && colIndex < width) {
      tiles[rowIndex][colIndex].type = "path";
      tiles[rowIndex][colIndex].height = 1;
    }
  }
  const spawns: SpawnPoint[] = [{ x: 0, y: 4 }];
  const base: BasePoint = { x: 9, y: 5 };
  return makeMapData({ width, height, spawns, base, tiles, regionId: 0, level: 1, style: "serpentine" });
}

// 1-tile-wide L (east on row 4, then south on col 7). One inside corner, southwest of tile (7, 4).
export function makeOneWideCornerMap(): MapData {
  const width = 9;
  const height = 9;
  const tiles: Tile[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: Tile[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) {
      row.push({ type: "terrain", height: 1 });
    }
    tiles.push(row);
  }
  for (let colIndex = 0; colIndex < 7; colIndex++) tiles[4][colIndex].type = "path";
  for (let rowIndex = 4; rowIndex < 8; rowIndex++) tiles[rowIndex][7].type = "path";
  const spawns: SpawnPoint[] = [{ x: 0, y: 4 }];
  const base: BasePoint = { x: 7, y: 7 };
  return makeMapData({ width, height, spawns, base, tiles, regionId: 0, level: 1, style: "bastion" });
}

export function makeSplitMap(): MapData {
  const width = 10;
  const height = 8;
  const tiles: Tile[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: Tile[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) {
      row.push({ type: "terrain", height: 1 });
    }
    tiles.push(row);
  }
  for (let colIndex = 0; colIndex < width; colIndex++) tiles[2][colIndex].type = "path";
  for (let colIndex = 0; colIndex < width; colIndex++) tiles[5][colIndex].type = "path";
  for (let rowIndex = 2; rowIndex <= 5; rowIndex++) {
    tiles[rowIndex][3].type = "path";
    tiles[rowIndex][7].type = "path";
  }
  const spawns: SpawnPoint[] = [
    { x: 0, y: 2 },
    { x: 0, y: 5 },
  ];
  const base: BasePoint = { x: 9, y: 3 };
  return makeMapData({ width, height, spawns, base, tiles, regionId: 0, level: 1, style: "split" });
}

export function makeCanyonMap(): MapData {
  const width = 12;
  const height = 10;
  const tiles: Tile[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: Tile[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) {
      row.push({ type: "terrain", height: 1 });
    }
    tiles.push(row);
  }
  const pathTiles: number[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) pathTiles.push([0, rowIndex]);
  for (let colIndex = 0; colIndex < 4; colIndex++) pathTiles.push([colIndex, height - 1]);
  for (let rowIndex = height - 1; rowIndex >= 3; rowIndex--) pathTiles.push([3, rowIndex]);
  for (let colIndex = 3; colIndex < 8; colIndex++) pathTiles.push([colIndex, 3]);
  for (let rowIndex = 3; rowIndex < height; rowIndex++) pathTiles.push([7, rowIndex]);
  for (let colIndex = 7; colIndex < width; colIndex++) pathTiles.push([colIndex, height - 1]);
  for (const [colIndex, rowIndex] of pathTiles) {
    if (rowIndex < height && colIndex < width) {
      tiles[rowIndex][colIndex].type = "path";
      tiles[rowIndex][colIndex].height = 1;
    }
  }
  const spawns: SpawnPoint[] = [{ x: 0, y: 0 }];
  const base: BasePoint = { x: width - 1, y: height - 1 };
  return makeMapData({ width, height, spawns, base, tiles, regionId: 0, level: 1, style: "canyon" });
}

export function makeOpenMap(): MapData {
  const width = 12;
  const height = 10;
  const tiles: Tile[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: Tile[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) {
      row.push({ type: "terrain", height: 1 });
    }
    tiles.push(row);
  }
  const mainPath: number[][] = [];
  for (let colIndex = 0; colIndex < width; colIndex++)
    mainPath.push([colIndex, Math.floor((colIndex * height) / width)]);
  for (const [colIndex, rowIndex] of mainPath) {
    if (rowIndex < height && colIndex < width) {
      tiles[rowIndex][colIndex].type = "path";
      tiles[rowIndex][colIndex].height = 1;
    }
  }
  for (let rowIndex = 3; rowIndex <= 6; rowIndex++) {
    for (let colIndex = 4; colIndex <= 7; colIndex++) {
      if (rowIndex < height && colIndex < width) {
        tiles[rowIndex][colIndex].type = "path";
        tiles[rowIndex][colIndex].height = 1;
      }
    }
  }
  const spawns: SpawnPoint[] = [{ x: 0, y: 0 }];
  const base: BasePoint = { x: width - 1, y: height - 1 };
  return makeMapData({ width, height, spawns, base, tiles, regionId: 0, level: 1, style: "open" });
}

export function makeBattlefieldMap(): MapData {
  const width = 14;
  const height = 12;
  const tiles: Tile[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: Tile[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) {
      row.push({ type: "terrain", height: 1 });
    }
    tiles.push(row);
  }
  const segments: number[][][] = [
    [
      [7, 0],
      [7, 3],
    ],
    [
      [7, 3],
      [2, 3],
    ],
    [
      [2, 3],
      [2, 7],
    ],
    [
      [2, 7],
      [11, 7],
    ],
    [
      [11, 7],
      [11, 10],
    ],
    [
      [11, 10],
      [7, 10],
    ],
    [
      [7, 10],
      [7, 11],
    ],
  ];
  for (const [[xStart, yStart], [xEnd, yEnd]] of segments) {
    let colIndex = xStart;
    let rowIndex = yStart;
    while (colIndex !== xEnd || rowIndex !== yEnd) {
      if (rowIndex < height && colIndex < width) {
        tiles[rowIndex][colIndex].type = "path";
        tiles[rowIndex][colIndex].height = 1;
      }
      if (colIndex !== xEnd) colIndex += Math.sign(xEnd - colIndex);
      if (rowIndex !== yEnd) rowIndex += Math.sign(yEnd - rowIndex);
    }
    if (rowIndex < height && colIndex < width) {
      tiles[rowIndex][colIndex].type = "path";
      tiles[rowIndex][colIndex].height = 1;
    }
  }
  const spawns: SpawnPoint[] = [{ x: 7, y: 0 }];
  const base: BasePoint = { x: 7, y: 11 };
  return makeMapData({ width, height, spawns, base, tiles, regionId: 0, level: 1, style: "battlefield" });
}
