import { dispatchCommand } from "@/sim/commandBus.js";
import { getLatestSnapshot } from "@/sim/SnapshotStore.js";
import { usePersistStore } from "@/stores/persist.js";
import { startRelay, stopRelay } from "./relay.js";

export const BUILTIN_STUBBY = "stubby";
export const BUILTIN_STUBBS = "stubbs";

// Owns the commander worker + relay lifecycle. Every id, including built-ins and
// "none", first releases the previous commander's orders. A built-in id then starts
// the relay (which spawns the worker and sends `start` with the kind); a saved LLM
// id starts the relay with "llm" plus that config.
export function setEnemyCommander(id: string | "none"): void {
  stopEnemyCommander();
  if (id === "none") return;
  if (id === BUILTIN_STUBBY || id === BUILTIN_STUBBS) {
    startRelay(id);
    return;
  }
  const llmCommanderConfig = usePersistStore().llmCommanders.find((config) => config.id === id);
  if (llmCommanderConfig) {
    startRelay("llm", llmCommanderConfig);
  }
}

// Stops the commander and releases any enemies it left in hold or an engagement
// policy. Reads live enemy ids from the latest snapshot and dispatches one
// llm:routeGroup so every held enemy reverts to its default path, then one
// llm:setTargeting so a stored policy cannot re-siege under the next commander.
// Safe with no game loaded: dispatchCommand is a no-op when the dispatcher is null.
export function stopEnemyCommander(): void {
  const snapshot = getLatestSnapshot();
  if (snapshot) {
    const enemyIds = snapshot.enemies.map((enemy) => enemy.id);
    if (enemyIds.length > 0) {
      dispatchCommand({ commandId: 0, type: "llm:routeGroup", enemyIds, hold: false, waypoints: [] });
      // releaseToDefault keeps the engagement policy. This command clears it so the
      // next intent does not re-siege under a commander that did not set it.
      dispatchCommand({ commandId: 0, type: "llm:setTargeting", enemyIds, mode: "default" });
    }
  }
  stopRelay();
}
