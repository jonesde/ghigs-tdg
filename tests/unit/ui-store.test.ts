// @ts-nocheck
/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCommandDispatcher } from "@/sim/commandBus.js";
import { GameState } from "@/sim/GameRunState.js";
import { WorkerCommandDispatcher } from "@/sim/WorkerCommandDispatcher.js";
import { createTestStores, createTestUiStore } from "../helpers/mock-stores";

describe("UiStore", () => {
  let store: ReturnType<typeof createTestUiStore>;

  beforeEach(() => {
    store = createTestUiStore();
  });

  afterEach(() => {
    setCommandDispatcher(null);
  });

  describe("initial state", () => {
    it("starts with all dialogs hidden", () => {
      expect(store.showPauseMenu).toBe(false);
      expect(store.showSkillTree).toBe(false);
      expect(store.showStatsPanel).toBe(false);
    });

    it("starts with null confirmDialog", () => {
      expect(store.confirmDialog).toBeNull();
    });

    it("starts with debugPanelVisible = false", () => {
      expect(store.debugPanelVisible).toBe(false);
    });

    it("starts with randomMapPanelVisible = false", () => {
      expect(store.randomMapPanelVisible).toBe(false);
    });

    it("starts with overlayPausedSim = false", () => {
      expect(store.overlayPausedSim).toBe(false);
    });

    it("anyPauseOverlayOpen ignores the overlays that never pause", () => {
      expect(store.anyPauseOverlayOpen).toBe(false);
      store.showMinimap = true;
      store.debugPanelVisible = true;
      expect(store.anyPauseOverlayOpen).toBe(false);
      store.showStatsPanel = true;
      expect(store.anyPauseOverlayOpen).toBe(true);
    });
  });

  describe("hasActiveDialog getter", () => {
    it("returns false when no confirmDialog", () => {
      expect(store.hasActiveDialog).toBe(false);
    });

    it("returns true when confirmDialog is set", () => {
      store.confirmDialog = { title: "Test", confirmLabel: "Confirm", cancelLabel: "Cancel" };
      expect(store.hasActiveDialog).toBe(true);
    });
  });

  describe("showConfirm / hideConfirm / executeConfirm", () => {
    it("showConfirm sets the dialog with defaults", () => {
      store.showConfirm({ title: "Test", message: "Are you sure?" });
      const dialog = store.confirmDialog as NonNullable<typeof store.confirmDialog>;
      expect(dialog.title).toBe("Test");
      expect(dialog.message).toBe("Are you sure?");
      expect(dialog.confirmLabel).toBe("Confirm");
      expect(dialog.cancelLabel).toBe("Cancel");
    });

    it("showConfirm uses custom labels", () => {
      store.showConfirm({ title: "Quit", message: "Leave?", confirmLabel: "Yes", cancelLabel: "No" });
      const dialog = store.confirmDialog as NonNullable<typeof store.confirmDialog>;
      expect(dialog.confirmLabel).toBe("Yes");
      expect(dialog.cancelLabel).toBe("No");
    });

    it("showConfirm stores onConfirm and onCancel callbacks", () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      store.showConfirm({ title: "T", message: "M", onConfirm, onCancel });
      const dialog = store.confirmDialog as NonNullable<typeof store.confirmDialog>;
      expect(dialog.onConfirm).toBe(onConfirm);
      expect(dialog.onCancel).toBe(onCancel);
    });

    it("hideConfirm calls onCancel and clears dialog", () => {
      const onCancel = vi.fn();
      store.showConfirm({ title: "T", message: "M", onCancel });
      store.hideConfirm();
      expect(onCancel).toHaveBeenCalled();
      expect(store.confirmDialog).toBeNull();
    });

    it("hideConfirm does not throw when no onCancel", () => {
      store.showConfirm({ title: "T", message: "M" });
      expect(() => store.hideConfirm()).not.toThrow();
      expect(store.confirmDialog).toBeNull();
    });

    it("executeConfirm calls onConfirm and hides dialog", () => {
      const onConfirm = vi.fn();
      store.showConfirm({ title: "T", message: "M", onConfirm });
      store.executeConfirm();
      expect(onConfirm).toHaveBeenCalled();
      expect(store.confirmDialog).toBeNull();
    });

    it("executeConfirm does not throw when no onConfirm", () => {
      store.showConfirm({ title: "T", message: "M" });
      expect(() => store.executeConfirm()).not.toThrow();
      expect(store.confirmDialog).toBeNull();
    });

    it("executeConfirm does NOT call onCancel", () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      store.showConfirm({ title: "T", message: "M", onConfirm, onCancel });
      store.executeConfirm();
      expect(onConfirm).toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      expect(store.confirmDialog).toBeNull();
    });
  });

  describe("openPauseMenu / closePauseMenu", () => {
    it("openPauseMenu claims the overlay pause when the run is playing", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.ui.openPauseMenu();
      expect(stores.ui.overlayPausedSim).toBe(true);
      expect(stores.ui.showPauseMenu).toBe(true);
    });

    it("openPauseMenu does not toggle pause when worker is null", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.game.worker = null;
      stores.ui.openPauseMenu();
      expect(stores.game.state).toBe(GameState.PLAYING);
    });

    it("openPauseMenu toggles pause via command when worker exists", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      const worker = { postMessage: vi.fn() } as unknown as Worker;
      stores.game.worker = worker;
      setCommandDispatcher(new WorkerCommandDispatcher(worker));
      stores.ui.openPauseMenu();
      setCommandDispatcher(null);
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "command", command: expect.objectContaining({ type: "action:togglePause" }) }),
      );
    });

    it("closePauseMenu hides menu and releases the overlay pause", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.ui.openPauseMenu();
      stores.ui.closePauseMenu();
      expect(stores.ui.showPauseMenu).toBe(false);
      expect(stores.ui.overlayPausedSim).toBe(false);
      expect(stores.game.state).toBe(GameState.PLAYING);
    });

    it("closePauseMenu does not toggle when was not playing", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.MENU);
      stores.ui.openPauseMenu();
      stores.ui.closePauseMenu();
      expect(stores.game.state).toBe(GameState.MENU);
    });
  });

  describe("openSkillTreeFromGame / closeSkillTree", () => {
    it("openSkillTreeFromGame sets showSkillTree and closes pause menu", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.ui.openSkillTreeFromGame();
      expect(stores.ui.showSkillTree).toBe(true);
      expect(stores.ui.showPauseMenu).toBe(false);
    });

    it("openSkillTreeFromGame does not toggle pause when worker is null", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.game.worker = null;
      stores.ui.openSkillTreeFromGame();
      expect(stores.game.state).toBe(GameState.PLAYING);
    });

    it("openSkillTreeFromGame toggles pause via command when worker exists", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      const worker = { postMessage: vi.fn() } as unknown as Worker;
      stores.game.worker = worker;
      setCommandDispatcher(new WorkerCommandDispatcher(worker));
      stores.ui.openSkillTreeFromGame();
      setCommandDispatcher(null);
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "command", command: expect.objectContaining({ type: "action:togglePause" }) }),
      );
    });

    it("closeSkillTree hides skill tree and releases the overlay pause", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.ui.openSkillTreeFromGame();
      stores.ui.closeSkillTree();
      expect(stores.ui.showSkillTree).toBe(false);
      expect(stores.ui.overlayPausedSim).toBe(false);
      expect(stores.game.state).toBe(GameState.PLAYING);
    });
  });

  describe("toggleStatsPanel / closeStatsPanel", () => {
    it("toggleStatsPanel toggles showStatsPanel", () => {
      expect(store.showStatsPanel).toBe(false);
      store.toggleStatsPanel();
      expect(store.showStatsPanel).toBe(true);
      store.toggleStatsPanel();
      expect(store.showStatsPanel).toBe(false);
    });

    it("closeStatsPanel sets showStatsPanel to false", () => {
      store.showStatsPanel = true;
      store.closeStatsPanel();
      expect(store.showStatsPanel).toBe(false);
    });

    it("claims the overlay pause when opened while playing", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.ui.toggleStatsPanel();
      expect(stores.ui.overlayPausedSim).toBe(true);
      expect(stores.ui.showStatsPanel).toBe(true);
    });

    it("leaves overlayPausedSim false when opened while already paused", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PAUSED);
      stores.ui.toggleStatsPanel();
      expect(stores.ui.overlayPausedSim).toBe(false);
    });

    it("dispatches a pause toggle on open and the matching resume on close", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      const worker = { postMessage: vi.fn() } as unknown as Worker;
      stores.game.worker = worker;
      setCommandDispatcher(new WorkerCommandDispatcher(worker));

      stores.ui.toggleStatsPanel();
      stores.ui.closeStatsPanel();
      setCommandDispatcher(null);

      const pauseCommands = worker.postMessage.mock.calls.filter(
        (call) => (call[0] as { command?: { type?: string } })?.command?.type === "action:togglePause",
      );
      expect(pauseCommands).toHaveLength(2);
      expect(stores.ui.overlayPausedSim).toBe(false);
    });

    it("does not resume when the panel was opened while already paused", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PAUSED);
      const worker = { postMessage: vi.fn() } as unknown as Worker;
      stores.game.worker = worker;
      setCommandDispatcher(new WorkerCommandDispatcher(worker));

      stores.ui.toggleStatsPanel();
      stores.ui.closeStatsPanel();
      setCommandDispatcher(null);

      expect(worker.postMessage).not.toHaveBeenCalled();
    });

    it("toggles closed through toggleStatsPanel, resuming exactly once", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      const worker = { postMessage: vi.fn() } as unknown as Worker;
      stores.game.worker = worker;
      setCommandDispatcher(new WorkerCommandDispatcher(worker));

      stores.ui.toggleStatsPanel();
      stores.ui.toggleStatsPanel();
      setCommandDispatcher(null);

      expect(stores.ui.showStatsPanel).toBe(false);
      expect(stores.ui.overlayPausedSim).toBe(false);
      expect(worker.postMessage.mock.calls).toHaveLength(2);
    });

    it("holds the pause while a second overlay stacks on top", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      const worker = { postMessage: vi.fn() } as unknown as Worker;
      stores.game.worker = worker;
      setCommandDispatcher(new WorkerCommandDispatcher(worker));

      stores.ui.toggleStatsPanel();
      stores.ui.toggleHelpDialog();
      stores.ui.closeStatsPanel();
      const pauseCommands = () =>
        worker.postMessage.mock.calls.filter(
          (call) => (call[0] as { command?: { type?: string } })?.command?.type === "action:togglePause",
        );
      expect(pauseCommands()).toHaveLength(1);
      expect(stores.ui.showHelpDialog).toBe(true);
      expect(stores.ui.overlayPausedSim).toBe(true);

      stores.ui.closeHelpDialog();
      expect(pauseCommands()).toHaveLength(2);
      expect(stores.ui.overlayPausedSim).toBe(false);
      setCommandDispatcher(null);
    });
  });

  describe("closeAllDialogs", () => {
    it("closes pause menu", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.ui.openPauseMenu();
      stores.ui.closeAllDialogs();
      expect(stores.ui.showPauseMenu).toBe(false);
    });

    it("closes skill tree", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.ui.openSkillTreeFromGame();
      stores.ui.closeAllDialogs();
      expect(stores.ui.showSkillTree).toBe(false);
    });

    it("closes stats panel", () => {
      store.showStatsPanel = true;
      store.closeAllDialogs();
      expect(store.showStatsPanel).toBe(false);
    });

    it("hides confirm dialog", () => {
      const onCancel = vi.fn();
      store.showConfirm({ title: "T", message: "M", onCancel });
      store.closeAllDialogs();
      expect(store.confirmDialog).toBeNull();
      expect(onCancel).toHaveBeenCalled();
    });

    it("closes the minimap", () => {
      store.showMinimap = true;
      store.closeAllDialogs();
      expect(store.showMinimap).toBe(false);
    });
  });

  describe("toggleMinimap / closeMinimap", () => {
    it("toggleMinimap flips showMinimap", () => {
      expect(store.showMinimap).toBe(false);
      store.toggleMinimap();
      expect(store.showMinimap).toBe(true);
      store.toggleMinimap();
      expect(store.showMinimap).toBe(false);
    });

    it("closeMinimap sets showMinimap to false", () => {
      store.showMinimap = true;
      store.closeMinimap();
      expect(store.showMinimap).toBe(false);
    });

    it("starts with showMinimap = false", () => {
      expect(store.showMinimap).toBe(false);
    });
  });

  describe("initForRun", () => {
    it("resets to default state when no savedState", () => {
      store.showPauseMenu = true;
      store.initForRun(null);
      expect(store.showPauseMenu).toBe(false);
    });

    it("overrides defaults with savedState fields", () => {
      store.initForRun({ showMinimap: true, debugPanelVisible: true });
      expect(store.showMinimap).toBe(true);
      expect(store.debugPanelVisible).toBe(true);
    });

    it("preserves saved fields while resetting unsaved ones", () => {
      store.initForRun({ showMinimap: true });
      expect(store.showMinimap).toBe(true);
      expect(store.showPauseMenu).toBe(false);
    });
  });
});
