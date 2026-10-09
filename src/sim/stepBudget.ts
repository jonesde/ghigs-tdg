// Fixed-step budget math lives here: the step the engine advances by, how many
// steps one tick may run, and how much sim time the accumulator cap discarded.
// Pure and worker-entry-free so node tests can drive it directly (WorkerEntry
// itself is not node-importable: it assigns self.onmessage at module level).
// Capping (not unbounded catch-up) avoids spiral-of-death freezes; the discard is
// returned as droppedSeconds (instead of vanishing silently) so the engine can
// count it in droppedSimSeconds and the snapshot can report it.
export const fixedDeltaSeconds = 1 / 60;

const maxStepsPerUpdate = 12;

export interface StepBudget {
  steps: number;
  // Seconds passed to each GameEngine.update. 1/60 at 1×–4×, 2/60 at 8×.
  stepSeconds: number;
  accumulator: number;
  droppedSeconds: number;
}

// 1×, 2×, and 4× stay on a 1/60 step. 8× pairs two of those (2/60). An 8/60 step
// shoved enemies hard enough that the longer quantum stays a direct-call test only.
export function stepSecondsForTimeScale(timeScale: number): number {
  if (timeScale >= 8) return fixedDeltaSeconds * 2;
  return fixedDeltaSeconds;
}

export function computeStepBudget(accumulatorSeconds: number, scaledDtSeconds: number, timeScale: number): StepBudget {
  // A paused tick passes timeScale 0. The accumulator may hold most of a step
  // (almost 2/60 at 8×). Spending it while paused would advance the sim, so the
  // remainder stays put until the run resumes.
  if (!(timeScale > 0)) {
    return { steps: 0, stepSeconds: fixedDeltaSeconds, accumulator: accumulatorSeconds, droppedSeconds: 0 };
  }
  const stepSeconds = stepSecondsForTimeScale(timeScale);
  // Same sim-seconds ceiling as the old fine-step cap (12/60 at 1×, 64/60 at 8×).
  // The cap is what stops a hitch from simulating the whole stall. At 8× that
  // ceiling is 32 steps of 2/60. WorkerEntry's 0.1 s wall clamp still binds first:
  // 6 steps at 1×, 12 at 2×, 24 at 4× and at 8×.
  const maxFineSteps = Math.min(64, Math.ceil(maxStepsPerUpdate * timeScale));
  const maxSimSeconds = fixedDeltaSeconds * maxFineSteps;
  const demanded = accumulatorSeconds + scaledDtSeconds;
  const capped = Math.min(demanded, maxSimSeconds);
  const droppedSeconds = Math.max(0, demanded - capped);
  // Division (not repeated subtraction): repeated subtraction accumulates float
  // dust and undercounts a full cap. The 1e-9 nudge only corrects that dust.
  const steps = Math.floor(capped / stepSeconds + 1e-9);
  const accumulator = capped - steps * stepSeconds;
  return { steps, stepSeconds, accumulator, droppedSeconds };
}
