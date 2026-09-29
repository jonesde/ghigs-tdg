import type { Command } from "@/sim/Command.js";
import { GameState } from "@/sim/Constants.js";
import type { CommanderBrain, CommanderMemory } from "./brain.js";
import { createBrain } from "./brain.js";
import { createLlmBrain } from "./llm/brain.js";
import type { LlmCommanderConfig } from "./llm/types.js";
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
  conversation: [],
  tokenCount: 0,
  lastObservation: null,
  commanderInstructions: "",
  pendingPlayerMessages: [],
  isCompressing: false,
};
let gridLayoutToggleSent = false;
// The run the cached layout belongs to (GameEngine.runId). On a run restart the
// previous layout is stale and the one-shot feed-off toggle must re-arm, so the
// engine's freshly re-enabled feed is turned back off after the new map is cached.
let lastRunId: number | null = null;

// LLM-brain cadence + in-flight guard. The relay polls at ~4 Hz but we only call
// the API about once per second; an in-flight decide is skipped (its tick dropped).
let deciding = false;
let lastDecisionTimeMs = 0;
const LLM_DECISION_INTERVAL_MS = 1000;
let pausedForBrain = false;
let latestObservation: CommanderObservation | null = null;

function postToMain(message: CommanderToMainMessage): void {
  self.postMessage(message);
}

function resetMemory(): void {
  memory.phase = "idle";
  memory.seenByWave = new Map<number, Set<number>>();
  memory.lastRushWaveNumber = null;
  memory.lastRoutedTowerSignature = "";
  memory.gridLayout = undefined;
  memory.conversation = [];
  memory.tokenCount = 0;
  memory.lastObservation = null;
  memory.commanderInstructions = "";
  memory.pendingPlayerMessages = [];
  memory.isCompressing = false;
  gridLayoutToggleSent = false;
  lastRunId = null;
  deciding = false;
  lastDecisionTimeMs = 0;
  pausedForBrain = false;
  latestObservation = null;
}

// Issues an async decide for the LLM brain with an in-flight guard + ~1 Hz
// cadence throttle + pause skip. Backoff is awaited before the observation is
// sampled. A thrown decide notifies and does not kill the worker.
async function decideLlm(): Promise<void> {
  if (!brain || deciding || pausedForBrain) return;
  const now = Date.now();
  if (now - lastDecisionTimeMs < LLM_DECISION_INTERVAL_MS) return;
  deciding = true;
  lastDecisionTimeMs = now;
  try {
    if (brain.awaitReady) await brain.awaitReady();
    if (pausedForBrain || !latestObservation) return;
    const commands = await brain.decide(latestObservation, memory);
    postToMain({ type: "commands", commands });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    postToMain({ type: "notify", message: `Commander error: ${errorMessage}` });
  } finally {
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
      if (brainKind === "llm") {
        const llmConfig: LlmCommanderConfig | undefined = message.config;
        brain = llmConfig
          ? createLlmBrain(llmConfig, {
              onChat: (text) => postToMain({ type: "chat", text, from: "commander" }),
              onNotify: (messageText) => postToMain({ type: "notify", message: messageText }),
              fetchFn: globalThis.fetch,
            })
          : null;
      } else {
        brain = createBrain(message.kind);
      }
      resetMemory();
      break;
    }
    case "stop": {
      brain = null;
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
        gridLayoutToggleSent = false;
        memory.phase = "idle";
        memory.seenByWave = new Map<number, Set<number>>();
        memory.lastRushWaveNumber = null;
        memory.lastRoutedTowerSignature = "";
        memory.conversation = [];
        memory.tokenCount = 0;
        memory.lastObservation = null;
        memory.isCompressing = false;
        // Player instructions and queued chat are not map state. The transcript is:
        // it names the previous run's enemies, so a sim runId bump drops it.
      }
      if (slice.gridLayout) {
        memory.gridLayout = slice.gridLayout;
        // The map never changes mid-run; emit the feed-off toggle exactly once so
        // the engine stops shipping gridLayout (steady-state per-tick cost → zero).
        if (!gridLayoutToggleSent) {
          gridLayoutToggleSent = true;
          commands.push({ commandId: 0, type: "llm:gridLayoutToggle" });
        }
      }
      const observation: CommanderObservation = buildObservation({
        ...slice,
        gridLayout: memory.gridLayout ?? slice.gridLayout,
      });
      // The one-shot gridLayoutToggle is posted on its own message so both the
      // stub and LLM paths share it, then each path posts its own command batch.
      if (commands.length > 0) {
        postToMain({ type: "commands", commands });
      }
      if (brainKind === "llm") {
        latestObservation = observation;
        pausedForBrain = slice.meta.state === GameState.PAUSED;
        void decideLlm();
      } else {
        const decision = brain.decide(observation, memory);
        const brainCommands = decision instanceof Promise ? await decision : decision;
        postToMain({ type: "commands", commands: brainCommands });
      }
      break;
    }
  }
}
