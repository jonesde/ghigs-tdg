import { advanceCommandBusEpoch, dispatchCommand } from "@/sim/commandBus.js";
import type { NavFieldSnapshotData, TowerSnapshot } from "@/sim/SimulationSnapshot.js";
import { getLatestSnapshot } from "@/sim/SnapshotStore.js";
import { useUiStore } from "@/stores/ui.js";
import type { LlmCommanderConfig } from "./llm/types.js";
import { DEFAULT_DECISION_INTERVAL_MS, normalizeDecisionIntervalMs } from "./llm/types.js";
import type {
  CommanderKind,
  CommanderSnapshotSlice,
  CommanderToMainMessage,
  MainToCommanderMessage,
} from "./protocol.js";

// The main-thread half of the commander transport. Passive reader of the snapshot
// store (~4 Hz). Caches gridLayout and navField so the worker always has map +
// tower-aware distances even when the serializer omits them mid-run.
const RELAY_INTERVAL_MS = 250;

let commanderWorker: Worker | null = null;
let relayIntervalId: ReturnType<typeof setInterval> | null = null;
let cachedGridLayout: number[][] | undefined;
let cachedHeights: number[][] | undefined;
let cachedNavField: NavFieldSnapshotData | undefined;
let cachedRunId: number | null = null;
let nextObservationId = 1;
// True while the sim clock is stopped for an in-flight commander request. The relay
// is the only main-thread party that posts commanderHold, so it owns this flag.
let clockHeldByCommander = false;
// Throttle state for llm commanders: observations post at decisionIntervalMs unless
// something significant changed. Stub kinds post every tick (250 ms) as before.
let relayCommanderKind: CommanderKind | null = null;
let relayDecisionIntervalMs = DEFAULT_DECISION_INTERVAL_MS;
let lastPostedAtMs = 0;
let firstPostPending = true;
let lastSentEnemyIds: number[] | null = null;
let lastSentTowerSignature: string | null = null;
let lastSentWave: number | null = null;

// Pinia state is a proxy. Worker.postMessage structured-clones its argument and throws
// DataCloneError on that proxy, which leaves the worker running with no start message
// and no decisions. The sim worker init uses the same JSON copy for persist state.
export function cloneCommanderConfig(config: LlmCommanderConfig): LlmCommanderConfig {
  return JSON.parse(JSON.stringify(config)) as LlmCommanderConfig;
}

export function startRelay(kind: CommanderKind, config?: LlmCommanderConfig): void {
  if (commanderWorker) return;
  commanderWorker = new Worker(new URL("./CommanderWorker.ts", import.meta.url), { type: "module" });
  commanderWorker.onmessage = (event: MessageEvent<CommanderToMainMessage>) => {
    const message = event.data;
    if (message.type === "commands") {
      for (const command of message.commands) {
        dispatchCommand(command);
      }
    } else if (message.type === "notify") {
      useUiStore().showNotification(message.message);
    } else if (message.type === "chat") {
      useUiStore().appendChatLog({ from: "commander", text: message.text });
    } else if (message.type === "trace") {
      useUiStore().appendLlmTrace({ responseText: message.responseText, commandSummary: message.commandSummary });
    } else if (message.type === "hold") {
      // Clock stop for an in-flight request. Not action:togglePause: that enters
      // GameState.PAUSED and the commander worker would skip the decide the hold waits on.
      // Track the flag so stopRelay only releases a clock this commander stopped.
      clockHeldByCommander = message.hold;
      dispatchCommand({ commandId: 0, type: "action:commanderHold", hold: message.hold });
    }
  };
  commanderWorker.onerror = (event: ErrorEvent) => {
    const detail = event.message || "Commander worker failed";
    failCommanderWorker(`Commander worker failed: ${detail}`);
  };
  commanderWorker.onmessageerror = () => {
    failCommanderWorker("Commander worker rejected a message");
  };
  const startMessage: MainToCommanderMessage =
    config === undefined ? { type: "start", kind } : { type: "start", kind, config: cloneCommanderConfig(config) };
  commanderWorker.postMessage(startMessage);
  relayCommanderKind = kind;
  relayDecisionIntervalMs =
    kind === "llm" ? normalizeDecisionIntervalMs(config?.decisionIntervalMs) : DEFAULT_DECISION_INTERVAL_MS;
  lastPostedAtMs = 0;
  firstPostPending = true;
  lastSentEnemyIds = null;
  lastSentTowerSignature = null;
  lastSentWave = null;
  relayIntervalId = setInterval(postObservation, RELAY_INTERVAL_MS);
}

function towerSignatureForThrottle(towers: TowerSnapshot[]): string {
  return towers
    .map((tower) => `${tower.tileX},${tower.tileY}:${tower.level}`)
    .sort()
    .join("|");
}

function sameEnemyIds(sent: number[], live: number[]): boolean {
  if (sent.length !== live.length) return false;
  for (let index = 0; index < sent.length; index++) {
    if (sent[index] !== live[index]) return false;
  }
  return true;
}

