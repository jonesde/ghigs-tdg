import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommanderMemory } from "@/commanders/brain.js";
import { createLlmBrain } from "@/commanders/llm/brain.js";
import { validateLlmResponse } from "@/commanders/llm/schema.js";
import {
  DEFAULT_LLM_SYSTEM_PROMPT,
  DEFAULT_TEMPERATURE_REASONING_OFF,
  DEFAULT_TEMPERATURE_REASONING_ON,
  type LlmCommanderConfig,
} from "@/commanders/llm/types.js";
import type { CommanderObservation } from "@/commanders/observation.js";
import type { CommanderSnapshotSlice, CommanderToMainMessage } from "@/commanders/protocol.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { GameState } from "@/sim/GameRunState.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import { fixedDeltaSeconds } from "@/sim/stepBudget.js";
import {
  createTestMapThemeStore,
  createTestPersistState,
  createTestThemeBundle,
  MockHostBindings,
} from "../helpers/mock-stores.js";

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
      countdownRemaining: 12.34,
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

function responseWithContent(content: string, promptTokens = 10) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: promptTokens } }),
  };
}

function messagesFromCall(
  fetchFn: { mock: { calls: unknown[][] } },
  callIndex: number,
): { role: string; content: string }[] {
  const init = fetchFn.mock.calls[callIndex]?.[1] as { body?: string } | undefined;
  const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
  return body.messages;
}

function lastUserContent(fetchFn: { mock: { calls: unknown[][] } }, callIndex: number): string {
  const users = messagesFromCall(fetchFn, callIndex).filter((message) => message.role === "user");
  return users[users.length - 1]?.content ?? "";
}

