import { mount } from "@vue/test-utils";
import { createPinia, type Pinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouter, type Router, type RouterHistory } from "vue-router";
import GameScreen from "@/components/GameScreen.vue";
import { GameState } from "@/sim/GameRunState.js";
import { baseSelectionId } from "@/sim/towers/BaseDefense.js";
import { useGameStore } from "@/stores/game.js";
import { useUiStore } from "@/stores/ui.js";

// Every child is stubbed so an assertion is about GameScreen's own gating and
// nothing else. Each stub renders a class naming the child.
vi.mock("@/components/SvgGameRoot.vue", () => ({ default: { template: '<div class="svg-game-root" />' } }));
vi.mock("@/components/GameHud.vue", () => ({ default: { template: '<div class="game-hud" />' } }));
vi.mock("@/components/GameShop.vue", () => ({ default: { template: '<div class="game-shop" />' } }));
vi.mock("@/components/TowerPanel.vue", () => ({ default: { template: '<div class="tower-panel" />' } }));
vi.mock("@/components/BasePanel.vue", () => ({ default: { template: '<div class="base-panel" />' } }));
vi.mock("@/components/DebugPanel.vue", () => ({ default: { template: '<div class="debug-panel" />' } }));
vi.mock("@/components/WaveGraph.vue", () => ({ default: { template: '<div class="wave-graph" />' } }));
vi.mock("@/components/EnemyChat.vue", () => ({ default: { template: '<div class="enemy-chat" />' } }));
vi.mock("@/components/WaveCountdown.vue", () => ({ default: { template: '<div class="wave-countdown" />' } }));
vi.mock("@/components/BonusPicker.vue", () => ({ default: { template: '<div class="bonus-picker" />' } }));
vi.mock("@/components/ProgressivePlacement.vue", () => ({
  default: { template: '<div class="progressive-placement" />' },
}));
vi.mock("@/components/PauseMenu.vue", () => ({ default: { template: '<div class="pause-menu" />' } }));
vi.mock("@/components/SkillTree.vue", () => ({ default: { template: '<div class="skill-tree" />' } }));
vi.mock("@/components/StatsPanel.vue", () => ({ default: { template: '<div class="stats-panel" />' } }));
vi.mock("@/components/MinimapPanel.vue", () => ({ default: { template: '<div class="minimap-panel" />' } }));
vi.mock("@/components/HelpDialog.vue", () => ({ default: { template: '<div class="help-dialog" />' } }));

const alwaysOn = [
  "svg-game-root",
  "game-hud",
  "game-shop",
  "tower-panel",
  "base-panel",
  "debug-panel",
  "wave-graph",
  "enemy-chat",
  // These two self-gate: GameScreen mounts them unconditionally and each child
  // owns its own v-if (BonusPicker on bonusPicker, ProgressivePlacement on the
  // hold / undo state), so their stubs render unconditionally here too.
  "bonus-picker",
  "progressive-placement",
];

// Overlays the parent gates with v-if.
const parentGated = ["wave-countdown", "pause-menu", "skill-tree", "stats-panel", "minimap-panel", "help-dialog"];

function fakeHistory(): RouterHistory {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    go: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    listen: vi.fn(),
    createHref: (path: string) => path,
    destroy: vi.fn(),
    location: { path: "/game" },
    state: {},
  } as unknown as RouterHistory;
}

interface Harness {
  pinia: Pinia;
  router: Router;
  gameStore: ReturnType<typeof useGameStore>;
  uiStore: ReturnType<typeof useUiStore>;
}

function createHarness(): Harness {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: fakeHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/game", name: "game", component: { template: "<div />" } },
      { path: "/game-over", name: "game-over", component: { template: "<div />" } },
      { path: "/victory", name: "victory", component: { template: "<div />" } },
    ],
  });
  const gameStore = useGameStore();
  const uiStore = useUiStore();
  gameStore.setState(GameState.PLAYING);
  return { pinia, router, gameStore, uiStore };
}

function mountScreen(harness: Harness) {
  return mount(GameScreen, { global: { plugins: [harness.pinia, harness.router] } });
}

// Turns on every conditional overlay at once so the "absent" assertions below
// start from a known-clean state and the "all at once" case has something real
// to assert.
function openEveryOverlay(harness: Harness): void {
  harness.uiStore.showPauseMenu = true;
  harness.uiStore.showSkillTree = true;
  harness.uiStore.showStatsPanel = true;
  harness.uiStore.showMinimap = true;
  harness.uiStore.showHelpDialog = true;
  harness.gameStore.waveCountdown = { remaining: 3, nextWave: 2 };
  harness.gameStore.bonusPicker = { id: "drop-1", source: "supply", offer: [] } as never;
  harness.gameStore.progressivePlacementHold = true;
}