function postObservation(): void {
  const snapshot = getLatestSnapshot();
  if (!snapshot || !commanderWorker) return;
  // A run restart (engine reloaded a map) bumps runId. The gridLayout feed is
  // disabled once the worker caches the map, but each new run re-enables it — with
  // a different map in general, but possibly the *same* map on a replay. So the
  // previously cached layout is stale and must be dropped. Detecting the boundary by
  // runId (not by gridLayout presence or mapIndex) is robust to the same-map-replay
  // case. The fresh layout is re-cached from this same snapshot, since the engine
  // re-enables the feed on (re)load and the snapshot therefore carries the new map.
  if ((snapshot.meta.runId ?? null) !== cachedRunId) {
    cachedRunId = snapshot.meta.runId ?? null;
    cachedGridLayout = undefined;
    cachedHeights = undefined;
    cachedNavField = undefined;
    nextObservationId = 1;
    // Stale throttle baselines would suppress the new run's first decisions.
    firstPostPending = true;
    lastSentEnemyIds = null;
    lastSentTowerSignature = null;
    lastSentWave = null;
    // Run boundary: commands the commander queued for the dead run must not flush
    // into the fresh one, so retire the bus epoch (drops pending with a warn).
    // Cross-module side effect: advances the shared commandBus epoch.
    advanceCommandBusEpoch("commander observed run boundary");
  }
  if (snapshot.gridLayout) {
    cachedGridLayout = snapshot.gridLayout;
  }
  if (snapshot.heights) {
    cachedHeights = snapshot.heights;
  }
  if (snapshot.navField) {
    cachedNavField = snapshot.navField;
  }
  if (relayCommanderKind === "llm") {
    const liveEnemyIds = snapshot.enemies.map((enemy) => enemy.id).sort((left, right) => left - right);
    const towerSignature = towerSignatureForThrottle(snapshot.towers);
    const wave = snapshot.meta.currentWave;
    const significantChange =
      firstPostPending ||
      lastSentEnemyIds === null ||
      !sameEnemyIds(lastSentEnemyIds, liveEnemyIds) ||
      lastSentTowerSignature !== towerSignature ||
      lastSentWave !== wave;
    if (!significantChange && Date.now() - lastPostedAtMs < relayDecisionIntervalMs) return;
    lastPostedAtMs = Date.now();
    firstPostPending = false;
    lastSentEnemyIds = liveEnemyIds;
    lastSentTowerSignature = towerSignature;
    lastSentWave = wave;
  }
  const slice: CommanderSnapshotSlice = {
    observationId: nextObservationId++,
    gridLayout: cachedGridLayout,
    heights: cachedHeights,
    enemies: snapshot.enemies,
    towers: snapshot.towers,
    spawnStates: snapshot.spawnStates,
    meta: snapshot.meta,
    nav: cachedNavField,
  };
  commanderWorker.postMessage({ type: "observation", slice } satisfies MainToCommanderMessage);
}

export function postChatToCommander(text: string): void {
  if (commanderWorker) {
    commanderWorker.postMessage({ type: "chat", text } satisfies MainToCommanderMessage);
  }
}

export function postUpdateInstructions(text: string): void {
  if (commanderWorker) {
    commanderWorker.postMessage({ type: "updateInstructions", text } satisfies MainToCommanderMessage);
  }
}

export function postUpdateCallSettings(
  pauseForCommander: boolean,
  decisionIntervalMs: number,
  reasoningEnabled: boolean,
): void {
  if (commanderWorker) {
    commanderWorker.postMessage({
      type: "updateCallSettings",
      pauseForCommander,
      decisionIntervalMs,
      reasoningEnabled,
    } satisfies MainToCommanderMessage);
  }
}

function failCommanderWorker(message: string): void {
  if (!commanderWorker) return;
  useUiStore().showNotification(message);
  useUiStore().setEnemyCommander("none");
}

export function resetRelayForTests(): void {
  cachedGridLayout = undefined;
  cachedHeights = undefined;
  cachedNavField = undefined;
  cachedRunId = null;
  nextObservationId = 1;
  clockHeldByCommander = false;
  relayCommanderKind = null;
  relayDecisionIntervalMs = DEFAULT_DECISION_INTERVAL_MS;
  lastPostedAtMs = 0;
  firstPostPending = true;
  lastSentEnemyIds = null;
  lastSentTowerSignature = null;
  lastSentWave = null;
}

export function peekNextObservationIdForTests(): number {
  return nextObservationId;
}

export function peekClockHeldForTests(): boolean {
  return clockHeldByCommander;
}

export function stopRelay(): void {
  if (relayIntervalId !== null) {
    clearInterval(relayIntervalId);
    relayIntervalId = null;
  }
  relayCommanderKind = null;
  const worker = commanderWorker;
  commanderWorker = null;
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.postMessage({ type: "stop" } satisfies MainToCommanderMessage);
    worker.terminate();
    // terminate() drops an in-flight decide's hold release and would leave the clock stopped.
    if (clockHeldByCommander) {
      clockHeldByCommander = false;
      dispatchCommand({ commandId: 0, type: "action:commanderHold", hold: false });
    }
  } else {
    clockHeldByCommander = false;
  }
  // NOTE: `cachedGridLayout` is intentionally NOT cleared here. The plan (§1.4)
  // requires the relay to own the gridLayout cache across worker restarts: once the
  // commander worker has toggled the engine feed off, a restarted worker would
  // otherwise receive no gridLayout and have no map. Keeping the cache lets the new
  // worker re-cache and re-emit the one-shot feed-off (which sets the engine feed
  // back off). The cache self-corrects on a new run because the engine re-enables the
  // feed (gridLayoutEnabled resets true in _initMap), so the next snapshot refreshes it.
}
