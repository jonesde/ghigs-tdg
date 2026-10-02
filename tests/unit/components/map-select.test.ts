// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { RouteRecordRaw } from "vue-router";
import { createMemoryHistory, createRouter } from "vue-router";
import { mockDefaultTheme } from "@/../tests/helpers/mock-stores.js";
import MapSelect from "@/components/MapSelect.vue";
import { CUSTOM_PROGRESSIVE_MAP_INDEX, CUSTOM_RANDOM_MAP_INDEX } from "@/sim/Constants.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

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
    { path: "/game", name: "game", component: { template: "<div>Game</div>" } },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

function mountMapSelect(): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  const themeStore = useMapThemeStore();
  themeStore.defaultTheme = mockDefaultTheme;
  themeStore.activeTheme = mockDefaultTheme;
  gameStore.resetToMenu();
  const router = createRouterWithRoutes();
  return { pinia, gameStore, persistStore, uiStore, router };
}

describe("MapSelect", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
    document.body.innerHTML = "";
  });

  it("renders 36 campaign maps and 12 progressive maps", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const mapCards = wrapper.findAll(".map-card");
    expect(mapCards.length).toBe(48);
    expect(wrapper.findAll(".progressive-header").length).toBe(3);
  });

  it("shows locked state for unlocked maps", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.highestUnlockedMap = 0;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const lockedCards = wrapper.findAll(".map-card.locked");
    expect(lockedCards.length).toBeGreaterThan(0);
  });

  it("shows best wave for completed maps", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.bestWaves.best_0 = 15;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Best Wave: 15");
  });

  it("displays region name for each map", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Verdant Marches");
    expect(wrapper.text()).toContain("Sunscorch Coast");
    expect(wrapper.text()).toContain("Thornpeak Wilds");
  });

  it("shows region headers", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const regionHeaders = wrapper.findAll(".region-header:not(.progressive-header) .region-label");
    expect(regionHeaders.length).toBe(3);
  });

  it("navigates to /game on map select", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const firstCard = wrapper.findAll(".map-card")[0];
    await firstCard.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/game");
  });

  it("unlocks the 1-path progressive card and keeps the 2-path card locked", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.highestUnlockedMap = 0;
    await router.replace("/map-select");
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const cards = wrapper.findAll(".map-card");
    const onePath = cards.find((card) => card.text().includes("Verdant Marches Progressive 1"));
    const twoPath = cards.find((card) => card.text().includes("Verdant Marches Progressive 2"));
    expect(onePath).toBeTruthy();
    expect(twoPath).toBeTruthy();
    expect(onePath!.classes()).not.toContain("locked");
    expect(twoPath!.classes()).toContain("locked");
    await twoPath!.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/map-select");
  });

  it("does not navigate when clicking locked map", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.highestUnlockedMap = 0;
    await router.replace("/map-select");
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const lockedCards = wrapper.findAll(".map-card.locked");
    expect(lockedCards.length).toBeGreaterThan(0);
    await lockedCards[0].trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/map-select");
  });

  it("displays gem reward multiplier for each map", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("💎");
  });

  it("reactively updates locked status when highestUnlockedMap changes", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.highestUnlockedMap = 0;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const lockedCards = wrapper.findAll(".map-card.locked");
    expect(lockedCards.length).toBeGreaterThan(0);
    persistStore.highestUnlockedMap = 5;
    await wrapper.vm.$nextTick();
    const mapCards = wrapper.findAll(".map-card");
    expect(mapCards[1].classes("locked")).toBe(false);
    expect(mapCards[6].classes("locked")).toBe(true);
  });

  it("map cards are tab-selectable with tabindex, role, and keyboard handlers", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const mapCards = wrapper.findAll(".map-card");
    expect(mapCards.length).toBe(48);
    for (const card of mapCards) {
      expect(card.attributes("tabindex")).toBe("0");
      expect(card.attributes("role")).toBe("button");
      expect(card.attributes("tabindex")).toBeDefined();
      expect(card.attributes("role")).toBeDefined();
    }
  });

  it("hides the custom map forms until a header button opens them", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(document.body.querySelector(".form-overlay")).toBeNull();
    const generateButton = wrapper.findAll("button").find((button) => button.text() === "Generate Map");
    const progressiveButton = wrapper.findAll("button").find((button) => button.text() === "Progressive Run");
    expect(generateButton).toBeTruthy();
    expect(progressiveButton).toBeTruthy();
  });

  it("opens the generated map dialog from the Generate Map header button", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Generate Map")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    expect(document.body.querySelectorAll(".form-overlay").length).toBe(1);
    expect(document.body.textContent).toContain("Generated Map");
    expect(document.body.textContent).toContain("Generate a procedural map with custom parameters");
    expect(document.body.querySelector("#random-seed")).toBeTruthy();
    expect(document.body.querySelector("#progressive-seed")).toBeNull();
  });

  it("opens one dialog at a time and closes it from the close button", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Generate Map")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Progressive Run")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector("#progressive-seed")).toBeTruthy();
    expect(document.body.querySelector("#random-seed")).toBeNull();
    (document.body.querySelector("button.form-close") as HTMLButtonElement).click();
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector(".form-overlay")).toBeNull();
  });

  it("closes the open dialog on Escape", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
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

  it("offers base entry counts 1 through 4 in the progressive form", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Progressive Run")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    const options = (document.body.querySelector("#progressive-entries") as HTMLSelectElement).querySelectorAll(
      "option",
    );
    expect(Array.from(options).map((option) => option.value)).toEqual(["1", "2", "3", "4"]);
  });

  it("starts a custom generated map from the form with a pinned seed", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: uiStore unused
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    await router.replace("/map-select");
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
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
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/game");
    expect(gameStore.mapIndex).toBe(CUSTOM_RANDOM_MAP_INDEX);
    expect(gameStore.map.seed).toBe(777);
    expect(gameStore.randomMapParams.seed).toBe(777);
    expect(gameStore.randomMapParams.level).toBe(4);
    expect(persistStore.randomMapSeed).toBe(777);
  });

  it("starts a custom progressive map from the form with the chosen entries and seed", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: uiStore unused
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    await router.replace("/map-select");
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Progressive Run")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    const regionSelect = document.body.querySelector("#progressive-region") as HTMLSelectElement;
    regionSelect.value = "1";
    regionSelect.dispatchEvent(new Event("change", { bubbles: true }));
    const levelInput = document.body.querySelector("#progressive-level") as HTMLInputElement;
    levelInput.value = "7";
    levelInput.dispatchEvent(new Event("input", { bubbles: true }));
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
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/game");
    expect(gameStore.mapIndex).toBe(CUSTOM_PROGRESSIVE_MAP_INDEX);
    expect(gameStore.map.style).toBe("progressive");
    expect(gameStore.map.regionId).toBe(0);
    expect(gameStore.map.level).toBe(7);
    expect(gameStore.map.entryCount).toBe(3);
    expect(gameStore.map.seed).toBe(424242);
    expect(persistStore.progressiveMapEntries).toBe(3);
  });

  it("rolls an auto seed for a custom progressive map when none is pinned", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: uiStore unused
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.progressiveMapSeed = null;
    await router.replace("/map-select");
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Progressive Run")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    const playButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Play Progressive Map",
    );
    playButton!.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/game");
    expect(gameStore.map.seed).toBeGreaterThanOrEqual(0);
    expect(gameStore.map.seed).toBeLessThan(999999);
  });

  it("restores the Auto seed placeholder when the seed input is cleared", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Progressive Run")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    const progressiveSeedInput = document.body.querySelector("#progressive-seed") as HTMLInputElement;
    progressiveSeedInput.value = "4242";
    progressiveSeedInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(persistStore.progressiveMapSeed).toBe(4242);
    progressiveSeedInput.value = "";
    progressiveSeedInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(persistStore.progressiveMapSeed).toBeNull();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Generate Map")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    const randomSeedInput = document.body.querySelector("#random-seed") as HTMLInputElement;
    randomSeedInput.value = "55";
    randomSeedInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(persistStore.randomMapSeed).toBe(55);
    randomSeedInput.value = "";
    randomSeedInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(persistStore.randomMapSeed).toBeNull();
  });
});
