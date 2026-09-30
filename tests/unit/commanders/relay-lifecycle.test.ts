import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LLM_SYSTEM_PROMPT,
  DEFAULT_TEMPERATURE_REASONING_OFF,
  DEFAULT_TEMPERATURE_REASONING_ON,
  type LlmCommanderConfig,
} from "@/commanders/llm/types.js";
import type { CommanderSnapshotSlice } from "@/commanders/protocol.js";
import { peekClockHeldForTests, resetRelayForTests, startRelay, stopRelay } from "@/commanders/relay.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import { getLatestSnapshot } from "@/sim/SnapshotStore.js";

vi.mock("@/sim/commandBus.js", () => ({ dispatchCommand: vi.fn() }));
vi.mock("@/sim/SnapshotStore.js", () => ({ getLatestSnapshot: vi.fn() }));
vi.mock("@/stores/ui.js", () => ({
  useUiStore: () => ({
    showNotification: vi.fn(),
    appendChatLog: vi.fn(),
    appendLlmTrace: vi.fn(),
    setEnemyCommander: vi.fn(),
  }),
}));

class FakeWorker {
  posted: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {}
}

const createdWorkers: FakeWorker[] = [];

function latestWorker(): FakeWorker {
  const worker = createdWorkers[createdWorkers.length - 1];
  if (!worker) throw new Error("relay did not create a worker");
  return worker;
}

function makeConfig(decisionIntervalMs: number): LlmCommanderConfig {
  return {
    id: "llm1",
    name: "LLM 1",
    endpointUrl: "http://localhost:1234/v1",
    token: "",
    modelName: "",
    contextLimit: 32768,
    commanderInstructions: "",
    systemPrompt: DEFAULT_LLM_SYSTEM_PROMPT,
    requestTimeoutMs: 30000,
    pauseForCommander: false,
    decisionIntervalMs,
    reasoningEnabled: false,
    temperatureReasoningOff: DEFAULT_TEMPERATURE_REASONING_OFF,
    temperatureReasoningOn: DEFAULT_TEMPERATURE_REASONING_ON,
  };
}

function makeSnapshot(runId: number, enemyIds: number[], towerLevel: number, wave: number): unknown {
  return {
    gridLayout: undefined,
    enemies: enemyIds.map((id) => ({ id })),
    towers: [{ tileX: 1, tileY: 1, level: towerLevel }],
    spawnStates: [],
    navField: undefined,
    meta: { runId, currentWave: wave },
  };
}

function observationPosts(worker: FakeWorker): CommanderSnapshotSlice[] {
  return worker.posted.flatMap((message) => {
    const typed = message as { type?: string; slice?: CommanderSnapshotSlice };
    return typed.type === "observation" && typed.slice ? [typed.slice] : [];
  });
}

function holdDispatches(): unknown[] {
  return vi.mocked(dispatchCommand).mock.calls.flatMap(([command]) => {
    const typed = command as { type?: string };
    return typed.type === "action:commanderHold" ? [command] : [];
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetRelayForTests();
  createdWorkers.length = 0;
  vi.mocked(dispatchCommand).mockClear();
  vi.stubGlobal(
    "Worker",
    class extends FakeWorker {
      constructor() {
        super();
        createdWorkers.push(this);
      }
    },
  );
});

afterEach(() => {
  stopRelay();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("relay stop hold release", () => {
  it("dispatches hold:false on stop only when the clock was held", () => {
    const snapshots = getLatestSnapshot as unknown as { mockReturnValue: (value: unknown) => void };
    snapshots.mockReturnValue(makeSnapshot(1, [], 1, 1));
    startRelay("stubby");
    latestWorker().onmessage?.({ data: { type: "hold", hold: true } });
    expect(peekClockHeldForTests()).toBe(true);
    vi.mocked(dispatchCommand).mockClear();
    stopRelay();
    expect(holdDispatches()).toEqual([{ commandId: 0, type: "action:commanderHold", hold: false }]);
    expect(peekClockHeldForTests()).toBe(false);
  });

  it("skips hold:false on stop when the clock was never held", () => {
    const snapshots = getLatestSnapshot as unknown as { mockReturnValue: (value: unknown) => void };
    snapshots.mockReturnValue(makeSnapshot(1, [], 1, 1));
    startRelay("stubby");
    stopRelay();
    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it("a hold:false message without a prior hold leaves the flag clear", () => {
    const snapshots = getLatestSnapshot as unknown as { mockReturnValue: (value: unknown) => void };
    snapshots.mockReturnValue(makeSnapshot(1, [], 1, 1));
    startRelay("stubby");
    latestWorker().onmessage?.({ data: { type: "hold", hold: false } });
    expect(peekClockHeldForTests()).toBe(false);
    vi.mocked(dispatchCommand).mockClear();
    stopRelay();
    expect(dispatchCommand).not.toHaveBeenCalled();
  });
});

describe("relay llm throttle", () => {
  it("posts the first observation immediately, then skips idle ticks", async () => {
    const snapshots = getLatestSnapshot as unknown as { mockReturnValue: (value: unknown) => void };
    snapshots.mockReturnValue(makeSnapshot(1, [4], 1, 1));
    startRelay("llm", makeConfig(5000));
    await vi.advanceTimersByTimeAsync(250);
    expect(observationPosts(latestWorker())).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(250);
    expect(observationPosts(latestWorker())).toHaveLength(1);
  });

  it("posts when a new enemy appears inside the interval", async () => {
    const snapshots = getLatestSnapshot as unknown as { mockReturnValue: (value: unknown) => void };
    snapshots.mockReturnValue(makeSnapshot(1, [4], 1, 1));
    startRelay("llm", makeConfig(5000));
    await vi.advanceTimersByTimeAsync(250);
    expect(observationPosts(latestWorker())).toHaveLength(1);
    snapshots.mockReturnValue(makeSnapshot(1, [4, 9], 1, 1));
    await vi.advanceTimersByTimeAsync(250);
    expect(observationPosts(latestWorker())).toHaveLength(2);
  });

  it("posts on tower-signature and wave changes, and when the interval elapses", async () => {
    const snapshots = getLatestSnapshot as unknown as { mockReturnValue: (value: unknown) => void };
    snapshots.mockReturnValue(makeSnapshot(1, [4], 1, 1));
    startRelay("llm", makeConfig(1000));
    await vi.advanceTimersByTimeAsync(250);
    expect(observationPosts(latestWorker())).toHaveLength(1);
    snapshots.mockReturnValue(makeSnapshot(1, [4], 2, 1));
    await vi.advanceTimersByTimeAsync(250);
    expect(observationPosts(latestWorker())).toHaveLength(2);
    snapshots.mockReturnValue(makeSnapshot(1, [4], 2, 2));
    await vi.advanceTimersByTimeAsync(250);
    expect(observationPosts(latestWorker())).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(observationPosts(latestWorker())).toHaveLength(4);
  });

  it("keeps stub kinds on the unthrottled 250ms cadence", async () => {
    const snapshots = getLatestSnapshot as unknown as { mockReturnValue: (value: unknown) => void };
    snapshots.mockReturnValue(makeSnapshot(1, [4], 1, 1));
    startRelay("stubby");
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(250);
    expect(observationPosts(latestWorker())).toHaveLength(3);
  });
});
