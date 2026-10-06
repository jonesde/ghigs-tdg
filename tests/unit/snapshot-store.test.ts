/**
 * Regression test for SnapshotStore.selectedTower mirroring.
 *
 * The selected tower object reference is kept stable across ticks (to preserve
 * identity for TowerPanel's interval setup), but its mutable fields must be
 * refreshed through the reactive proxy so Vue dependency tracking fires. A raw
 * Object.assign on the cached underlying object updated the values but did NOT
 * trigger reactivity, leaving the Upgrade button (canUpgrade cost/level) stale
 * after an upgrade.
 *
 * Snapshots are produced only through the sanctioned serializer (buildSnapshot)
 * from a real GameEngine, never hand-built wire literals — engine/entity fields
 * are set as input fixtures.
 */

import { describe, expect, it, vi } from "vitest";
import { computed, nextTick, watch } from "vue";
import { GameState } from "@/sim/Constants.js";
import type { TowerSnapshot } from "@/sim/SimulationSnapshot.js";
import { SNAPSHOT_SCHEMA_VERSION } from "@/sim/SimulationSnapshot.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import { SnapshotStore } from "@/sim/SnapshotStore.js";
import { buildTestTower, createTestEngine, selectTestTower } from "../helpers/engine-snapshot";
import { createTestGameStore } from "../helpers/mock-stores";

let nextCommandId = 0;

