import type { Command } from "@/sim/Command.js";
import { GameState } from "@/sim/GameRunState.js";
import type { CommanderBrain, CommanderMemory } from "./brain.js";
import { createBrain } from "./brain.js";
import { createLlmBrain } from "./llm/brain.js";
import {
  DEFAULT_DECISION_INTERVAL_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type LlmCommanderConfig,
  normalizeDecisionIntervalMs,
} from "./llm/types.js";
import type { CommanderObservation } from "./observation.js";
import { buildObservation } from "./observation.js";
import type {
  CommanderKind,
  CommanderSnapshotSlice,
  CommanderToMainMessage,
  MainToCommanderMessage,
} from "./protocol.js";

// Inside the worker, `self` is the global DedicatedWorkerGlobalScope. Declared
// minimally to avoid pulling in the WebWorker lib (which conflicts with the DOM lib).
interface WorkerGlobalScope {
  postMessage(message: CommanderToMainMessage): void;
  onmessage: ((event: MessageEvent<MainToCommanderMessage>) => void) | null;
}
declare const self: WorkerGlobalScope;

let brain: CommanderBrain | null = null;
let brainKind: CommanderKind = "stubby";
const memory: CommanderMemory = {
  phase: "idle",
  seenByWave: new Map<number, Set<number>>(),
  lastRushWaveNumber: null,
  lastRoutedTowerSignature: "",
  gridLayout: undefined,
  heights: undefined,
  conversation: [],
  tokenCount: 0,
  lastObservation: null,
  commanderInstructions: "",
  pendingPlayerMessages: [],
  isCompressing: false,
  rejectionNote: null,
};
let gridLayoutToggleSent = false;
let cachedLayoutGeneration = -1;
// The layout generation the live LLM transcript was built on. -1 = no transcript yet.
let conversationLayoutGeneration = -1;
// The run the cached layout belongs to (GameEngine.runId). On a run restart the
// previous layout is stale and the one-shot feed-off toggle must re-arm, so the
// engine's freshly re-enabled feed is turned back off after the new map is cached.
let lastRunId: number | null = null;

// LLM-brain cadence + in-flight guard. The relay polls at ~4 Hz. A new decide waits
// until decisionIntervalMs after the previous one finished. An in-flight decide drops its tick.
let deciding = false;
let lastDecisionTimeMs = 0;
let decisionIntervalMs = DEFAULT_DECISION_INTERVAL_MS;
let pausedForBrain = false;
let pauseForCommander = false;
let activeLlmConfig: LlmCommanderConfig | null = null;
let latestObservation: CommanderObservation | null = null;

// Slack past the fetch abort timer after which a posted hold is force-released.
const holdCapSlackMs = 5000;

function postToMain(message: CommanderToMainMessage): void {
  self.postMessage(message);
}

function commandsMessage(commands: Command[], observationId: number | undefined): CommanderToMainMessage {
  if (observationId === undefined) return { type: "commands", commands };
  return { type: "commands", commands, observationId };
}

function resetMemory(): void {
  memory.phase = "idle";
  memory.seenByWave = new Map<number, Set<number>>();
  memory.lastRushWaveNumber = null;
  memory.lastRoutedTowerSignature = "";
  memory.gridLayout = undefined;
  memory.heights = undefined;
  memory.conversation = [];
  memory.tokenCount = 0;
  memory.lastObservation = null;
  memory.commanderInstructions = "";
  memory.pendingPlayerMessages = [];
  memory.isCompressing = false;
  memory.rejectionNote = null;
  gridLayoutToggleSent = false;
  cachedLayoutGeneration = -1;
  conversationLayoutGeneration = -1;
  lastRunId = null;
  deciding = false;
  lastDecisionTimeMs = 0;
  pausedForBrain = false;
  latestObservation = null;
}

