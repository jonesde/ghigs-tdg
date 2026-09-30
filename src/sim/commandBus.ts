import type { Command } from "./Command.js";
import type { CommandDispatcher } from "./CommandDispatcher.js";

// A NON-reactive, module-level dispatch seam shared by Vue components that need
// to send intents to the simulation. The active dispatcher (a
// WorkerCommandDispatcher wrapping the worker) is registered once by
// SvgGameRoot.vue on mount. Components call dispatchCommand(...) instead of
// reaching into the old game-store engine field (which no longer exists in
// Phase 7+).
//
// IMPORTANT: this module must NOT import Pinia stores or any @/stores/* — it is
// imported by src/sim and consumed from components, and keeping it store-free
// preserves the sim/main-thread boundary. It holds only a runtime reference to
// the dispatcher object, which is fine.
let activeDispatcher: CommandDispatcher | null = null;
let nextBusCommandId = 1;
// Bus epoch: bumped every time the dispatcher tears down (setCommandDispatcher(null)
// on unmount) and on run boundaries (commander relay observing a new runId).
// Pending entries are tagged with the epoch at enqueue time; a flush delivers only
// same-epoch entries and drops stale ones with a warn, so post-unmount commander
// output can never land in a freshly mounted run.
let busEpoch = 0;

interface PendingBusEntry {
  command: Command;
  epoch: number;
}

// Bounded hold for commands dispatched while no dispatcher is registered (e.g.
// before mount). Drained FIFO into the next registered dispatcher; drop-oldest
// past the bound so a chattering producer cannot grow memory without limit.
const pendingCommands: PendingBusEntry[] = [];
const MAX_PENDING_COMMANDS = 100;

export function setCommandDispatcher(dispatcher: CommandDispatcher | null): void {
  if (!dispatcher) {
    // Teardown ends the epoch: discard anything still held so a later mount starts
    // clean, then bump so late arrivals tag fresh.
    if (pendingCommands.length > 0) {
      console.warn(`commandBus dispatcher torn down: dropped ${pendingCommands.length} pending commands`);
      pendingCommands.length = 0;
    }
    activeDispatcher = null;
    busEpoch++;
    return;
  }
  activeDispatcher = dispatcher;
  while (pendingCommands.length > 0) {
    const pendingEntry = pendingCommands.shift()!;
    if (pendingEntry.epoch !== busEpoch) {
      console.warn(
        `commandBus dropped stale-epoch command ${pendingEntry.command.type} ` +
          `(epoch ${pendingEntry.epoch}, current ${busEpoch})`,
      );
      continue;
    }
    dispatcher.dispatch(pendingEntry.command);
  }
}

// Advances the epoch without dropping: entries tagged with an older epoch are
// dropped with a warn at the next flush (setCommandDispatcher) instead of being
// delivered into the fresh run. Called on run boundaries (the commander relay
// observes snapshot runId changes) so commands queued for a dead run never land in
// the next one. Teardown (setCommandDispatcher(null)) still discards immediately.
// Block A receipt semantics are untouched: lastAppliedCommandId still advances only
// on successful apply (see commandDrain.ts).
export function advanceCommandBusEpoch(reason: string): void {
  busEpoch++;
  if (pendingCommands.length > 0) {
    console.warn(`commandBus epoch advanced (${reason}): ${pendingCommands.length} pending commands now stale`);
  }
}

export function getCommandBusEpoch(): number {
  return busEpoch;
}

export function resetCommandBusForTests(): void {
  activeDispatcher = null;
  pendingCommands.length = 0;
  nextBusCommandId = 1;
  busEpoch = 0;
}

export function dispatchCommand(command: Command): void {
  // Clone first: the bus assigns commandId on its own copy so the caller's
  // object is never mutated.
  const outgoing: Command = { ...command };
  // A commandId of 0 (or absent) is treated as "unassigned" — the dispatcher
  // reassigns a fresh monotonic id so the worker can correlate confirmations.
  if (outgoing.commandId === undefined || outgoing.commandId <= 0) {
    outgoing.commandId = nextBusCommandId++;
  }
  if (!activeDispatcher) {
    if (pendingCommands.length >= MAX_PENDING_COMMANDS) {
      pendingCommands.shift();
      console.warn(`commandBus queue full (${MAX_PENDING_COMMANDS}): dropped oldest command`);
    }
    pendingCommands.push({ command: outgoing, epoch: busEpoch });
    console.warn(`commandBus dispatched with no dispatcher: queued ${outgoing.type}`);
    return;
  }
  activeDispatcher.dispatch(outgoing);
}