describe("SnapshotStore selectedTower mirroring", () => {
  it("refreshes mutable fields through the reactive proxy after an upgrade", async () => {
    const gameStore = createTestGameStore();
    const store = new SnapshotStore(gameStore as never);
    const selected = () => gameStore.selectedTower as unknown as TowerSnapshot | null;

    const engine = createTestEngine();
    // Unlock upper levels so the tower can upgrade past the default max (2),
    // keeping canUpgrade.cost/nextLevel defined before and after the upgrade.
    engine.persistState.unlocked.basic!.levels[2] = true;
    engine.persistState.unlocked.basic!.levels[3] = true;
    const tower = buildTestTower(engine);
    selectTestTower(engine, tower);

    // First snapshot: freshly-built level 1 tower.
    store.apply(buildSnapshot(engine, nextCommandId++));
    const initialLevel = selected()?.level ?? 0;
    const initialCost = selected()?.canUpgrade?.cost ?? null;
    expect(initialLevel).toBe(1);
    expect(initialCost).not.toBeNull();

    // Track whether a dependent computed re-evaluates after the upgrade.
    let upgradeCostEvaluations = 0;
    const trackedUpgradeCost = computed(() => {
      upgradeCostEvaluations++;
      return selected()?.canUpgrade?.cost ?? null;
    });
    // Prime the computed + its reactive dependencies.
    expect(trackedUpgradeCost.value).toBe(initialCost);
    const initialEvaluations = upgradeCostEvaluations;

    // Second snapshot after a real upgrade (same selected tower id → the
    // SnapshotStore proxy-refresh branch under test runs).
    engine.runState.gold = 1_000_000;
    engine.upgradeSelected();
    store.apply(buildSnapshot(engine, nextCommandId++));
    await nextTick();

    // Values must reflect the latest snapshot...
    expect(selected()?.level).toBe(initialLevel + 1);
    expect(selected()?.canUpgrade?.nextLevel).toBe(initialLevel + 2);
    expect(selected()?.canUpgrade?.cost).not.toBe(initialCost);
    // ...and the dependent computed must have re-evaluated (reactivity fired),
    // not return the stale cached cost.
    expect(trackedUpgradeCost.value).toBe(selected()?.canUpgrade?.cost);
    expect(upgradeCostEvaluations).toBeGreaterThan(initialEvaluations);
  });

  it("notifies watchers on selected tower field changes", async () => {
    const gameStore = createTestGameStore();
    const store = new SnapshotStore(gameStore as never);

    const engine = createTestEngine();
    engine.persistState.unlocked.basic!.levels[2] = true;
    engine.persistState.unlocked.basic!.levels[3] = true;
    const tower = buildTestTower(engine);
    selectTestTower(engine, tower);

    store.apply(buildSnapshot(engine, nextCommandId++));
    const initialLevel = (gameStore.selectedTower as unknown as TowerSnapshot | null)?.level ?? 0;

    let sawLevel: number | null = null;
    const stop = watch(
      () => (gameStore.selectedTower as unknown as TowerSnapshot | null)?.level ?? null,
      (value) => {
        sawLevel = value;
      },
    );

    engine.runState.gold = 1_000_000;
    engine.upgradeSelected();
    store.apply(buildSnapshot(engine, nextCommandId++));
    await nextTick();

    expect(sawLevel).toBe(initialLevel + 1);
    stop();
  });

  it("persists previousWaveDamage across frames, not just the reset frame", () => {
    const gameStore = createTestGameStore();
    const store = new SnapshotStore(gameStore as never);
    const selected = () => gameStore.selectedTower as unknown as TowerSnapshot | null;

    const engine = createTestEngine();
    const tower = buildTestTower(engine);
    selectTestTower(engine, tower);

    // Frame A: tower deals 50 damage this wave. No reset yet → no previous wave.
    tower.waveDamage = 50;
    store.apply(buildSnapshot(engine, nextCommandId++));
    expect(selected()?.previousWaveDamage).toBeUndefined();

    // Frame B: wave starts, engine resets waveDamage to 0. Transition captured.
    tower.waveDamage = 0;
    store.apply(buildSnapshot(engine, nextCommandId++));
    expect(selected()?.previousWaveDamage).toBe(50);

    // Frame C: mid next wave (waveDamage climbing again). The value must persist
    // (previously it flashed 50 only on frame B, then reverted to 0).
    tower.waveDamage = 10;
    store.apply(buildSnapshot(engine, nextCommandId++));
    expect(selected()?.previousWaveDamage).toBe(50);
  });

  it("ignores a snapshot with a mismatched schemaVersion, keeps the previous, warns once", () => {
    const gameStore = createTestGameStore();
    const store = new SnapshotStore(gameStore as never);
    const engine = createTestEngine();

    const valid = buildSnapshot(engine, nextCommandId++);
    store.apply(valid);
    expect(store.get()).toBe(valid);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const mismatched = { ...buildSnapshot(engine, nextCommandId++), schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1 };
      store.apply(mismatched);
      store.apply(mismatched);
      expect(store.get()).toBe(valid);
      expect(gameStore.gold).toBe(valid.meta.gold);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("mirrors progressiveUndoAvailable from snapshot meta", () => {
    const gameStore = createTestGameStore();
    const store = new SnapshotStore(gameStore as never);
    const engine = createTestEngine();

    engine.progressivePlacementUndo = { stampCount: 0, offer: [0] };
    store.apply(buildSnapshot(engine, nextCommandId++));
    expect(gameStore.progressiveUndoAvailable).toBe(true);

    engine.progressivePlacementUndo = null;
    store.apply(buildSnapshot(engine, nextCommandId++));
    expect(gameStore.progressiveUndoAvailable).toBe(false);
  });

  it("does not rewrite waveCountdown when remaining/nextWave are numerically unchanged", () => {
    const gameStore = createTestGameStore();
    const store = new SnapshotStore(gameStore as never);
    const engine = createTestEngine();

    engine.runState.waveCountdown = { remaining: 5, nextWave: 3 };
    store.apply(buildSnapshot(engine, nextCommandId++));
    const firstCountdown = gameStore.waveCountdown;
    expect(firstCountdown).toEqual({ remaining: 5, nextWave: 3 });

    // A fresh equal object each tick must not produce a reactive write.
    engine.runState.waveCountdown = { remaining: 5, nextWave: 3 };
    store.apply(buildSnapshot(engine, nextCommandId++));
    expect(gameStore.waveCountdown).toBe(firstCountdown);

    engine.runState.waveCountdown = { remaining: 4, nextWave: 3 };
    store.apply(buildSnapshot(engine, nextCommandId++));
    expect(gameStore.waveCountdown).not.toBe(firstCountdown);
    expect(gameStore.waveCountdown).toEqual({ remaining: 4, nextWave: 3 });

    engine.runState.waveCountdown = null;
    store.apply(buildSnapshot(engine, nextCommandId++));
    expect(gameStore.waveCountdown).toBeNull();
  });

  it("re-mirrors mapCaches when a paid unlock flips unlocked with no hp or layout change", () => {
    const gameStore = createTestGameStore();
    const store = new SnapshotStore(gameStore as never);
    const engine = createTestEngine();
    const grid = engine.grid;
    const cache = engine.mapCaches[0];
    if (!grid || !cache) throw new Error("no cache");

    store.apply(buildSnapshot(engine, nextCommandId++));
    expect(gameStore.mapCaches.find((site) => site.id === cache.id)?.unlocked).toBe(false);

    const world = grid.tileToWorld(cache.tileX, cache.tileY);
    engine.runState.state = GameState.PLAYING;
    engine.runState.gold = 10_000;
    engine.handleClick(world.x, world.y);
    if (!engine.runState.bonusPicker) throw new Error("locked picker did not open");

    store.apply(buildSnapshot(engine, nextCommandId++));
    expect(gameStore.bonusPickerLocked).toBe(true);

    // The paid unlock changes only `unlocked` on the site: no hp, tile, or layout
    // move. The site signature must carry the flag or the mirror stays locked and
    // the player pays twice for a picker that never shows its cards.
    expect(engine.unlockCache()).toBe(true);
    store.apply(buildSnapshot(engine, nextCommandId++));

    expect(gameStore.mapCaches.find((site) => site.id === cache.id)?.unlocked).toBe(true);
    expect(gameStore.bonusPickerLocked).toBe(false);
  });

  it("resets the picker's keyboard cursor whenever a different picker is mirrored in", () => {
    const gameStore = createTestGameStore();
    const store = new SnapshotStore(gameStore as never);
    const engine = createTestEngine();
    const grid = engine.grid;
    const cache = engine.mapCaches[0];
    if (!grid || !cache) throw new Error("no cache");

    const world = grid.tileToWorld(cache.tileX, cache.tileY);
    engine.runState.state = GameState.PLAYING;
    engine.handleClick(world.x, world.y);
    store.apply(buildSnapshot(engine, nextCommandId++));
    expect(gameStore.bonusPicker?.id).toBe(cache.id);

    // The cursor is where the player left it inside the open picker.
    gameStore.selectBonusPickerOption(2);
    expect(gameStore.bonusPickerSelectedOption).toBe(2);
    store.apply(buildSnapshot(engine, nextCommandId++));
    expect(gameStore.bonusPickerSelectedOption).toBe(2);

    // Reopening the same site is a new choice list: the cursor goes back to the
    // first card, the same way the placement hold resets the block cursor.
    engine.dismissBonus();
    store.apply(buildSnapshot(engine, nextCommandId++));
    expect(gameStore.bonusPicker).toBeNull();
    expect(gameStore.bonusPickerSelectedOption).toBe(0);

    engine.handleClick(world.x, world.y);
    store.apply(buildSnapshot(engine, nextCommandId++));
    expect(gameStore.bonusPickerSelectedOption).toBe(0);
  });
});
