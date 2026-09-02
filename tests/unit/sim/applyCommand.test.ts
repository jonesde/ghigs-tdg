import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "@/sim/applyCommand.js";
import { GameEngine } from "@/sim/GameEngine.js";
import {
  createTestMapThemeStore,
  createTestPersistState,
  createTestThemeBundle,
  MockHostBindings,
} from "../../helpers/mock-stores.js";
import { orderedPath } from "../../helpers/navmesh-test-utils.js";

const FIXED_DT = 1 / 60;

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
    for (let tick = 0; tick < 30; tick++) engine.update(FIXED_DT);
  });

  function firstEnemyId(): number {
    const enemy = engine.enemyManager!.enemies[0]!;
    return enemy.id;
  }

  it("llm:routeGroup with hold: true sets routingMode to 'hold'", () => {
    const enemyId = firstEnemyId();
    const enemy = engine.getEnemiesByIds([enemyId])[0]!;
    const holdTile = orderedPath(engine.grid!, 0)[3]!;
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
    enemy.applyRoute([orderedPath(engine.grid!, 0)[3]!], "hold");
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
    const waypoint = orderedPath(engine.grid!, 0)[3]!;
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
    for (let tick = 0; tick < 200; tick++) engine.update(FIXED_DT);
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
    for (let tick = 0; tick < 200; tick++) engine.update(FIXED_DT);
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
    const reachableWaypoint = orderedPath(grid, 0)[2]!;
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
});