describe("Integration: LLM commander worker pause + relay", () => {
  // Augment the real jsdom `self` rather than replace it: this test steps the
  // game engine (Rapier physics), whose `world.step()` needs Web APIs on `self`.
  // Replacing `self` with a bare mock strips those and makes stepping panic. We
  // override only `postMessage`/`onmessage` (the commander worker's touchpoints).
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
    fetch: unknown;
  };
  const originalFetch = gw.fetch;
  const originalPostMessage = workerScope.postMessage;
  const posted: CommanderToMainMessage[] = [];
  const mockSelf = workerScope;
  let engine: GameEngine;
  let persistState: ReturnType<typeof createTestPersistState>;
  let mockHost: MockHostBindings;

  function snapshotWithState(state: string): ReturnType<typeof buildSnapshot> {
    const snapshot = buildSnapshot(engine, 0);
    snapshot.meta.state = state as typeof snapshot.meta.state;
    return snapshot;
  }

  beforeEach(() => {
    workerScope.postMessage = (msg: CommanderToMainMessage) => posted.push(msg);
  });
  afterEach(() => {
    workerScope.postMessage = originalPostMessage;
    gw.fetch = originalFetch;
    vi.useRealTimers();
    posted.length = 0;
    mockSelf.onmessage?.({ data: { type: "stop" } });
  });

  function setup(): void {
    createTestMapThemeStore();
    persistState = createTestPersistState();
    mockHost = new MockHostBindings();
    engine = new GameEngine(persistState, createTestThemeBundle(), mockHost, 0);
    engine.loadMap(0);
    engine.waveManager?.startNextWave();
    for (let tick = 0; tick < 5; tick++) engine.update(fixedDeltaSeconds);
  }

  async function deliver(data: unknown): Promise<void> {
    const handler = mockSelf.onmessage;
    if (!handler) throw new Error("commander worker did not register onmessage");
    await (handler as (event: { data: unknown }) => Promise<void>)({ data });
  }

  it("skips the API request while paused and issues exactly one after unpause", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "[]" } }] }),
    })) as unknown as typeof fetch;
    gw.fetch = fetchFn;
    gw.self = mockSelf;

    await import("@/commanders/CommanderWorker.js");
    mockSelf.onmessage!({ data: { type: "start", kind: "llm", config: makeConfig() } });
    setup();

    // Several PAUSED observations: the worker must never call fetch.
    for (let i = 0; i < 3; i++) {
      mockSelf.onmessage!({ data: { type: "observation", slice: snapshotWithState(GameState.PAUSED) } });
      vi.advanceTimersByTime(200);
    }
    expect(fetchFn).toHaveBeenCalledTimes(0);

    // Advance past the 1 Hz cadence and post a non-paused observation.
    vi.advanceTimersByTime(1000);
    mockSelf.onmessage!({ data: { type: "observation", slice: snapshotWithState(GameState.PLAYING) } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(posted.some((message) => message.type === "hold")).toBe(false);
  });

  it("holds the sim clock around an in-flight decide when pauseForCommander is set", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let resolveFetch: (value: unknown) => void = () => {};
    const fetchFn = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;
    gw.fetch = fetchFn;
    gw.self = mockSelf;
    await import("@/commanders/CommanderWorker.js");
    await deliver({ type: "start", kind: "llm", config: { ...makeConfig(), pauseForCommander: true } });
    setup();
    posted.length = 0;

    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PAUSED) });
    expect(fetchFn).toHaveBeenCalledTimes(0);
    expect(posted.some((message) => message.type === "hold")).toBe(false);

    const playing = deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(posted.filter((message) => message.type === "hold")).toEqual([{ type: "hold", hold: true }]);

    resolveFetch({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "[]" } }] }),
    });
    await playing;
    await vi.advanceTimersByTimeAsync(0);
    expect(posted.filter((message) => message.type === "hold")).toEqual([
      { type: "hold", hold: true },
      { type: "hold", hold: false },
    ]);
  });

  it("rebuilds the prompt only when commander instructions change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchFn = vi.fn(async () => responseWithContent("[]"));
    gw.fetch = fetchFn as unknown as typeof fetch;
    gw.self = mockSelf;
    await import("@/commanders/CommanderWorker.js");
    await deliver({ type: "start", kind: "llm", config: makeConfig() });
    setup();
    await deliver({ type: "updateInstructions", text: "alpha" });

    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    // Finish the request at this timestamp. The next gap is measured from the reply.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const firstMessages = messagesFromCall(fetchFn, 0);
    expect(firstMessages[0]?.content).toContain("alpha");
    const firstUser = firstMessages.filter((message) => message.role === "user");
    expect(firstUser[firstUser.length - 1]?.content).toContain('"kind":"snapshot"');

    vi.advanceTimersByTime(1000);
    await deliver({ type: "updateInstructions", text: "alpha" });
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const secondUsers = messagesFromCall(fetchFn, 1).filter((message) => message.role === "user");
    expect(secondUsers[secondUsers.length - 1]?.content).toContain('"kind":"delta"');

    vi.advanceTimersByTime(1000);
    await deliver({ type: "updateInstructions", text: "beta" });
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    const thirdMessages = messagesFromCall(fetchFn, 2);
    expect(thirdMessages[0]?.content).toContain("beta");
    expect(thirdMessages.some((message) => message.role === "assistant")).toBe(false);
    const thirdUsers = thirdMessages.filter((message) => message.role === "user");
    expect(thirdUsers).toHaveLength(1);
    expect(thirdUsers[0]?.content).toContain('"kind":"snapshot"');
  });

  it("rebuilds a full snapshot after a progressive placement changes the layout generation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchFn = vi.fn(async () => responseWithContent("[]"));
    gw.fetch = fetchFn as unknown as typeof fetch;
    gw.self = mockSelf;
    await import("@/commanders/CommanderWorker.js");
    await deliver({ type: "start", kind: "llm", config: makeConfig() });
    setup();

    const withLayout = (generation: number): CommanderSnapshotSlice => {
      const slice = snapshotWithState(GameState.PLAYING) as unknown as CommanderSnapshotSlice;
      slice.gridLayout = [
        [1, 2],
        [3, 1],
      ];
      slice.meta.layoutGeneration = generation;
      return slice;
    };

    // First layout: full snapshot primes the transcript.
    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: withLayout(0) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(lastUserContent(fetchFn, 0)).toContain('"kind":"snapshot"');

    // Same generation, no layout re-ship: the next turn is a delta.
    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(lastUserContent(fetchFn, 1)).toContain('"kind":"delta"');

    // A placement re-indexes every tile (origin shift): the tile-keyed transcript is
    // stale, so the worker drops it and the next decide sends a full snapshot again.
    // The bumped slice arrives without the rectangle here (feed-off timing) and must
    // still drop at once, not one relay tick later.
    vi.advanceTimersByTime(1000);
    const bumpedWithoutLayout = snapshotWithState(GameState.PLAYING) as unknown as CommanderSnapshotSlice;
    bumpedWithoutLayout.meta.layoutGeneration = 1;
    await deliver({ type: "observation", slice: bumpedWithoutLayout });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(lastUserContent(fetchFn, 2)).toContain('"kind":"snapshot"');

    // The generation settled (no relay applies the feed-off in this harness, so the
    // slice must carry generation 1 explicitly or the engine's gen-0 layout would
    // look like another placement): back to deltas.
    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: withLayout(1) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(lastUserContent(fetchFn, 3)).toContain('"kind":"delta"');
  });

  it("notifies and keeps deciding after an observation throws", async () => {
    vi.useFakeTimers();
    gw.self = mockSelf;
    await import("@/commanders/CommanderWorker.js");
    await deliver({ type: "start", kind: "stubby" });
    setup();
    await deliver({ type: "observation", slice: { meta: {} } });
    const notified = posted.some(
      (message) => message.type === "notify" && message.message.startsWith("Commander error:"),
    );
    expect(notified).toBe(true);
    posted.length = 0;
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    expect(posted.some((message) => message.type === "commands")).toBe(true);
  });

  it("waits the decision interval after a paused request finishes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let resolveFetch: (value: unknown) => void = () => {};
    const fetchFn = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;
    gw.fetch = fetchFn;
    gw.self = mockSelf;
    await import("@/commanders/CommanderWorker.js");
    await deliver({
      type: "start",
      kind: "llm",
      config: { ...makeConfig(), pauseForCommander: true, decisionIntervalMs: 1000 },
    });
    setup();
    posted.length = 0;

    vi.advanceTimersByTime(1000);
    const playing = deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(posted.filter((message) => message.type === "hold")).toEqual([{ type: "hold", hold: true }]);

    vi.advanceTimersByTime(5000);
    resolveFetch({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "[]" } }] }),
    });
    await playing;
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(999);
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    const nextPlaying = deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(posted.filter((message) => message.type === "hold")).toEqual([
      { type: "hold", hold: true },
      { type: "hold", hold: false },
      { type: "hold", hold: true },
    ]);
    resolveFetch({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "[]" } }] }),
    });
    await nextPlaying;
    await vi.advanceTimersByTimeAsync(0);
  });

  it("applies pause and the call delay from updateCallSettings without restarting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchFn = vi.fn(async () => responseWithContent("[]")) as unknown as typeof fetch;
    gw.fetch = fetchFn;
    gw.self = mockSelf;
    await import("@/commanders/CommanderWorker.js");
    await deliver({ type: "start", kind: "llm", config: makeConfig() });
    setup();
    posted.length = 0;

    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(posted.some((message) => message.type === "hold")).toBe(false);

    await deliver({
      type: "updateCallSettings",
      pauseForCommander: true,
      decisionIntervalMs: 1000,
      reasoningEnabled: false,
    });
    vi.advanceTimersByTime(1000);
    posted.length = 0;
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(posted.filter((message) => message.type === "hold")).toEqual([
      { type: "hold", hold: true },
      { type: "hold", hold: false },
    ]);

    await deliver({
      type: "updateCallSettings",
      pauseForCommander: true,
      decisionIntervalMs: 5000,
      reasoningEnabled: false,
    });
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(4999);
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1);
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(posted.filter((message) => message.type === "hold")).toEqual([
      { type: "hold", hold: true },
      { type: "hold", hold: false },
      { type: "hold", hold: true },
      { type: "hold", hold: false },
    ]);
  });

  it("sends the reasoning fields from updateCallSettings on the next request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchFn = vi.fn(async () => responseWithContent("[]")) as unknown as typeof fetch;
    gw.fetch = fetchFn;
    gw.self = mockSelf;
    await import("@/commanders/CommanderWorker.js");
    await deliver({ type: "start", kind: "llm", config: makeConfig() });
    setup();

    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    const calls = (fetchFn as unknown as { mock: { calls: Array<[string, { body?: string }]> } }).mock.calls;
    const firstBody = JSON.parse(String(calls[0]?.[1].body)) as { reasoning_effort?: string };
    expect(firstBody.reasoning_effort).toBe("none");

    await deliver({
      type: "updateCallSettings",
      pauseForCommander: false,
      decisionIntervalMs: 1000,
      reasoningEnabled: true,
    });
    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    const secondBody = JSON.parse(String(calls[1]?.[1].body)) as {
      reasoning_effort?: string;
      enable_thinking?: boolean;
      thinking?: { type: string };
    };
    expect(secondBody.reasoning_effort).toBe("medium");
    expect(secondBody.enable_thinking).toBe(true);
    expect(secondBody.thinking).toEqual({ type: "enabled" });
  });

  function traceMessages(): { responseText: string; commandSummary: string }[] {
    return posted.flatMap((message) =>
      message.type === "trace" ? [{ responseText: message.responseText, commandSummary: message.commandSummary }] : [],
    );
  }

  it("posts the raw model body and a command summary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const raw = JSON.stringify([
      { type: "llm:routeGroup", enemyIds: [1], hold: true, holdTile: { x: 3, y: 4 }, waypoints: [] },
    ]);
    const fetchFn = vi.fn(async () => responseWithContent(raw));
    gw.fetch = fetchFn as unknown as typeof fetch;
    gw.self = mockSelf;
    await import("@/commanders/CommanderWorker.js");
    await deliver({ type: "start", kind: "llm", config: makeConfig() });
    setup();
    posted.length = 0;

    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(traceMessages()).toEqual([{ responseText: raw, commandSummary: "hold 1 at (3, 4)" }]);
  });

  it("keeps the chat sentence in the chat log and the raw body in the trace", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const raw = JSON.stringify({
      commands: [{ type: "llm:routeGroup", enemyIds: [1], hold: true, waypoints: [] }],
      chat: "moving",
    });
    const fetchFn = vi.fn(async () => responseWithContent(raw));
    gw.fetch = fetchFn as unknown as typeof fetch;
    gw.self = mockSelf;
    await import("@/commanders/CommanderWorker.js");
    await deliver({ type: "start", kind: "llm", config: makeConfig() });
    setup();
    posted.length = 0;

    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(posted.some((message) => message.type === "chat" && message.text === "moving")).toBe(true);
    expect(traceMessages()[0]?.responseText).toBe(raw);
    expect(traceMessages()[0]?.commandSummary).toBe("hold 1");
  });

  it("traces a non-JSON body and does not apply commander commands", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchFn = vi.fn(async () => responseWithContent("this is not json"));
    gw.fetch = fetchFn as unknown as typeof fetch;
    gw.self = mockSelf;
    await import("@/commanders/CommanderWorker.js");
    await deliver({ type: "start", kind: "llm", config: makeConfig() });
    setup();
    posted.length = 0;

    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    const applied = posted.flatMap((message) => (message.type === "commands" ? message.commands : []));
    expect(applied.every((command) => command.type === "llm:setGridLayoutFeed")).toBe(true);
    expect(traceMessages()[0]?.responseText).toBe("this is not json");
    expect(traceMessages()[0]?.commandSummary).toContain("rejected:");
  });

  it("traces a repeated transport failure without a second toast", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchFn = vi.fn(async () => ({ ok: false, status: 500, text: async () => "" }));
    gw.fetch = fetchFn as unknown as typeof fetch;
    gw.self = mockSelf;
    await import("@/commanders/CommanderWorker.js");
    await deliver({ type: "start", kind: "llm", config: makeConfig() });
    setup();
    posted.length = 0;

    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(0);
    expect(traceMessages()).toEqual([{ responseText: "", commandSummary: "request failed: status 500" }]);

    vi.advanceTimersByTime(1000);
    await deliver({ type: "observation", slice: snapshotWithState(GameState.PLAYING) });
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(traceMessages()).toEqual([
      { responseText: "", commandSummary: "request failed: status 500" },
      { responseText: "", commandSummary: "request failed: status 500" },
    ]);
    expect(posted.filter((message) => message.type === "notify")).toHaveLength(1);
  });
});

