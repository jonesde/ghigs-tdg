import { dispatchCommand } from "@/sim/commandBus.js";
import { getLatestSnapshot } from "@/sim/SnapshotStore.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";
import { startRelay, stopRelay } from "./relay.js";

export const BUILTIN_STUBBY = "stubby";
export const BUILTIN_STUBBS = "stubbs";

// Owns the commander worker + relay lifecycle. Every id, including built-ins and
// "none", first stops the previous commander (releasing its orders when one was
// active; a no-op release when the prior id was "none"). A built-in id then starts
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
// policy. Skips the release dispatches when no commander was active: with no prior
// commander nothing can be held or latched, so the dispatches would only be noise
// on the command bus. Reads live enemy ids from the latest snapshot and dispatches
// one llm:routeGroup so every held enemy reverts to its default path, then one
// llm:setTargeting so a stored policy cannot re-siege under the next commander.
// Safe with no game loaded: dispatchCommand is a no-op when the dispatcher is null.
export function stopEnemyCommander(): void {
  const snapshot = getLatestSnapshot();
  // uiStore.setEnemyCommander calls this before overwriting enemyCommander, so here
  // it still names the prior commander. "none" means there is nothing to release.
  const hadActiveCommander = useUiStore().enemyCommander !== "none";
  if (snapshot && hadActiveCommander) {
    const enemyIds = snapshot.enemies.map((enemy) => enemy.id);
    if (enemyIds.length > 0) {
      dispatchCommand({ commandId: 0, type: "llm:routeGroup", enemyIds, hold: false, waypoints: [] });
      // releaseToDefault keeps the engagement policy. This command clears it so the
      // next intent does not re-siege under a commander that did not set it.
      dispatchCommand({ commandId: 0, type: "llm:setTargeting", enemyIds, mode: "default" });
    }
    // The spawn order lives on the engine, not on the live enemies. Leaving it
    // latched would park the next wave after this commander is gone.
    dispatchCommand({ commandId: 0, type: "llm:setSpawnOrder", clear: true });
  }
  stopRelay();
}
