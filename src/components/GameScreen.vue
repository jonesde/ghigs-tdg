<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { awaitDisposeWorker } from "@/router/index.js";
import { GameState } from "@/sim/Constants.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import { useGameStore } from "@/stores/game.js";
import { useUiStore } from "@/stores/ui.js";
import BasePanel from "./BasePanel.vue";
import BonusPicker from "./BonusPicker.vue";
import DebugPanel from "./DebugPanel.vue";
import EnemyChat from "./EnemyChat.vue";
import GameHud from "./GameHud.vue";
import GameShop from "./GameShop.vue";
import HelpDialog from "./HelpDialog.vue";
import MinimapPanel from "./MinimapPanel.vue";
import PauseMenu from "./PauseMenu.vue";
import ProgressivePlacement from "./ProgressivePlacement.vue";
import SkillTree from "./SkillTree.vue";
import StatsPanel from "./StatsPanel.vue";
import SvgGameRoot from "./SvgGameRoot.vue";
import TowerPanel from "./TowerPanel.vue";
import WaveCountdown from "./WaveCountdown.vue";
import WaveGraph from "./WaveGraph.vue";

const router = useRouter();
const gameStore = useGameStore();
const uiStore = useUiStore();

let popstateHandler: ((event: PopStateEvent) => void) | null = null;
let awaitingConfirm = false;
const disposed = ref(false);

watch(
  () => gameStore.state,
  (state: GameState) => {
    if (state === GameState.GAME_OVER) router.push("/game-over");
    else if (state === GameState.VICTORY) router.push("/victory");
  },
  { immediate: true },
);

function onPopState() {
  if (awaitingConfirm) {
    awaitingConfirm = false;
    return;
  }
  awaitingConfirm = true;
  uiStore.showConfirm({
    title: "End Game",
    message: "Are you sure you want to leave? Your progress in this run will be lost.",
    confirmLabel: "End Game",
    cancelLabel: "Stay",
    onConfirm() {
      disposed.value = true;
      dispatchCommand({ commandId: 0, type: "action:endRun" });
      router.push("/game-over");
    },
    onCancel() {
      awaitingConfirm = false;
    },
  });
  // Restore history entry so the next back press can be caught again.
  history.pushState(history.state, "", location.href);
}

onMounted(() => {
  history.pushState(history.state, "", location.href);
  popstateHandler = onPopState;
  window.addEventListener("popstate", popstateHandler);
});

onUnmounted(() => {
  if (popstateHandler) {
    window.removeEventListener("popstate", popstateHandler);
    popstateHandler = null;
  }
  if (gameStore.worker && !disposed.value) {
    void awaitDisposeWorker(gameStore.worker);
  }
});
</script>

<template>
  <div class="game-screen">
    <SvgGameRoot />
    <GameHud />
    <GameShop />
    <TowerPanel />
    <BasePanel />
    <DebugPanel />
    <WaveGraph />

    <!-- Wave countdown overlay -->
    <WaveCountdown v-if="gameStore.waveCountdown" />
    <BonusPicker />
    <ProgressivePlacement />

    <!-- PauseMenu overlay -->
    <PauseMenu v-if="uiStore.showPauseMenu" />

    <!-- SkillTree overlay -->
    <SkillTree v-if="uiStore.showSkillTree" />

    <!-- StatsPanel overlay -->
    <StatsPanel v-if="uiStore.showStatsPanel" />

    <!-- Minimap overlay -->
    <MinimapPanel v-if="uiStore.showMinimap" />

    <!-- HelpDialog overlay -->
    <HelpDialog v-if="uiStore.showHelpDialog" />

    <!-- EnemyChat overlay (self-gates on active LLM commander) -->
    <EnemyChat />
  </div>
</template>

<style scoped>
.game-screen {
  position: relative;
  width: 100%;
  height: 100%;
}


</style>
