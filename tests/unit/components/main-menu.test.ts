// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { RouteRecordRaw } from "vue-router";
import { createMemoryHistory, createRouter } from "vue-router";
import { mockDefaultTheme } from "@/../tests/helpers/mock-stores.js";
import MainMenu from "@/components/MainMenu.vue";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

const THEME_BG_SVG = "<svg viewBox='0 0 1600 900'><rect width='1600' height='900' fill='themebgmarker'/></svg>";

interface MountResult {
  pinia: ReturnType<typeof createPinia>;
  gameStore: ReturnType<typeof useGameStore>;
  persistStore: ReturnType<typeof usePersistStore>;
  uiStore: ReturnType<typeof useUiStore>;
  themeStore: ReturnType<typeof useMapThemeStore>;
  router: ReturnType<typeof createRouter>;
}

function createRouterWithRoutes(): ReturnType<typeof createRouter> {
  const routes: RouteRecordRaw[] = [
    { path: "/", name: "main-menu", component: { template: "<div>MainMenu</div>" } },
    { path: "/map-select", name: "map-select", component: { template: "<div>MapSelect</div>" } },
    { path: "/skill-tree", name: "skill-tree", component: { template: "<div>SkillTree</div>" } },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

function mountMainMenu(): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  const themeStore = useMapThemeStore();
  const themedMock = { ...mockDefaultTheme, menuBackground: THEME_BG_SVG };
  themeStore.defaultTheme = themedMock;
  themeStore.activeTheme = themedMock;
  themeStore.loadedThemes[themedMock.id] = themedMock;
  gameStore.resetToMenu();
  const router = createRouterWithRoutes();
  return { pinia, gameStore, persistStore, uiStore, themeStore, router };
}

describe("MainMenu", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  it("renders new game button", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("New Game");
  });

  it("renders skill tree button", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Upgrades!");
  });

  it("renders difficulty slider", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const slider = wrapper.find('input[type="range"]');
    expect(slider.exists()).toBe(true);
  });

  it("displays current difficulty value", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    persistStore.setDifficultyTick(4);
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("×2.00");
  });

  it("updates difficulty on slider change", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const slider = wrapper.find('input[type="range"]');
    await slider.setValue(6);
    expect(persistStore.difficulty.multiplierTick).toBe(6);
  });

  it("slider reflects store difficulty changes from outside", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    persistStore.setDifficultyTick(8);
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const slider = wrapper.find('input[type="range"]');
    expect(parseInt((slider.element as HTMLInputElement).value, 10)).toBe(8);
  });

  it("displays gem count", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    persistStore.gems = 250;
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("250");
  });

  it("navigates to /map-select on new game click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const newGameBtn = wrapper.findAll("button").find((button) => button.text().includes("New Game"))!;
    await newGameBtn.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/map-select");
  });

  it("navigates to /skill-tree on skill tree click when not in game", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const skillBtn = wrapper.findAll("button").find((button) => button.text().includes("Upgrades"))!;
    await skillBtn.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/skill-tree");
  });

  it("renders a theme card for every theme in the manifest", () => {
    const { pinia, themeStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const cards = wrapper.findAll(".theme-card");
    expect(cards.length).toBe(themeStore.availableThemes.length);
    expect(cards.length).toBe(2);
  });

  it("highlights the currently selected theme card", () => {
    const { pinia, persistStore, router } = mountMainMenu();
    persistStore.lastSelectedThemeId = "the-aftermath";
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const selected = wrapper.findAll(".theme-card").find((card) => card.classes("selected"));
    expect(selected).toBeDefined();
    expect(selected!.find(".theme-card-label").text()).toBe("Aftermath");
    expect(selected!.find(".theme-card-progress").text()).toBe("Region 1 · Map 1");
  });

  it("selecting a theme card persists the theme id and loads it", async () => {
    const { pinia, persistStore, themeStore, router } = mountMainMenu();
    persistStore.lastSelectedThemeId = "the-aftermath";
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const card = wrapper.findAll(".theme-card").find((c) => c.text().includes("Polymath"))!;
    await card.trigger("click");
    expect(persistStore.lastSelectedThemeId).toBe("default");
    expect(themeStore.activeThemeId).toBe("default");
  });

  it("renders the active theme menu background", () => {
    const { pinia, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const background = wrapper.find(".menu-background");
    expect(background.exists()).toBe(true);
    expect(background.html()).toContain("themebgmarker");
  });

  it("renders each theme card's menu background as a preview", () => {
    const { pinia, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const card = wrapper.findAll(".theme-card").find((c) => c.text().includes("Polymath"))!;
    const cardBackground = card.find(".theme-card-bg");
    expect(cardBackground.exists()).toBe(true);
    expect(cardBackground.html()).toContain("themebgmarker");
  });
});
