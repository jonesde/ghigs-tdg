import type { Command } from "@/sim/Command.js";
import type {
  EnemySnapshot,
  NavFieldSnapshotData,
  SnapshotMeta,
  SpawnStateSnapshot,
  TowerSnapshot,
} from "@/sim/SimulationSnapshot.js";
import type { LlmCommanderConfig } from "./llm/types.js";

export type CommanderKind = "stubby" | "stubbs" | "llm";

// The worker's intentional input contract — a throttled, abstracted slice of the
// full SimulationSnapshot, not "the whole snapshot". The relay owns the gridLayout
// and navField caches and always supplies them when available.
export interface CommanderSnapshotSlice {
  gridLayout: number[][] | undefined; // constant map (0=terrain,1=path,2=base,3=spawn)
  enemies: EnemySnapshot[];
  towers: TowerSnapshot[];
  spawnStates: SpawnStateSnapshot[];
  meta: SnapshotMeta;
  // Tower-aware nav field (distance-to-base, spawn reachability). Source of truth
  // for commander pathing decisions — not a re-BFS of gridLayout.
  nav: NavFieldSnapshotData | undefined;
}

export type MainToCommanderMessage =
  | { type: "start"; kind: CommanderKind; config?: LlmCommanderConfig }
  | { type: "stop" }
  | { type: "observation"; slice: CommanderSnapshotSlice }
  | { type: "chat"; text: string }
  | { type: "updateInstructions"; text: string };

export type CommanderToMainMessage =
  | { type: "commands"; commands: Command[] }
  | { type: "notify"; message: string }
  | { type: "chat"; text: string; from: "commander" }
  | { type: "hold"; hold: boolean };
