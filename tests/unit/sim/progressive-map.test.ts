/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { MAP_GEM_MULTIPLIERS } from "@/sim/Constants.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import {
  type BlockEdge,
  type BlockTemplate,
  boardToGeneratedMap,
  commitPlacement,
  createProgressiveBoard,
  gemMultiplierForMap,
  generateProgressiveCatalog,
  generateProgressiveMap,
  legalSites,
  type PlacedBlock,
  type ProgressiveBoard,
  type ProgressiveConfig,
  placementLegal,
  progressiveConfigForIndex,
  progressiveUnlockMapIndex,
  replayProgressiveBoard,
  rotatedMouths,
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
    heightPattern: "flat",
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

describe("progressive map catalog", () => {
  it("builds ten templates, two of each path pattern, with open and closed mouths", () => {
    const catalog = generateProgressiveCatalog(900001);
    expect(catalog).toHaveLength(10);
    expect(catalog.map((template) => template.pattern)).toEqual([
      "straight",
      "straight",
      "elbowRight",
      "elbowLeft",
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
      true,
      false,
      true,
      false,
      true,
      false,
      false,
    ]);
    expect(catalog[0]!.mouths).toEqual(["N", "S"]);
    expect(catalog[2]!.mouths).toEqual(["N", "E"]);
    expect(catalog[3]!.mouths).toEqual(["N", "W"]);
    expect(catalog[4]!.mouths).toEqual(["N", "E", "S"]);
    expect(catalog[6]!.mouths).toEqual(["N", "E", "S", "W"]);
    expect(catalog[8]!.mouths).toEqual([]);
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
    expect(catalog[2]!.tiles[2]![4]!.type).toBe("path");
    expect(catalog[2]!.tiles[2]![0]!.type).toBe("terrain");
    expect(catalog[3]!.tiles[2]![0]!.type).toBe("path");
    expect(catalog[3]!.tiles[2]![4]!.type).toBe("terrain");
    const sameHeight =
      catalog[8]!.heightPattern === catalog[9]!.heightPattern &&
      catalog[8]!.flatHeight === catalog[9]!.flatHeight &&
      catalog[8]!.peakCorner === catalog[9]!.peakCorner;
    expect(sameHeight).toBe(false);
  });

  it("starts with one spawn per entry and attaches a two-opening block to each", () => {
    for (const entryCount of [1, 2, 3, 4]) {
      const started = createProgressiveBoard(configFor(entryCount));
      expect(started.board.blocks).toHaveLength(1 + entryCount);
      expect(started.board.spawns).toHaveLength(entryCount);
      expect(started.board.spawns.map((spawn) => spawn.id)).toEqual([1, 2, 3, 4].slice(0, entryCount));
      for (const block of started.board.blocks) {
        if (block.kind !== "catalog") continue;
        expect(block.templateIndex).toBeLessThan(4);
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
    expect(placementLegal(started.board, started.catalog, 8, 0, spawn.blockX + delta.x, spawn.blockY + delta.y)).toBe(
      false,
    );
    const base = started.board.blocks[0]!;
    const blankEdge = (["N", "E", "S", "W"] as BlockEdge[]).find((edge) => !base.entryEdges.includes(edge))!;
    const blankDelta = EDGE_DELTA[blankEdge];
    expect(placementLegal(started.board, started.catalog, 8, 0, blankDelta.x, blankDelta.y)).toBe(true);
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
      4,
      rotationFacing(started.catalog[4]!, facing),
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
    const bridged = commitPlacement(board, catalog, 2, 3, 0, 0, () => 0);
    expect(bridged).not.toBeNull();
    expect(bridged!.board.spawns).toEqual([]);
  });

  it("fills a sealed hole, fixes a single mouth, and leaves a two-mouth hole empty", () => {
    const catalog = generateProgressiveCatalog(1);
    const ring = [placed(8, 0, 1, -1), placed(8, 0, 1, 1), placed(8, 0, 2, -1), placed(8, 0, 2, 1)];
    const sealed = commitPlacement(emptyBoard([placed(-1, 0, 0, 0), ...ring]), catalog, 8, 0, 2, 0, () => 0);
    expect(sealed!.added.some((block) => block.fill && block.blockX === 1 && block.blockY === 0)).toBe(true);

    const oneMouth = commitPlacement(
      emptyBoard([placed(-1, 0, 0, 0, ["E"]), ...ring], [{ id: 1, blockX: 0, blockY: 0, edge: "E", fixed: false }]),
      catalog,
      8,
      0,
      2,
      0,
      () => 0,
    );
    expect(oneMouth!.board.spawns).toEqual([{ id: 1, blockX: 0, blockY: 0, edge: "E", fixed: true }]);

    const twoMouth = commitPlacement(
      emptyBoard(
        [placed(-1, 0, 0, 0, ["E"]), placed(0, 0, 1, -1), placed(8, 0, 1, 1), placed(8, 0, 2, -1), placed(8, 0, 2, 1)],
        [{ id: 1, blockX: 0, blockY: 0, edge: "E", fixed: false }],
      ),
      catalog,
      8,
      0,
      2,
      0,
      () => 0,
    );
    expect(twoMouth!.added.every((block) => !block.fill)).toBe(true);

    const bay = commitPlacement(emptyBoard([placed(-1, 0, 0, 0)]), catalog, 8, 0, 0, 1, () => 0);
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
      { templateIndex: 8, rotation: 0, blockX: 1, blockY: 0, fill: true },
    ]);
    const before = replayed.board.spawns.find((spawn) => spawn.fixed);
    if (before) {
      const again = replayProgressiveBoard(configFor(1), [
        { templateIndex: 8, rotation: 0, blockX: 1, blockY: 0, fill: true },
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
      [placed(-1, 0, 0, 0, ["N"]), placed(2, 1, 0, -1)],
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
});

describe("progressive economy", () => {
  it("uses the linked normal map's gem multiplier and level", () => {
    expect(gemMultiplierForMap(36)).toBe(1);
    expect(gemMultiplierForMap(39)).toBe(3);
    expect(gemMultiplierForMap(0)).toBe(MAP_GEM_MULTIPLIERS[0]);
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
    expect(maybeUnlockNextMap(save, 36)).toBe(false);
    expect(save.highestUnlockedMap).toBe(0);
    save.gems = 100;
    expect(tryUnlockGeneral(save, "progressiveThirdChoice", 0).ok).toBe(true);
    expect(save.generalAddons.progressiveThirdChoice).toBe(0);
    expect(tryRefundGeneral(save, "progressiveThirdChoice", 0)).toMatchObject({ ok: true, gems: 100 });
    expect(save.gems).toBe(100);
    expect(save.generalAddons.progressiveThirdChoice).toBeNull();
  });
});
