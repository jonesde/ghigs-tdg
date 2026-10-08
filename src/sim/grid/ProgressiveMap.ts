// Seeded 5×5 block catalogs and the lattice rules for progressive maps.
// Tile coordinates on a board are absolute: the base block is (0, 0) and north
// of it is negative. GeneratedMap normalizes those into a 0-based array plus
// originTileX/originTileY so world positions stay put when the rectangle grows.

import { getGameContent } from "@/content/gameContent.js";
import type { MapsContent } from "@/content/schemas/maps.js";
import { type GeneratedMap, getMap, type MapSpawnPoint, mulberry32 } from "@/sim/grid/Map.js";

export const progressiveBlockSize = getGameContent().maps.progressive.blockSize;

// Default (no-theme) maps catalog. Theme worlds override this per run via
// MapThemeData.maps; the engine and map generators take it as a parameter and
// fall back to this default when a theme carries no override.
const defaultMaps = getGameContent().maps;
const progressiveMapIndexBase = defaultMaps.levels.length;
const progressiveVariantCount = defaultMaps.progressive.variants.length;
// The catalog groups progressive.variants by region, so a region's variants are
// the stride between its first index and the next region's.
const progressiveVariantsPerRegion = progressiveVariantCount / (defaultMaps.levels.length / defaultMaps.mapsPerRegion);

// Added to the region's starting gold for each base entry beyond the first.
export function progressiveEntryGold(entryCount: number): number {
  const entriesBeyondFirst = Math.max(0, Math.floor(entryCount) - 1);
  return getGameContent().economy.progressiveGoldPerEntry * entriesBeyondFirst;
}
const blockCenter = (progressiveBlockSize - 1) / 2;
const marginBlocks = 1;
const terrainTemplateIndexes = [10, 11];
const twoOpeningTemplateCount = 6;

export type BlockEdge = "N" | "E" | "S" | "W";
export type PathPattern =
  | "straight"
  | "straightJog"
  | "elbowRight"
  | "elbowLeft"
  | "elbowRing"
  | "tee"
  | "plus"
  | "terrain";
export type HeightPattern = "slope" | "peak" | "roughSlope" | "scatter";
export type ProgressiveTileType = "terrain" | "path" | "base" | "spawn" | "void";

export interface TemplateTile {
  type: "terrain" | "path";
  height: number;
}

export interface BlockTemplate {
  pattern: PathPattern;
  open: boolean;
  mouths: BlockEdge[];
  tiles: TemplateTile[][];
  heightPattern: HeightPattern;
  flatHeight: number;
  peakCorner: number;
}

export interface PlacedBlock {
  kind: "base" | "catalog";
  templateIndex: number;
  rotation: number;
  blockX: number;
  blockY: number;
  fill: boolean;
  entryEdges: BlockEdge[];
  heightPattern: HeightPattern;
  flatHeight: number;
  peakCorner: number;
}

export interface BoardSpawn {
  id: number;
  blockX: number;
  blockY: number;
  edge: BlockEdge;
  fixed: boolean;
}

export interface ProgressiveBoard {
  blocks: PlacedBlock[];
  spawns: BoardSpawn[];
  nextSpawnId: number;
}

export interface ProgressiveConfig {
  regionId: number;
  level: number;
  entryCount: number;
  seed: number;
}

export interface BlockSite {
  rotation: number;
  blockX: number;
  blockY: number;
}

// Placement log entry. The main thread replays these onto the seeded start;
// rotation lives only on the place command, not in the offer snapshot.
export interface ProgressiveStamp {
  templateIndex: number;
  rotation: number;
  blockX: number;
  blockY: number;
  fill: boolean;
}

const edges: BlockEdge[] = ["N", "E", "S", "W"];
const edgeDelta: Record<BlockEdge, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};
const oppositeEdge: Record<BlockEdge, BlockEdge> = { N: "S", E: "W", S: "N", W: "E" };
const clockwiseEdge: Record<BlockEdge, BlockEdge> = { N: "E", E: "S", S: "W", W: "N" };
const mouthLocalByEdge: Record<BlockEdge, { x: number; y: number }> = {
  N: { x: blockCenter, y: 0 },
  E: { x: progressiveBlockSize - 1, y: blockCenter },
  S: { x: blockCenter, y: progressiveBlockSize - 1 },
  W: { x: 0, y: blockCenter },
};
const entryEdgesByCount: BlockEdge[][] = [["N"], ["N", "S"], ["N", "E", "S"], ["N", "E", "S", "W"]];
const heightPatterns: HeightPattern[] = ["slope", "peak", "roughSlope", "scatter"];
const catalogPatterns: Array<{ pattern: PathPattern; open: boolean }> = [
  { pattern: "straight", open: false },
  { pattern: "straight", open: true },
  { pattern: "straightJog", open: false },
  { pattern: "elbowRight", open: false },
  { pattern: "elbowLeft", open: true },
  { pattern: "elbowRing", open: false },
  { pattern: "tee", open: false },
  { pattern: "tee", open: true },
  { pattern: "plus", open: false },
  { pattern: "plus", open: true },
  { pattern: "terrain", open: false },
  { pattern: "terrain", open: false },
];

export function isProgressiveMapIndex(mapIndex: number): boolean {
  return mapIndex >= progressiveMapIndexBase && mapIndex < progressiveMapIndexBase + progressiveVariantCount;
}

export function progressiveMapIndex(regionId: number, variantIndex: number): number {
  return progressiveMapIndexBase + regionId * progressiveVariantsPerRegion + variantIndex;
}

export function progressiveConfigForIndex(mapIndex: number, maps: MapsContent = defaultMaps): ProgressiveConfig | null {
  if (!isProgressiveMapIndex(mapIndex)) return null;
  const variant = maps.progressive.variants[mapIndex - progressiveMapIndexBase];
  if (!variant) return null;
  return { regionId: variant.regionId, level: variant.level, entryCount: variant.entryCount, seed: variant.seed };
}