// Issues an async decide for the LLM brain with an in-flight guard, a gap after the
// previous decide, and a pause skip. Backoff is awaited before the observation is
// sampled. A thrown decide notifies and does not kill the worker.
async function decideLlm(): Promise<void> {
  if (!brain || deciding || pausedForBrain) return;
  const now = Date.now();
  if (now - lastDecisionTimeMs < decisionIntervalMs) return;
  deciding = true;
  const holding = pauseForCommander;
  let holdPosted = false;
  let holdCapTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    if (brain.awaitReady) await brain.awaitReady();
    if (pausedForBrain || !latestObservation) return;
    const consumedObservation = latestObservation;
    if (holding) {
      // Crosses the worker boundary: stops the sim clock for the in-flight request.
      // Posted after the backoff wait so the clock keeps running while waiting.
      postToMain({ type: "hold", hold: true });
      holdPosted = true;
      const holdCapMs = (activeLlmConfig?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS) + holdCapSlackMs;
      holdCapTimer = setTimeout(() => {
        // Crosses the worker boundary: force-releases a hold the bounded fetch did not release.
        if (holdPosted) {
          holdPosted = false;
          postToMain({ type: "hold", hold: false });
        }
      }, holdCapMs);
    }
    const commands = await brain.decide(consumedObservation, memory);
    postToMain(commandsMessage(commands, consumedObservation.observationId));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    postToMain({ type: "notify", message: `Commander error: ${errorMessage}` });
  } finally {
    if (holdCapTimer !== null) clearTimeout(holdCapTimer);
    // Stamp after the request. pauseForCommander stops the sim clock for the whole
    // call, so a start stamp lets the request consume the gap and the next observation
    // re-pauses immediately.
    lastDecisionTimeMs = Date.now();
    // Crosses the worker boundary: restarts the sim clock once the request settles.
    if (holdPosted) postToMain({ type: "hold", hold: false });
    deciding = false;
  }
}

self.onmessage = (event: MessageEvent<MainToCommanderMessage>) => {
  return handleCommanderMessage(event.data);
};

async function handleCommanderMessage(message: MainToCommanderMessage): Promise<void> {
  try {
    await dispatchCommanderMessage(message);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    postToMain({ type: "notify", message: `Commander error: ${errorMessage}` });
  }
}

