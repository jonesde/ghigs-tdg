/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { MAP_GEM_MULTIPLIERS, TOTAL_MAPS } from "@/sim/Constants.js";
import { Enemy, resetEnemyId } from "@/sim/enemies/Enemy.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap, mulberry32 } from "@/sim/grid/Map.js";
import {
  type BlockEdge,
  type BlockSite,
  type BlockTemplate,
  boardToGeneratedMap,
  chooseAdjacentSite,
  commitPlacement,
  createProgressiveBoard,
  drawBlockOffer,
  gemMultiplierForRegionLevel,
  generateProgressiveCatalog,
  generateProgressiveMap,
  generateProgressiveMapByIndex,
  legalSites,
  nextUsableRotation,
  offerHasAlternative,
  type PlacedBlock,
  type ProgressiveBoard,
  type ProgressiveConfig,
  placementExtendsOpening,
  placementLegal,
  progressiveConfigForIndex,
  progressiveConfigFromMap,
  progressiveUnlockMapIndex,
  replayProgressiveBoard,
  rotatedMouths,
  sitesAtRotation,
  templateCanExtendOpening,
} from "@/sim/grid/ProgressiveMap.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { createDefaultPersistState, maybeUnlockNextMap } from "@/sim/PersistState.js";
import { tryRefundGeneral, tryUnlockGeneral } from "@/sim/towers/SkillTree.js";
import { WaveManager } from "@/sim/waves/WaveManager.js";

const EDGE_DELTA: Record<BlockEdge, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};
const OPPOSITE_EDGE: Record<BlockEdge, BlockEdge> = { N: "S", E: "W", S: "N", W: "E" };

function configFor(entryCount: number, seed = 900001): ProgressiveConfig {
  return { regionId: 0, level: entryCount === 4 ? 12 : 1, entryCount, seed };
}

function placed(
  templateIndex: number,
  rotation: number,
  blockX: number,
  blockY: number,
  entryEdges: BlockEdge[] = [],
): PlacedBlock {
  return {
    kind: templateIndex < 0 ? "base" : "catalog",
    templateIndex,
    rotation,
    blockX,
    blockY,
    fill: false,
    entryEdges,
    heightPattern: "slope",
    flatHeight: 1,
    peakCorner: 0,
  };
}

function emptyBoard(blocks: PlacedBlock[], spawns: ProgressiveBoard["spawns"] = []): ProgressiveBoard {
  return { blocks, spawns, nextSpawnId: spawns.reduce((max, spawn) => Math.max(max, spawn.id), 0) + 1 };
}

function rotationFacing(template: BlockTemplate, edge: BlockEdge): number {
  for (let rotation = 0; rotation < 4; rotation++) {
    if (rotatedMouths(template, rotation).includes(edge)) return rotation;
  }
  throw new Error(`template ${template.pattern} has no rotation with mouth ${edge}`);
}

const MOUTH_LOCAL: Record<BlockEdge, [number, number]> = { N: [2, 0], E: [4, 2], S: [2, 4], W: [0, 2] };

function pathTileKeys(template: BlockTemplate): Set<string> {
  const keys = new Set<string>();
  for (let localY = 0; localY < template.tiles.length; localY++) {
    for (let localX = 0; localX < (template.tiles[localY]?.length ?? 0); localX++) {
      if (template.tiles[localY]?.[localX]?.type === "path") keys.add(`${localX},${localY}`);
    }
  }
  return keys;
}

function expectOnePathComponent(template: BlockTemplate): void {
  const pathKeys = pathTileKeys(template);
  const firstMouth = template.mouths[0];
  if (!firstMouth) return;
  const [startX, startY] = MOUTH_LOCAL[firstMouth];
  const seen = new Set<string>([`${startX},${startY}`]);
  const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
  const neighborOffsets: Array<[number, number]> = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head]!;
    head += 1;
    for (const [offsetX, offsetY] of neighborOffsets) {
      const key = `${current.x + offsetX},${current.y + offsetY}`;
      if (!pathKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push({ x: current.x + offsetX, y: current.y + offsetY });
    }
  }
  expect(seen.size).toBe(pathKeys.size);
  for (const mouth of template.mouths) {
    const [mouthX, mouthY] = MOUTH_LOCAL[mouth];
    expect(seen.has(`${mouthX},${mouthY}`)).toBe(true);
  }
}