// A progressive GeneratedMap carries every ProgressiveConfig field (boardToGeneratedMap
// writes them back on every rebuild), so run-time callers recover the config from the
// live map instead of the catalog index — custom progressive runs have no catalog index.
export function progressiveConfigFromMap(map: GeneratedMap | null): ProgressiveConfig | null {
  if (map === null) return null;
  if (map.style !== "progressive" || map.entryCount === undefined) return null;
  return { regionId: map.regionId, level: map.level, entryCount: map.entryCount, seed: map.seed };
}

export function progressiveUnlockMapIndex(config: ProgressiveConfig): number {
  return config.regionId * defaultMaps.mapsPerRegion + (config.level - 1);
}

export function gemMultiplierForRegionLevel(regionId: number, level: number): number {
  return getGameContent().economy.mapGemMultipliers[regionId * defaultMaps.mapsPerRegion + (level - 1)] || 1;
}

export function progressiveTileRotation(seed: number, absoluteX: number, absoluteY: number): number {
  const mixed = (Math.imul(seed ^ (absoluteX + 0x9e37), 0x45d9f3b) ^ Math.imul(absoluteY + 0x27d4, 0x27d4eb2d)) >>> 0;
  return mixed % 4;
}

function blockKey(blockX: number, blockY: number): string {
  return `${blockX},${blockY}`;
}

function normalizeQuarterTurns(rotation: number): number {
  return ((rotation % 4) + 4) % 4;
}

export function rotateEdge(edge: BlockEdge, quarterTurns: number): BlockEdge {
  let current = edge;
  const turns = normalizeQuarterTurns(quarterTurns);
  for (let step = 0; step < turns; step++) current = clockwiseEdge[current];
  return current;
}

function mouthsForPattern(pattern: PathPattern): BlockEdge[] {
  if (pattern === "straight" || pattern === "straightJog") return ["N", "S"];
  if (pattern === "elbowRight" || pattern === "elbowRing") return ["N", "E"];
  if (pattern === "elbowLeft") return ["N", "W"];
  if (pattern === "tee") return ["N", "E", "S"];
  if (pattern === "plus") return ["N", "E", "S", "W"];
  return [];
}

function closedPathKeys(pattern: PathPattern): Set<string> {
  const keys = new Set<string>();
  const addColumn = () => {
    for (let localY = 0; localY < progressiveBlockSize; localY++) keys.add(`${blockCenter},${localY}`);
  };
  const addRow = () => {
    for (let localX = 0; localX < progressiveBlockSize; localX++) keys.add(`${localX},${blockCenter}`);
  };
  const addTiles = (tiles: Array<[number, number]>) => {
    for (const [tileX, tileY] of tiles) keys.add(`${tileX},${tileY}`);
  };
  if (pattern === "straight") addColumn();
  if (pattern === "straightJog")
    addTiles([
      [2, 4],
      [2, 3],
      [1, 3],
      [1, 2],
      [1, 1],
      [2, 1],
      [2, 0],
    ]);
  if (pattern === "elbowRight") {
    for (let localY = 0; localY <= blockCenter; localY++) keys.add(`${blockCenter},${localY}`);
    for (let localX = blockCenter + 1; localX < progressiveBlockSize; localX++) keys.add(`${localX},${blockCenter}`);
  }
  if (pattern === "elbowLeft") {
    for (let localY = 0; localY <= blockCenter; localY++) keys.add(`${blockCenter},${localY}`);
    for (let localX = 0; localX < blockCenter; localX++) keys.add(`${localX},${blockCenter}`);
  }
  if (pattern === "elbowRing")
    addTiles([
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 3],
      [3, 3],
      [3, 2],
      [4, 2],
    ]);
  if (pattern === "tee") {
    addColumn();
    keys.add(`${blockCenter + 1},${blockCenter}`);
    keys.add(`${progressiveBlockSize - 1},${blockCenter}`);
  }
  if (pattern === "plus") {
    addColumn();
    addRow();
  }
  return keys;
}

const peakCorners = [
  { x: 0, y: 0 },
  { x: progressiveBlockSize - 1, y: 0 },
  { x: progressiveBlockSize - 1, y: progressiveBlockSize - 1 },
  { x: 0, y: progressiveBlockSize - 1 },
];

function slopeHeightAt(peak: { x: number; y: number }, localX: number, localY: number): number {
  const offsetX = peak.x === 0 ? localX : progressiveBlockSize - 1 - localX;
  const offsetY = peak.y === 0 ? localY : progressiveBlockSize - 1 - localY;
  const maxDistance = 2 * (progressiveBlockSize - 1);
  return 4 - Math.round(((offsetX + offsetY) * 3) / maxDistance);
}

// A pure tile hash, not the placement RNG, so worker and main-thread replays agree.
function terrainJitter(seed: number, localX: number, localY: number): number {
  const mixed = (Math.imul(seed ^ (localX + 0x9e37), 0x45d9f3b) ^ Math.imul(localY + 0x27d4, 0x27d4eb2d)) >>> 0;
  return (mixed % 3) - 1;
}

function terrainHeightAt(
  pattern: HeightPattern,
  flatHeight: number,
  peakCorner: number,
  localX: number,
  localY: number,
): number {
  const peak = peakCorners[peakCorner] ?? peakCorners[0]!;
  const jitterSeed = (peakCorner + 1) * 5 + flatHeight;
  if (pattern === "slope") return slopeHeightAt(peak, localX, localY);
  if (pattern === "roughSlope") {
    const height = slopeHeightAt(peak, localX, localY) + terrainJitter(jitterSeed, localX, localY);
    return Math.min(4, Math.max(1, height));
  }
  if (pattern === "scatter") {
    const height = flatHeight + terrainJitter(jitterSeed, localX, localY);
    return Math.min(4, Math.max(1, height));
  }
  const opposite = peakCorners[(peakCorner + 2) % 4] ?? peakCorners[2]!;
  if (localX === peak.x && localY === peak.y) return 4;
  if (localX === opposite.x && localY === opposite.y) return 1;
  const besidePeak =
    (localX === peak.x && Math.abs(localY - peak.y) === 1) || (localY === peak.y && Math.abs(localX - peak.x) === 1);
  if (besidePeak) return 3;
  return 2;
}

