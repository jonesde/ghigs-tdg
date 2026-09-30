// @ts-nocheck
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { WorkerParticleSpawner } from "@/sim/ParticleSystem.js";
import { SNAPSHOT_SCHEMA_VERSION } from "@/sim/SimulationSnapshot.js";
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
    undefined,
    new WorkerParticleSpawner(),
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
    // Drain the tower-placement particle burst so this tick is a quiet one; the
    // sparse-effects contract is asserted by the dedicated tests below.
    engine.particleSpawner.consumeSpawns();

    const snap = buildSnapshot(engine, 7);

    expect(snap.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
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
    // Animation shipping (Block D2): frame payloads are no longer serialized;
    // the render resolves timing from the active theme by type.
    expect(e.walking).toBeUndefined();
    expect(e.hitReaction).toBeUndefined();
    expect(e.attackAnimation).toBeUndefined();

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

  it("omits lightning/stun/particle effects entirely on a quiet tick", () => {
    const engine = makeEngine();
    const snap = buildSnapshot(engine, 0);
    expect(snap.lightningEffects).toBeUndefined();
    expect(snap.stunEffects).toBeUndefined();
    expect(snap.particleSpawns).toBeUndefined();
  });

  it("includes lightning/stun/particle effects when the buffers are non-empty", () => {
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
    engine.particleSpawner.spawn(10, 20, "#ffffff", 3, { speed: 30, life: 0.2 });

    const snap = buildSnapshot(engine, 0);
    expect(snap.lightningEffects!.length).toBeGreaterThan(0);
    expect(snap.stunEffects!.length).toBeGreaterThan(0);
    expect(snap.particleSpawns!.length).toBeGreaterThan(0);
  });

  it("does not consume effects at build time; an explicit consume clears the buffers", () => {
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
    engine.particleSpawner.spawn(10, 20, "#ffffff", 3, { speed: 30, life: 0.2 });

    // Double build in one tick (terminal/test paths) must see identical effects:
    // nothing is consumed until WorkerEntry consumes after a successful post.
    const first = buildSnapshot(engine, 0);
    const second = buildSnapshot(engine, 0);
    expect(second.lightningEffects).toEqual(first.lightningEffects);
    expect(second.stunEffects).toEqual(first.stunEffects);
    expect(second.particleSpawns).toEqual(first.particleSpawns);

    // The explicit post-delivery consume (WorkerEntry.consumeDeliveredEffects)
    // drains them; the next build ships nothing.
    engine.projectileManager.consumeRenderVisualEffects();
    expect(engine.particleSpawner.consumeSpawns()).not.toBeUndefined();

    const third = buildSnapshot(engine, 0);
    expect(third.lightningEffects).toBeUndefined();
    expect(third.stunEffects).toBeUndefined();
    expect(third.particleSpawns).toBeUndefined();
  });

  it("memoizes the gridLayout array per run and rebuilds it on the next run", () => {
    const engine = makeEngine();
    const first = buildSnapshot(engine, 0);
    const second = buildSnapshot(engine, 0);
    expect(first.gridLayout).toBeDefined();
    // Same run: the exact same array reference is reused (no per-tick rebuild).
    expect(second.gridLayout).toBe(first.gridLayout);

    // A (re)load bumps runId; the cache is invalidated and rebuilt with equal content.
    engine.loadMap(0);
    const third = buildSnapshot(engine, 0);
    expect(third.gridLayout).not.toBe(first.gridLayout);
    expect(third.gridLayout).toEqual(first.gridLayout);
  });

  it("keeps the gridLayout gate: feed off ships nothing, re-enabling reuses the cache", () => {
    const engine = makeEngine();
    const first = buildSnapshot(engine, 0);
    engine.gridLayoutEnabled = false;
    expect(buildSnapshot(engine, 0).gridLayout).toBeUndefined();
    engine.gridLayoutEnabled = true;
    expect(buildSnapshot(engine, 0).gridLayout).toBe(first.gridLayout);
  });
});