describe("Unit: LLM brain round-trip + malformed", () => {
  it("translates a valid routeGroup response into a Command", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([{ type: "llm:routeGroup", enemyIds: [1], waypoints: [{ x: 1, y: 1 }] }]),
              },
            },
          ],
          usage: { prompt_tokens: 7 },
        }),
    })) as unknown as typeof fetch;
    const brain = createLlmBrain(makeConfig(), { fetchFn });
    const commands = await brain.decide(makeObservation(), makeMemory());
    const route = commands.find((command) => command.type === "llm:routeGroup");
    expect(route).toBeDefined();
    if (route && route.type === "llm:routeGroup") {
      expect(route.enemyIds).toEqual([1]);
      expect(route.waypoints).toEqual([{ x: 1, y: 1 }]);
    }
  });

  it("returns no commands and notifies on a malformed response", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "this is not json",
    })) as unknown as typeof fetch;
    const notify = vi.fn();
    const brain = createLlmBrain(makeConfig(), { fetchFn, onNotify: notify });
    const commands = await brain.decide(makeObservation(), makeMemory());
    expect(commands).toHaveLength(0);
    expect(notify).toHaveBeenCalled();
  });

  it("forwards a chat message when present", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ commands: [], chat: "greetings" }) } }] }),
    })) as unknown as typeof fetch;
    const chat = vi.fn();
    const brain = createLlmBrain(makeConfig(), { fetchFn, onChat: chat });
    await brain.decide(makeObservation(), makeMemory());
    expect(chat).toHaveBeenCalledWith("greetings");
  });

  it("resends the transcript, deltas changes and removals, and coalesces player text", async () => {
    const assistant = "[]";
    const fetchFn = vi.fn(async () => responseWithContent(assistant));
    const brain = createLlmBrain(makeConfig(), { fetchFn: fetchFn as unknown as typeof fetch });
    const memory = makeMemory();
    const first = makeObservation();
    first.enemies = [
      { id: 1, tileX: 0, tileY: 0, level: 1, hp: 10, maxHp: 10 },
      { id: 2, tileX: 2, tileY: 2, level: 1, hp: 8, maxHp: 8 },
      { id: 3, tileX: 3, tileY: 3, level: 1, hp: 4, maxHp: 4 },
      { id: 4, tileX: 1, tileY: 1, level: 1, hp: 6, maxHp: 6 },
    ];
    await brain.decide(first, memory);

    const second = makeObservation();
    second.enemies = [
      { id: 1, tileX: 1, tileY: 0, level: 1, hp: 10, maxHp: 10 },
      { id: 2, tileX: 2, tileY: 2, level: 1, hp: 8, maxHp: 8, routingMode: "hold" },
      { id: 4, tileX: 1, tileY: 1, level: 1, hp: 6, maxHp: 6 },
    ];
    memory.pendingPlayerMessages.push("hold north");
    await brain.decide(second, memory);

    const messages = messagesFromCall(fetchFn, 1);
    expect(messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[1]?.content).toContain('"kind":"snapshot"');
    expect(messages[2]?.content).toBe(assistant);
    const deltaMessage = messages[3]?.content ?? "";
    expect(deltaMessage).toContain('"kind":"delta"');
    expect(deltaMessage).toContain("Player message:\nhold north");
    const delta = JSON.parse(deltaMessage.split("\n\n")[0] ?? "") as {
      changedEnemies: { id: number; routingMode?: string }[];
      newEnemies: { id: number }[];
      removedEnemyIds: number[];
    };
    expect(delta.removedEnemyIds).toEqual([3]);
    expect(delta.newEnemies).toEqual([]);
    expect(delta.changedEnemies.map((enemy) => enemy.id).sort()).toEqual([1, 2]);
    expect(delta.changedEnemies.find((enemy) => enemy.id === 2)?.routingMode).toBe("hold");
  });

  it("keys tower deltas by stable id across an origin shift", async () => {
    const fetchFn = vi.fn(async () => responseWithContent("[]"));
    const brain = createLlmBrain(makeConfig(), { fetchFn: fetchFn as unknown as typeof fetch });
    const memory = makeMemory();
    const first = makeObservation();
    first.towers = [{ id: "tower-a", tileX: 2, tileY: 3, level: 1, hp: 20, maxHp: 20 }];
    await brain.decide(first, memory);

    const second = makeObservation();
    // A west/north progressive placement lowers the origin and re-indexes every
    // surviving tower. Keyed by id, the tower diffs as moved, not removed + new.
    second.towers = [{ id: "tower-a", tileX: 5, tileY: 3, level: 1, hp: 20, maxHp: 20 }];
    await brain.decide(second, memory);

    const deltaMessage = lastUserContent(fetchFn, 1);
    expect(deltaMessage).toContain('"kind":"delta"');
    const delta = JSON.parse(deltaMessage.split("\n\n")[0] ?? "") as {
      newTowers: unknown[];
      removedTowers: unknown[];
      changedTowers: { x: number; y: number }[];
    };
    expect(delta.removedTowers).toEqual([]);
    expect(delta.newTowers).toEqual([]);
    expect(delta.changedTowers).toEqual([expect.objectContaining({ x: 5, y: 3 })]);
  });

  it("rebuilds a full snapshot once the context budget is exceeded", async () => {
    const fetchFn = vi.fn(async () => responseWithContent("[]", 100));
    const config = makeConfig();
    config.contextLimit = 100;
    const brain = createLlmBrain(config, { fetchFn: fetchFn as unknown as typeof fetch });
    const memory = makeMemory();
    await brain.decide(makeObservation(), memory);
    expect(memory.isCompressing).toBe(true);

    const nextObservation = makeObservation();
    nextObservation.enemies = [{ id: 9, tileX: 1, tileY: 1, level: 1, hp: 3, maxHp: 3 }];
    await brain.decide(nextObservation, memory);
    const messages = messagesFromCall(fetchFn, 1);
    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(messages[1]?.content).toContain('"kind":"snapshot"');
    expect(messages[1]?.content).toContain('"id":9');
  });

  it("restores the transcript when the request fails", async () => {
    const fetchFn = vi.fn();
    fetchFn.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "" });
    fetchFn.mockResolvedValueOnce(responseWithContent("[]"));
    const notify = vi.fn();
    const brain = createLlmBrain(makeConfig(), { fetchFn: fetchFn as unknown as typeof fetch, onNotify: notify });
    const memory = makeMemory();
    const commands = await brain.decide(makeObservation(), memory);
    expect(commands).toEqual([]);
    expect(memory.conversation).toEqual([]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("LLM request failed:"));

    await brain.decide(makeObservation(), memory);
    const messages = messagesFromCall(fetchFn, 1);
    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(messages[1]?.content).toContain('"kind":"snapshot"');
    expect(messages[1]?.content).not.toContain("Previous reply was rejected");
  });

  it("keeps a mid-request transcript drop clean instead of appending onto it", async () => {
    let firstCall = true;
    let resolveFirst: (value: unknown) => void = () => {};
    const fetchMock = vi.fn(() => {
      if (firstCall) {
        firstCall = false;
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(responseWithContent("[]"));
    });
    const brain = createLlmBrain(makeConfig(), { fetchFn: fetchMock as unknown as typeof fetch });
    const memory = makeMemory();
    memory.pendingPlayerMessages.push("hold north");
    const inFlight = brain.decide(makeObservation(), memory);

    // The worker drops the transcript mid-request (run restart / progressive placement).
    memory.conversation = [];
    memory.lastObservation = null;
    memory.isCompressing = false;
    memory.rejectionNote = null;

    resolveFirst(responseWithContent("[]"));
    const commands = await inFlight;
    expect(commands).toEqual([]);
    // No dangling assistant reply on the fresh context, and the player message that
    // never reached it is re-delivered next turn.
    expect(memory.conversation).toEqual([]);
    expect(memory.pendingPlayerMessages).toEqual(["hold north"]);

    // The next decide rebuilds the full snapshot and coalesces the player text.
    await brain.decide(makeObservation(), memory);
    const messages = messagesFromCall(fetchMock, 1);
    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    const rebuilt = messages[messages.length - 1]?.content ?? "";
    expect(rebuilt).toContain('"kind":"snapshot"');
    expect(rebuilt).toContain("Player message:\nhold north");
  });

  it("applies valid sibling commands when one entry is rejected", async () => {
    const content = JSON.stringify([
      { type: "llm:routeGroup", enemyIds: [1], waypoints: [{ x: 1, y: 1 }] },
      { type: "llm:notACommand" },
    ]);
    const fetchFn = vi.fn(async () => responseWithContent(content));
    const notify = vi.fn();
    const memory = makeMemory();
    const brain = createLlmBrain(makeConfig(), { fetchFn: fetchFn as unknown as typeof fetch, onNotify: notify });
    const commands = await brain.decide(makeObservation(), memory);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe("llm:routeGroup");
    expect(notify).toHaveBeenCalled();
    expect(memory.conversation.some((message) => message.role === "assistant")).toBe(true);
  });

  it("sends snapped tower distance, base health, and the inter-wave countdown", async () => {
    const fetchFn = vi.fn(async () => responseWithContent("[]"));
    const brain = createLlmBrain(makeConfig(), { fetchFn: fetchFn as unknown as typeof fetch });
    const observation = makeObservation();
    observation.map = [
      [0, 1],
      [0, 1],
    ];
    observation.nav = {
      pathVersion: 1,
      distanceToBase: [
        [-1, 4],
        [-1, 2],
      ],
      spawnReachable: [true],
    };
    observation.towers = [{ tileX: 0, tileY: 0, level: 1, hp: 20, maxHp: 20, type: "basic" }];
    await brain.decide(observation, makeMemory());
    const snapshot = JSON.parse(messagesFromCall(fetchFn, 0)[1]?.content ?? "") as {
      towers: { distanceToBase: number }[];
      wave: { baseHp: number; maxBaseHp: number; countdownSeconds: number | null };
    };
    expect(snapshot.towers[0]?.distanceToBase).toBe(4);
    expect(snapshot.wave).toMatchObject({ baseHp: 40, maxBaseHp: 100, countdownSeconds: 12.3 });
  });

  it("lists a zero-hp tower as removed and reports a distance-only enemy change", async () => {
    const fetchFn = vi.fn(async () => responseWithContent("[]"));
    const brain = createLlmBrain(makeConfig(), { fetchFn: fetchFn as unknown as typeof fetch });
    const memory = makeMemory();
    const first = makeObservation();
    first.enemies = [
      { id: 1, tileX: 0, tileY: 0, level: 1, hp: 10, maxHp: 10, distanceToBase: 5, routingMode: "hold" },
    ];
    first.towers = [{ tileX: 1, tileY: 1, level: 1, hp: 20, maxHp: 20 }];
    await brain.decide(first, memory);
    const second = makeObservation();
    second.enemies = [
      { id: 1, tileX: 0, tileY: 0, level: 1, hp: 10, maxHp: 10, distanceToBase: 3, routingMode: "hold" },
    ];
    second.towers = [{ tileX: 1, tileY: 1, level: 1, hp: 0, maxHp: 20 }];
    await brain.decide(second, memory);
    const secondMessages = messagesFromCall(fetchFn, 1);
    const delta = JSON.parse(secondMessages[secondMessages.length - 1]?.content ?? "") as {
      changedEnemies: { id: number; distanceToBase: number }[];
      changedTowers: unknown[];
      removedTowers: { x: number; y: number }[];
    };
    expect(delta.changedEnemies).toEqual([expect.objectContaining({ id: 1, distanceToBase: 3 })]);
    expect(delta.changedTowers).toEqual([]);
    expect(delta.removedTowers).toEqual([{ x: 1, y: 1 }]);
  });

  it("parses a fenced json body into commands", async () => {
    const fenced = '```json\n[{"type":"llm:routeGroup","enemyIds":[1],"waypoints":[]}]\n```';
    const fetchFn = vi.fn(async () => responseWithContent(fenced));
    const brain = createLlmBrain(makeConfig(), { fetchFn: fetchFn as unknown as typeof fetch });
    const commands = await brain.decide(makeObservation(), makeMemory());
    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe("llm:routeGroup");
  });

  it("tells the model about a rejected reply and suppresses a repeated toast until one is accepted", async () => {
    const fetchFn = vi.fn();
    fetchFn.mockResolvedValueOnce(responseWithContent("not json at all"));
    fetchFn.mockResolvedValueOnce(responseWithContent("still not json"));
    fetchFn.mockResolvedValueOnce(responseWithContent("[]"));
    fetchFn.mockResolvedValueOnce(responseWithContent("nope"));
    const notify = vi.fn();
    const trace = vi.fn();
    const brain = createLlmBrain(makeConfig(), {
      fetchFn: fetchFn as unknown as typeof fetch,
      onNotify: notify,
      onTrace: trace,
    });
    const memory = makeMemory();
    await brain.decide(makeObservation(), memory);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("LLM response was not valid JSON");
    expect(trace).toHaveBeenCalledTimes(1);
    expect(trace).toHaveBeenCalledWith({
      responseText: "not json at all",
      commandSummary: "rejected: LLM response was not valid JSON",
    });
    expect(memory.conversation).toEqual([]);

    await brain.decide(makeObservation(), memory);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(trace).toHaveBeenCalledTimes(2);
    expect(trace).toHaveBeenLastCalledWith({
      responseText: "still not json",
      commandSummary: "rejected: LLM response was not valid JSON",
    });
    const secondMessages = messagesFromCall(fetchFn, 1);
    const userMessage = secondMessages[secondMessages.length - 1]?.content ?? "";
    expect(userMessage).toContain("Previous reply was rejected: LLM response was not valid JSON");

    await brain.decide(makeObservation(), memory);
    expect(memory.rejectionNote).toBeNull();

    await brain.decide(makeObservation(), memory);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("rejects an unknown setTargeting mode with an error string", async () => {
    const parsed = validateLlmResponse([{ type: "llm:setTargeting", enemyIds: [1], mode: "snipe" }], makeConfig());
    expect(parsed.commands).toEqual([]);
    expect(parsed.error).toBe("setTargeting unknown mode: snipe");

    const content = JSON.stringify([{ type: "llm:setTargeting", enemyIds: [1], mode: "snipe" }]);
    const fetchFn = vi.fn(async () => responseWithContent(content));
    const notify = vi.fn();
    const brain = createLlmBrain(makeConfig(), { fetchFn: fetchFn as unknown as typeof fetch, onNotify: notify });
    const memory = makeMemory();
    const commands = await brain.decide(makeObservation(), memory);
    expect(commands).toEqual([]);
    expect(memory.rejectionNote).toContain("setTargeting unknown mode: snipe");
    expect(notify).toHaveBeenCalled();
  });

  it("records empty enemyIds as an error instead of silently skipping", async () => {
    const parsed = validateLlmResponse([{ type: "llm:routeGroup", enemyIds: [], waypoints: [] }], makeConfig());
    expect(parsed.commands).toEqual([]);
    expect(parsed.error).toBe("empty enemyIds");

    const content = JSON.stringify([{ type: "llm:routeGroup", enemyIds: [], waypoints: [] }]);
    const fetchFn = vi.fn(async () => responseWithContent(content));
    const brain = createLlmBrain(makeConfig(), { fetchFn: fetchFn as unknown as typeof fetch });
    const memory = makeMemory();
    const commands = await brain.decide(makeObservation(), memory);
    expect(commands).toEqual([]);
    expect(memory.rejectionNote).toContain("empty enemyIds");
  });

  it("rejects a malformed routeGroup and resends the reason next turn", async () => {
    const parsed = validateLlmResponse([{ type: "llm:routeGroup", hold: true }], makeConfig());
    expect(parsed.commands).toEqual([]);
    expect(parsed.error).toBe("routeGroup is invalid");

    const fetchFn = vi.fn();
    fetchFn.mockResolvedValueOnce(responseWithContent(JSON.stringify([{ type: "llm:routeGroup", hold: true }])));
    fetchFn.mockResolvedValueOnce(responseWithContent("[]"));
    const brain = createLlmBrain(makeConfig(), { fetchFn: fetchFn as unknown as typeof fetch });
    const memory = makeMemory();
    const commands = await brain.decide(makeObservation(), memory);
    expect(commands).toEqual([]);
    expect(memory.rejectionNote).toContain("routeGroup is invalid");

    await brain.decide(makeObservation(), memory);
    const messages = messagesFromCall(fetchFn, 1);
    const userMessage = messages[messages.length - 1]?.content ?? "";
    expect(userMessage).toContain("Previous reply was rejected: LLM response rejected: routeGroup is invalid");
  });

  it("filters out-of-bounds tiles but keeps sibling valid commands with a corrective note", async () => {
    const content = JSON.stringify([
      { type: "llm:routeGroup", enemyIds: [1], waypoints: [{ x: 1, y: 1 }] },
      { type: "llm:routeGroup", enemyIds: [1], waypoints: [{ x: 99, y: 99 }] },
    ]);
    const fetchFn = vi.fn(async () => responseWithContent(content));
    const notify = vi.fn();
    const brain = createLlmBrain(makeConfig(), { fetchFn: fetchFn as unknown as typeof fetch, onNotify: notify });
    const memory = makeMemory();
    const commands = await brain.decide(makeObservation(), memory);
    expect(commands).toHaveLength(2);
    const filteredCommand = commands[1];
    expect(filteredCommand?.type).toBe("llm:routeGroup");
    if (filteredCommand?.type === "llm:routeGroup") expect(filteredCommand.waypoints).toEqual([]);
    expect(memory.rejectionNote).toContain("out-of-bounds");
    expect(memory.conversation.some((message) => message.role === "assistant")).toBe(true);
    expect(notify).toHaveBeenCalled();
  });

  it("drops commands for unknown enemy ids and rejects when every command is filtered", async () => {
    const mixedContent = JSON.stringify([
      { type: "llm:routeGroup", enemyIds: [1], waypoints: [{ x: 1, y: 1 }] },
      { type: "llm:routeGroup", enemyIds: [99], waypoints: [{ x: 0, y: 0 }] },
    ]);
    const mixedFetch = vi.fn(async () => responseWithContent(mixedContent));
    const mixedBrain = createLlmBrain(makeConfig(), { fetchFn: mixedFetch as unknown as typeof fetch });
    const mixedMemory = makeMemory();
    const mixedCommands = await mixedBrain.decide(makeObservation(), mixedMemory);
    expect(mixedCommands).toHaveLength(1);
    expect(mixedMemory.rejectionNote).toContain("unknown enemyIds");
    expect(mixedMemory.conversation.some((message) => message.role === "assistant")).toBe(true);

    const allDroppedContent = JSON.stringify([{ type: "llm:routeGroup", enemyIds: [99], waypoints: [{ x: 0, y: 0 }] }]);
    const droppedFetch = vi.fn(async () => responseWithContent(allDroppedContent));
    const droppedBrain = createLlmBrain(makeConfig(), { fetchFn: droppedFetch as unknown as typeof fetch });
    const droppedMemory = makeMemory();
    const droppedCommands = await droppedBrain.decide(makeObservation(), droppedMemory);
    expect(droppedCommands).toEqual([]);
    expect(droppedMemory.rejectionNote).toContain("unknown enemyIds");
    expect(droppedMemory.conversation).toEqual([]);
  });
});