function rollHeight(rng: () => number): { heightPattern: HeightPattern; flatHeight: number; peakCorner: number } {
  const heightPattern = heightPatterns[Math.floor(rng() * heightPatterns.length)] ?? "slope";
  const flatHeight = 1 + Math.floor(rng() * 4);
  const peakCorner = Math.floor(rng() * 4);
  return { heightPattern, flatHeight, peakCorner };
}

function buildTemplateTiles(
  pattern: PathPattern,
  open: boolean,
  heightPattern: HeightPattern,
  flatHeight: number,
  peakCorner: number,
): TemplateTile[][] {
  const pathKeys = closedPathKeys(pattern);
  if (open && pattern !== "terrain") {
    for (let localY = 1; localY <= 3; localY++) {
      for (let localX = 1; localX <= 3; localX++) pathKeys.add(`${localX},${localY}`);
    }
    // The carved center stays terrain, including where a closed cross ran through it.
    pathKeys.delete(`${blockCenter},${blockCenter}`);
  }
  const tiles: TemplateTile[][] = [];
  for (let localY = 0; localY < progressiveBlockSize; localY++) {
    const row: TemplateTile[] = [];
    for (let localX = 0; localX < progressiveBlockSize; localX++) {
      const isPath = pathKeys.has(`${localX},${localY}`);
      row.push({
        type: isPath ? "path" : "terrain",
        height: isPath ? 1 : terrainHeightAt(heightPattern, flatHeight, peakCorner, localX, localY),
      });
    }
    tiles.push(row);
  }
  return tiles;
}

export function generateProgressiveCatalog(seed: number): BlockTemplate[] {
  const rng = mulberry32(seed);
  return catalogPatterns.map((entry) => {
    const height = rollHeight(rng);
    const mouths = mouthsForPattern(entry.pattern);
    return {
      pattern: entry.pattern,
      open: entry.open && entry.pattern !== "terrain",
      mouths,
      tiles: buildTemplateTiles(entry.pattern, entry.open, height.heightPattern, height.flatHeight, height.peakCorner),
      heightPattern: height.heightPattern,
      flatHeight: height.flatHeight,
      peakCorner: height.peakCorner,
    };
  });
}

function sourceLocalAfterInverseRotation(
  localX: number,
  localY: number,
  quarterTurns: number,
): { x: number; y: number } {
  let x = localX;
  let y = localY;
  const turns = normalizeQuarterTurns(quarterTurns);
  for (let step = 0; step < turns; step++) {
    const nextX = y;
    const nextY = progressiveBlockSize - 1 - x;
    x = nextX;
    y = nextY;
  }
  return { x, y };
}

export function rotatedMouths(template: BlockTemplate, rotation: number): BlockEdge[] {
  return template.mouths.map((mouth) => rotateEdge(mouth, rotation));
}

function blockMouths(block: PlacedBlock, catalog: BlockTemplate[]): BlockEdge[] {
  if (block.kind === "base") return block.entryEdges;
  const template = catalog[block.templateIndex];
  if (!template) return [];
  return rotatedMouths(template, block.rotation);
}

function blockAt(board: ProgressiveBoard, blockX: number, blockY: number): PlacedBlock | null {
  return board.blocks.find((block) => block.blockX === blockX && block.blockY === blockY) ?? null;
}

function occupiedKeys(board: ProgressiveBoard): Set<string> {
  return new Set(board.blocks.map((block) => blockKey(block.blockX, block.blockY)));
}

export function localTile(
  catalog: BlockTemplate[],
  block: PlacedBlock,
  localX: number,
  localY: number,
): TemplateTile | null {
  if (block.kind === "catalog") {
    const template = catalog[block.templateIndex];
    if (!template) return null;
    const source = sourceLocalAfterInverseRotation(localX, localY, block.rotation);
    return template.tiles[source.y]?.[source.x] ?? null;
  }
  const inBase = localX >= 1 && localX <= 3 && localY >= 1 && localY <= 3;
  if (inBase) return { type: "path", height: 1 };
  const mouth = edges.find((edge) => {
    const mouthLocal = mouthLocalByEdge[edge];
    return mouthLocal.x === localX && mouthLocal.y === localY && block.entryEdges.includes(edge);
  });
  if (mouth) return { type: "path", height: 1 };
  return {
    type: "terrain",
    height: terrainHeightAt(block.heightPattern, block.flatHeight, block.peakCorner, localX, localY),
  };
}

function sharedEdgeCompatible(ourMouths: BlockEdge[], ourEdge: BlockEdge, neighborMouths: BlockEdge[]): boolean {
  const weOpen = ourMouths.includes(ourEdge);
  const theyOpen = neighborMouths.includes(oppositeEdge[ourEdge]);
  return weOpen === theyOpen;
}

function placementEdgeLegal(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  templateIndex: number,
  rotation: number,
  blockX: number,
  blockY: number,
): boolean {
  const template = catalog[templateIndex];
  if (!template) return false;
  if (blockAt(board, blockX, blockY)) return false;
  const ourMouths = rotatedMouths(template, rotation);
  let sharedEdges = 0;
  let connections = 0;
  for (const edge of edges) {
    const delta = edgeDelta[edge];
    const neighbor = blockAt(board, blockX + delta.x, blockY + delta.y);
    if (!neighbor) continue;
    sharedEdges += 1;
    const neighborMouths = blockMouths(neighbor, catalog);
    if (!sharedEdgeCompatible(ourMouths, edge, neighborMouths)) return false;
    if (ourMouths.includes(edge)) connections += 1;
  }
  if (sharedEdges === 0) return false;
  if (template.mouths.length === 0) return connections === 0;
  return connections > 0;
}

