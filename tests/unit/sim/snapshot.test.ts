// @ts-nocheck
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import {
  createTestPersistState,
  createTestThemeBundle,
  MockHostBindings,
  mockDefaultTheme,
} from "../../helpers/mock-stores";

function makeEngine() {
  const engine = new GameEngine(
    createTestPersistState(),
    createTestThemeBundle(mockDefaultTheme),
    new MockHostBindings(),
    0,
  );
  engine.loadMap(0);
  return engine;
}

function buildTowerOnValidTile(engine: GameEngine) {
  const grid = engine.runState.grid;
  for (let x = 0; x < grid.width; x++) {
    for (let y = 0; y < grid.height; y++) {
      if (grid.canBuild(x, y)) {
        const tower = engine.towerManager.build("basic", x, y, engine.persistState, grid);
        if (tower) return tower;
      }
    }
  }
  throw new Error("no buildable tile found");
}

describe("SnapshotSerializer (Phase 5)", () => {
  it("omits physics debug lines unless debugPhysicsEnabled is set", () => {
    const engine = makeEngine();
    const snap = buildSnapshot(engine, 0);
    expect(snap.debugPhysics).toBeNull();
  });

  it("ships wave-top towers ranked by previous-wave damage", () => {
    const engine = makeEngine();
    const first = buildTowerOnValidTile(engine);
    first.waveDamage = 50;
    const second = buildTowerOnValidTile(engine);
    second.waveDamage = 20;
    engine.simSeconds = 12;
    engine.onWaveStart(2);
    const snap = buildSnapshot(engine, 0);
    expect(snap.meta.waveTopTowers).toEqual([
      { towerId: first.id, rank: 1, damage: 50, simSeconds: 12 },
      { towerId: second.id, rank: 2, damage: 20, simSeconds: 12 },
    ]);
  });

  it("ships navMeshCorridor and physics debug lines on the first snapshot", () => {
    const engine = makeEngine();
    engine.debugPhysicsEnabled = true;
    const snap = buildSnapshot(engine, 0);
    expect(snap.navMeshCorridor).not.toBeNull();
    expect(snap.navMeshCorridor!.positions.length).toBeGreaterThan(0);
    expect(snap.navMeshCorridor!.indices.length).toBeGreaterThan(0);
    expect(snap.debugPhysics).not.toBeNull();
    expect(snap.debugPhysics!.vertices.length).toBeGreaterThan(0);
  });

  it("builds a complete snapshot from a live engine", () => {
    const engine = makeEngine();
    const grid = engine.runState.grid;
    buildTowerOnValidTile(engine);
    const enemy = new Enemy("boss", 2, 0, grid, 1, 0, engine.themeBundle.active, null);
    engine.enemyManager.enemies.push(enemy);

    const snap = buildSnapshot(engine, 7);

    expect(snap.schemaVersion).toBe(1);
    expect(snap.lastAppliedCommandId).toBe(7);
    expect(snap.frameId).toBeGreaterThan(0);
    expect(snap.meta.gold).toBe(engine.runState.gold);
    expect(snap.meta.baseHealth).toBe(engine.runState.baseHealth);
    expect(snap.meta.mapIndex).toBe(0);
    expect(snap.towers.length).toBe(1);
    expect(snap.enemies.length).toBe(1);
    expect(snap.projectiles).toBeInstanceOf(Array);
    // Finding 7: particles are no longer serialized in the snapshot. The worker
    // ships sparse spawn requests (present only when non-empty) via particleSpawns.
    expect(snap.particles).toBeUndefined();
    expect(snap.particleSpawns).toBeUndefined();
    expect(snap.spawnStates.length).toBe(grid.spawns.length);
    expect(typeof snap.spawnStates[0].pendingCount).toBe("number");
  });

  it("carries expected entity fields", () => {
    const engine = makeEngine();
    const grid = engine.runState.grid;
    const tower = buildTowerOnValidTile(engine);
    // Finding 1a: derived fields are shipped only for the selected tower.
    engine.runState.selectedTowerId = String(tower.id);
    const enemy = new Enemy("boss", 2, 0, grid, 1, 0, engine.themeBundle.active, null);
    engine.enemyManager.enemies.push(enemy);

    const snap = buildSnapshot(engine, 0);
    const e = snap.enemies[0];
    expect(e.type).toBe("boss");
    expect(e.isBoss).toBe(true);
    expect(e.radius).toBeGreaterThan(0);
    expect(e.x).toBe(enemy.x);
    expect(e.angle).toBe(enemy.moveAngle);
    expect(e.statusEffects).toBeInstanceOf(Array);

    const t = snap.towers.find((tw) => tw.id === String(tower.id))!;
    expect(t.type).toBe("basic");
    expect(t.color).toBeTruthy();
    expect(t.sellValue).toBeGreaterThan(0);
    expect(t.canUpgrade).toBeTruthy();
    expect(t.stats).toBeTruthy();
    expect(t.animation).toBeTruthy();
  });

  it("omits derived fields on non-selected towers", () => {
    const engine = makeEngine();
    buildTowerOnValidTile(engine);
    // Finding 1a: non-selected towers must NOT carry the expensive derived
    // fields — they are computed only for the selected tower.
    const snap = buildSnapshot(engine, 0);
    const t = snap.towers[0];
    expect(t.sellValue).toBeUndefined();
    expect(t.canUpgrade).toBeUndefined();
    expect(t.stats).toBeUndefined();
    expect(t.placedAt).toBe(0);
  });

  it("reflects engine mutations in subsequent snapshots", () => {
    const engine = makeEngine();
    const first = buildSnapshot(engine, 1);
    engine.runState.gold = 999;
    const second = buildSnapshot(engine, 2);

    expect(first.meta.gold).not.toBe(999);
    expect(second.meta.gold).toBe(999);
    expect(second.frameId).toBe(first.frameId + 1);
  });

  it("produces an independent copy of scalar state (no shared mutation)", () => {
    const engine = makeEngine();
    const snap = buildSnapshot(engine, 0);
    const originalGold = snap.meta.gold;
    engine.runState.gold = originalGold + 50;
    // Mutating the engine after snapshot must not retroactively change the snapshot.
    expect(snap.meta.gold).toBe(originalGold);
  });

  it("emits empty lightning/stun effects for a fresh (paused) engine", () => {
    const engine = makeEngine();
    const snap = buildSnapshot(engine, 0);
    expect(snap.lightningEffects).toHaveLength(0);
    expect(snap.stunEffects).toHaveLength(0);
  });

  it("consumes ephemeral lightning/stun effects so a paused tick does not replay them", () => {
    const engine = makeEngine();
    const enemy = engine.enemyManager.spawn("minion", 1, 0, 1);
    engine.projectileManager.fireLightning({
      originX: 100,
      originY: 200,
      damage: 4,
      towerLevel: 1,
      targetId: enemy.id,
      stunDuration: 0.1,
    });

    const first = buildSnapshot(engine, 0);
    expect(first.lightningEffects.length).toBeGreaterThan(0);
    expect(first.stunEffects.length).toBeGreaterThan(0);

    // Without an intervening update(), the effects must be consumed and blank —
    // this guards against perpetual lightning while the game is paused.
    const second = buildSnapshot(engine, 0);
    expect(second.lightningEffects).toHaveLength(0);
    expect(second.stunEffects).toHaveLength(0);
  });
});
