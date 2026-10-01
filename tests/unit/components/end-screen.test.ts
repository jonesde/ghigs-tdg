// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { RouteRecordRaw } from "vue-router";
import { createMemoryHistory, createRouter } from "vue-router";
import EndScreen from "@/components/EndScreen.vue";
import { CUSTOM_PROGRESSIVE_MAP_INDEX } from "@/sim/Constants.js";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

interface GemBreakdown {
  bossKills: { base: number; afterDiff: number; afterRegion: number; afterFirstTime: number };
  milestones: { base: number; afterDiff: number; afterRegion: number; afterFirstTime: number };
  waveCompletion: { base: number; afterDiff: number; afterRegion: number; afterFirstTime: number };
  firstClearBonus: number;
}

interface MountResult {
  pinia: ReturnType<typeof createPinia>;
  gameStore: ReturnType<typeof useGameStore>;
  persistStore: ReturnType<typeof usePersistStore>;
  uiStore: ReturnType<typeof useUiStore>;
  router: ReturnType<typeof createRouter>;
}

function createRouterWithRoutes(): ReturnType<typeof createRouter> {
  const routes: RouteRecordRaw[] = [
    { path: "/", name: "main-menu", component: { template: "<div>MainMenu</div>" } },
    { path: "/map-select", name: "map-select", component: { template: "<div>MapSelect</div>" } },
    { path: "/skill-tree", name: "skill-tree", component: { template: "<div>SkillTree</div>" } },
    { path: "/game", name: "game", component: { template: "<div>Game</div>" } },
    { path: "/game-over", name: "game-over", component: { template: "<div>GameOver</div>" } },
    { path: "/victory", name: "victory", component: { template: "<div>Victory</div>" } },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

function mountEndScreen(props: Record<string, unknown> = {}): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  gameStore.resetToMenu();
  const router = createRouterWithRoutes();
  return { pinia, gameStore, persistStore, uiStore, router, ...props };
}

describe("EndScreen", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  it("shows game over text when won=false", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountEndScreen();
    const wrapper = mount(EndScreen, { props: { won: false }, global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("GAME OVER");
  });

  it("shows victory text when won=true", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountEndScreen();
    const wrapper = mount(EndScreen, { props: { won: true }, global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("VICTORY");
  });

  it("displays wave count reached", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountEndScreen();
    gameStore.endScreenData = { wave: 42, gems: 0, victory: false, gemBreakdown: {} as GemBreakdown };
    const wrapper = mount(EndScreen, { props: { won: false }, global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("42");
  });

  it("displays gem breakdown", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountEndScreen();
    gameStore.endScreenData = {
      wave: 100,
      gems: 50,
      victory: true,
      gemBreakdown: {
        waveCompletion: { base: 30, afterDiff: 30, afterRegion: 60, afterFirstTime: 60 },
        bossKills: { base: 10, afterDiff: 10, afterRegion: 20, afterFirstTime: 20 },
        milestones: { base: 5, afterDiff: 5, afterRegion: 10, afterFirstTime: 10 },
      } as unknown as GemBreakdown,
    };
    const wrapper = mount(EndScreen, { props: { won: true }, global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Wave Completion");
    expect(wrapper.text()).toContain("Boss Kills");
    expect(wrapper.text()).toContain("Milestones");
  });

  it("displays boss kill gems", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountEndScreen();
    gameStore.endScreenData = {
      wave: 100,
      gems: 50,
      victory: true,
      gemBreakdown: {
        bossKills: { base: 20, afterDiff: 20, afterRegion: 40, afterFirstTime: 40 },
      } as unknown as GemBreakdown,
    };
    const wrapper = mount(EndScreen, { props: { won: true }, global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Boss Kills");
  });

  it("displays milestone gems", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountEndScreen();
    gameStore.endScreenData = {
      wave: 100,
      gems: 50,
      victory: true,
      gemBreakdown: {
        milestones: { base: 10, afterDiff: 10, afterRegion: 20, afterFirstTime: 20 },
      } as unknown as GemBreakdown,
    };
    const wrapper = mount(EndScreen, { props: { won: true }, global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Milestones");
  });

  it("navigates to /skill-tree on continue", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountEndScreen();
    const wrapper = mount(EndScreen, { props: { won: true }, global: { plugins: [router, pinia] } });
    const upgradeBtn = wrapper.findAll("button").find((button) => button.text().includes("Upgrades"))!;
    await upgradeBtn.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/skill-tree");
  });

  it("navigates to / on return to menu", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountEndScreen();
    const wrapper = mount(EndScreen, { props: { won: false }, global: { plugins: [router, pinia] } });
    const menuBtn = wrapper.findAll("button").find((button) => button.text().includes("Main Menu"))!;
    await menuBtn.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/");
  });

  it("replays a custom progressive run from the history entry params", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: uiStore unused
    const { pinia, gameStore, persistStore, uiStore, router } = mountEndScreen();
    persistStore.runHistory = [
      {
        mapIndex: CUSTOM_PROGRESSIVE_MAP_INDEX,
        victory: true,
        wave: 20,
        gems: 50,
        bossesKilled: 1,
        bossesReachedBase: 0,
        gemBreakdown: {},
        date: 0,
        progressiveMapParams: { regionId: 1, level: 4, entryCount: 2, seed: 31337 },
      },
    ];
    const wrapper = mount(EndScreen, { props: { won: true }, global: { plugins: [router, pinia] } });
    const replayButton = wrapper.findAll("button").find((button) => button.text() === "Play Again")!;
    await replayButton.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(gameStore.mapIndex).toBe(CUSTOM_PROGRESSIVE_MAP_INDEX);
    expect(gameStore.map.style).toBe("progressive");
    expect(gameStore.map.regionId).toBe(1);
    expect(gameStore.map.level).toBe(4);
    expect(gameStore.map.entryCount).toBe(2);
    expect(gameStore.map.seed).toBe(31337);
  });
});
