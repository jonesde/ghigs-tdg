import { FIXED_DT, MAX_STEPS_PER_FRAME } from "@/sim/Constants.js";

// Fixed-step budget: how many FIXED_DT steps to run this tick and how much sim
// time the accumulator cap discarded. Pure and worker-entry-free so node tests
// can drive it directly (WorkerEntry itself is not node-importable: it assigns
// self.onmessage at module level). Capping (not unbounded catch-up) avoids
// spiral-of-death freezes; the discard is returned as droppedSeconds (instead
// of vanishing silently) so the engine can count it in droppedSimSeconds and
// the snapshot can report it.
export interface StepBudget {
  steps: number;
  accumulator: number;
  droppedSeconds: number;
}

export function computeStepBudget(accumulatorSeconds: number, scaledDtSeconds: number, timeScale: number): StepBudget {
  const maxSteps = Math.min(64, Math.ceil(MAX_STEPS_PER_FRAME * Math.max(1, timeScale)));
  const demanded = accumulatorSeconds + scaledDtSeconds;
  const capped = Math.min(demanded, FIXED_DT * maxSteps);
  const droppedSeconds = Math.max(0, demanded - capped);
  // Division (not repeated subtraction): repeated FIXED_DT subtraction accumulates
  // float dust and undercounts a full cap (63 instead of 64 steps). The 1e-9 nudge
  // only corrects that dust, far below any real partial-step remainder.
  const steps = Math.min(maxSteps, Math.floor(capped / FIXED_DT + 1e-9));
  const accumulator = capped - steps * FIXED_DT;
  return { steps, accumulator, droppedSeconds };
}
