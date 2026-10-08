import type { EndScreenPayload } from "@/sim/GameRunState.js";
import type { ConfirmPayload, HostBindings, PersistStateSlice, SoundName, UiEvent } from "@/sim/HostBindings.js";
import { stampRunHistoryDate } from "@/sim/PersistState.js";
import type { SoundManager } from "@/sound/SoundManager.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

export class MainThreadHostBindings implements HostBindings {
  private sound: SoundManager;

  constructor(sound: SoundManager) {
    this.sound = sound;
  }

  playSound(name: SoundName): void {
    this.sound.play(name);
  }

  notifyUi(event: UiEvent): void {
    const uiStore = useUiStore();
    switch (event.type) {
      case "initForRun":
        uiStore.initForRun(null);
        break;
      case "showNotification":
        uiStore.showNotification(event.message);
        break;
      case "endGame": {
        const gameStore = useGameStore();
        const { victory, ...data } = event.payload;
        gameStore.triggerEnd(victory, data as Omit<EndScreenPayload, "victory">);
        break;
      }
    }
  }

  syncGridTower(_x: number, _y: number, _placed: boolean): void {}

  schedulePersistSave(state: PersistStateSlice): void {
    const persistStore = usePersistStore();
    // Field-by-field assignment to preserve Pinia reactivity on each field.
    // Object.assign on $state can break reactivity in some Pinia versions.
    persistStore.gems = state.gems;
    // buildPersistSlice already deep-cloned every bucket, so the whole record
    // can be replaced without aliasing the worker's live state.
    persistStore.themeProgress = state.themeProgress;
    persistStore.activeWaves = { ...state.activeWaves };
    // Host-side wall-clock stamp: the worker stores workerRunDateSentinel so
    // replays stay deterministic; the real date is applied here on receipt.
    for (const entry of state.runHistory) {
      stampRunHistoryDate(entry, Date.now());
    }
    // unlocked + generalAddons are main-thread-owned (skill tree) and are NOT
    // overwritten here — the worker never mutates them and would otherwise
    // clobber mid-run unlocks/addon changes with its stale init-time copy.
    persistStore.runHistory = [...state.runHistory];
    persistStore.save();
  }

  requestConfirm(payload: ConfirmPayload): Promise<boolean> {
    const uiStore = useUiStore();
    const themeStore = useMapThemeStore();
    const visual = themeStore.getDefaultTowerVisual(payload.towerType);
    const towerName = visual?.name ?? payload.towerType;
    return new Promise<boolean>((resolve) => {
      uiStore.showConfirm({
        title: payload.isRefund ? "Full Refund" : "Sell Tower",
        message: `${payload.isRefund ? "Refund" : "Sell"} ${towerName} (Lv ${payload.towerLevel}) for ${payload.sellValue}g?`,
        confirmLabel: payload.isRefund ? "Refund" : "Sell",
        cancelLabel: "Keep",
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }
}