describe("progressive map catalog", () => {
  it("builds twelve templates with the new blocks in the two-opening entry group", () => {
    const catalog = generateProgressiveCatalog(900001);
    expect(catalog).toHaveLength(12);
    expect(catalog.map((template) => template.pattern)).toEqual([
      "straight",
      "straight",
      "straightJog",
      "elbowRight",
      "elbowLeft",
      "elbowRing",
      "tee",
      "tee",
      "plus",
      "plus",
      "terrain",
      "terrain",
    ]);
    expect(catalog.map((template) => template.open)).toEqual([
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
    ]);
    expect(catalog[0]!.mouths).toEqual(["N", "S"]);
    expect(catalog[2]!.mouths).toEqual(["N", "S"]);
    expect(catalog[3]!.mouths).toEqual(["N", "E"]);
    expect(catalog[4]!.mouths).toEqual(["N", "W"]);
    expect(catalog[5]!.mouths).toEqual(["N", "E"]);
    expect(catalog[6]!.mouths).toEqual(["N", "E", "S"]);
    expect(catalog[8]!.mouths).toEqual(["N", "E", "S", "W"]);
    expect(catalog[10]!.mouths).toEqual([]);
    for (const template of catalog) {
      for (const row of template.tiles) {
        for (const tile of row) {
          if (tile.type === "path") expect(tile.height).toBe(1);
          else {
            expect(tile.height).toBeGreaterThanOrEqual(1);
            expect(tile.height).toBeLessThanOrEqual(4);
          }
        }
      }
    }
    expect(catalog[0]!.tiles[0]![2]!.type).toBe("path");
    expect(catalog[0]!.tiles[0]![1]!.type).toBe("terrain");
    expect(catalog[1]!.tiles[2]![1]!.type).toBe("path");
    expect(catalog[1]!.tiles[0]![1]!.type).toBe("terrain");
    expect(catalog[3]!.tiles[2]![4]!.type).toBe("path");
    expect(catalog[3]!.tiles[2]![0]!.type).toBe("terrain");
    expect(catalog[4]!.tiles[2]![0]!.type).toBe("path");
    expect(catalog[4]!.tiles[2]![4]!.type).toBe("terrain");
    const sameHeight =
      catalog[10]!.heightPattern === catalog[11]!.heightPattern &&
      catalog[10]!.flatHeight === catalog[11]!.flatHeight &&
      catalog[10]!.peakCorner === catalog[11]!.peakCorner;
    expect(sameHeight).toBe(false);
  });

  it("jogs the straight block around a terrain center tile", () => {
    const catalog = generateProgressiveCatalog(900001);
    const jog = catalog[2]!;
    expect(pathTileKeys(jog)).toEqual(new Set(["2,4", "2,3", "1,3", "1,2", "1,1", "2,1", "2,0"]));
    expect(jog.tiles[2]![2]!.type).toBe("terrain");
    expectOnePathComponent(jog);
  });

  it("routes the ring elbow around a terrain center tile", () => {
    const catalog = generateProgressiveCatalog(900001);
    const ring = catalog[5]!;
    expect(pathTileKeys(ring)).toEqual(new Set(["2,0", "2,1", "1,1", "1,2", "1,3", "2,3", "3,3", "3,2", "4,2"]));
    expect(ring.tiles[2]![2]!.type).toBe("terrain");
    const ringNeighbors: Array<[number, number]> = [
      [2, 1],
      [2, 3],
      [1, 2],
      [3, 2],
    ];
    for (const [neighborX, neighborY] of ringNeighbors) {
      expect(ring.tiles[neighborY]?.[neighborX]?.type).toBe("path");
    }
    expectOnePathComponent(ring);
  });

  it("keeps every open block's carved center as terrain with a path around it", () => {
    const catalog = generateProgressiveCatalog(900001);
    const openTemplates = catalog.filter((template) => template.open);
    expect(openTemplates.map((template) => template.pattern)).toEqual(["straight", "elbowLeft", "tee", "plus"]);
    for (const template of openTemplates) {
      expect(template.tiles[2]![2]!.type).toBe("terrain");
      const openRing: Array<[number, number]> = [
        [1, 1],
        [2, 1],
        [3, 1],
        [3, 2],
        [3, 3],
        [2, 3],
        [1, 3],
        [1, 2],
      ];
      for (const [ringX, ringY] of openRing) {
        expect(template.tiles[ringY]?.[ringX]?.type).toBe("path");
      }
      expectOnePathComponent(template);
    }
  });

  it("grades every template with varied heights instead of repeated row patterns", () => {
    const catalog = generateProgressiveCatalog(900001);
    for (const template of catalog) {
      expect(["slope", "peak", "roughSlope", "scatter"]).toContain(template.heightPattern);
      const terrainHeights = new Set<number>();
      for (const row of template.tiles) {
        for (const tile of row) {
          if (tile.type === "terrain") terrainHeights.add(tile.height);
        }
      }
      expect(terrainHeights.size).toBeGreaterThan(1);
      const rowSignatures = new Set(
        template.tiles.map((row) =>
          JSON.stringify(row.filter((tile) => tile.type === "terrain").map((tile) => tile.height)),
        ),
      );
      expect(rowSignatures.size).toBeGreaterThanOrEqual(3);
    }
  });

  it("starts with one spawn per entry and attaches a two-opening block to each", () => {
    for (const entryCount of [1, 2, 3, 4]) {
      const started = createProgressiveBoard(configFor(entryCount));
      expect(started.board.blocks).toHaveLength(1 + entryCount);
      expect(started.board.spawns).toHaveLength(entryCount);
      expect(started.board.spawns.map((spawn) => spawn.id)).toEqual([1, 2, 3, 4].slice(0, entryCount));
      for (const block of started.board.blocks) {
        if (block.kind !== "catalog") continue;
        expect(block.templateIndex).toBeLessThan(6);
      }
    }
  });
});

