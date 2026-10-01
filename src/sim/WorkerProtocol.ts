import type { Command } from "./Command.js";
import type { ConfirmPayload, PersistStateSlice, SoundName, ThemeBundle, UiEvent } from "./HostBindings.js";
import type { PersistState } from "./PersistState.js";
import type { SimulationSnapshot } from "./SimulationSnapshot.js";

// Worker → Main
export type WorkerToMainMessage =
  | { type: "snapshot"; snapshot: SimulationSnapshot }
  | { type: "playSound"; name: SoundName }
  | { type: "notifyUi"; event: UiEvent }
  | { type: "schedulePersistSave"; state: PersistStateSlice }
  | { type: "gridTowerSync"; x: number; y: number; placed: boolean }
  | { type: "requestConfirm"; payload: ConfirmPayload; requestId: number }
  | { type: "workerReady" }
  | { type: "disposed" }
  | { type: "workerError"; message: string; stack?: string };

// Main → Worker
export type MainToWorkerMessage =
  | {
      type: "init";
      persistState: PersistState;
      themeBundle: ThemeBundle;
      mapIndex: number;
      randomMapParams?: unknown;
      progressiveMapParams?: unknown;
    }
  | { type: "command"; command: Command }
  | { type: "confirmResult"; requestId: number; confirmed: boolean }
  | { type: "dispose" }
  // Main thread consumed the snapshot with this frameId; the worker may post the
  // next one. Stale acks (frameId < lastPostedFrameId, e.g. a duplicate render or
  // an ack from before an init) are ignored.
  | { type: "snapshotAck"; frameId: number };
