// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { RouteRecordRaw } from "vue-router";
import { createMemoryHistory, createRouter } from "vue-router";
import { mockDefaultTheme } from "@/../tests/helpers/mock-stores.js";
import MainMenu from "@/components/MainMenu.vue";
import { CUSTOM_PROGRESSIVE_MAP_INDEX, CUSTOM_RANDOM_MAP_INDEX } from "@/sim/Constants.js";
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
    { path: "/game", name: "game", component: { template: "<div>Game</div>" } },
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
  const aftermathMock = { ...themedMock, id: "the-aftermath", label: "Aftermath" };
  themeStore.defaultTheme = themedMock;
  themeStore.activeTheme = themedMock;
  // Preload every manifest theme so onMounted's ensureThemeLoaded calls resolve
  // from cache; a late async load would mutate loadedThemes and re-render stale
  // unmounted wrappers from prior tests, crashing their body teleports.
  themeStore.loadedThemes[themedMock.id] = themedMock;
  themeStore.loadedThemes["the-aftermath"] = aftermathMock;
  gameStore.resetToMenu();
  const router = createRouterWithRoutes();
  return { pinia, gameStore, persistStore, uiStore, themeStore, router };
}

async function flushNavigation() {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

describe("MainMenu", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
    document.body.innerHTML = "";
  });

  it("renders the New Game section label with the Select Map, Progressive Run, and Generate Map buttons", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.find(".section-label").text()).toBe("New Game");
    const buttons = wrapper.findAll(".new-game-section button");
    expect(buttons.map((button) => button.text())).toEqual(["Select Map", "Progressive Run", "Generate Map"]);
    expect(buttons[0].classes()).toContain("primary");
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

  it("navigates to /map-select on Select Map click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const selectMapBtn = wrapper.findAll("button").find((button) => button.text().includes("Select Map"))!;
    await selectMapBtn.trigger("click");
    await flushNavigation();
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

  it("hides the custom map dialogs until a New Game section button opens them", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    expect(document.body.querySelector(".form-overlay")).toBeNull();
    const progressiveButton = wrapper.findAll("button").find((button) => button.text() === "Progressive Run");
    const generateButton = wrapper.findAll("button").find((button) => button.text() === "Generate Map");
    expect(progressiveButton).toBeTruthy();
    expect(generateButton).toBeTruthy();
  });

  it("opens the progressive map dialog from the Progressive Run button", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Progressive Run")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    expect(document.body.querySelectorAll(".form-overlay").length).toBe(1);
    expect(document.body.textContent).toContain("Progressive Map");
    expect(document.body.querySelector("#progressive-seed")).toBeTruthy();
    expect(document.body.querySelector("#random-seed")).toBeNull();
  });

  it("opens the generated map dialog from the Generate Map button and keeps one dialog open at a time", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Progressive Run")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector("#progressive-seed")).toBeTruthy();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Generate Map")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector("#random-seed")).toBeTruthy();
    expect(document.body.querySelector("#progressive-seed")).toBeNull();
    expect(document.body.querySelectorAll(".form-overlay").length).toBe(1);
  });

  it("closes the open dialog from the close button and on Escape", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Generate Map")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector(".form-overlay")).not.toBeNull();
    (document.body.querySelector("button.form-close") as HTMLButtonElement).click();
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector(".form-overlay")).toBeNull();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Progressive Run")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector(".form-overlay")).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector(".form-overlay")).toBeNull();
  });

  it("starts a custom generated map from the menu with a pinned seed", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: uiStore unused
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Generate Map")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    const seedInput = document.body.querySelector("#random-seed") as HTMLInputElement;
    seedInput.value = "777";
    seedInput.dispatchEvent(new Event("input", { bubbles: true }));
    const levelInput = document.body.querySelector("#random-level") as HTMLInputElement;
    levelInput.value = "4";
    levelInput.dispatchEvent(new Event("input", { bubbles: true }));
    const playButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Play Generated Map",
    );
    expect(playButton).toBeTruthy();
    playButton!.click();
    await flushNavigation();
    expect(router.currentRoute.value.path).toBe("/game");
    expect(gameStore.mapIndex).toBe(CUSTOM_RANDOM_MAP_INDEX);
    expect(gameStore.map.seed).toBe(777);
    expect(gameStore.randomMapParams.seed).toBe(777);
    expect(gameStore.randomMapParams.level).toBe(4);
    expect(persistStore.randomMapSeed).toBe(777);
  });

  it("starts a custom progressive map from the menu with the chosen entries and seed", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: uiStore unused
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Progressive Run")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    const entriesSelect = document.body.querySelector("#progressive-entries") as HTMLSelectElement;
    entriesSelect.value = "3";
    entriesSelect.dispatchEvent(new Event("change", { bubbles: true }));
    const seedInput = document.body.querySelector("#progressive-seed") as HTMLInputElement;
    seedInput.value = "424242";
    seedInput.dispatchEvent(new Event("input", { bubbles: true }));
    const playButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Play Progressive Map",
    );
    expect(playButton).toBeTruthy();
    playButton!.click();
    await flushNavigation();
    expect(router.currentRoute.value.path).toBe("/game");
    expect(gameStore.mapIndex).toBe(CUSTOM_PROGRESSIVE_MAP_INDEX);
    expect(gameStore.map.style).toBe("progressive");
    expect(gameStore.map.entryCount).toBe(3);
    expect(gameStore.map.seed).toBe(424242);
    expect(persistStore.progressiveMapEntries).toBe(3);
  });
});