describe("progressive placement", () => {
  it("accepts a mouth-to-mouth join and rejects a terrain block against a mouth", () => {
    const started = createProgressiveBoard(configFor(1));
    const spawn = started.board.spawns[0]!;
    const delta = EDGE_DELTA[spawn.edge];
    const facing = OPPOSITE_EDGE[spawn.edge];
    const straightRotation = rotationFacing(started.catalog[0]!, facing);
    expect(
      placementLegal(
        started.board,
        started.catalog,
        0,
        straightRotation,
        spawn.blockX + delta.x,
        spawn.blockY + delta.y,
      ),
    ).toBe(true);
    expect(placementLegal(started.board, started.catalog, 10, 0, spawn.blockX + delta.x, spawn.blockY + delta.y)).toBe(
      false,
    );
    const base = started.board.blocks[0]!;
    const blankEdge = (["N", "E", "S", "W"] as BlockEdge[]).find((edge) => !base.entryEdges.includes(edge))!;
    const blankDelta = EDGE_DELTA[blankEdge];
    expect(placementLegal(started.board, started.catalog, 10, 0, blankDelta.x, blankDelta.y)).toBe(true);
    expect(legalSites(started.board, started.catalog, 0).some((site) => site.blockX === 1 && site.blockY === 1)).toBe(
      false,
    );
  });

  it("moves one spawn along a straight and adds a spawn for a tee", () => {
    const started = createProgressiveBoard(configFor(1));
    const spawn = started.board.spawns[0]!;
    const delta = EDGE_DELTA[spawn.edge];
    const facing = OPPOSITE_EDGE[spawn.edge];
    const straight = commitPlacement(
      started.board,
      started.catalog,
      0,
      rotationFacing(started.catalog[0]!, facing),
      spawn.blockX + delta.x,
      spawn.blockY + delta.y,
      () => 0,
    );
    expect(straight).not.toBeNull();
    const moved = straight!.board.spawns.find((candidate) => candidate.id === spawn.id);
    expect(moved).toMatchObject({ blockX: spawn.blockX + delta.x, blockY: spawn.blockY + delta.y });
    expect(straight!.board.spawns).toHaveLength(1);

    const tee = commitPlacement(
      started.board,
      started.catalog,
      6,
      rotationFacing(started.catalog[6]!, facing),
      spawn.blockX + delta.x,
      spawn.blockY + delta.y,
      () => 0,
    );
    expect(tee).not.toBeNull();
    expect(tee!.board.spawns.map((candidate) => candidate.id).sort((left, right) => left - right)).toEqual([1, 2]);
  });

  it("drops both spawns when one block bridges two mouths", () => {
    const catalog = generateProgressiveCatalog(1);
    const board = emptyBoard(
      [placed(0, 1, -1, 0), placed(0, 0, 0, -1)],
      [
        { id: 1, blockX: -1, blockY: 0, edge: "E", fixed: false },
        { id: 2, blockX: 0, blockY: -1, edge: "S", fixed: false },
      ],
    );
    const bridged = commitPlacement(board, catalog, 3, 3, 0, 0, () => 0);
    expect(bridged).not.toBeNull();
    expect(bridged!.board.spawns).toEqual([]);
  });

  it("fills a sealed hole, fixes a single mouth, and leaves a two-mouth hole empty", () => {
    const catalog = generateProgressiveCatalog(1);
    const ring = [placed(10, 0, 1, -1), placed(10, 0, 1, 1), placed(10, 0, 2, -1), placed(10, 0, 2, 1)];
    const sealed = commitPlacement(emptyBoard([placed(-1, 0, 0, 0), ...ring]), catalog, 10, 0, 2, 0, () => 0);
    expect(sealed!.added.some((block) => block.fill && block.blockX === 1 && block.blockY === 0)).toBe(true);

    const oneMouth = commitPlacement(
      emptyBoard([placed(-1, 0, 0, 0, ["E"]), ...ring], [{ id: 1, blockX: 0, blockY: 0, edge: "E", fixed: false }]),
      catalog,
      10,
      0,
      2,
      0,
      () => 0,
    );
    expect(oneMouth!.board.spawns).toEqual([{ id: 1, blockX: 0, blockY: 0, edge: "E", fixed: true }]);

    const twoMouth = commitPlacement(
      emptyBoard(
        [
          placed(-1, 0, 0, 0, ["E"]),
          placed(0, 0, 1, -1),
          placed(10, 0, 1, 1),
          placed(10, 0, 2, -1),
          placed(10, 0, 2, 1),
        ],
        [{ id: 1, blockX: 0, blockY: 0, edge: "E", fixed: false }],
      ),
      catalog,
      10,
      0,
      2,
      0,
      () => 0,
    );
    expect(twoMouth!.added.every((block) => !block.fill)).toBe(true);

    const bay = commitPlacement(emptyBoard([placed(-1, 0, 0, 0)]), catalog, 10, 0, 0, 1, () => 0);
    expect(bay!.added).toHaveLength(1);
  });

  it("keeps a fixed spawn fixed when a later path connects to it", () => {
    const catalog = generateProgressiveCatalog(1);
    const board = emptyBoard([placed(0, 0, 0, 0)], [{ id: 1, blockX: 0, blockY: 0, edge: "N", fixed: true }]);
    const extended = commitPlacement(board, catalog, 0, 0, 0, -1, () => 0);
    expect(extended!.board.spawns.find((spawn) => spawn.id === 1)).toMatchObject({
      blockX: 0,
      blockY: 0,
      edge: "N",
      fixed: true,
    });
    const replayed = replayProgressiveBoard(configFor(1), [
      { templateIndex: 10, rotation: 0, blockX: 1, blockY: 0, fill: true },
    ]);
    const before = replayed.board.spawns.find((spawn) => spawn.fixed);
    if (before) {
      const again = replayProgressiveBoard(configFor(1), [
        { templateIndex: 10, rotation: 0, blockX: 1, blockY: 0, fill: true },
        { templateIndex: 0, rotation: 0, blockX: before.blockX, blockY: before.blockY - 1, fill: false },
      ]);
      expect(again.board.spawns.find((spawn) => spawn.id === before.id)?.fixed).toBe(true);
    }
  });
});

