import type { Command } from "@/sim/Command.js";
import { createLlmBrain } from "./llm/brain.js";
import type { LlmCommanderConfig } from "./llm/types.js";
import type { CommanderObservation } from "./observation.js";
import type { CommanderKind } from "./protocol.js";
import { createStubbsBrain } from "./stubbs/brain.js";
import { createStubbyBrain } from "./stubby/brain.js";

export type CommanderPhase = "idle" | "holding" | "rushing";

// Plain-object scratch + per-run memory shared between decide() calls. The worker
// owns the live instance; brains treat it as opaque state (no closures of their own).
export interface CommanderMemory {
  phase: CommanderPhase;
  seenByWave: Map<number, Set<number>>; // enemy ids seen, keyed by wave number
  lastRushWaveNumber: number | null;
  lastRoutedTowerSignature: string;
  gridLayout: number[][] | undefined;
  // LLM scratch state (used by the llm brain added in a later batch)
  conversation: { role: "user" | "assistant" | "system"; content: string }[];
  tokenCount: number;
  lastObservation: import("./observation.js").CommanderObservation | null;
  commanderInstructions: string;
  pendingPlayerMessages: string[];
  isCompressing: boolean;
  // Why the previous model reply was dropped. Cleared when a reply is accepted.
  rejectionNote: string | null;
}

export interface CommanderBrain {
  decide(observation: CommanderObservation, memory: CommanderMemory): Command[] | Promise<Command[]>;
  // LLM brain waits out API backoff before the worker samples the latest observation.
  awaitReady?(): Promise<void>;
}

export function createBrain(kind: CommanderKind, config?: LlmCommanderConfig): CommanderBrain {
  switch (kind) {
    case "stubby":
      return createStubbyBrain();
    case "stubbs":
      return createStubbsBrain();
    case "llm": {
      if (!config) throw new Error("llm commander requires config");
      return createLlmBrain(config);
    }
    default: {
      const unknown = kind as string;
      throw new Error(`Unknown commander kind: ${unknown}`);
    }
  }
}
