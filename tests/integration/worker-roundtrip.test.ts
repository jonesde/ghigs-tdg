/**
 * Worker round-trip smoke test (Phase 7).
 *
 * A real `import GameWorker from "@/sim/WorkerEntry.ts?worker"` does not run
 * under Vitest's jsdom pool reliably, so we exercise the worker's actual
 * message-handler logic directly. The worker module binds its `onmessage` and
 * reads `self.postMessage` at runtime, so we install a `self` interceptor that
 * captures `postMessage` output while preserving the rest of the jsdom global
 * scope. This matters under the Rapier physics flag: `world.step()` reaches
 * into Web APIs (TextEncoder, etc.) on `self`, so replacing `self` wholesale
 * with a bare mock would break stepping. We therefore override only the two
 * members the worker touches (`postMessage`, `onmessage`) and restore them
 * afterwards.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Command } from "@/sim/Command.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "@/sim/WorkerProtocol.js";
import { createTestPersistState, createTestThemeBundle } from "../helpers/mock-stores";

type WorkerMessageHandler = ((event: { data: MainToWorkerMessage }) => void) | null;

type SnapshotMessage = Extract<WorkerToMainMessage, { type: "snapshot" }>;

function snapshotMessages(messages: WorkerToMainMessage[]): SnapshotMessage[] {
  return messages.filter((m): m is SnapshotMessage => m.type === "snapshot");
}

describe("worker round-trip", () => {
  // `self` is the jsdom global; we keep it intact (Rapier needs its Web APIs)
  // and only swap `postMessage` so we can capture the worker's output. The
  // worker binds its `onmessage` handler once at module import (module
  // caching), so we leave that binding in place across tests and only manage
  // `postMessage` (re-installed per test, restored after).
  const workerScope = globalThis.self as unknown as {
    postMessage: (message: WorkerToMainMessage) => void;
    onmessage: WorkerMessageHandler;
  };
  const gw = globalThis as unknown as {
    self: { postMessage: (message: WorkerToMainMessage) => void; onmessage: WorkerMessageHandler } | undefined;
  };
  const originalPostMessage = workerScope.postMessage;
  const posted: WorkerToMainMessage[] = [];
  // `mockSelf` aliases the live worker scope so the test can invoke the handler
  // the worker registered via `self.onmessage = ...`.
  const mockSelf = workerScope;

  // Re-install the capture interceptor before each test (afterEach restores it,
  // so the next test must re-apply it).
  beforeEach(() => {
    workerScope.postMessage = (msg: WorkerToMainMessage) => {
      posted.push(msg);
    };
  });

  afterEach(() => {
    workerScope.postMessage = originalPostMessage;
    ackReceived = 0;
  });
  function sendInit(): void {
    mockSelf.onmessage!({
      data: { type: "init", persistState: createTestPersistState(), themeBundle: createTestThemeBundle(), mapIndex: 0 },
    });
  }
  function sendCommand(command: Command): void {
    mockSelf.onmessage!({ data: { type: "command", command } });
  }
  function sendDispose(): void {
    mockSelf.onmessage!({ data: { type: "dispose" } });
  }
  function snapshotCount(): number {
    return snapshotMessages(posted).length;
  }
  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  // Polls until `condition` is true or `timeoutMs` elapses. Used in place of a
  // fixed setTimeout wait so the assertions are robust to scheduling contention
  // when many test files run in parallel (the worker's loop is setTimeout-driven
  // and a short fixed wait can be starved under load).
  async function waitFor(condition: () => boolean, timeoutMs = 1000, intervalMs = 10): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (condition()) return true;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return condition();
  }

  // Counts acks actually delivered to the worker (the worker processes snapshotAck
  // synchronously), so this equals "acks received by the worker" used by the
  // backpressure assertions below.
  let ackReceived = 0;
  // Mirrors the real main thread: ack the frameId of the most recently posted
  // snapshot — the one the rAF loop would just have rendered.
  function latestPostedFrameId(): number {
    const snapshots = snapshotMessages(posted);
    return snapshots[snapshots.length - 1]?.snapshot.frameId ?? 0;
  }
  function sendAck(): void {
    mockSelf.onmessage!({ data: { type: "snapshotAck", frameId: latestPostedFrameId() } });
    ackReceived++;
  }
  // Drives a fake main-thread rAF that posts one ack roughly every frame. Returns
  // a stop() to clear the interval. Each tick counts as one received ack.
  function startAckDriver(intervalMs = 16): { stop: () => void; acks: () => number } {
    const handle = setInterval(sendAck, intervalMs);
    return { stop: () => clearInterval(handle), acks: () => ackReceived };
  }

  it("initializes and produces snapshots with expected meta", async () => {
    gw.self = mockSelf;
    posted.length = 0;

    // Import after self is installed so the module binds self.onmessage to the mock.
    await import("@/sim/WorkerEntry.js");
    expect(typeof mockSelf.onmessage).toBe("function");

    mockSelf.onmessage!({
      data: { type: "init", persistState: createTestPersistState(), themeBundle: createTestThemeBundle(), mapIndex: 0 },
    });

    // Let the setTimeout-driven fixed-timestep loop run a few ticks.
    await waitFor(() => snapshotMessages(posted).length > 0);

    // Stop the loop cleanly.
    mockSelf.onmessage!({ data: { type: "dispose" } });

    const snapshots = snapshotMessages(posted);
    expect(snapshots.length).toBeGreaterThan(0);

    const firstSnapshot = snapshots[0]!.snapshot;
    expect(firstSnapshot.meta.mapIndex).toBe(0);
    expect(firstSnapshot.meta.gold).toBeGreaterThan(0);
  });

  it("builds a tower via selectBuildType + input:click commands", async () => {
    gw.self = mockSelf;
    posted.length = 0;

    await import("@/sim/WorkerEntry.js");

    // Find a buildable tile so the click actually places a tower (catches the
    // bug where the worker never received the active build type).
    const mapData = getMap(0);
    const grid = new Grid(mapData);
    let buildTile: { tx: number; ty: number } | null = null;
    for (let ty = 0; ty < grid.height && !buildTile; ty++) {
      for (let tx = 0; tx < grid.width && !buildTile; tx++) {
        if (grid.canBuild(tx, ty)) buildTile = { tx, ty };
      }
    }
    expect(buildTile).not.toBeNull();

    mockSelf.onmessage!({
      data: { type: "init", persistState: createTestPersistState(), themeBundle: createTestThemeBundle(), mapIndex: 0 },
    });

    // Select a build type (this is what the main thread sends via the command seam).
    mockSelf.onmessage!({
      data: { type: "command", command: { commandId: 1, type: "action:selectBuildType", towerType: "basic" } },
    });

    await waitFor(() => snapshotMessages(posted).some((m) => m.snapshot.meta.selectedTowerType === "basic"));
    const afterSelect = snapshotMessages(posted);
    expect(afterSelect[afterSelect.length - 1]!.snapshot.meta.selectedTowerType).toBe("basic");

    // Click the buildable tile to place a tower.
    const ts = 36;
    mockSelf.onmessage!({
      data: {
        type: "command",
        command: {
          commandId: 2,
          type: "input:click",
          worldX: buildTile!.tx * ts + 18,
          worldY: buildTile!.ty * ts + 18,
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    mockSelf.onmessage!({ data: { type: "dispose" } });

    const finalSnapshots = snapshotMessages(posted);
    expect(finalSnapshots.length).toBeGreaterThan(0);
    const last = finalSnapshots[finalSnapshots.length - 1]!.snapshot;
    expect(last.towers.length).toBeGreaterThan(0);
  });

  it("(Finding 3a) posts no snapshot while paused and idle", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40); // baseline snapshot posts while paused

    // Start the game running so the loop actively posts.
    sendCommand({ commandId: 1, type: "action:togglePause" });
    await wait(120);
    const runningCount = snapshotCount();
    expect(runningCount).toBeGreaterThan(1);

    // Pause: scaledDt becomes 0. The pause command itself posts once (it mutated
    // state that tick), then the idle skip must hold for every subsequent tick.
    sendCommand({ commandId: 2, type: "action:togglePause" });
    await wait(120);
    expect(snapshotCount()).toBe(runningCount + 1);
    await wait(120);
    expect(snapshotCount()).toBe(runningCount + 1);
    sendDispose();
  });

  it("(Finding 3b) posts exactly one snapshot on the frame a command applies while paused", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40);

    // Paused + idle: only the baseline snapshot was posted.
    const before = snapshotCount();
    expect(before).toBeGreaterThan(0);

    // A state-mutating command (selectBuildType) must force exactly one post.
    sendCommand({ commandId: 3, type: "action:selectBuildType", towerType: "basic" });
    await wait(40);
    expect(snapshotCount()).toBe(before + 1);
    sendDispose();
  });

  it("(Finding 3c) posts the terminal snapshot exactly once before the loop stops", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40);

    const before = snapshotCount();
    sendCommand({ commandId: 4, type: "action:debugEndRun", victory: true });
    await wait(50);
    // Exactly one terminal snapshot was posted.
    expect(snapshotCount()).toBe(before + 1);
    const terminal = snapshotMessages(posted)[snapshotMessages(posted).length - 1]!;
    expect(terminal.snapshot.meta.state).toBe("victory");
    // Loop is stopped: no further snapshots even after a long wait.
    await wait(100);
    expect(snapshotCount()).toBe(before + 1);
    sendDispose();
  });

  it("(Finding 3d) a subsequent init re-enables the loop cleanly", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40);

    // Drive to terminal, loop stops.
    sendCommand({ commandId: 5, type: "action:debugEndRun", victory: true });
    await wait(50);
    expect(snapshotMessages(posted).some((m) => m.snapshot.meta.state === "victory")).toBe(true);

    // Re-init on the same (stopped) worker → loop resumes, fresh baseline snapshot.
    const beforeReinit = snapshotCount();
    sendInit();
    await wait(60);
    expect(snapshotCount()).toBeGreaterThan(beforeReinit);
    const resumed = snapshotMessages(posted)[snapshotMessages(posted).length - 1]!;
    // Fresh run starts paused again.
    expect(resumed.snapshot.meta.state).toBe("paused");
    sendDispose();
  });

  it("action:syncPersist reaches the engine and forces a snapshot post", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40); // baseline snapshot

    const before = snapshotCount();
    const syncedState = createTestPersistState();
    syncedState.unlocked.basic!.variantA[0] = true;
    sendCommand({
      commandId: 6,
      type: "action:syncPersist",
      unlocked: syncedState.unlocked,
      generalAddons: syncedState.generalAddons,
    });
    await wait(40);
    // syncPersist returns true → the worker must post a fresh snapshot.
    expect(snapshotCount()).toBe(before + 1);
    sendDispose();
  });

  it("action:debug addGold reaches the worker and reflects in the snapshot", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40); // baseline snapshot

    const before = snapshotCount();
    const beforeGold = snapshotMessages(posted)[snapshotMessages(posted).length - 1]!.snapshot.meta.gold;
    sendCommand({ commandId: 7, type: "action:debug", kind: "addGold", amount: 500 });
    await wait(40);
    // debug returns true → a fresh snapshot is posted.
    expect(snapshotCount()).toBe(before + 1);
    const afterGold = snapshotMessages(posted)[snapshotMessages(posted).length - 1]!.snapshot.meta.gold;
    expect(afterGold).toBe(beforeGold + 500);
    sendDispose();
  });

  it("(P2-1a) no ack → only baseline + command-induced frames; running-idle ticks drop", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40); // baseline posts while paused (awaitingAck = true)

    // Go running with NO acks sent from the "main thread".
    sendCommand({ commandId: 1, type: "action:togglePause" });
    await wait(40);
    // Exactly two snapshots: baseline + the togglePause forced post.
    expect(snapshotCount()).toBe(2);

    // Further running-idle ticks must be dropped (awaitingAck still true).
    await wait(120);
    expect(snapshotCount()).toBe(2);
    sendDispose();
  });

  it("(P2-1b) with ack each frame → rate-matched; snapshots track received acks", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40);
    // Baseline (1) posted while paused.

    // Start running. The togglePause command is itself a forced post.
    sendCommand({ commandId: 1, type: "action:togglePause" });
    await wait(20);
    const postsBeforeAckLoop = snapshotCount(); // baseline + togglePause
    expect(postsBeforeAckLoop).toBeGreaterThanOrEqual(2);

    // Drive a fake main-thread rAF that acks one snapshot per frame (~16ms),
    // with no further commands, for ~250ms.
    const driver = startAckDriver(16);
    await wait(250);
    driver.stop();

    // Posts made after the running start must track the acks the worker actually
    // received. Tolerance absorbs setTimeout/rAF timer jitter. A command sent
    // mid-segment would add +1; none is sent here, so upper bound is ackCount.
    const postsAfterStart = snapshotCount() - postsBeforeAckLoop;
    const acks = driver.acks();
    expect(postsAfterStart).toBeGreaterThanOrEqual(acks - 2);
    expect(postsAfterStart).toBeLessThanOrEqual(acks + 2);
    sendDispose();
  });

  it("(P2-1b-frameId) ignores a stale ack; acks the last posted frame releases the gate", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40); // baseline posts (awaitingAck = true)
    const baselineFrameId = latestPostedFrameId();

    // Go running. togglePause is a forced post; afterwards awaitingAck is true and
    // running-idle ticks must drop until a current-frame ack arrives.
    sendCommand({ commandId: 1, type: "action:togglePause" });
    await wait(40);
    const postsAfterStart = snapshotCount();
    expect(postsAfterStart).toBeGreaterThanOrEqual(2);

    // Stale ack (the baseline frame, older than the last post) must NOT release.
    mockSelf.onmessage!({ data: { type: "snapshotAck", frameId: baselineFrameId } });
    await wait(120);
    expect(snapshotCount()).toBe(postsAfterStart);

    // Acking the last posted frame releases the gate; running ticks post again.
    sendAck();
    await wait(120);
    expect(snapshotCount()).toBeGreaterThan(postsAfterStart);
    sendDispose();
  });

  it("(P2-1b-paused) a command while paused force-posts exactly one snapshot", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40);
    const before = snapshotCount(); // baseline only (paused + idle)

    // Select a build type while paused — must force exactly one post.
    sendCommand({ commandId: 3, type: "action:selectBuildType", towerType: "basic" });
    await wait(40);
    expect(snapshotCount()).toBe(before + 1);
    // And a subsequent paused-idle tick must still be gated (awaitingAck was reset
    // false by the pausedMutation post, but idle → no post anyway).
    await wait(60);
    expect(snapshotCount()).toBe(before + 1);
    sendDispose();
  });

  it("(P2-1c) terminal → exactly one final post regardless of awaitingAck", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40);
    // Baseline posts (awaitingAck = true). Send NO ack, then drive to victory.
    const before = snapshotCount();

    sendCommand({ commandId: 4, type: "action:debugEndRun", victory: true });
    await wait(50);
    // Exactly one terminal snapshot was posted even though awaitingAck was set.
    expect(snapshotCount()).toBe(before + 1);
    const terminal = snapshotMessages(posted)[snapshotMessages(posted).length - 1]!;
    expect(terminal.snapshot.meta.state).toBe("victory");
    // Loop is stopped: no further snapshots even after a long wait.
    await wait(100);
    expect(snapshotCount()).toBe(before + 1);
    sendDispose();
  });

  it("(P2-1d) init re-entry resets the gate; fresh baseline posts and running frames resume with acks", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40);

    // Drive to terminal (sets the gate via awaitingAck on the baseline).
    sendCommand({ commandId: 5, type: "action:debugEndRun", victory: true });
    await wait(50);
    expect(snapshotMessages(posted).some((m) => m.snapshot.meta.state === "victory")).toBe(true);

    // Re-init on the same (stopped) worker → gate resets, fresh baseline posts.
    const beforeReinit = snapshotCount();
    sendInit();
    await wait(40);
    expect(snapshotCount()).toBeGreaterThan(beforeReinit);
    const resumed = snapshotMessages(posted)[snapshotMessages(posted).length - 1]!;
    expect(resumed.snapshot.meta.state).toBe("paused");

    // Now run with acks flowing: running frames must resume posting.
    sendCommand({ commandId: 6, type: "action:togglePause" });
    await wait(20);
    const postsBeforeAckLoop = snapshotCount();
    const driver = startAckDriver(16);
    await wait(200);
    driver.stop();
    const postsAfterStart = snapshotCount() - postsBeforeAckLoop;
    const acks = driver.acks();
    expect(postsAfterStart).toBeGreaterThanOrEqual(acks - 2);
    expect(postsAfterStart).toBeLessThanOrEqual(acks + 2);
    sendDispose();
  });

  it("commanderHold freezes simSeconds while the run stays playing", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40);

    sendCommand({ commandId: 1, type: "action:togglePause" });
    const driver = startAckDriver(16);
    const started = await waitFor(() => {
      const snapshots = snapshotMessages(posted);
      const latest = snapshots[snapshots.length - 1];
      const simSeconds = latest?.snapshot.meta.simSeconds ?? 0;
      return latest !== undefined && latest.snapshot.meta.state === "playing" && simSeconds > 0;
    });
    expect(started).toBe(true);

    sendCommand({ commandId: 2, type: "action:commanderHold", hold: true });
    const held = await waitFor(() => {
      const snapshots = snapshotMessages(posted);
      const latest = snapshots[snapshots.length - 1];
      return latest?.snapshot.meta.commanderHold === true;
    });
    expect(held).toBe(true);
    const snapshotsAtHold = snapshotMessages(posted);
    const heldSnapshot = snapshotsAtHold[snapshotsAtHold.length - 1]!;
    const frozenSimSeconds = heldSnapshot.snapshot.meta.simSeconds ?? 0;
    expect(heldSnapshot.snapshot.meta.state).toBe("playing");

    await wait(200);
    const snapshotsWhileHeld = snapshotMessages(posted);
    const stillHeld = snapshotsWhileHeld[snapshotsWhileHeld.length - 1]!;
    expect(stillHeld.snapshot.meta.commanderHold).toBe(true);
    expect(stillHeld.snapshot.meta.state).toBe("playing");
    expect(stillHeld.snapshot.meta.simSeconds ?? 0).toBe(frozenSimSeconds);

    sendCommand({ commandId: 3, type: "action:commanderHold", hold: false });
    const released = await waitFor(() => {
      const snapshots = snapshotMessages(posted);
      const latest = snapshots[snapshots.length - 1];
      return (
        latest !== undefined &&
        latest.snapshot.meta.commanderHold !== true &&
        (latest.snapshot.meta.simSeconds ?? 0) > frozenSimSeconds
      );
    });
    expect(released).toBe(true);
    const snapshotsAfterRelease = snapshotMessages(posted);
    const releasedSnapshot = snapshotsAfterRelease[snapshotsAfterRelease.length - 1]!;
    expect(releasedSnapshot.snapshot.meta.state).toBe("playing");
    driver.stop();
    sendDispose();
  });
});
