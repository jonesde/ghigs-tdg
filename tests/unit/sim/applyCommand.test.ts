import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "@/sim/applyCommand.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import { fixedDeltaSeconds } from "@/sim/stepBudget.js";
import {
  createTestMapThemeStore,
  createTestPersistState,
  createTestThemeBundle,
  MockHostBindings,
} from "../../helpers/mock-stores.js";
import { orderedPath } from "../../helpers/navmesh-test-utils.js";

describe("applyCommand llm:* commands (Phase 1 seam)", () => {
  let engine: GameEngine;
  let persistState: ReturnType<typeof createTestPersistState>;
  let mockHost: MockHostBindings;

  beforeEach(() => {
    createTestMapThemeStore();
    persistState = createTestPersistState();
    mockHost = new MockHostBindings();
    engine = new GameEngine(persistState, createTestThemeBundle(), mockHost, 0);
    engine.loadMap(0);
    engine.waveManager?.startNextWave();
    // Tick long enough for at least one enemy to spawn.
    for (let tick = 0; tick < 30; tick++) engine.update(fixedDeltaSeconds);
  });

  function firstEnemyId(): number {
    const enemy = engine.enemyManager!.enemies[0]!;
    return enemy.id;
  }

  it("llm:routeGroup with hold: true sets routingMode to 'hold'", () => {
    const enemyId = firstEnemyId();
    const enemy = engine.getEnemiesByIds([enemyId])[0]!;
    const holdTile = orderedPath(engine.grid!, 0)![3]!;
    const result = applyCommand(engine, {
      commandId: 0,
      type: "llm:routeGroup",
      enemyIds: [enemyId],
      hold: true,
      holdTile,
      waypoints: [],
    });
    expect(result).toBe(true);
    expect(enemy.routingMode).toBe("hold");
    // Consumer-visible ON-model state: the held enemy's holdWorld is the requested
    // hold tile's world point and it does not attack the base (it is parked, not
    // advancing). Physical arrival at the hold tile is owned by the DetourCrowd
    // agent and is not asserted here.
    const holdWorld = engine.grid!.tileToWorld(holdTile.x, holdTile.y);
    expect(enemy.holdWorld).not.toBeNull();
    expect(enemy.holdWorld!.x).toBeCloseTo(holdWorld.x, 5);
    expect(enemy.holdWorld!.y).toBeCloseTo(holdWorld.y, 5);
    expect(enemy.attackingBase).toBe(false);
  });

  it("llm:routeGroup with empty waypoints releases to default pathing", () => {
    const enemyId = firstEnemyId();
    const enemy = engine.getEnemiesByIds([enemyId])[0]!;
    enemy.applyRoute([orderedPath(engine.grid!, 0)![3]!], "hold");
    expect(enemy.routingMode).toBe("hold");
    const result = applyCommand(engine, {
      commandId: 0,
      type: "llm:routeGroup",
      enemyIds: [enemyId],
      hold: false,
      waypoints: [],
    });
    expect(result).toBe(true);
    expect(enemy.routingMode).toBe("default");
  });

  it("llm:routeGroup does not unlatch an enemy that is already attacking the base", () => {
    const enemyId = firstEnemyId();
    const enemy = engine.getEnemiesByIds([enemyId])[0]!;
    enemy.attackingBase = true;
    enemy.motionLock = "park";
    const result = applyCommand(engine, {
      commandId: 0,
      type: "llm:routeGroup",
      enemyIds: [enemyId],
      hold: false,
      waypoints: [],
    });
    expect(result).toBe(true);
    expect(enemy.attackingBase).toBe(true);
    expect(enemy.motionLock).toBe("park");
  });

  it("llm:routeGroup with a waypoint sets routingMode to 'route' with a non-null path", () => {
    const enemyId = firstEnemyId();
    const enemy = engine.getEnemiesByIds([enemyId])[0]!;
    const waypoint = orderedPath(engine.grid!, 0)![3]!;
    const result = applyCommand(engine, {
      commandId: 0,
      type: "llm:routeGroup",
      enemyIds: [enemyId],
      hold: false,
      waypoints: [waypoint],
    });
    expect(result).toBe(true);
    expect(enemy.routingMode).toBe("route");
    expect(enemy.routeWorld).not.toBeNull();
    // Consumer-visible: after routing, the enemy continues toward the base.
    const base = engine.grid!.getBase();
    const baseCenter = engine.grid!.tileToWorld(base.x, base.y);
    const distanceToBase = (e: typeof enemy) => Math.hypot(e.centerX - baseCenter.x, e.centerY - baseCenter.y);
    const startDistance = distanceToBase(enemy);
    // 400 ticks: map 0's route detours south before heading for the base, so the
    // enemy must cover the detour plus part of the east leg to net closer.
    for (let tick = 0; tick < 400; tick++) engine.update(fixedDeltaSeconds);
    expect(distanceToBase(enemy)).toBeLessThan(startDistance);
  });

  it("llm:setTargeting stores the targeting mode on the enemy", () => {
    const enemyId = firstEnemyId();
    const enemy = engine.getEnemiesByIds([enemyId])[0]!;
    const result = applyCommand(engine, {
      commandId: 0,
      type: "llm:setTargeting",
      enemyIds: [enemyId],
      mode: "strongest",
    });
    expect(result).toBe(true);
    expect(enemy.targetingMode).toBe("strongest");
  });

  it("llm:setTargeting default clears the stored mode", () => {
    const enemyId = firstEnemyId();
    const enemy = engine.getEnemiesByIds([enemyId])[0]!;
    enemy.targetingMode = "nearest";
    const result = applyCommand(engine, {
      commandId: 0,
      type: "llm:setTargeting",
      enemyIds: [enemyId],
      mode: "default",
    });
    expect(result).toBe(true);
    expect(enemy.targetingMode).toBeNull();
  });

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

  it("llm:siegeTower on a live tower sieges it and clears the engagement policy", () => {
    const enemyId = firstEnemyId();
    const enemy = engine.getEnemiesByIds([enemyId])[0]!;
    enemy.targetingMode = "strongest";
    const tower = buildTowerOnValidTile();
    const result = applyCommand(engine, {
      commandId: 0,
      type: "llm:siegeTower",
      enemyIds: [enemyId],
      towerTile: { x: tower.tileX, y: tower.tileY },
    });
    expect(result).toBe(true);
    expect(enemy.routingMode).toBe("siege");
    expect(enemy.siegeTower).toBe(tower);
    expect(enemy.targetingMode).toBeNull();
  });

  it("llm:siegeTower keeps the policy when the tower is missing", () => {
    const enemyId = firstEnemyId();
    const enemy = engine.getEnemiesByIds([enemyId])[0]!;
    enemy.targetingMode = "nearest";
    const result = applyCommand(engine, {
      commandId: 0,
      type: "llm:siegeTower",
      enemyIds: [enemyId],
      towerTile: { x: 0, y: 0 },
    });
    expect(result).toBe(true);
    expect(enemy.targetingMode).toBe("nearest");
    expect(enemy.routingMode).toBe("default");
  });

  it("llm:gridLayoutToggle flips engine.gridLayoutEnabled and returns false", () => {
    const before = engine.gridLayoutEnabled;
    const result = applyCommand(engine, { commandId: 0, type: "llm:gridLayoutToggle" });
    expect(result).toBe(false);
    expect(engine.gridLayoutEnabled).toBe(!before);
  });

  it("getEnemiesByIds returns only matching enemies, dropping unknown ids", () => {
    const enemyId = firstEnemyId();
    const matched = engine.getEnemiesByIds([enemyId, 99999]);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.id).toBe(enemyId);
    expect(engine.getEnemiesByIds([123456])).toHaveLength(0);
  });

  it("llm:routeGroup drops an unreachable waypoint but still routes the enemy to base", () => {
    const enemyId = firstEnemyId();
    const enemy = engine.getEnemiesByIds([enemyId])[0]!;
    const grid = engine.grid!;
    // A terrain tile whose four neighbors are all terrain cannot reach the path
    // network, so its leg is dropped. The final base leg (from the enemy's current
    // path tile) still succeeds, so the enemy routes to the base rather than freezing.
    let isolatedTile: { x: number; y: number } | null = null;
    for (let y = 0; y < grid.height && !isolatedTile; y++) {
      for (let x = 0; x < grid.width && !isolatedTile; x++) {
        if (grid.tiles[y]![x]!.type !== "terrain") continue;
        const neighbors = [
          { x: x + 1, y },
          { x: x - 1, y },
          { x, y: y + 1 },
          { x, y: y - 1 },
        ];
        const allTerrain = neighbors.every((n) =>
          n.x >= 0 && n.y >= 0 && n.x < grid.width && n.y < grid.height
            ? grid.tiles[n.y]![n.x]!.type === "terrain"
            : true,
        );
        if (allTerrain) isolatedTile = { x, y };
      }
    }
    expect(isolatedTile).not.toBeNull();
    const result = applyCommand(engine, {
      commandId: 0,
      type: "llm:routeGroup",
      enemyIds: [enemyId],
      hold: false,
      waypoints: [isolatedTile!],
    });
    expect(result).toBe(true);
    // The unreachable leg is skipped; the enemy still advances toward the base.
    expect(enemy.routingMode).toBe("route");
    expect(enemy.routeWorld).not.toBeNull();
    const base = engine.grid!.getBase();
    const baseCenter = engine.grid!.tileToWorld(base.x, base.y);
    const distanceToBase = (enemyRef: typeof enemy) =>
      Math.hypot(enemyRef.centerX - baseCenter.x, enemyRef.centerY - baseCenter.y);
    const startDistance = distanceToBase(enemy);
    // 400 ticks: map 0's route detours south before heading for the base, so the
    // enemy must cover the detour plus part of the east leg to net closer.
    for (let tick = 0; tick < 400; tick++) engine.update(fixedDeltaSeconds);
    expect(distanceToBase(enemy)).toBeLessThan(startDistance);
  });

  it("llm:routeGroup drops an unreachable leg but still routes the survivors", () => {
    const enemyId = firstEnemyId();
    const enemy = engine.getEnemiesByIds([enemyId])[0]!;
    const grid = engine.grid!;
    // A reachable path-tile waypoint followed by an unreachable terrain waypoint:
    // the second leg is dropped, the first leg routes the enemy to the reachable tile.
    let isolatedTile: { x: number; y: number } | null = null;
    for (let y = 0; y < grid.height && !isolatedTile; y++) {
      for (let x = 0; x < grid.width && !isolatedTile; x++) {
        if (grid.tiles[y]![x]!.type !== "terrain") continue;
        const neighbors = [
          { x: x + 1, y },
          { x: x - 1, y },
          { x, y: y + 1 },
          { x, y: y - 1 },
        ];
        const allTerrain = neighbors.every((n) =>
          n.x >= 0 && n.y >= 0 && n.x < grid.width && n.y < grid.height
            ? grid.tiles[n.y]![n.x]!.type === "terrain"
            : true,
        );
        if (allTerrain) isolatedTile = { x, y };
      }
    }
    expect(isolatedTile).not.toBeNull();
    const reachableWaypoint = orderedPath(grid, 0)![2]!;
    const result = applyCommand(engine, {
      commandId: 0,
      type: "llm:routeGroup",
      enemyIds: [enemyId],
      hold: false,
      waypoints: [reachableWaypoint, isolatedTile!],
    });
    expect(result).toBe(true);
    expect(enemy.routingMode).toBe("route");
    expect(enemy.routeWorld).not.toBeNull();
  });

  function spawnFresh(spawnIndex: number, wave: number) {
    const enemy = engine.enemyManager!.spawn("minion", 1, spawnIndex, wave);
    expect(enemy).not.toBeNull();
    return enemy!;
  }

  it("llm:setSpawnOrder holds the next spawn on its own tile and leaves enemies already alive", () => {
    const living = engine.enemyManager!.enemies[0]!;
    const livingMode = living.routingMode;
    applyCommand(engine, { commandId: 0, type: "llm:setSpawnOrder", hold: true });
    expect(living.routingMode).toBe(livingMode);
    const enemy = spawnFresh(0, 4);
    const spawn = engine.grid!.spawns[0]!;
    expect(enemy.wave).toBe(4);
    expect(enemy.spawnIndex).toBe(0);
    expect(enemy.routingMode).toBe("hold");
    expect(enemy.holdWorld).toEqual(engine.grid!.tileToWorld(spawn.x, spawn.y));
    const snapshot = buildSnapshot(engine, 0);
    expect(snapshot.meta.spawnOrders).toEqual([{ hold: true }]);
    expect(snapshot.meta.spawns?.[0]).toEqual({ spawnIndex: 0, x: spawn.x, y: spawn.y });
    expect(snapshot.enemies.find((entry) => entry.id === enemy.id)?.wave).toBe(4);
  });

  it("a per-spawn slot replaces the default and does not apply to another index", () => {
    const spawn = engine.grid!.spawns[0]!;
    applyCommand(engine, { commandId: 0, type: "llm:setSpawnOrder", hold: true, targetingMode: "base" });
    applyCommand(engine, {
      commandId: 0,
      type: "llm:setSpawnOrder",
      spawnIndex: 0,
      hold: true,
      holdTile: { x: spawn.x, y: spawn.y },
    });
    const onZero = spawnFresh(0, 2);
    expect(onZero.routingMode).toBe("hold");
    expect(onZero.targetingMode).toBeNull();
    expect(onZero.holdWorld).toEqual(engine.grid!.tileToWorld(spawn.x, spawn.y));
    applyCommand(engine, {
      commandId: 0,
      type: "llm:setSpawnOrder",
      spawnIndex: 7,
      hold: true,
      holdTile: { x: spawn.x + 3, y: spawn.y + 3 },
    });
    expect(engine.enemyManager!.listSpawnOrders()).toEqual([
      { hold: true, targetingMode: "base" },
      { spawnIndex: 0, hold: true, holdTile: { x: spawn.x, y: spawn.y } },
      { spawnIndex: 7, hold: true, holdTile: { x: spawn.x + 3, y: spawn.y + 3 } },
    ]);
    if (engine.grid!.spawns.length > 1) {
      const onOther = spawnFresh(1, 2);
      const otherSpawn = engine.grid!.spawns[1]!;
      expect(onOther.routingMode).toBe("hold");
      expect(onOther.targetingMode).toBe("base");
      expect(onOther.holdWorld).toEqual(engine.grid!.tileToWorld(otherSpawn.x, otherSpawn.y));
    }
  });

  it("keeps targetingMode after releaseHeld and filters by wave and spawnIndex", () => {
    applyCommand(engine, { commandId: 0, type: "llm:setSpawnOrder", hold: true, targetingMode: "base" });
    const waveThree = spawnFresh(0, 3);
    const waveFour = spawnFresh(0, 4);
    waveFour.spawnIndex = 1;
    expect(waveThree.targetingMode).toBe("base");
    applyCommand(engine, { commandId: 0, type: "llm:releaseHeld", wave: 3 });
    expect(waveThree.routingMode).toBe("default");
    expect(waveThree.targetingMode).toBe("base");
    expect(waveFour.routingMode).toBe("hold");
    applyCommand(engine, { commandId: 0, type: "llm:releaseHeld", spawnIndex: 1 });
    expect(waveFour.routingMode).toBe("default");
    expect(waveFour.targetingMode).toBe("base");
  });

  it("sieges a live tower from the spawn order and leaves default pathing when the tower is gone", () => {
    const tower = buildTowerOnValidTile();
    applyCommand(engine, {
      commandId: 0,
      type: "llm:setSpawnOrder",
      towerTile: { x: tower.tileX, y: tower.tileY },
      targetingMode: "strongest",
    });
    const sieging = spawnFresh(0, 1);
    expect(sieging.routingMode).toBe("siege");
    expect(sieging.siegeTower).toBe(tower);
    expect(sieging.targetingMode).toBeNull();
    applyCommand(engine, { commandId: 0, type: "llm:setSpawnOrder", clear: true });
    // A tower tile with no live tower leaves default pathing. It must be in-bounds:
    // out-of-bounds tiles are rejected at intake, so "gone" is expressed with a
    // real tile (a spawn can never host a tower).
    const emptyTile = engine.grid!.spawns[0]!;
    applyCommand(engine, { commandId: 0, type: "llm:setSpawnOrder", towerTile: { x: emptyTile.x, y: emptyTile.y } });
    const walking = spawnFresh(0, 1);
    expect(walking.routingMode).toBe("default");
    expect(engine.enemyManager!.listSpawnOrders()).toEqual([{ towerTile: { x: emptyTile.x, y: emptyTile.y } }]);
  });

  it("clear drops the default and every per-spawn slot before the next spawn", () => {
    applyCommand(engine, { commandId: 0, type: "llm:setSpawnOrder", hold: true });
    applyCommand(engine, { commandId: 0, type: "llm:setSpawnOrder", spawnIndex: 0, hold: true });
    applyCommand(engine, { commandId: 0, type: "llm:setSpawnOrder", clear: true });
    const enemy = spawnFresh(0, 1);
    expect(enemy.routingMode).toBe("default");
    expect(engine.enemyManager!.listSpawnOrders()).toEqual([]);
  });
});