describe("progressive world positions", () => {
  it("keeps the base at world (90, 90) and a closed elbow reachable", () => {
    const map = generateProgressiveMap(progressiveConfigForIndex(36)!);
    const grid = new Grid(map);
    expect(grid.tileToWorld(map.base.x, map.base.y)).toEqual({ x: 90, y: 90 });

    const catalog = generateProgressiveCatalog(1);
    const board = emptyBoard(
      [placed(-1, 0, 0, 0, ["N"]), placed(3, 1, 0, -1)],
      [{ id: 1, blockX: 0, blockY: -1, edge: "E", fixed: false }],
    );
    const elbowMap = boardToGeneratedMap({ regionId: 0, level: 1, entryCount: 1, seed: 1 }, board, catalog);
    const elbowGrid = new Grid(elbowMap);
    const builder = new NavMeshBuilder(elbowGrid);
    expect(builder.isSuccess()).toBe(true);
    const spawn = elbowMap.spawns[0]!;
    const spawnWorld = elbowGrid.tileToWorld(spawn.x, spawn.y);
    const baseWorld = elbowGrid.tileToWorld(elbowMap.base.x, elbowMap.base.y);
    const path = builder.findPath(spawnWorld, baseWorld);
    expect(path.length).toBeGreaterThan(0);
    builder.destroy();
  });

  it("leaves a normal map on a zero world origin", () => {
    const map = getMap(0);
    expect(map.originTileX).toBeUndefined();
    expect(map.originTileY).toBeUndefined();
    const grid = new Grid(map);
    expect(grid.worldOriginX).toBe(0);
    expect(grid.worldOriginY).toBe(0);
    expect(grid.worldToTile(90, 90)).toEqual({ x: 2, y: 2 });
    expect(grid.tileToWorld(2, 2)).toEqual({ x: 2 * 36 + 18, y: 2 * 36 + 18 });
    expect(map.tiles.some((row) => row.some((tile) => tile.type === "void"))).toBe(false);
  });

  it("keeps every spawn enemy at its spawn tile on a negative-origin board", () => {
    const map = generateProgressiveMapByIndex(TOTAL_MAPS)!;
    const grid = new Grid(map);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetEnemyId();
    try {
      for (let spawnIndex = 0; spawnIndex < map.spawns.length; spawnIndex++) {
        const enemy = new Enemy("minion", 1, spawnIndex, grid, 1);
        const spawn = map.spawns[spawnIndex]!;
        const expected = grid.tileToWorld(spawn.x, spawn.y);
        enemy.postPhysics(1 / 60);
        expect(enemy.x).toBe(expected.x);
        expect(enemy.y).toBe(expected.y);
      }
      expect(warned).not.toHaveBeenCalledWith(
        "Enemy escaped world bounds; clamping",
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    } finally {
      warned.mockRestore();
    }
  });
});

describe("progressive config recovery", () => {
  it("round-trips a custom config through the generated map", () => {
    const config: ProgressiveConfig = { regionId: 1, level: 7, entryCount: 3, seed: 424242 };
    expect(progressiveConfigFromMap(generateProgressiveMap(config))).toEqual(config);
  });

  it("recovers a catalog variant config from its generated map", () => {
    const config = progressiveConfigForIndex(37)!;
    expect(progressiveConfigFromMap(generateProgressiveMap(config))).toEqual(config);
  });

  it("returns null for maps without progressive fields", () => {
    expect(progressiveConfigFromMap(getMap(0))).toBeNull();
    expect(progressiveConfigFromMap(null)).toBeNull();
  });
});

describe("progressive economy", () => {
  it("uses the linked normal map's gem multiplier and level", () => {
    expect(gemMultiplierForRegionLevel(0, 1)).toBe(1);
    expect(gemMultiplierForRegionLevel(0, 12)).toBe(3);
    expect(gemMultiplierForRegionLevel(0, 1)).toBe(MAP_GEM_MULTIPLIERS[0]);
    expect(progressiveUnlockMapIndex(progressiveConfigForIndex(36)!)).toBe(0);
    expect(progressiveUnlockMapIndex(progressiveConfigForIndex(37)!)).toBe(4);
    const levelTwelve = generateProgressiveMap(progressiveConfigForIndex(39)!);
    expect(levelTwelve.level).toBe(12);
    const manager = new WaveManager(levelTwelve, {
      enemies: [],
      spawn: () => null,
      enqueueOrSpawn: () => undefined,
      releaseOnePending: () => undefined,
      hasPendingEnemies: () => false,
      getTotalPendingCount: () => 0,
      getPendingCountForSpawn: () => 0,
      getActiveEnemyCountForSpawn: () => 0,
      getEnemiesInRange: () => [],
    });
    expect(manager.generateWave(3)[0]!.level).toBe(13);
  });

  it("does not advance the campaign from a progressive clear and refunds the third choice", () => {
    const save = createDefaultPersistState();
    expect(maybeUnlockNextMap(save, "default", 36)).toBe(false);
    expect(save.themeProgress.default?.highestUnlockedMap ?? 0).toBe(0);
    save.gems = 100;
    expect(tryUnlockGeneral(save, "progressiveThirdChoice", 0).ok).toBe(true);
    expect(save.generalAddons.progressiveThirdChoice).toBe(0);
    expect(tryRefundGeneral(save, "progressiveThirdChoice", 0)).toMatchObject({ ok: true, gems: 100 });
    expect(save.gems).toBe(100);
    expect(save.generalAddons.progressiveThirdChoice).toBeNull();
  });
});

describe("progressive block offers", () => {
  function offerExtends(board: ProgressiveBoard, catalog: BlockTemplate[], offer: number[]): boolean {
    return offer.some((templateIndex) => templateCanExtendOpening(board, catalog, templateIndex));
  }

  it("reserves a template that can extend an opening", () => {
    const started = createProgressiveBoard(configFor(1));
    const spawn = started.board.spawns[0]!;
    const delta = EDGE_DELTA[spawn.edge];
    const facing = OPPOSITE_EDGE[spawn.edge];
    const rotation = rotationFacing(started.catalog[0]!, facing);
    expect(
      placementExtendsOpening(
        started.board,
        started.catalog,
        0,
        rotation,
        spawn.blockX + delta.x,
        spawn.blockY + delta.y,
      ),
    ).toBe(true);
    const random = mulberry32(1);
    for (let draw = 0; draw < 40; draw++) {
      const pair = drawBlockOffer(started.board, started.catalog, 2, random);
      const triple = drawBlockOffer(started.board, started.catalog, 3, random);
      expect(pair).toHaveLength(2);
      expect(triple).toHaveLength(3);
      expect(offerExtends(started.board, started.catalog, pair)).toBe(true);
      expect(offerExtends(started.board, started.catalog, triple)).toBe(true);
      expect(new Set(pair).size).toBe(pair.length);
      expect(new Set(triple).size).toBe(triple.length);
    }
    const biased = drawBlockOffer(started.board, started.catalog, 3, () => 0.99);
    expect(biased).toHaveLength(3);
    expect(offerExtends(started.board, started.catalog, biased)).toBe(true);
    expect(offerHasAlternative(started.board, started.catalog, 2, biased.slice(0, 2))).toBe(true);
  });

  it("fills from terrain when no template extends an opening", () => {
    const catalog = generateProgressiveCatalog(1);
    const board = emptyBoard([placed(10, 0, 0, 0)]);
    const offer = drawBlockOffer(board, catalog, 2, () => 0);
    expect(offer.length).toBeGreaterThan(0);
    expect(offer.every((templateIndex) => !templateCanExtendOpening(board, catalog, templateIndex))).toBe(true);
    expect(offerHasAlternative(board, catalog, 2, offer)).toBe(false);
  });

  it("skips quarter-turns with no site and moves to the nearest site on an axis", () => {
    const started = createProgressiveBoard(configFor(1));
    let skipped = false;
    for (let templateIndex = 0; templateIndex < started.catalog.length; templateIndex++) {
      const populated: number[] = [];
      const empty: number[] = [];
      for (let rotation = 0; rotation < 4; rotation++) {
        const sites = sitesAtRotation(started.board, started.catalog, templateIndex, rotation);
        if (sites.length > 0) populated.push(rotation);
        else empty.push(rotation);
      }
      const emptyRotation = empty[0];
      if (populated.length === 0 || emptyRotation === undefined) continue;
      const usable = nextUsableRotation(started.board, started.catalog, templateIndex, emptyRotation);
      expect(populated).toContain(usable);
      expect(empty).not.toContain(usable);
      skipped = true;
      break;
    }
    expect(skipped).toBe(true);

    const sites: BlockSite[] = [
      { rotation: 0, blockX: 0, blockY: 0 },
      { rotation: 0, blockX: 2, blockY: 0 },
      { rotation: 0, blockX: 0, blockY: 3 },
    ];
    expect(chooseAdjacentSite(sites, sites[0]!, "right")).toEqual(sites[1]);
    expect(chooseAdjacentSite(sites, sites[1]!, "right")).toEqual(sites[1]);
    expect(chooseAdjacentSite(sites, sites[0]!, "down")).toEqual(sites[2]);
  });
});
