import { applyCommandWithStats } from "./applyCommandStats.js";
import type { Command } from "./Command.js";
import type { GameEngine } from "./GameEngine.js";
import { validateCommand } from "./validateCommand.js";

export interface CommandQueueReceipt {
  lastAppliedCommandId: number;
  lastFailedCommandId: number;
  applied: number;
  skipped: number;
}

export function createCommandQueueReceipt(): CommandQueueReceipt {
  return { lastAppliedCommandId: 0, lastFailedCommandId: 0, applied: 0, skipped: 0 };
}

function trackApplied(receipt: CommandQueueReceipt, command: Command): void {
  if (command.commandId !== undefined) receipt.lastAppliedCommandId = command.commandId;
}

function trackFailed(receipt: CommandQueueReceipt, command: Command): void {
  if (command.commandId !== undefined) receipt.lastFailedCommandId = command.commandId;
}

// Drains queued commands in arrival order with intake validation. Rejected commands
// (validation failure or apply throw) mutate nothing, never advance
// lastAppliedCommandId, and record lastFailedCommandId instead. Failures surface
// through reportError (the worker posts workerError) plus a UI notification via
// the engine host. Returns whether any command mutated visible state.
export function drainCommandQueue(
  engine: GameEngine,
  queue: Command[],
  receipt: CommandQueueReceipt,
  reportError: (message: string, stack?: string) => void,
): boolean {
  let stateMutated = false;
  let tickAppliedCount = 0;
  let tickSkippedCount = 0;
  let tickCommandCount = 0;
  while (queue.length > 0) {
    const command = queue.shift()!;
    const rejection = validateCommand(command, engine.grid ?? null);
    if (rejection !== null) {
      trackFailed(receipt, command);
      engine.host.notifyUi({ type: "showNotification", message: `Command rejected: ${rejection}` });
      reportError(`Command ${command.type} rejected: ${rejection}`);
      continue;
    }
    try {
      const stats = applyCommandWithStats(engine, command);
      trackApplied(receipt, command);
      if (stats.mutated) stateMutated = true;
      tickAppliedCount += stats.applied;
      tickSkippedCount += stats.skipped;
      tickCommandCount += 1;
    } catch (error) {
      const failure = error as Error;
      trackFailed(receipt, command);
      reportError(`Command ${command.type} failed: ${failure.message}`, failure.stack);
    }
  }
  if (tickCommandCount > 0) {
    receipt.applied = tickAppliedCount;
    receipt.skipped = tickSkippedCount;
  }
  return stateMutated;
}