describe("GameScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("always-on children", () => {
    it.each(alwaysOn)("mounts %s with every overlay closed", (className) => {
      const harness = createHarness();
      const wrapper = mountScreen(harness);
      expect(wrapper.find(`.${className}`).exists()).toBe(true);
    });
  });

  describe("overlay gating", () => {
    it.each(parentGated)("does not mount %s while it is closed", (className) => {
      const harness = createHarness();
      const wrapper = mountScreen(harness);
      expect(wrapper.find(`.${className}`).exists()).toBe(false);
    });

    it("mounts every overlay at once without one displacing another", async () => {
      const harness = createHarness();
      const wrapper = mountScreen(harness);
      openEveryOverlay(harness);
      await wrapper.vm.$nextTick();

      for (const className of [...parentGated, ...alwaysOn]) {
        expect(wrapper.find(`.${className}`).exists()).toBe(true);
      }
    });

    it("mounts the pause menu only while uiStore.showPauseMenu is set", async () => {
      const harness = createHarness();
      harness.uiStore.showPauseMenu = true;
      const wrapper = mountScreen(harness);
      expect(wrapper.find(".pause-menu").exists()).toBe(true);

      harness.uiStore.showPauseMenu = false;
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".pause-menu").exists()).toBe(false);
    });

    it("mounts the wave countdown only while gameStore.waveCountdown is set", async () => {
      const harness = createHarness();
      const wrapper = mountScreen(harness);
      expect(wrapper.find(".wave-countdown").exists()).toBe(false);

      harness.gameStore.waveCountdown = { remaining: 2, nextWave: 3 };
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".wave-countdown").exists()).toBe(true);

      harness.gameStore.waveCountdown = null;
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".wave-countdown").exists()).toBe(false);
    });

    it.each([
      "bonus-picker",
      "progressive-placement",
    ])("mounts %s unconditionally and leaves the open/closed decision to the child", (className) => {
      const harness = createHarness();
      const wrapper = mountScreen(harness);
      // Both are mounted with every gate false; each child owns its own v-if.
      expect(wrapper.find(`.${className}`).exists()).toBe(true);
    });
  });

  describe("terminal state routing", () => {
    it("routes to /game-over when the run ends", async () => {
      const harness = createHarness();
      const push = vi.spyOn(harness.router, "push").mockResolvedValue(undefined);
      const wrapper = mountScreen(harness);

      harness.gameStore.setState(GameState.GAME_OVER);
      await wrapper.vm.$nextTick();

      expect(push).toHaveBeenCalledWith("/game-over");
    });

    it("routes to /victory when the run is won", async () => {
      const harness = createHarness();
      const push = vi.spyOn(harness.router, "push").mockResolvedValue(undefined);
      const wrapper = mountScreen(harness);

      harness.gameStore.setState(GameState.VICTORY);
      await wrapper.vm.$nextTick();

      expect(push).toHaveBeenCalledWith("/victory");
    });

    it("does not route while the run is merely paused", async () => {
      const harness = createHarness();
      const push = vi.spyOn(harness.router, "push").mockResolvedValue(undefined);
      const wrapper = mountScreen(harness);

      harness.gameStore.setState(GameState.PAUSED);
      await wrapper.vm.$nextTick();

      expect(push).not.toHaveBeenCalled();
    });
  });

  describe("popstate guard", () => {
    it("asks for confirmation before leaving the run", async () => {
      const harness = createHarness();
      const wrapper = mountScreen(harness);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wrapper.vm.$nextTick();

      expect(harness.uiStore.confirmDialog?.title).toBe("End Game");
      wrapper.unmount();
    });

    it("removes its popstate listener on unmount", () => {
      const harness = createHarness();
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const wrapper = mountScreen(harness);
      wrapper.unmount();

      expect(removeSpy.mock.calls.map((call) => call[0])).toContain("popstate");
    });
  });

  describe("base selection", () => {
    it("mounts both detail panels; each child gates its own content on the selection", () => {
      const harness = createHarness();
      harness.gameStore.selectedTowerId = baseSelectionId;
      const wrapper = mountScreen(harness);
      // GameScreen mounts both unconditionally, so this asserts the parent's
      // contract only. TowerPanel/BasePanel are covered by their own tests.
      expect(wrapper.find(".base-panel").exists()).toBe(true);
      expect(wrapper.find(".tower-panel").exists()).toBe(true);
    });
  });
});
