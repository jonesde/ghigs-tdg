import { defineStore } from "pinia";
import { BUILTIN_STUBBS, BUILTIN_STUBBY, setEnemyCommander as startEnemyCommander } from "@/commanders/index.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import { useGameStore } from "./game";

export type ChatLogEntry = { from: "player" | "commander"; text: string };
export type LlmTraceEntry = { responseText: string; commandSummary: string };

const LLM_TRACE_LIMIT = 50;
const LLM_TRACE_TEXT_LIMIT = 8000;

export interface UiStoreLike {
  showPauseMenu: boolean;
  showSkillTree: boolean;
  showStatsPanel: boolean;
  showHelpDialog: boolean;
  showMinimap: boolean;
  debugPanelVisible: boolean;
  confirmDialog: ConfirmDialogState | null;
  anyPauseOverlayOpen: boolean;
  closeAllDialogs: () => void;
  executeConfirm: () => void;
  openPauseMenu: () => void;
  toggleMinimap: () => void;
  closeMinimap: () => void;
  enemyCommander: string | "none";
  setEnemyCommander: (id: string | "none") => void;
  chatLog: ChatLogEntry[];
  appendChatLog: (entry: ChatLogEntry) => void;
  clearChatLog: () => void;
  llmTraceLog: LlmTraceEntry[];
  appendLlmTrace: (entry: LlmTraceEntry) => void;
  clearLlmTrace: () => void;
  activeCommanderIsLlm: boolean;
}

