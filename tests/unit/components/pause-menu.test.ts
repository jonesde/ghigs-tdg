// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { RouteRecordRaw } from "vue-router";
import { createMemoryHistory, createRouter } from "vue-router";
import PauseMenu from "@/components/PauseMenu.vue";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

interface MountResult {
  pinia: ReturnType<typeof createPinia>;
  gameStore: ReturnType<typeof useGameStore>;
  persistStore: ReturnType<typeof usePersistStore>;
  uiStore: ReturnType<typeof useUiStore>;
  router: ReturnType<typeof createRouter>;
}

function createTestRouter(): ReturnType<typeof createRouter> {
  const routes: RouteRecordRaw[] = [
    { path: "/", name: "main-menu", component: { template: "<div/>" } },
    { path: "/map-select", name: "map-select", component: { template: "<div/>" } },
    { path: "/game", name: "game", component: { template: "<div/>" } },
    { path: "/game-over", name: "game-over", component: { template: "<div/>" } },
    { path: "/skill-tree", name: "skill-tree", component: { template: "<div/>" } },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

function mountPauseMenu(): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  const router = createTestRouter();
  return { pinia, gameStore, persistStore, uiStore, router };
}

describe("PauseMenu", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  it("renders Resume button", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountPauseMenu();
    const wrapper = mount(PauseMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Resume");
  });

  it("renders End Run button", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountPauseMenu();
    const wrapper = mount(PauseMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("End Run");
  });

  it("renders Upgrades! button", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountPauseMenu();
    const wrapper = mount(PauseMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Upgrades!");
  });

  it("does not render New Game button", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountPauseMenu();
    const wrapper = mount(PauseMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).not.toContain("New Game");
  });

  it("does not render Run History button", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountPauseMenu();
    const wrapper = mount(PauseMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).not.toContain("Run History");
  });

  it("does not render game title", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountPauseMenu();
    const wrapper = mount(PauseMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).not.toContain("Ground Held is Ground Stood");
  });

  it("renders difficulty slider", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountPauseMenu();
    const wrapper = mount(PauseMenu, { global: { plugins: [router, pinia] } });
    const slider = wrapper.find('input[type="range"]');
    expect(slider.exists()).toBe(true);
  });

  it("displays gem count", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountPauseMenu();
    persistStore.gems = 250;
    const wrapper = mount(PauseMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("250");
  });

  it("displays current difficulty value", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountPauseMenu();
    persistStore.setDifficultyTick(4);
    const wrapper = mount(PauseMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("×2.00");
  });

  it("updates difficulty on slider change", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountPauseMenu();
    const wrapper = mount(PauseMenu, { global: { plugins: [router, pinia] } });
    const slider = wrapper.find('input[type="range"]');
    await slider.setValue(6);
    expect(persistStore.difficulty.multiplierTick).toBe(6);
  });

  it("Resume button calls closePauseMenu", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountPauseMenu();
    const wrapper = mount(PauseMenu, { global: { plugins: [router, pinia] } });
    const resumeBtn = wrapper.findAll("button").find((button) => button.text().includes("Resume"))!;
    await resumeBtn.trigger("click");
    expect(uiStore.showPauseMenu).toBe(false);
  });

  it("End Run button shows confirm dialog", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountPauseMenu();
    const wrapper = mount(PauseMenu, { global: { plugins: [router, pinia] } });
    const endRunBtn = wrapper.findAll("button").find((button) => button.text().includes("End Run"))!;
    await endRunBtn.trigger("click");
    expect(uiStore.confirmDialog).not.toBeNull();
    expect(uiStore.confirmDialog!.title).toBe("End Run");
  });

  it("Upgrades! button calls openSkillTreeFromGame", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountPauseMenu();
    const wrapper = mount(PauseMenu, { global: { plugins: [router, pinia] } });
    const skillBtn = wrapper.findAll("button").find((button) => button.text().includes("Upgrades"))!;
    await skillBtn.trigger("click");
    expect(uiStore.showSkillTree).toBe(true);
    expect(uiStore.showPauseMenu).toBe(false);
  });
});
