import type { Command } from "./Command.js";
import type { CommandDispatcher } from "./CommandDispatcher.js";
import type { MainToWorkerMessage } from "./WorkerProtocol.js";

// Fallback id source so a command that reaches this dispatcher without an
// assigned id (direct dispatch bypassing commandBus) never crosses the worker
// boundary with correlation 0.
let nextFallbackCommandId = 1;

export class WorkerCommandDispatcher implements CommandDispatcher {
  private worker: Worker;

  constructor(worker: Worker) {
    this.worker = worker;
  }

  dispatch(command: Command): void {
    const outgoing: Command = { ...command };
    if (outgoing.commandId === undefined || outgoing.commandId <= 0) {
      outgoing.commandId = nextFallbackCommandId++;
    }
    // Pinia proxies on action:syncPersist are not structured-cloneable. postMessage throws
    // DataCloneError and the worker keeps its init-time addon snapshot, so a mid-run unlock
    // (including Third Block Choice) never changes the live offer. JSON copy matches init.
    const cloneable = JSON.parse(JSON.stringify(outgoing)) as Command;
    const msg: MainToWorkerMessage = { type: "command", command: cloneable };
    this.worker.postMessage(msg);
  }
}