// Terrain does not consume an opening, so it stays on the edge rule. A path
// stamp also has to leave a durable opening: applyPlayerStamp calls the edge
// rule, which is what keeps this search from recursing.
export function placementLegal(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  templateIndex: number,
  rotation: number,
  blockX: number,
  blockY: number,
): boolean {
  if (!placementEdgeLegal(board, catalog, templateIndex, rotation, blockX, blockY)) return false;
  const template = catalog[templateIndex];
  if (!template || template.mouths.length === 0) return true;
  return placementLeavesContinuation(board, catalog, templateIndex, rotation, blockX, blockY);
}

function placementLeavesContinuation(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  templateIndex: number,
  rotation: number,
  blockX: number,
  blockY: number,
): boolean {
  const next = cloneBoard(board);
  const player = catalogBlock(templateIndex, rotation, blockX, blockY, false);
  if (!applyPlayerStamp(next, catalog, player)) return false;
  return boardHasDurableOpening(next, catalog);
}

function boardHasDurableOpening(board: ProgressiveBoard, catalog: BlockTemplate[]): boolean {
  for (const spawn of board.spawns) {
    if (spawn.fixed) continue;
    const delta = edgeDelta[spawn.edge];
    const facingX = spawn.blockX + delta.x;
    const facingY = spawn.blockY + delta.y;
    if (blockAt(board, facingX, facingY)) continue;
    if (facingCellHasDurableFollowUp(board, catalog, facingX, facingY)) return true;
  }
  return false;
}

function facingCellHasDurableFollowUp(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  blockX: number,
  blockY: number,
): boolean {
  for (let templateIndex = 0; templateIndex < catalog.length; templateIndex++) {
    const template = catalog[templateIndex];
    if (!template || template.mouths.length === 0) continue;
    for (let rotation = 0; rotation < 4; rotation++) {
      if (!placementExtendsOpening(board, catalog, templateIndex, rotation, blockX, blockY)) continue;
      if (followUpAdmitsPath(board, catalog, templateIndex, rotation, blockX, blockY)) return true;
    }
  }
  return false;
}

function followUpAdmitsPath(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  templateIndex: number,
  rotation: number,
  blockX: number,
  blockY: number,
): boolean {
  const next = cloneBoard(board);
  const player = catalogBlock(templateIndex, rotation, blockX, blockY, false);
  if (!applyPlayerStamp(next, catalog, player)) return false;
  for (const spawn of next.spawns) {
    if (spawn.fixed) continue;
    const delta = edgeDelta[spawn.edge];
    const facingX = spawn.blockX + delta.x;
    const facingY = spawn.blockY + delta.y;
    if (blockAt(next, facingX, facingY)) continue;
    if (cellAdmitsPathTemplate(next, catalog, facingX, facingY)) return true;
  }
  return false;
}

function cellAdmitsPathTemplate(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  blockX: number,
  blockY: number,
): boolean {
  for (let templateIndex = 0; templateIndex < catalog.length; templateIndex++) {
    const template = catalog[templateIndex];
    if (!template || template.mouths.length === 0) continue;
    for (let rotation = 0; rotation < 4; rotation++) {
      if (placementEdgeLegal(board, catalog, templateIndex, rotation, blockX, blockY)) return true;
    }
  }
  return false;
}

export function legalSites(board: ProgressiveBoard, catalog: BlockTemplate[], templateIndex: number): BlockSite[] {
  if (board.blocks.length === 0) return [];
  let minX = board.blocks[0]!.blockX;
  let maxX = minX;
  let minY = board.blocks[0]!.blockY;
  let maxY = minY;
  for (const block of board.blocks) {
    minX = Math.min(minX, block.blockX);
    maxX = Math.max(maxX, block.blockX);
    minY = Math.min(minY, block.blockY);
    maxY = Math.max(maxY, block.blockY);
  }
  const sites: BlockSite[] = [];
  for (let blockY = minY - 1; blockY <= maxY + 1; blockY++) {
    for (let blockX = minX - 1; blockX <= maxX + 1; blockX++) {
      for (let rotation = 0; rotation < 4; rotation++) {
        if (placementLegal(board, catalog, templateIndex, rotation, blockX, blockY)) {
          sites.push({ rotation, blockX, blockY });
        }
      }
    }
  }
  return sites;
}

function spawnOnMouth(board: ProgressiveBoard, blockX: number, blockY: number, edge: BlockEdge): BoardSpawn | null {
  return (
    board.spawns.find((spawn) => spawn.blockX === blockX && spawn.blockY === blockY && spawn.edge === edge) ?? null
  );
}

function deriveInitialSpawns(board: ProgressiveBoard, catalog: BlockTemplate[]): void {
  board.spawns = [];
  board.nextSpawnId = 1;
  for (const block of board.blocks) {
    const mouths = blockMouths(block, catalog);
    for (const edge of edges) {
      if (!mouths.includes(edge)) continue;
      const delta = edgeDelta[edge];
      const neighbor = blockAt(board, block.blockX + delta.x, block.blockY + delta.y);
      if (neighbor && blockMouths(neighbor, catalog).includes(oppositeEdge[edge])) continue;
      board.spawns.push({ id: board.nextSpawnId, blockX: block.blockX, blockY: block.blockY, edge, fixed: false });
      board.nextSpawnId += 1;
    }
  }
}