async function dispatchCommanderMessage(message: MainToCommanderMessage): Promise<void> {
  switch (message.type) {
    case "start": {
      brainKind = message.kind;
      const llmConfig: LlmCommanderConfig | undefined = message.config;
      if (brainKind === "llm") {
        brain = llmConfig
          ? createLlmBrain(llmConfig, {
              onChat: (text) => postToMain({ type: "chat", text, from: "commander" }),
              onNotify: (messageText) => postToMain({ type: "notify", message: messageText }),
              onTrace: (entry) =>
                postToMain({ type: "trace", responseText: entry.responseText, commandSummary: entry.commandSummary }),
              fetchFn: globalThis.fetch,
            })
          : null;
      } else {
        brain = createBrain(message.kind);
      }
      resetMemory();
      // Config, not run memory. resetMemory runs on every start and must not clear these.
      pauseForCommander = brainKind === "llm" && message.config?.pauseForCommander === true;
      decisionIntervalMs =
        brainKind === "llm"
          ? normalizeDecisionIntervalMs(message.config?.decisionIntervalMs)
          : DEFAULT_DECISION_INTERVAL_MS;
      // The brain closes over this object. Later call-settings updates mutate it so
      // the next complete() sends the new reasoning fields. The in-flight body is
      // already serialized.
      activeLlmConfig = brainKind === "llm" && llmConfig ? llmConfig : null;
      if (activeLlmConfig) activeLlmConfig.reasoningEnabled = activeLlmConfig.reasoningEnabled === true;
      break;
    }
    case "stop": {
      brain = null;
      activeLlmConfig = null;
      break;
    }
    case "chat": {
      memory.pendingPlayerMessages.push(message.text);
      break;
    }
    case "updateInstructions": {
      if (message.text === memory.commanderInstructions) break;
      memory.commanderInstructions = message.text;
      memory.isCompressing = true;
      break;
    }
    case "updateCallSettings": {
      if (brainKind !== "llm") break;
      pauseForCommander = message.pauseForCommander === true;
      decisionIntervalMs = normalizeDecisionIntervalMs(message.decisionIntervalMs);
      if (activeLlmConfig) activeLlmConfig.reasoningEnabled = message.reasoningEnabled === true;
      break;
    }
    case "observation": {
      if (!brain) break;
      const slice: CommanderSnapshotSlice = message.slice;
      const commands: Command[] = [];
      // Detect a run restart (engine reloaded a map → runId bumped). The previous
      // run's cached layout is stale and must be dropped, and the one-shot feed-off
      // toggle must re-arm so the freshly re-enabled feed is turned back off after
      // the new map is cached. Robust to same-map replays (runId changes even when
      // mapIndex/layout do not). The first observation of a session (lastRunId null)
      // also initializes correctly.
      if ((slice.meta.runId ?? null) !== lastRunId) {
        lastRunId = slice.meta.runId ?? null;
        memory.gridLayout = undefined;
        memory.heights = undefined;
        gridLayoutToggleSent = false;
        cachedLayoutGeneration = -1;
        conversationLayoutGeneration = -1;
        memory.phase = "idle";
        memory.seenByWave = new Map<number, Set<number>>();
        memory.lastRushWaveNumber = null;
        memory.lastRoutedTowerSignature = "";
        memory.conversation = [];
        memory.tokenCount = 0;
        memory.lastObservation = null;
        memory.isCompressing = false;
        memory.rejectionNote = null;
        // Player instructions and queued chat are not map state. The transcript is:
        // it names the previous run's enemies, so a sim runId bump drops it. The
        // rejection note describes that transcript, so it is dropped with it.
      }
      // Progressive placements bump layoutGeneration on every snapshot meta, but
      // the rectangle itself ships only while the one-shot gridLayout feed is on.
      // Compare the generation (not the layout) so a bumped slice that arrives
      // after the feed-off still drops the stale tile-keyed transcript at once
      // instead of one relay tick later.
      const generation = slice.meta.layoutGeneration ?? 0;
      if (
        brainKind === "llm" &&
        memory.conversation.length > 0 &&
        conversationLayoutGeneration !== -1 &&
        generation !== conversationLayoutGeneration
      ) {
        // A placement west/north re-indexes every tile (origin shift). The transcript is
        // tile-keyed, so its coordinates and map image are stale, and stale hold/waypoint
        // tiles from earlier turns pass the bounds filter onto shifted physical tiles.
        // Drop the transcript so the next decide rebuilds the full snapshot on the new
        // rectangle. Already-applied orders need no shift — the engine moves route and
        // order tiles, and world positions stay put.
        memory.conversation = [];
        memory.tokenCount = 0;
        memory.lastObservation = null;
        memory.isCompressing = false;
        memory.rejectionNote = null;
      }
      conversationLayoutGeneration = generation;
      if (slice.gridLayout) {
        memory.gridLayout = slice.gridLayout;
        if (slice.heights) memory.heights = slice.heights;
        // Normal maps ship the layout once. A progressive placement bumps
        // layoutGeneration and re-enables the feed, so the worker caches the new
        // rectangle and turns the feed off again.
        if (!gridLayoutToggleSent || generation !== cachedLayoutGeneration) {
          cachedLayoutGeneration = generation;
          gridLayoutToggleSent = true;
          commands.push({ commandId: 0, type: "llm:setGridLayoutFeed", enabled: false });
        }
      }
      const observation: CommanderObservation = buildObservation({
        ...slice,
        gridLayout: memory.gridLayout ?? slice.gridLayout,
        heights: memory.heights ?? slice.heights,
      });
      // The one-shot gridLayout feed-off command is posted on its own message so both the
      // stub and LLM paths share it, then each path posts its own command batch.
      if (commands.length > 0) {
        postToMain(commandsMessage(commands, observation.observationId));
      }
      if (brainKind === "llm") {
        latestObservation = observation;
        pausedForBrain = slice.meta.state === GameState.PAUSED;
        void decideLlm();
      } else {
        const decision = brain.decide(observation, memory);
        const brainCommands = decision instanceof Promise ? await decision : decision;
        postToMain(commandsMessage(brainCommands, observation.observationId));
      }
      break;
    }
  }
}
