import {
  createRouter,
  createWebHistory,
  type NavigationGuardNext,
  type RouteLocationNormalized,
  type RouteRecordRaw,
} from "vue-router";
import { GameState } from "@/sim/GameRunState.js";
import type { WorkerToMainMessage } from "@/sim/WorkerProtocol.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";

const routes: RouteRecordRaw[] = [
  { path: "/", name: "main-menu", component: () => import("@/components/MainMenu.vue") },
  { path: "/map-select", name: "map-select", component: () => import("@/components/MapSelect.vue") },
  { path: "/skill-tree", name: "skill-tree", component: () => import("@/components/SkillTree.vue") },
  { path: "/game", name: "game", component: () => import("@/components/GameScreen.vue") },
  {
    path: "/game-over",
    name: "game-over",
    component: () => import("@/components/EndScreen.vue"),
    props: { won: false },
  },
  { path: "/victory", name: "victory", component: () => import("@/components/EndScreen.vue"), props: { won: true } },
  { path: "/history", name: "history", component: () => import("@/components/HistoryScreen.vue") },
  { path: "/commanders", name: "commanders", component: () => import("@/components/CommandersScreen.vue") },
];

const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes });

router.beforeEach(async (to: RouteLocationNormalized, from: RouteLocationNormalized, next: NavigationGuardNext) => {
  const gameStore = useGameStore();

  // Block direct access to /game without a loaded map
  // Check `gameStore.map` instead of `mapIndex` — random maps use mapIndex=-1 but still have a valid map
  if (to.name === "game" && !gameStore.map) {
    next("/map-select");
    return;
  }

  // Require active theme to be resolved before entering /game
  const mapThemeStore = useMapThemeStore();
  if (to.name === "game" && !mapThemeStore.activeTheme) {
    next("/map-select");
    return;
  }

  // Auto-redirect from game state to end screen
  // Capture terminal state BEFORE dispose() overwrites it with MENU
  const prevState = gameStore.state;

  // Leaving /game — dispose the worker, wait for the "disposed" ack so the
  // final persist flush is not dropped, then terminate and save progress (fix #3).
  if (from.name === "game" && to.name !== "game" && gameStore.worker) {
    await awaitDisposeWorker(gameStore.worker);
  }

  if (prevState === GameState.GAME_OVER && to.name !== "game-over" && to.name !== "victory") {
    next("/game-over");
    return;
  }
  if (prevState === GameState.VICTORY && to.name !== "game-over" && to.name !== "victory") {
    next("/victory");
    return;
  }
  next();
});

export default router;

// Posts dispose, waits for the worker's "disposed" ack (with a short safety
// timeout), terminates it, then flushes persist state. Module-private: the
// router guard is the only caller. SvgGameRoot.onUnmounted is the fallback
// owner for unmounts this guard does not see; it skips dispose when this
// function has already cleared gameStore.worker.
async function awaitDisposeWorker(worker: Worker): Promise<void> {
  await new Promise<void>((resolve) => {
    const onDisposed = (event: MessageEvent): void => {
      const data = event.data as WorkerToMainMessage | null;
      if (data && data.type === "disposed") {
        worker.removeEventListener("message", onDisposed);
        resolve();
      }
    };
    worker.addEventListener("message", onDisposed);
    worker.postMessage({ type: "dispose" });
    setTimeout(resolve, 500);
  });
  worker.terminate();
  useGameStore().clearWorker();
  usePersistStore().save();
}