function refreshFixed(board: ProgressiveBoard, catalog: BlockTemplate[]): void {
  for (const spawn of board.spawns) {
    // A spawn that already faces a filled mouth stays put for the rest of the run.
    if (spawn.fixed) continue;
    const delta = edgeDelta[spawn.edge];
    const neighbor = blockAt(board, spawn.blockX + delta.x, spawn.blockY + delta.y);
    if (!neighbor) continue;
    const neighborMouths = blockMouths(neighbor, catalog);
    spawn.fixed = !neighborMouths.includes(oppositeEdge[spawn.edge]);
  }
}

function catalogBlock(
  templateIndex: number,
  rotation: number,
  blockX: number,
  blockY: number,
  fill: boolean,
): PlacedBlock {
  return {
    kind: "catalog",
    templateIndex,
    rotation: normalizeQuarterTurns(rotation),
    blockX,
    blockY,
    fill,
    entryEdges: [],
    heightPattern: "slope",
    flatHeight: 1,
    peakCorner: 0,
  };
}

function applyPlayerStamp(board: ProgressiveBoard, catalog: BlockTemplate[], stamp: PlacedBlock): boolean {
  // Edge rule only. placementLegal calls this while searching for a continuation.
  if (!placementEdgeLegal(board, catalog, stamp.templateIndex, stamp.rotation, stamp.blockX, stamp.blockY))
    return false;
  const template = catalog[stamp.templateIndex]!;
  const ourMouths = rotatedMouths(template, stamp.rotation);
  const consumed: BoardSpawn[] = [];
  const connectedEdges: BlockEdge[] = [];
  for (const edge of ourMouths) {
    const delta = edgeDelta[edge];
    const neighborX = stamp.blockX + delta.x;
    const neighborY = stamp.blockY + delta.y;
    const neighbor = blockAt(board, neighborX, neighborY);
    if (!neighbor) continue;
    const neighborEdge = oppositeEdge[edge];
    if (!blockMouths(neighbor, catalog).includes(neighborEdge)) continue;
    connectedEdges.push(edge);
    const spawn = spawnOnMouth(board, neighborX, neighborY, neighborEdge);
    if (spawn && !spawn.fixed) consumed.push(spawn);
  }
  board.blocks.push(stamp);
  const newEdges = ourMouths.filter((edge) => !connectedEdges.includes(edge));
  const edgeOrder = edges.filter((edge) => newEdges.includes(edge));
  if (consumed.length === 1 && edgeOrder.length > 0) {
    const moved = consumed[0]!;
    const destination = edgeOrder[0]!;
    moved.blockX = stamp.blockX;
    moved.blockY = stamp.blockY;
    moved.edge = destination;
    moved.fixed = false;
    for (let index = 1; index < edgeOrder.length; index++) {
      board.spawns.push({
        id: board.nextSpawnId,
        blockX: stamp.blockX,
        blockY: stamp.blockY,
        edge: edgeOrder[index]!,
        fixed: false,
      });
      board.nextSpawnId += 1;
    }
  } else {
    if (consumed.length > 0) {
      const consumedIds = new Set(consumed.map((spawn) => spawn.id));
      board.spawns = board.spawns.filter((spawn) => !consumedIds.has(spawn.id));
    }
    for (const edge of edgeOrder) {
      board.spawns.push({ id: board.nextSpawnId, blockX: stamp.blockX, blockY: stamp.blockY, edge, fixed: false });
      board.nextSpawnId += 1;
    }
  }
  return true;
}

