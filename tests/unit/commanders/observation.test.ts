import { describe, expect, it } from "vitest";
import { buildObservation } from "@/commanders/observation.js";
import type { CommanderSnapshotSlice } from "@/commanders/protocol.js";
import type { EnemySnapshot, SnapshotMeta, SpawnStateSnapshot, TowerSnapshot } from "@/sim/SimulationSnapshot.js";

// Minimal fake slice fields — only what `buildObservation` reads. Cast to the
// real slice type so we exercise the pure projection without a live engine.
function fakeEnemy(id: number, x: number, y: number, hp: number, maxHp: number, level = 1) {
  return { id, x, y, level, hp, maxHp };
}

function fakeTower(tileX: number, tileY: number, health: number, maxHealth: number, level = 1) {
  return { tileX, tileY, level, health, maxHealth };
}

function fakeMeta(overrides: Partial<SnapshotMeta> = {}): SnapshotMeta {
  return {
    state: "playing",
    mapIndex: 0,
    baseHealth: 20,
    maxBaseHealth: 100,
    gold: 100,
    currentWave: 1,
    waveCountdown: null,
    timeScale: 1,
    selectedTowerId: null,
    selectedTowerType: null,
    runGemsEarned: 0,
    bossesKilledThisRun: 0,
    bossesReachedBaseThisRun: 0,
    lastScaledDt: 0,
    endScreenData: null,
    tileSize: 36,
    waveActive: true,
    remainingScheduledSpawns: 0,
    ...overrides,
  } as SnapshotMeta;
}

function makeSlice(partial: Partial<CommanderSnapshotSlice>): CommanderSnapshotSlice {
  return {
    gridLayout: undefined,
    enemies: [],
    towers: [],
    spawnStates: [],
    meta: fakeMeta(),
    ...partial,
  } as unknown as CommanderSnapshotSlice;
}

describe("buildObservation", () => {
  it("uses the slice gridLayout as the map when present", () => {
    const gridLayout = [
      [0, 1, 2],
      [3, 0, 1],
    ];
    const observation = buildObservation(makeSlice({ gridLayout }));
    expect(observation.map).toBe(gridLayout);
  });

  it("maps the map to undefined when gridLayout is undefined (worker reuses its cached copy)", () => {
    const observation = buildObservation(makeSlice({ gridLayout: undefined }));
    expect(observation.map).toBeUndefined();
  });

  it("converts enemy world x/y to tile coords via meta.tileSize", () => {
    const slice = makeSlice({
      meta: fakeMeta({ tileSize: 36 }),
      enemies: [fakeEnemy(1, 40, 73, 50, 50), fakeEnemy(2, 36, 0, 10, 10)] as EnemySnapshot[],
    });
    const observation = buildObservation(slice);
    // world x=40 / 36 = 1.11 → tileX 1; y=73 / 36 = 2.02 → tileY 2.
    expect(observation.enemies[0]).toMatchObject({ id: 1, tileX: 1, tileY: 2 });
    expect(observation.enemies[1]).toMatchObject({ id: 2, tileX: 1, tileY: 0 });
  });

  it("renames tower health/maxHealth to hp/maxHp in the semantic view", () => {
    const slice = makeSlice({ towers: [fakeTower(2, 3, 42, 60)] as TowerSnapshot[] });
    const observation = buildObservation(slice);
    expect(observation.towers[0]).toMatchObject({ tileX: 2, tileY: 3, hp: 42, maxHp: 60 });
    expect(observation.towers[0]).not.toHaveProperty("health");
    expect(observation.towers[0]).not.toHaveProperty("maxHealth");
  });

  it("sums spawnStates.pendingCount into wave.pendingEnemyCount", () => {
    const spawnStates: SpawnStateSnapshot[] = [
      { visualState: "open", closeTransitionTimer: 0, pendingCount: 5 },
      { visualState: "open", closeTransitionTimer: 0, pendingCount: 3 },
    ] as SpawnStateSnapshot[];
    const slice = makeSlice({ spawnStates });
    const observation = buildObservation(slice);
    expect(observation.wave.pendingEnemyCount).toBe(8);
  });

  it("projects enemy type and targetingMode, and tower type, when the snapshot has them", () => {
    const slice = makeSlice({
      enemies: [{ ...fakeEnemy(1, 0, 0, 10, 10), type: "minion", targetingMode: "nearest" }] as EnemySnapshot[],
      towers: [{ ...fakeTower(1, 1, 20, 20), type: "basic" }] as TowerSnapshot[],
    });
    const observation = buildObservation(slice);
    expect(observation.enemies[0]).toMatchObject({ type: "minion", targetingMode: "nearest" });
    expect(observation.towers[0]).toMatchObject({ type: "basic" });
  });

  it("carries remainingScheduledSpawns and active into the wave block", () => {
    const slice = makeSlice({ meta: fakeMeta({ currentWave: 4, remainingScheduledSpawns: 7, waveActive: false }) });
    const observation = buildObservation(slice);
    expect(observation.wave.currentWave).toBe(4);
    expect(observation.wave.remainingScheduledSpawns).toBe(7);
    expect(observation.wave.active).toBe(false);
    expect(observation.wave.baseHealth).toBe(20);
    expect(observation.wave.maxBaseHealth).toBe(100);
    expect(observation.wave.countdownRemaining).toBeNull();
  });

  it("copies an inter-wave countdown onto the wave", () => {
    const slice = makeSlice({
      meta: fakeMeta({ baseHealth: 12, maxBaseHealth: 40, waveCountdown: { remaining: 8.26, nextWave: 3 } }),
    });
    const observation = buildObservation(slice);
    expect(observation.wave.baseHealth).toBe(12);
    expect(observation.wave.maxBaseHealth).toBe(40);
    expect(observation.wave.countdownRemaining).toBe(8.26);
  });

  it("carries the snapshot command receipt into the wave block", () => {
    const slice = makeSlice({ meta: fakeMeta({ lastAppliedCommandId: 9, lastAppliedCount: 2, lastSkippedCount: 1 }) });
    const observation = buildObservation(slice);
    expect(observation.wave.commandReceipt).toEqual({ commandId: 9, applied: 2, skipped: 1, failedCommandId: 0 });
  });

  it("leaves commandReceipt undefined when the meta has no receipt fields", () => {
    const observation = buildObservation(makeSlice({}));
    expect(observation.wave.commandReceipt).toBeUndefined();
  });
});
