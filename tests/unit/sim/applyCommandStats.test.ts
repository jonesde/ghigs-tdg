import { beforeEach, describe, expect, it } from "vitest";
import { applyCommandWithStats } from "@/sim/applyCommandStats.js";
import { GameEngine } from "@/sim/GameEngine.js";
import {
  createTestMapThemeStore,
  createTestPersistState,
  createTestThemeBundle,
  MockHostBindings,
} from "../../helpers/mock-stores.js";
import { orderedPath } from "../../helpers/navmesh-test-utils.js";

const FIXED_DT = 1 / 60;

describe("applyCommandWithStats (Block C parallel wrapper)", () => {
  let engine: GameEngine;
  let persistState: ReturnType<typeof createTestPersistState>;

  beforeEach(() => {
    createTestMapThemeStore();
    persistState = createTestPersistState();
    engine = new GameEngine(persistState, createTestThemeBundle(), new MockHostBindings(), 0);
    engine.loadMap(0);
    engine.waveManager?.startNextWave();
    for (let tick = 0; tick < 30; tick++) engine.update(FIXED_DT);
  });

  function firstEnemyId(): number {
    return engine.enemyManager!.enemies[0]!.id;
  }

  function buildTowerOnValidTile() {
    const grid = engine.grid!;
    for (let tileX = 0; tileX < grid.width; tileX++) {
      for (let tileY = 0; tileY < grid.height; tileY++) {
        if (!grid.canBuild(tileX, tileY)) continue;
        const tower = engine.towerManager!.build("basic", tileX, tileY, persistState, grid);
        if (tower) return tower;
      }
    }
    throw new Error("no buildable tile found");
  }

  it("counts unknown enemy ids as skipped without re-mutating", () => {
    const enemyId = firstEnemyId();
    const stats = applyCommandWithStats(engine, {
      commandId: 1,
      type: "llm:routeGroup",
      enemyIds: [enemyId, 99999],
      hold: true,
      holdTile: orderedPath(engine.grid!, 0)![3]!,
      waypoints: [],
    });
    expect(stats.mutated).toBe(true);
    expect(stats.applied).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.note).toBeUndefined();
    expect(engine.getEnemiesByIds([enemyId])[0]!.routingMode).toBe("hold");
  });

  it("reports all-skipped when no enemy id resolves", () => {
    const stats = applyCommandWithStats(engine, {
      commandId: 2,
      type: "llm:setTargeting",
      enemyIds: [123456, 99999],
      mode: "strongest",
    });
    expect(stats.mutated).toBe(true);
    expect(stats.applied).toBe(0);
    expect(stats.skipped).toBe(2);
  });

  it("adds the missing-tower note on siegeTower and still counts found enemies as applied", () => {
    const enemyId = firstEnemyId();
    const stats = applyCommandWithStats(engine, {
      commandId: 3,
      type: "llm:siegeTower",
      enemyIds: [enemyId, 99999],
      towerTile: { x: 0, y: 0 },
    });
    expect(stats.mutated).toBe(true);
    expect(stats.applied).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.note).toBe("tower missing/ghost — released to default");
    expect(engine.getEnemiesByIds([enemyId])[0]!.routingMode).toBe("default");
  });

  it("adds the ghost note on siegeTower against a ghosted tower", () => {
    const enemyId = firstEnemyId();
    const tower = buildTowerOnValidTile();
    tower.isGhost = true;
    const stats = applyCommandWithStats(engine, {
      commandId: 4,
      type: "llm:siegeTower",
      enemyIds: [enemyId],
      towerTile: { x: tower.tileX, y: tower.tileY },
    });
    expect(stats.applied).toBe(1);
    expect(stats.skipped).toBe(0);
    expect(stats.note).toBe("tower missing/ghost — released to default");
    expect(engine.getEnemiesByIds([enemyId])[0]!.routingMode).toBe("default");
  });

  it("sieges without a note when the tower is live", () => {
    const enemyId = firstEnemyId();
    const tower = buildTowerOnValidTile();
    const stats = applyCommandWithStats(engine, {
      commandId: 5,
      type: "llm:siegeTower",
      enemyIds: [enemyId],
      towerTile: { x: tower.tileX, y: tower.tileY },
    });
    expect(stats).toMatchObject({ mutated: true, applied: 1, skipped: 0 });
    expect(stats.note).toBeUndefined();
    expect(engine.getEnemiesByIds([enemyId])[0]!.routingMode).toBe("siege");
  });

  it("counts releaseHeld from the pre-apply held set", () => {
    const enemyId = firstEnemyId();
    const enemy = engine.getEnemiesByIds([enemyId])[0]!;
    enemy.applyRoute([orderedPath(engine.grid!, 0)![3]!], "hold");
    const stats = applyCommandWithStats(engine, { commandId: 6, type: "llm:releaseHeld" });
    expect(stats.mutated).toBe(true);
    expect(stats.applied).toBe(1);
    expect(stats.skipped).toBe(0);
    expect(enemy.routingMode).toBe("default");
  });

  it("maps mutated to applied 1/0 for non-enemy commands", () => {
    const pauseStats = applyCommandWithStats(engine, { commandId: 7, type: "action:togglePause" });
    expect(pauseStats).toMatchObject({ mutated: true, applied: 1, skipped: 0 });
    const orderStats = applyCommandWithStats(engine, { commandId: 8, type: "llm:setSpawnOrder", hold: true });
    expect(orderStats).toMatchObject({ mutated: true, applied: 1, skipped: 0 });
  });

  it("sets the feed explicitly via llm:setGridLayoutFeed with no visible mutation", () => {
    engine.gridLayoutEnabled = true;
    const offStats = applyCommandWithStats(engine, { commandId: 9, type: "llm:setGridLayoutFeed", enabled: false });
    expect(offStats).toMatchObject({ mutated: false, applied: 0, skipped: 0 });
    expect(engine.gridLayoutEnabled).toBe(false);
    const onStats = applyCommandWithStats(engine, { commandId: 10, type: "llm:setGridLayoutFeed", enabled: true });
    expect(engine.gridLayoutEnabled).toBe(true);
    expect(onStats.mutated).toBe(false);
  });

  it("keeps the deprecated toggle flip behavior for compat", () => {
    const before = engine.gridLayoutEnabled;
    const stats = applyCommandWithStats(engine, { commandId: 11, type: "llm:gridLayoutToggle" });
    expect(stats.mutated).toBe(false);
    expect(engine.gridLayoutEnabled).toBe(!before);
  });
});
