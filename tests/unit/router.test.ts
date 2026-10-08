// @ts-nocheck
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouter, createWebHistory } from "vue-router";
import { GameState } from "@/sim/GameRunState.js";
import type { GeneratedMap } from "@/sim/grid/Map.js";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";

function createTestGameStore() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return useGameStore();
}

function createTestPersistStore() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = usePersistStore();
  store.$reset();
  return store;
}

function createRouterWithGuards(
  gameStore: ReturnType<typeof createTestGameStore>,
  persistStore: ReturnType<typeof createTestPersistStore>,
) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "main-menu", component: {} },
      { path: "/map-select", name: "map-select", component: {} },
      { path: "/skill-tree", name: "skill-tree", component: {} },
      { path: "/game", name: "game", component: {} },
      { path: "/game-over", name: "game-over", component: {} },
      { path: "/victory", name: "victory", component: {} },
    ],
  });

  router.beforeEach((to, from) => {
    // Block direct access to /game without a loaded map
    // Check `gameStore.map` instead of `mapIndex` — random maps use mapIndex=-1 but still have a valid map
    if (to.name === "game" && !gameStore.map) {
      return "/map-select";
    }

    // Auto-redirect from game state to end screen
    // Capture terminal state BEFORE dispose() overwrites it with MENU
    const prevState = gameStore.state;

    // Leaving /game — dispose the worker, terminate it, and save progress
    if (from.name === "game" && to.name !== "game") {
      const worker = gameStore.worker;
      if (worker) {
        worker.postMessage({ type: "dispose" });
        worker.terminate();
        gameStore.clearWorker();
      }
      persistStore.save();
    }

    if (prevState === GameState.GAME_OVER && to.name !== "game-over" && to.name !== "victory") {
      return "/game-over";
    }
    if (prevState === GameState.VICTORY && to.name !== "game-over" && to.name !== "victory") {
      return "/victory";
    }
  });

  return router;
}

describe("Router — navigation guards", () => {
  let router: ReturnType<typeof createRouterWithGuards>;
  let gameStore: ReturnType<typeof createTestGameStore>;
  let persistStore: ReturnType<typeof createTestPersistStore>;

  beforeEach(() => {
    gameStore = createTestGameStore();
    persistStore = createTestPersistStore();
    router = createRouterWithGuards(gameStore, persistStore);
  });

  describe("blocking direct /game access", () => {
    it("redirects to /map-select when no map is loaded", async () => {
      gameStore.map = null;
      gameStore.mapIndex = -1;
      await router.push("/game");
      expect(router.currentRoute.value.path).toBe("/map-select");
    });

    it("allows /game when a map is loaded", async () => {
      gameStore.map = { name: "Test Map", regionId: 0 } as unknown as GeneratedMap;
      gameStore.mapIndex = 0;
      await router.push("/game");
      expect(router.currentRoute.value.path).toBe("/game");
    });

    it("allows /game for random maps (mapIndex=-1 but map is set)", async () => {
      gameStore.map = { name: "Random Map", regionId: 0 } as unknown as GeneratedMap;
      gameStore.mapIndex = -1;
      await router.push("/game");
      expect(router.currentRoute.value.path).toBe("/game");
    });
  });

  describe("leaving /game", () => {
    function makeMockWorker() {
      return { postMessage: vi.fn(), terminate: vi.fn() } as unknown as Worker;
    }

    it("posts dispose and terminates worker when leaving game route", async () => {
      const worker = makeMockWorker();
      gameStore.worker = worker;
      gameStore.map = { name: "Test Map", regionId: 0 } as unknown as GeneratedMap;
      gameStore.mapIndex = 0;
      await router.push("/game");
      await router.push("/map-select");
      expect(worker.postMessage).toHaveBeenCalledWith({ type: "dispose" });
      expect(worker.terminate).toHaveBeenCalled();
      expect(gameStore.worker).toBeNull();
    });

    it("calls persistStore.save() when leaving game route", async () => {
      const saveMock = vi.spyOn(persistStore, "save");
      const worker = makeMockWorker();
      gameStore.worker = worker;
      gameStore.map = { name: "Test Map", regionId: 0 } as unknown as GeneratedMap;
      gameStore.mapIndex = 0;
      await router.push("/game");
      await router.push("/map-select");
      expect(saveMock).toHaveBeenCalled();
    });

    it("does not dispose or save when navigating game->game", async () => {
      const worker = makeMockWorker();
      const saveMock = vi.spyOn(persistStore, "save");
      gameStore.worker = worker;
      gameStore.map = { name: "Test Map", regionId: 0 } as unknown as GeneratedMap;
      gameStore.mapIndex = 0;
      await router.push("/game");
      await router.push("/game");
      expect(worker.postMessage).not.toHaveBeenCalled();
      expect(worker.terminate).not.toHaveBeenCalled();
      expect(saveMock).not.toHaveBeenCalled();
    });
  });

  describe("auto-redirect on GAME_OVER", () => {
    it("redirects to /game-over from any non-end-screen route", async () => {
      gameStore.state = GameState.GAME_OVER;
      await router.push("/map-select");
      expect(router.currentRoute.value.path).toBe("/game-over");
    });

    it("redirects to /game-over even when navigating from /game", async () => {
      // Start in PLAYING so we can navigate to /game first
      gameStore.state = GameState.PLAYING;
      gameStore.map = { name: "Test Map", regionId: 0 } as unknown as GeneratedMap;
      gameStore.mapIndex = 0;
      const worker = { postMessage: vi.fn(), terminate: vi.fn() } as unknown as Worker;
      gameStore.worker = worker;
      await router.push("/game");
      // Now set terminal state and navigate away
      gameStore.state = GameState.GAME_OVER;
      await router.push("/map-select");
      expect(worker.postMessage).toHaveBeenCalledWith({ type: "dispose" });
      expect(router.currentRoute.value.path).toBe("/game-over");
    });

    it("does not redirect when already on /game-over", async () => {
      gameStore.state = GameState.GAME_OVER;
      await router.push("/game-over");
      expect(router.currentRoute.value.path).toBe("/game-over");
    });

    it("does not redirect when already on /victory", async () => {
      gameStore.state = GameState.GAME_OVER;
      await router.push("/victory");
      expect(router.currentRoute.value.path).toBe("/victory");
    });
  });

  describe("auto-redirect on VICTORY", () => {
    it("redirects to /victory from any non-end-screen route", async () => {
      gameStore.state = GameState.VICTORY;
      await router.push("/map-select");
      expect(router.currentRoute.value.path).toBe("/victory");
    });

    it("redirects to /victory even when navigating from /game", async () => {
      // Start in PLAYING so we can navigate to /game first
      gameStore.state = GameState.PLAYING;
      gameStore.map = { name: "Test Map", regionId: 0 } as unknown as GeneratedMap;
      gameStore.mapIndex = 0;
      const worker = { postMessage: vi.fn(), terminate: vi.fn() } as unknown as Worker;
      gameStore.worker = worker;
      await router.push("/game");
      // Now set terminal state and navigate away
      gameStore.state = GameState.VICTORY;
      await router.push("/map-select");
      expect(worker.postMessage).toHaveBeenCalledWith({ type: "dispose" });
      expect(router.currentRoute.value.path).toBe("/victory");
    });

    it("does not redirect when already on /victory", async () => {
      gameStore.state = GameState.VICTORY;
      await router.push("/victory");
      expect(router.currentRoute.value.path).toBe("/victory");
    });
  });
});
