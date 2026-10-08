import type { TowerId } from "@/content/towerIds.js";
import type { EnemyVisualMeta, MapThemeData, TowerVisualMeta } from "@/render/themes/index.js";
import type { EndScreenPayload } from "./GameRunState.js";
import type { PersistState } from "./PersistState.js";

// Canonical sound-name type — replaces the module-private declaration in SoundManager.ts.
// Uses a template-literal for tower shoot sounds to give compile-time safety against typos.
export type ShootSoundName = `shoot_${TowerId}`;
export type SoundName = ShootSoundName | "place" | "base_hit" | "boss_die" | "sell" | "cancel";

// Anything the sim needs to ask the host to do that isn't a sound, a persistence flush,
// or a confirm dialog.
export type UiEvent =
  | { type: "initForRun"; mapIndex: number }
  | { type: "showNotification"; message: string }
  | { type: "endGame"; payload: EndScreenPayload };

// What the sim emits when it needs the user to confirm something.
// The host enriches with display data (themed tower name) and shows the dialog.
export interface ConfirmPayload {
  towerId: string;
  towerType: string;
  towerLevel: number;
  sellValue: number;
  isRefund: boolean;
}

// Subset of PersistState the host needs to write to localStorage.
// Must cover every field the worker can mutate so a batched flush fully
// replaces the persisted slice. Derived from PersistState via Pick (rather than
// restating the field list) so adding a worker-mutable field to PersistState and
// this slice is caught by the compiler in buildPersistSlice instead of drifting.
//
// NOTE: `unlocked` and `generalAddons` are intentionally EXCLUDED — they are
// main-thread-owned (mutated only by the skill tree via persistStore). The
// worker runs off a snapshot taken at init and would otherwise clobber
// mid-run unlocks/addon changes when it flushes its (stale) copy back. They
// reach the worker via action:syncPersist instead. `themeProgress` is the
// per-world map progress (save v5); the worker only writes the bucket for its
// own run's theme, and buildPersistSlice deep-clones every bucket so the host
// can replace the whole record without aliasing live engine state.
export type PersistStateSlice = Pick<PersistState, "gems" | "themeProgress" | "activeWaves" | "runHistory">;

// Narrow interface for TowerManager/Tower — they only need playSound, not the full HostBindings.
export interface SoundPlayer {
  playSound(name: SoundName): void;
}

// Central interface — every method is fire-and-forget except requestConfirm,
// which returns a Promise because the sim cannot proceed until the user decides.
export interface HostBindings extends SoundPlayer {
  notifyUi(event: UiEvent): void;
  schedulePersistSave(state: PersistStateSlice): void;
  syncGridTower(x: number, y: number, placed: boolean): void;
  requestConfirm(payload: ConfirmPayload): Promise<boolean>;
}

// Bundle of theme data passed from the host (SvgGameRoot.vue) into the engine.
// Avoids the engine importing the theme Pinia store. Phase 2 populates the
// defaultVisuals records; Phase 1 passes them as empty records.
export interface ThemeBundle {
  active: MapThemeData | null;
  defaultTowerVisuals: Record<string, TowerVisualMeta>;
  defaultEnemyVisuals: Record<string, EnemyVisualMeta>;
}
