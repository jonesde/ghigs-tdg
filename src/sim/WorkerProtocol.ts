import type { Command } from "./Command.js";
import type { ConfirmPayload, PersistStateSlice, SoundName, ThemeBundle, UiEvent } from "./HostBindings.js";
import type { PersistState } from "./PersistState.js";
import type { WorkerPerfSample } from "./perfTrace.js";
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
  | { type: "workerError"; message: string; stack?: string }
  // Once a second, and only when the init message set perf. Carries the last
  // tick's phase times plus the window counters. Absent from normal play.
  | { type: "perfSample"; sample: WorkerPerfSample };

// Main → Worker
export type MainToWorkerMessage =
  | {
      type: "init";
      persistState: PersistState;
      themeBundle: ThemeBundle;
      mapIndex: number;
      randomMapParams?: unknown;
      progressiveMapParams?: unknown;
      // Main thread sets this only for a dev build opened with ?perf=1.
      perf?: boolean;
    }
  | { type: "command"; command: Command }
  | { type: "confirmResult"; requestId: number; confirmed: boolean }
  | { type: "dispose" }
  // Main thread consumed the snapshot with this frameId; the worker may post the
  // next one. Stale acks (frameId < lastPostedFrameId, e.g. a duplicate render or
  // an ack from before an init) are ignored.
  | { type: "snapshotAck"; frameId: number };