interface ConfirmDialogConfig {
  title?: string;
  message?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmDialogState {
  title: string;
  message?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmLabel: string;
  cancelLabel: string;
}

interface NotificationState {
  message: string;
  expires: number;
}

interface UiStateShape {
  showPauseMenu: boolean;
  showSkillTree: boolean;
  showStatsPanel: boolean;
  showHelpDialog: boolean;
  showMinimap: boolean;
  confirmDialog: ConfirmDialogState | null;
  notification: NotificationState | null;
  debugPanelVisible: boolean;
  randomMapPanelVisible: boolean;
  enemyCommander: string | "none";
  chatLog: ChatLogEntry[];
  llmTraceLog: LlmTraceEntry[];
  overlayPausedSim: boolean;
}

function defaultUiState(): UiStateShape {
  return {
    showPauseMenu: false,
    showSkillTree: false,
    showStatsPanel: false,
    showHelpDialog: false,
    showMinimap: false,
    confirmDialog: null,
    notification: null,
    debugPanelVisible: false,
    randomMapPanelVisible: false,
    enemyCommander: "none",
    chatLog: [],
    llmTraceLog: [],
    overlayPausedSim: false,
  };
}

export const useUiStore = defineStore("ui", {
  state: (): UiStateShape => defaultUiState(),

  getters: {
    hasActiveDialog: (state) => !!state.confirmDialog,
    anyPauseOverlayOpen: (state): boolean =>
      state.showPauseMenu || state.showSkillTree || state.showStatsPanel || state.showHelpDialog,
    activeCommanderIsLlm: (state): boolean => {
      const commanderId = state.enemyCommander;
      return commanderId !== "none" && commanderId !== BUILTIN_STUBBY && commanderId !== BUILTIN_STUBBS;
    },
  },

  actions: {
    showConfirm(config: ConfirmDialogConfig) {
      this.confirmDialog = {
        title: config.title || "Confirm",
        ...(config.message !== undefined && { message: config.message }),
        ...(config.onConfirm && { onConfirm: config.onConfirm }),
        ...(config.onCancel && { onCancel: config.onCancel }),
        confirmLabel: config.confirmLabel || "Confirm",
        cancelLabel: config.cancelLabel || "Cancel",
      };
    },

    showNotification(message: string, duration?: number) {
      this.notification = { message, expires: Date.now() + (duration || 3000) };
    },

    hideNotification() {
      this.notification = null;
    },

    hideConfirm() {
      if (this.confirmDialog?.onCancel) {
        this.confirmDialog.onCancel();
      }
      this.confirmDialog = null;
    },

    executeConfirm() {
      if (this.confirmDialog?.onConfirm) {
        this.confirmDialog.onConfirm();
      }
      this.confirmDialog = null;
    },

    // Single owner for the pause an overlay takes: the first overlay that opens
    // while the sim is playing sets overlayPausedSim and dispatches the pause;
    // stacked overlays neither set it again nor clear it. Resume authority is
    // this flag, never gameStore.state, so a close resumes exactly what the
    // first open stopped. Cross-store impact: both actions dispatch through the
    // command bus into the worker, which flips the sim's paused bit.
    beginOverlayPause() {
      // The flag guard matters: postMessage is async, so gameStore still reads
      // PLAYING for a frame or two after the first pause dispatch. Without it a
      // second overlay opening in that window would toggle the pause back off.
      if (this.overlayPausedSim) return;
      if (useGameStore().isPlaying) {
        this.overlayPausedSim = true;
        dispatchCommand({ commandId: 0, type: "action:togglePause" });
      }
    },

    endOverlayPause() {
      if (this.overlayPausedSim && !this.anyPauseOverlayOpen) {
        this.overlayPausedSim = false;
        dispatchCommand({ commandId: 0, type: "action:togglePause" });
      }
    },

    openPauseMenu() {
      this.beginOverlayPause();
      this.showPauseMenu = true;
    },

    closePauseMenu() {
      this.showPauseMenu = false;
      this.endOverlayPause();
    },

    openSkillTreeFromGame() {
      // Both flags are written before beginOverlayPause runs: showSkillTree must
      // already be true so endOverlayPause cannot see a gap where no overlay is
      // open, and showPauseMenu must drop without routing through
      // closePauseMenu (which would end the pause this call is inheriting).
      this.showSkillTree = true;
      this.showPauseMenu = false;
      this.beginOverlayPause();
    },

    closeSkillTree() {
      this.showSkillTree = false;
      this.endOverlayPause();
    },

    // The stats panel is a full-screen modal, so it pauses like the pause menu,
    // skill tree, and help dialog do. beginOverlayPause makes closeStatsPanel
    // resume only what opening the first of those overlays actually stopped.
    toggleStatsPanel() {
      if (this.showStatsPanel) {
        this.closeStatsPanel();
        return;
      }
      this.beginOverlayPause();
      this.showStatsPanel = true;
    },

    // Same shape as closePauseMenu / closeSkillTree: clear the flag first, then
    // let the single owner resume only when no other pause overlay is open.
    closeStatsPanel() {
      this.showStatsPanel = false;
      this.endOverlayPause();
    },

    toggleHelpDialog() {
      if (this.showHelpDialog) {
        this.closeHelpDialog();
        return;
      }
      this.beginOverlayPause();
      this.showHelpDialog = true;
    },

    toggleMinimap() {
      this.showMinimap = !this.showMinimap;
    },

    closeMinimap() {
      this.showMinimap = false;
    },

    setEnemyCommander(id: string | "none") {
      this.clearChatLog();
      this.clearLlmTrace();
      // Starts (and stops the prior commander) before overwriting enemyCommander so
      // stopEnemyCommander still sees the prior id and can skip its release
      // dispatches when nothing was active. The relay itself never reads this state.
      startEnemyCommander(id);
      this.enemyCommander = id;
    },

    appendChatLog(entry: ChatLogEntry) {
      this.chatLog.push(entry);
      if (this.chatLog.length > 20) {
        this.chatLog.splice(0, this.chatLog.length - 20);
      }
    },

    clearChatLog() {
      this.chatLog = [];
    },

    appendLlmTrace(entry: LlmTraceEntry) {
      const responseText =
        entry.responseText.length > LLM_TRACE_TEXT_LIMIT
          ? `${entry.responseText.slice(0, LLM_TRACE_TEXT_LIMIT)}…`
          : entry.responseText;
      this.llmTraceLog.push({ responseText, commandSummary: entry.commandSummary });
      if (this.llmTraceLog.length > LLM_TRACE_LIMIT) {
        this.llmTraceLog.splice(0, this.llmTraceLog.length - LLM_TRACE_LIMIT);
      }
    },

    clearLlmTrace() {
      this.llmTraceLog = [];
    },

    closeHelpDialog() {
      this.showHelpDialog = false;
      this.endOverlayPause();
    },

    closeAllDialogs() {
      if (this.showPauseMenu) this.closePauseMenu();
      if (this.showSkillTree) this.closeSkillTree();
      if (this.showStatsPanel) this.closeStatsPanel();
      if (this.showHelpDialog) this.closeHelpDialog();
      if (this.showMinimap) this.closeMinimap();
      if (this.debugPanelVisible) this.closeDebugPanel();
      if (this.confirmDialog) this.hideConfirm();
    },

    openDebugPanel() {
      this.debugPanelVisible = true;
      dispatchCommand({ commandId: 0, type: "action:debug", kind: "setDebugPhysics", amount: 1 });
    },

    closeDebugPanel() {
      this.debugPanelVisible = false;
      dispatchCommand({ commandId: 0, type: "action:debug", kind: "setDebugPhysics", amount: 0 });
    },

    initForRun(savedState: Partial<UiStateShape> | null) {
      this.$state = { ...defaultUiState(), ...(savedState || {}) };
    },
  },
});