function findHoles(board: ProgressiveBoard): Array<Array<{ x: number; y: number }>> {
  if (board.blocks.length === 0) return [];
  let minX = board.blocks[0]!.blockX;
  let maxX = minX;
  let minY = board.blocks[0]!.blockY;
  let maxY = minY;
  for (const block of board.blocks) {
    minX = Math.min(minX, block.blockX);
    maxX = Math.max(maxX, block.blockX);
    minY = Math.min(minY, block.blockY);
    maxY = Math.max(maxY, block.blockY);
  }
  const occupied = occupiedKeys(board);
  const reachMinX = minX - 1;
  const reachMaxX = maxX + 1;
  const reachMinY = minY - 1;
  const reachMaxY = maxY + 1;
  const reached = new Set<string>();
  const queue: Array<{ x: number; y: number }> = [];
  const trySeed = (x: number, y: number) => {
    const key = blockKey(x, y);
    if (occupied.has(key) || reached.has(key)) return;
    reached.add(key);
    queue.push({ x, y });
  };
  for (let x = reachMinX; x <= reachMaxX; x++) {
    trySeed(x, reachMinY);
    trySeed(x, reachMaxY);
  }
  for (let y = reachMinY; y <= reachMaxY; y++) {
    trySeed(reachMinX, y);
    trySeed(reachMaxX, y);
  }
  let head = 0;
  while (head < queue.length) {
    const current = queue[head]!;
    head += 1;
    for (const edge of edges) {
      const delta = edgeDelta[edge];
      const nextX = current.x + delta.x;
      const nextY = current.y + delta.y;
      if (nextX < reachMinX || nextX > reachMaxX || nextY < reachMinY || nextY > reachMaxY) continue;
      const key = blockKey(nextX, nextY);
      if (occupied.has(key) || reached.has(key)) continue;
      reached.add(key);
      queue.push({ x: nextX, y: nextY });
    }
  }
  const holeCells: Array<{ x: number; y: number }> = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const key = blockKey(x, y);
      if (occupied.has(key) || reached.has(key)) continue;
      holeCells.push({ x, y });
    }
  }
  const remaining = new Set(holeCells.map((cell) => blockKey(cell.x, cell.y)));
  const components: Array<Array<{ x: number; y: number }>> = [];
  for (const cell of holeCells) {
    const startKey = blockKey(cell.x, cell.y);
    if (!remaining.has(startKey)) continue;
    const component: Array<{ x: number; y: number }> = [];
    const componentQueue = [cell];
    remaining.delete(startKey);
    let componentHead = 0;
    while (componentHead < componentQueue.length) {
      const current = componentQueue[componentHead]!;
      componentHead += 1;
      component.push(current);
      for (const edge of edges) {
        const delta = edgeDelta[edge];
        const next = { x: current.x + delta.x, y: current.y + delta.y };
        const nextKey = blockKey(next.x, next.y);
        if (!remaining.has(nextKey)) continue;
        remaining.delete(nextKey);
        componentQueue.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

function mouthsIntoComponent(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  cells: Array<{ x: number; y: number }>,
): number {
  const cellKeys = new Set(cells.map((cell) => blockKey(cell.x, cell.y)));
  let count = 0;
  for (const cell of cells) {
    for (const edge of edges) {
      const delta = edgeDelta[edge];
      const neighborX = cell.x + delta.x;
      const neighborY = cell.y + delta.y;
      if (cellKeys.has(blockKey(neighborX, neighborY))) continue;
      const neighbor = blockAt(board, neighborX, neighborY);
      if (!neighbor) continue;
      if (blockMouths(neighbor, catalog).includes(oppositeEdge[edge])) count += 1;
    }
  }
  return count;
}

export function commitPlacement(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  templateIndex: number,
  rotation: number,
  blockX: number,
  blockY: number,
  rng: () => number,
): { board: ProgressiveBoard; added: PlacedBlock[] } | null {
  if (!placementLegal(board, catalog, templateIndex, rotation, blockX, blockY)) return null;
  const next = cloneBoard(board);
  const player = catalogBlock(templateIndex, rotation, blockX, blockY, false);
  if (!applyPlayerStamp(next, catalog, player)) return null;
  const added: PlacedBlock[] = [player];
  for (const component of findHoles(next)) {
    const mouthCount = mouthsIntoComponent(next, catalog, component);
    if (mouthCount > 1) continue;
    for (const cell of component) {
      const terrainIndex = terrainTemplateIndexes[Math.floor(rng() * terrainTemplateIndexes.length)] ?? 10;
      const fillRotation = Math.floor(rng() * 4);
      const fill = catalogBlock(terrainIndex, fillRotation, cell.x, cell.y, true);
      next.blocks.push(fill);
      added.push(fill);
    }
  }
  refreshFixed(next, catalog);
  return { board: next, added };
}

// Player stamp only. Hole fills are terrain and do not change the walkable
// tiles, so a walk-mesh probe can use this board without advancing the placement RNG.
export function boardWithPlayerStamp(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  templateIndex: number,
  rotation: number,
  blockX: number,
  blockY: number,
): ProgressiveBoard | null {
  if (!placementLegal(board, catalog, templateIndex, rotation, blockX, blockY)) return null;
  const next = cloneBoard(board);
  const player = catalogBlock(templateIndex, rotation, blockX, blockY, false);
  if (!applyPlayerStamp(next, catalog, player)) return null;
  return next;
}

export type ProgressiveSiteDirection = "up" | "down" | "left" | "right";

export function sitesAtRotation(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  templateIndex: number,
  rotation: number,
): BlockSite[] {
  const quarterTurns = normalizeQuarterTurns(rotation);
  return legalSites(board, catalog, templateIndex).filter((site) => site.rotation === quarterTurns);
}

export function nextUsableRotation(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  templateIndex: number,
  startRotation: number,
): number {
  const start = normalizeQuarterTurns(startRotation);
  for (let offset = 0; offset < 4; offset++) {
    const rotation = (start + offset) % 4;
    if (sitesAtRotation(board, catalog, templateIndex, rotation).length > 0) return rotation;
  }
  return start;
}

export function chooseAdjacentSite(
  sites: BlockSite[],
  current: BlockSite,
  direction: ProgressiveSiteDirection,
): BlockSite {
  let bestSite: BlockSite | null = null;
  let bestPrimary = Number.POSITIVE_INFINITY;
  let bestPerpendicular = Number.POSITIVE_INFINITY;
  for (const site of sites) {
    if (site.blockX === current.blockX && site.blockY === current.blockY) continue;
    const deltaX = site.blockX - current.blockX;
    const deltaY = site.blockY - current.blockY;
    let primary = 0;
    let perpendicular = 0;
    if (direction === "up") {
      if (deltaY >= 0) continue;
      primary = -deltaY;
      perpendicular = Math.abs(deltaX);
    } else if (direction === "down") {
      if (deltaY <= 0) continue;
      primary = deltaY;
      perpendicular = Math.abs(deltaX);
    } else if (direction === "left") {
      if (deltaX >= 0) continue;
      primary = -deltaX;
      perpendicular = Math.abs(deltaY);
    } else {
      if (deltaX <= 0) continue;
      primary = deltaX;
      perpendicular = Math.abs(deltaY);
    }
    if (primary < bestPrimary || (primary === bestPrimary && perpendicular < bestPerpendicular)) {
      bestSite = site;
      bestPrimary = primary;
      bestPerpendicular = perpendicular;
    }
  }
  return bestSite ?? current;
}

export function placementExtendsOpening(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  templateIndex: number,
  rotation: number,
  blockX: number,
  blockY: number,
): boolean {
  if (!placementEdgeLegal(board, catalog, templateIndex, rotation, blockX, blockY)) return false;
  const template = catalog[templateIndex];
  if (!template || template.mouths.length === 0) return false;
  const mouths = rotatedMouths(template, rotation);
  let connectedToOpening = 0;
  let newMouths = 0;
  for (const edge of mouths) {
    const delta = edgeDelta[edge];
    const neighbor = blockAt(board, blockX + delta.x, blockY + delta.y);
    if (!neighbor) {
      newMouths += 1;
      continue;
    }
    if (blockMouths(neighbor, catalog).includes(oppositeEdge[edge])) connectedToOpening += 1;
  }
  return connectedToOpening > 0 && newMouths > 0;
}

export function templateCanExtendOpening(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  templateIndex: number,
): boolean {
  return legalSites(board, catalog, templateIndex).some((site) =>
    placementExtendsOpening(board, catalog, templateIndex, site.rotation, site.blockX, site.blockY),
  );
}

function legalTemplateGroups(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
): { legal: number[]; extending: number[] } {
  const legal: number[] = [];
  const extending: number[] = [];
  for (let templateIndex = 0; templateIndex < catalog.length; templateIndex++) {
    if (legalSites(board, catalog, templateIndex).length === 0) continue;
    legal.push(templateIndex);
    if (templateCanExtendOpening(board, catalog, templateIndex)) extending.push(templateIndex);
  }
  return { legal, extending };
}

function takeUniform(pool: number[], rng: () => number): number {
  const pickedIndex = Math.floor(rng() * pool.length);
  const picked = pool[pickedIndex] ?? pool[0]!;
  pool.splice(pickedIndex, 1);
  return picked;
}

function shuffleOffer(offer: number[], rng: () => number): void {
  for (let index = offer.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const current = offer[index]!;
    offer[index] = offer[swapIndex]!;
    offer[swapIndex] = current;
  }
}

function sameTemplateSet(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  for (const templateIndex of left) {
    if (!rightSet.has(templateIndex)) return false;
  }
  return true;
}

export function offerHasAlternative(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  choiceCount: number,
  currentOffer: readonly number[],
): boolean {
  const groups = legalTemplateGroups(board, catalog);
  const slotCount = Math.min(choiceCount, groups.legal.length);
  if (slotCount <= 0) return false;
  const extending = new Set(groups.extending);
  const combination: number[] = [];
  let validCount = 0;
  let matchesCurrent = false;
  const walk = (start: number): void => {
    if (validCount > 1) return;
    if (combination.length === slotCount) {
      const includesExtender =
        extending.size === 0 || combination.some((templateIndex) => extending.has(templateIndex));
      if (!includesExtender) return;
      validCount += 1;
      if (sameTemplateSet(combination, currentOffer)) matchesCurrent = true;
      return;
    }
    for (let index = start; index < groups.legal.length; index++) {
      combination.push(groups.legal[index]!);
      walk(index + 1);
      combination.pop();
      if (validCount > 1) return;
    }
  };
  walk(0);
  if (validCount > 1) return true;
  return validCount === 1 && !matchesCurrent;
}

export function drawBlockOffer(
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
  choiceCount: number,
  rng: () => number,
): number[] {
  const groups = legalTemplateGroups(board, catalog);
  if (groups.legal.length === 0 || choiceCount <= 0) return [];
  const offer: number[] = [];
  const pool = groups.legal.slice();
  if (groups.extending.length > 0) {
    const extender = takeUniform(groups.extending.slice(), rng);
    offer.push(extender);
    const poolIndex = pool.indexOf(extender);
    if (poolIndex >= 0) pool.splice(poolIndex, 1);
  }
  while (offer.length < choiceCount && pool.length > 0) offer.push(takeUniform(pool, rng));
  shuffleOffer(offer, rng);
  return offer;
}

function cloneBoard(board: ProgressiveBoard): ProgressiveBoard {
  return {
    blocks: board.blocks.map((block) => ({ ...block, entryEdges: [...block.entryEdges] })),
    spawns: board.spawns.map((spawn) => ({ ...spawn })),
    nextSpawnId: board.nextSpawnId,
  };
}

export function createProgressiveBoard(config: ProgressiveConfig): {
  board: ProgressiveBoard;
  catalog: BlockTemplate[];
} {
  const catalog = generateProgressiveCatalog(config.seed);
  const rng = mulberry32((config.seed ^ 0x51ed9b3) >>> 0);
  const baseHeight = rollHeight(rng);
  const entryEdges = entryEdgesByCount[config.entryCount - 1] ?? entryEdgesByCount[0]!;
  const base: PlacedBlock = {
    kind: "base",
    templateIndex: -1,
    rotation: 0,
    blockX: 0,
    blockY: 0,
    fill: false,
    entryEdges: [...entryEdges],
    heightPattern: baseHeight.heightPattern,
    flatHeight: baseHeight.flatHeight,
    peakCorner: baseHeight.peakCorner,
  };
  const board: ProgressiveBoard = { blocks: [base], spawns: [], nextSpawnId: 1 };
  for (const entryEdge of entryEdges) {
    const delta = edgeDelta[entryEdge];
    const requiredEdge = oppositeEdge[entryEdge];
    const options: Array<{ templateIndex: number; rotation: number }> = [];
    for (let templateIndex = 0; templateIndex < twoOpeningTemplateCount; templateIndex++) {
      const template = catalog[templateIndex];
      if (!template) continue;
      for (let rotation = 0; rotation < 4; rotation++) {
        if (rotatedMouths(template, rotation).includes(requiredEdge)) options.push({ templateIndex, rotation });
      }
    }
    const picked = options[Math.floor(rng() * options.length)];
    if (!picked) continue;
    board.blocks.push(catalogBlock(picked.templateIndex, picked.rotation, delta.x, delta.y, false));
  }
  deriveInitialSpawns(board, catalog);
  refreshFixed(board, catalog);
  return { board, catalog };
}

export function replayProgressiveBoard(
  config: ProgressiveConfig,
  stamps: ProgressiveStamp[],
): { board: ProgressiveBoard; catalog: BlockTemplate[] } {
  const started = createProgressiveBoard(config);
  const board = started.board;
  for (const stamp of stamps) {
    if (stamp.fill) {
      board.blocks.push(catalogBlock(stamp.templateIndex, stamp.rotation, stamp.blockX, stamp.blockY, true));
    } else {
      applyPlayerStamp(
        board,
        started.catalog,
        catalogBlock(stamp.templateIndex, stamp.rotation, stamp.blockX, stamp.blockY, false),
      );
    }
    // Fixed spawns are visible to the next player stamp. Refreshing only at the
    // end would let a later block move a mouth that a fill already sealed.
    refreshFixed(board, started.catalog);
  }
  return { board, catalog: started.catalog };
}

export function blockCoordinateForTile(
  originTileX: number,
  originTileY: number,
  tileX: number,
  tileY: number,
): { blockX: number; blockY: number } {
  const absoluteX = originTileX + tileX;
  const absoluteY = originTileY + tileY;
  return { blockX: Math.floor(absoluteX / progressiveBlockSize), blockY: Math.floor(absoluteY / progressiveBlockSize) };
}

export function progressiveBlockWorldCorner(blockX: number, blockY: number, tileSize = 36): { x: number; y: number } {
  return { x: blockX * progressiveBlockSize * tileSize, y: blockY * progressiveBlockSize * tileSize };
}

function absoluteMouthTile(blockX: number, blockY: number, edge: BlockEdge): { x: number; y: number } {
  const local = mouthLocalByEdge[edge];
  return { x: blockX * progressiveBlockSize + local.x, y: blockY * progressiveBlockSize + local.y };
}

export function boardToGeneratedMap(
  config: ProgressiveConfig,
  board: ProgressiveBoard,
  catalog: BlockTemplate[],
): GeneratedMap {
  let minBlockX = 0;
  let maxBlockX = 0;
  let minBlockY = 0;
  let maxBlockY = 0;
  for (const block of board.blocks) {
    minBlockX = Math.min(minBlockX, block.blockX);
    maxBlockX = Math.max(maxBlockX, block.blockX);
    minBlockY = Math.min(minBlockY, block.blockY);
    maxBlockY = Math.max(maxBlockY, block.blockY);
  }
  minBlockX -= marginBlocks;
  maxBlockX += marginBlocks;
  minBlockY -= marginBlocks;
  maxBlockY += marginBlocks;
  const originTileX = minBlockX * progressiveBlockSize;
  const originTileY = minBlockY * progressiveBlockSize;
  const width = (maxBlockX - minBlockX + 1) * progressiveBlockSize;
  const height = (maxBlockY - minBlockY + 1) * progressiveBlockSize;
  const tiles: GeneratedMap["tiles"] = [];
  for (let row = 0; row < height; row++) {
    const tileRow: GeneratedMap["tiles"][number] = [];
    for (let column = 0; column < width; column++) tileRow.push({ type: "void", height: 1 });
    tiles.push(tileRow);
  }
  const spawnTiles = new Set(
    board.spawns.map((spawn) => {
      const absolute = absoluteMouthTile(spawn.blockX, spawn.blockY, spawn.edge);
      return `${absolute.x},${absolute.y}`;
    }),
  );
  for (const block of board.blocks) {
    for (let localY = 0; localY < progressiveBlockSize; localY++) {
      for (let localX = 0; localX < progressiveBlockSize; localX++) {
        const absoluteX = block.blockX * progressiveBlockSize + localX;
        const absoluteY = block.blockY * progressiveBlockSize + localY;
        const indexX = absoluteX - originTileX;
        const indexY = absoluteY - originTileY;
        const sample = localTile(catalog, block, localX, localY);
        if (!sample) continue;
        let type: ProgressiveTileType = sample.type;
        if (block.kind === "base" && localX >= 1 && localX <= 3 && localY >= 1 && localY <= 3) type = "base";
        if (spawnTiles.has(`${absoluteX},${absoluteY}`)) type = "spawn";
        const cell = tiles[indexY]?.[indexX];
        if (!cell) continue;
        cell.type = type;
        cell.height = type === "path" || type === "spawn" || type === "base" ? 1 : sample.height;
      }
    }
  }
  const spawns: MapSpawnPoint[] = board.spawns.map((spawn) => {
    const absolute = absoluteMouthTile(spawn.blockX, spawn.blockY, spawn.edge);
    return { x: absolute.x - originTileX, y: absolute.y - originTileY, id: spawn.id, fixed: spawn.fixed };
  });
  const baseIndexX = blockCenter - originTileX;
  const baseIndexY = blockCenter - originTileY;
  return {
    regionId: config.regionId,
    level: config.level,
    style: "progressive",
    width,
    height,
    tiles,
    spawns,
    base: { x: baseIndexX, y: baseIndexY },
    name: "",
    bossCadence: getGameContent().enemies.bossCadence[config.regionId] ?? getGameContent().enemies.bossCadence[0]!,
    seed: config.seed,
    entryCount: config.entryCount,
    originTileX,
    originTileY,
  };
}

export function generateProgressiveMap(config: ProgressiveConfig, stamps: ProgressiveStamp[] = []): GeneratedMap {
  const replayed = replayProgressiveBoard(config, stamps);
  return boardToGeneratedMap(config, replayed.board, replayed.catalog);
}

export function generateProgressiveMapByIndex(
  mapIndex: number,
  stamps: ProgressiveStamp[] = [],
  maps: MapsContent = defaultMaps,
): GeneratedMap | null {
  const config = progressiveConfigForIndex(mapIndex, maps);
  if (!config) return null;
  return generateProgressiveMap(config, stamps);
}

// Normal indices stay on the cached generator. Progressive indices rebuild the
// seeded start (placements are applied by the caller, not here). The maps
// catalog selects which world's level configs / progressive variants resolve.
export function resolveGeneratedMap(mapIndex: number, maps: MapsContent = defaultMaps): GeneratedMap {
  if (isProgressiveMapIndex(mapIndex)) {
    const map = generateProgressiveMapByIndex(mapIndex, [], maps);
    if (!map) throw new Error(`Progressive map ${mapIndex} is not configured`);
    return map;
  }
  return getMap(mapIndex, maps);
}
