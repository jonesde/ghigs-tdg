import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommanderMemory } from "@/commanders/brain.js";
import { createLlmBrain } from "@/commanders/llm/brain.js";
import {
  DEFAULT_LLM_SYSTEM_PROMPT,
  DEFAULT_TEMPERATURE_REASONING_OFF,
  DEFAULT_TEMPERATURE_REASONING_ON,
  type LlmCommanderConfig,
} from "@/commanders/llm/types.js";
import type { CommanderObservation } from "@/commanders/observation.js";
import { buildObservation } from "@/commanders/observation.js";
import type { CommanderSnapshotSlice, CommanderToMainMessage } from "@/commanders/protocol.js";
import { peekNextObservationIdForTests, resetRelayForTests, startRelay, stopRelay } from "@/commanders/relay.js";
import { GameState } from "@/sim/Constants.js";
import { getLatestSnapshot } from "@/sim/SnapshotStore.js";

vi.mock("@/sim/SnapshotStore.js", () => ({ getLatestSnapshot: vi.fn() }));
vi.mock("@/stores/ui.js", () => ({
  useUiStore: () => ({ showNotification: vi.fn(), appendChatLog: vi.fn(), appendLlmTrace: vi.fn() }),
}));

function makeConfig(): LlmCommanderConfig {
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
    decisionIntervalMs: 1000,
    reasoningEnabled: false,
    temperatureReasoningOff: DEFAULT_TEMPERATURE_REASONING_OFF,
    temperatureReasoningOn: DEFAULT_TEMPERATURE_REASONING_ON,
  };
}

function makeObservation(): CommanderObservation {
  return {
    map: [
      [1, 2],
      [3, 1],
    ],
    enemies: [{ id: 1, tileX: 0, tileY: 0, level: 1, hp: 10, maxHp: 10 }],
    towers: [{ tileX: 1, tileY: 1, level: 1, hp: 20, maxHp: 20 }],
    wave: {
      currentWave: 1,
      pendingEnemyCount: 0,
      spawnStates: [],
      remainingScheduledSpawns: 0,
      active: false,
      baseHealth: 40,
      maxBaseHealth: 100,
      countdownRemaining: null,
    },
  };
}

function makeMemory(): CommanderMemory {
  return {
    phase: "idle",
    seenByWave: new Map<number, Set<number>>(),
    lastRushWaveNumber: null,
    lastRoutedTowerSignature: "",
    gridLayout: undefined,
    conversation: [],
    tokenCount: 0,
    lastObservation: null,
    commanderInstructions: "",
    pendingPlayerMessages: [],
    isCompressing: false,
    rejectionNote: null,
  };
}

function makeSlice(observationId: number): CommanderSnapshotSlice {
  return {
    observationId,
    gridLayout: undefined,
    enemies: [],
    towers: [],
    spawnStates: [],
    meta: {
      state: GameState.PLAYING,
      runId: 7,
      tileSize: 36,
      currentWave: 1,
      remainingScheduledSpawns: 0,
      waveActive: false,
      baseHealth: 40,
      maxBaseHealth: 100,
      waveCountdown: null,
    },
    nav: undefined,
  } as unknown as CommanderSnapshotSlice;
}

function responseWithContent(content: string) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10 } }),
  };
}

describe("observationId projection", () => {
  it("copies the slice observationId onto the brain observation", () => {
    const observation = buildObservation({ ...makeSlice(41), gridLayout: [[0, 1]] });
    expect(observation.observationId).toBe(41);
  });

  it("leaves observationId undefined when the slice carries none", () => {
    const slice = makeSlice(1);
    delete (slice as { observationId?: number }).observationId;
    expect(buildObservation(slice).observationId).toBeUndefined();
  });
});

describe("observationId trace tag", () => {
  it("prepends the observation id to a successful command summary", async () => {
    const raw = JSON.stringify([{ type: "llm:routeGroup", enemyIds: [1], hold: true, waypoints: [] }]);
    const fetchFn = vi.fn(async () => responseWithContent(raw)) as unknown as typeof fetch;
    const trace = vi.fn();
    const brain = createLlmBrain(makeConfig(), { fetchFn, onTrace: trace });
    const observation = makeObservation();
    observation.observationId = 7;
    await brain.decide(observation, makeMemory());
    expect(trace).toHaveBeenCalledWith({ responseText: raw, commandSummary: "obs #7 hold 1" });
  });

  it("prepends the observation id to a failed request summary", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 500, text: async () => "" }));
    const trace = vi.fn();
    const brain = createLlmBrain(makeConfig(), { fetchFn: fetchFn as unknown as typeof fetch, onTrace: trace });
    const observation = makeObservation();
    observation.observationId = 12;
    await brain.decide(observation, makeMemory());
    expect(trace).toHaveBeenCalledWith({ responseText: "", commandSummary: "obs #12 request failed: status 500" });
  });

  it("leaves the summary untagged when the observation has no id", async () => {
    const fetchFn = vi.fn(async () => responseWithContent("[]")) as unknown as typeof fetch;
    const trace = vi.fn();
    const brain = createLlmBrain(makeConfig(), { fetchFn, onTrace: trace });
    await brain.decide(makeObservation(), makeMemory());
    expect(trace).toHaveBeenCalledWith({ responseText: "[]", commandSummary: "no commands" });
  });
});

