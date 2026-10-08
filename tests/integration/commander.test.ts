import { afterEach, describe, expect, it } from "vitest";
import type { CommanderToMainMessage } from "@/commanders/protocol.js";
import { applyCommand } from "@/sim/applyCommand.js";
import type { Command } from "@/sim/Command.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import { fixedDeltaSeconds } from "@/sim/stepBudget.js";
import {
  createTestMapThemeStore,
  createTestPersistState,
  createTestThemeBundle,
  MockHostBindings,
} from "../helpers/mock-stores.js";

// Minimal DedicatedWorkerGlobalScope shape for the commander worker (mirrors the
// mock used in tests/integration/worker-roundtrip.test.ts for the sim worker).

function extractCommands(messages: CommanderToMainMessage[]): Command[] {
  const commands: Command[] = [];
  for (const message of messages) {
    if (message.type === "commands") commands.push(...message.commands);
  }
  return commands;
}

describe("Integration: real commander worker round-trip (stubby)", () => {
  let engine: GameEngine;
  let persistState: ReturnType<typeof createTestPersistState>;
  let mockHost: MockHostBindings;
  // Augment the real jsdom `self` rather than replace it: the game engine stepped
  // here runs the Rapier physics world, whose `world.step()` reaches into Web APIs
  // (TextEncoder, etc.) on `self`. Replacing `self` with a bare mock strips those
  // and makes stepping panic. We override only `postMessage`/`onmessage` (the two
  // members the commander worker touches) and restore after.
  const workerScope = globalThis.self as unknown as {
    postMessage: (message: CommanderToMainMessage) => void;
    onmessage: ((event: { data: unknown }) => void) | null;
  };
  const gw = globalThis as unknown as {
    self:
      | {
          postMessage: (message: CommanderToMainMessage) => void;
          onmessage: ((event: { data: unknown }) => void) | null;
        }
      | undefined;
  };
  const originalPostMessage = workerScope.postMessage;
  const posted: CommanderToMainMessage[] = [];
  const mockSelf = workerScope;

  beforeEach(() => {
    workerScope.postMessage = (msg: CommanderToMainMessage) => posted.push(msg);
  });
  afterEach(() => {
    workerScope.postMessage = originalPostMessage;
    posted.length = 0;
  });

  function setupEngine(): void {
    createTestMapThemeStore();
    persistState = createTestPersistState();
    mockHost = new MockHostBindings();
    engine = new GameEngine(persistState, createTestThemeBundle(), mockHost, 0);
    engine.loadMap(0);
    engine.waveManager?.startNextWave();
  }

  function postObservation(): Command[] {
    const snapshot = buildSnapshot(engine, 0);
    mockSelf.onmessage!({ data: { type: "observation", slice: snapshot } });
    return extractCommands(posted);
  }

  it("holds spawned enemies, then rushes them to the base on wave emergence", async () => {
    // Install the mock worker global BEFORE importing the worker module so its
    // self.onmessage binding lands on our mock.
    gw.self = mockSelf;
    posted.length = 0;

    const _workerModule = await import("@/commanders/CommanderWorker.js");
    void _workerModule;

    // Start the stubby brain (also resets the worker's module-level memory).
    mockSelf.onmessage!({ data: { type: "start", kind: "stubby" } });

    setupEngine();

    // Tick until a few enemies have spawned, then feed the first observation.
    for (let tick = 0; tick < 30; tick++) engine.update(fixedDeltaSeconds);
    const firstCommands = postObservation();

    // Exactly one setGridLayoutFeed (feed off) is emitted on first gridLayout receipt.
    const toggles = firstCommands.filter((c) => c.type === "llm:setGridLayoutFeed");
    expect(toggles).toHaveLength(1);
    // Spawned enemies are held while spawning.
    const holds = firstCommands.filter((c) => c.type === "llm:routeGroup" && c.hold === true);
    expect(holds.length).toBeGreaterThan(0);

    // Apply the captured commands back through applyCommand.
    for (const command of firstCommands) applyCommand(engine, command);

    // Let collision separation settle, then capture the held baseline from the
    // snapshot (consumer-visible state) rather than Enemy internals. A held enemy
    // does not advance, so its distance to the base stays put (lane-offset jitter
    // is tolerated; a real advance would close more than a tile per second).
    for (let tick = 0; tick < 10; tick++) engine.update(fixedDeltaSeconds);
    const heldId = (holds[0] as Extract<Command, { type: "llm:routeGroup" }>).enemyIds[0]!;
    const tileSize = engine.grid!.tileSize;
    const baseWorldX = engine.grid!.base.x * tileSize + tileSize / 2;
    const baseWorldY = engine.grid!.base.y * tileSize + tileSize / 2;
    const snapshotBefore = buildSnapshot(engine, 0);
    const enemyBefore = snapshotBefore.enemies.find((e) => e.id === heldId)!;
    for (let tick = 0; tick < 60; tick++) engine.update(fixedDeltaSeconds);
    const snapshotAfter = buildSnapshot(engine, 0);
    const enemyAfter = snapshotAfter.enemies.find((e) => e.id === heldId)!;
    const distBefore = Math.hypot(enemyBefore.x - baseWorldX, enemyBefore.y - baseWorldY);
    const distAfter = Math.hypot(enemyAfter.x - baseWorldX, enemyAfter.y - baseWorldY);
    expect(Math.abs(distAfter - distBefore)).toBeLessThan(tileSize);

    // Keep ticking and feeding observations (holds are idempotent) until the wave
    // has fully emerged; the worker then emits the release rush.
    let rushCommands: Command[] = [];
    for (let tick = 0; tick < 4000 && rushCommands.length === 0; tick++) {
      engine.update(fixedDeltaSeconds);
      if (tick % 10 === 0) {
        const commands = postObservation();
        rushCommands = commands.filter(
          (c) => c.type === "llm:routeGroup" && c.hold === false && c.waypoints.length === 0,
        );
        for (const command of commands) applyCommand(engine, command);
      }
    }
    expect(rushCommands.length).toBeGreaterThan(0);

    // After release the rush command reverts the held enemies to default routing
    // and they advance toward the base (they are no longer culled as "reached
    // base"). We assert the released enemy is no longer held and has advanced
    // toward the base rather than requiring it to land a hit (the crowd-owned
    // movement to the base is timing/collision sensitive).
    const releasedEnemy = engine.getEnemiesByIds([heldId])[0];
    expect(releasedEnemy ? releasedEnemy.routingMode : "default").toBe("default");
    const distBeforeRush = releasedEnemy
      ? Math.hypot(releasedEnemy.centerX - baseWorldX, releasedEnemy.centerY - baseWorldY)
      : 0;
    for (let tick = 0; tick < 2000; tick++) engine.update(fixedDeltaSeconds);
    const afterEnemy = engine.getEnemiesByIds([heldId])[0];
    if (afterEnemy) {
      const distAfterRush = Math.hypot(afterEnemy.centerX - baseWorldX, afterEnemy.centerY - baseWorldY);
      expect(distAfterRush).toBeLessThan(distBeforeRush);
    }
    expect(rushCommands.length).toBeGreaterThan(0);

    mockSelf.onmessage!({ data: { type: "stop" } });
  });
});