describe("relay observationId assignment", () => {
  class FakeWorker {
    posted: unknown[] = [];
    onmessage: ((event: unknown) => void) | null = null;
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

  function makeSnapshot(runId: number) {
    return {
      gridLayout: [[0]],
      enemies: [],
      towers: [],
      spawnStates: [],
      navField: undefined,
      meta: { runId, state: GameState.PLAYING },
    };
  }

  function observationIds(): number[] {
    return latestWorker().posted.flatMap((message) => {
      const typed = message as { type?: string; slice?: CommanderSnapshotSlice };
      return typed.type === "observation" && typed.slice ? [typed.slice.observationId] : [];
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    resetRelayForTests();
    createdWorkers.length = 0;
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

  it("assigns increasing ids and resets to 1 when the run id changes", async () => {
    const snapshots = getLatestSnapshot as unknown as { mockReturnValue: (value: unknown) => void };
    snapshots.mockReturnValue(makeSnapshot(3));
    startRelay("stubby");
    expect(peekNextObservationIdForTests()).toBe(1);
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(250);
    expect(observationIds()).toEqual([1, 2]);

    snapshots.mockReturnValue(makeSnapshot(4));
    await vi.advanceTimersByTimeAsync(250);
    expect(observationIds()).toEqual([1, 2, 1]);
  });
});

describe("worker observationId echo + hold-during-backoff", () => {
  const workerScope = globalThis.self as unknown as {
    postMessage: (message: CommanderToMainMessage) => void;
    onmessage: ((event: { data: unknown }) => void) | null;
  };
  const gw = globalThis as unknown as { self: unknown; fetch: unknown };
  const originalFetch = gw.fetch;
  const originalPostMessage = workerScope.postMessage;
  const posted: CommanderToMainMessage[] = [];
  const mockSelf = workerScope;

  async function deliver(data: unknown): Promise<void> {
    const handler = mockSelf.onmessage;
    if (!handler) throw new Error("commander worker did not register onmessage");
    await (handler as (event: { data: unknown }) => Promise<void>)({ data });
  }

  function commandBatches(): { commands: { type: string }[]; observationId?: number }[] {
    return posted.flatMap((message) => (message.type === "commands" ? [message] : []));
  }

  function holdFlags(): boolean[] {
    return posted.flatMap((message) => (message.type === "hold" ? [message.hold] : []));
  }

  beforeEach(() => {
    workerScope.postMessage = (message: CommanderToMainMessage) => posted.push(message);
  });
  afterEach(() => {
    workerScope.postMessage = originalPostMessage;
    gw.fetch = originalFetch;
    vi.useRealTimers();
    posted.length = 0;
    mockSelf.onmessage?.({ data: { type: "stop" } });
  });

  it("echoes the observation id on stub feed-off and brain batches", async () => {
    vi.useFakeTimers();
    gw.self = mockSelf;
    await import("@/commanders/CommanderWorker.js");
    await deliver({ type: "start", kind: "stubby" });
    const slice = { ...makeSlice(41), gridLayout: [[0]] };
    await deliver({ type: "observation", slice });
    const batches = commandBatches();
    expect(batches).toHaveLength(2);
    expect(batches[0]?.commands[0]?.type).toBe("llm:setGridLayoutFeed");
    for (const batch of batches) expect(batch.observationId).toBe(41);
  });

  it("echoes the consumed observation id on the llm command batch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    gw.fetch = vi.fn(async () => responseWithContent("[]")) as unknown as typeof fetch;
    gw.self = mockSelf;
    await import("@/commanders/CommanderWorker.js");
    await deliver({ type: "start", kind: "llm", config: makeConfig() });
    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: makeSlice(9) });
    await vi.advanceTimersByTimeAsync(0);
    const batches = commandBatches();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.observationId).toBe(9);
  });

  it("withholds hold until the backoff wait elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchFn = vi.fn();
    fetchFn.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "" });
    fetchFn.mockResolvedValue(responseWithContent("[]"));
    gw.fetch = fetchFn as unknown as typeof fetch;
    gw.self = mockSelf;
    await import("@/commanders/CommanderWorker.js");
    await deliver({ type: "start", kind: "llm", config: { ...makeConfig(), pauseForCommander: true } });

    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: makeSlice(1) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(holdFlags()).toEqual([true, false]);
    expect(commandBatches()[0]?.observationId).toBe(1);

    vi.advanceTimersByTime(1000);
    posted.length = 0;
    await deliver({ type: "observation", slice: makeSlice(2) });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(holdFlags()).toEqual([]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(holdFlags()).toEqual([true, false]);
    expect(commandBatches()[0]?.observationId).toBe(2);
  });
});
