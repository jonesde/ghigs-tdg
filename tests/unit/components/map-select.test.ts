// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { RouteRecordRaw } from "vue-router";
import { createMemoryHistory, createRouter } from "vue-router";
import { mockDefaultTheme } from "@/../tests/helpers/mock-stores.js";
import MapSelect from "@/components/MapSelect.vue";
import { customProgressiveMapIndex, customRandomMapIndex } from "@/sim/GameRunState.js";
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

function markerByLabel(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll(".map-node").find((marker) => marker.find(".map-node-label").text() === label);
}

async function flushNavigation() {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

describe("MapSelect", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
    document.body.innerHTML = "";
  });

  it("renders 3 region tabs and 16 map markers for the active region", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const tabs = wrapper.findAll(".region-tab");
    expect(tabs.length).toBe(3);
    expect(tabs.map((tab) => tab.text())).toEqual(["Verdant Marches", "Sunscorch Coast", "Thornpeak Wilds"]);
    expect(tabs[0].classes()).toContain("active");
    expect(wrapper.findAll(".map-node").length).toBe(16);
    expect(wrapper.findAll(".map-node.progressive").length).toBe(4);
  });

  it("switches region tabs, pre-selects the first map level, and shows that region's maps", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    await markerByLabel(wrapper, "3")!.trigger("click");
    expect(persistStore.lastSelectedMapIndex).toBe(2);
    await wrapper.findAll(".region-tab")[2].trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".region-tab")[2].classes()).toContain("active");
    expect(wrapper.find(".details-hint").exists()).toBe(false);
    expect(wrapper.find(".details-name").text()).toContain("Thornpeak Wilds Map 1");
    expect(wrapper.findAll(".map-node").length).toBe(16);
    const firstMarker = wrapper.findAll(".map-node")[0];
    expect(firstMarker.classes()).toContain("selected");
    expect(firstMarker.find("title").text()).toContain("Thornpeak Wilds");
    expect(persistStore.lastSelectedMapIndex).toBe(24);
  });

  it("pre-selects the first map level and shows its details when no map level is remembered", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(wrapper.findAll(".region-tab")[0].classes()).toContain("active");
    expect(markerByLabel(wrapper, "1")!.classes()).toContain("selected");
    expect(wrapper.find(".details-hint").exists()).toBe(false);
    expect(wrapper.find(".details-name").text()).toContain("Verdant Marches Map 1");
  });

  it("restores the remembered map level on its region tab", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.lastSelectedMapIndex = 15;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(wrapper.findAll(".region-tab")[1].classes()).toContain("active");
    expect(markerByLabel(wrapper, "4")!.classes()).toContain("selected");
    expect(wrapper.find(".details-name").text()).toContain("Sunscorch Coast Map 4");
  });

  it("restores a remembered progressive map index on its region tab", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.lastSelectedMapIndex = 41;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(wrapper.findAll(".region-tab")[1].classes()).toContain("active");
    expect(markerByLabel(wrapper, "P2")!.classes()).toContain("selected");
    expect(wrapper.find(".details-name").text()).toContain("Sunscorch Coast Progressive 2");
  });

  it("falls back to the default region and first map level for an invalid remembered index", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.lastSelectedMapIndex = 99;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(wrapper.findAll(".region-tab")[0].classes()).toContain("active");
    expect(markerByLabel(wrapper, "1")!.classes()).toContain("selected");
    expect(wrapper.find(".details-name").text()).toContain("Verdant Marches Map 1");
  });

  it("persists the selected map index when a marker is clicked", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    await markerByLabel(wrapper, "3")!.trigger("click");
    expect(persistStore.lastSelectedMapIndex).toBe(2);
  });

  it("shows locked state for locked markers", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.ensureThemeProgress("default").highestUnlockedMap = 0;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(wrapper.findAll(".map-node.locked").length).toBe(14);
    expect(markerByLabel(wrapper, "1")!.classes()).not.toContain("locked");
  });

  it("shows best wave and gem reward in the marker tooltip", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.ensureThemeProgress("default").bestWaves.best_0 = 15;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const tooltip = markerByLabel(wrapper, "1")!.find("title").text();
    expect(tooltip).toContain("Best Wave: 15");
    expect(tooltip).toContain("💎");
  });

  it("shows the best wave readout and only the earned milestone medals on a marker", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.ensureThemeProgress("default").bestWaves.best_0 = 34;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const marker = markerByLabel(wrapper, "1")!;
    expect(marker.find(".map-node-wave").text()).toBe("☠ 34");
    expect(marker.find(".map-node-medals").text()).toBe("🥉 🥈");
  });

  it("rings and crowns a marker from the first-clear record even when best wave is one short", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const progress = persistStore.ensureThemeProgress("default");
    progress.firstClears["0"] = true;
    progress.bestWaves.best_0 = 99;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const marker = markerByLabel(wrapper, "1")!;
    expect(marker.classes()).toContain("cleared");
    expect(marker.find(".map-node-medals").text()).toBe("🥉 🥈 🥇 👑");
    expect(marker.findAll(".map-node-clear-ring").length).toBe(2);
    expect(marker.find("title").text()).toContain("👑 Cleared");
  });

  it("rings and crowns a marker for a map cleared at the victory wave", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.ensureThemeProgress("default").bestWaves.best_0 = 100;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const marker = markerByLabel(wrapper, "1")!;
    expect(marker.classes()).toContain("cleared");
    expect(marker.find(".map-node-medals").text()).toBe("🥉 🥈 🥇 👑");
    expect(marker.findAll(".map-node-clear-ring").length).toBe(2);
    expect(marker.find("title").text()).toContain("👑 Cleared");
  });

  it("selects a marker, shows its details, and plays from the Play button", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    await markerByLabel(wrapper, "1")!.trigger("click");
    expect(wrapper.find(".details-name").text()).toContain("Verdant Marches Map 1");
    expect(wrapper.find(".map-details").text()).toContain("💎");
    expect(wrapper.find(".map-details").text()).toContain("Best Wave:");
    const playButton = wrapper.find(".details-play-btn");
    expect(playButton.text()).toBe("Play");
    await playButton.trigger("click");
    await flushNavigation();
    expect(router.currentRoute.value.path).toBe("/game");
  });

  it("starts the map on double click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    await markerByLabel(wrapper, "1")!.trigger("dblclick");
    await flushNavigation();
    expect(router.currentRoute.value.path).toBe("/game");
  });

  it("shows an on-map play button under the pre-selected map level and starts from it", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(markerByLabel(wrapper, "1")!.classes()).toContain("selected");
    const playButton = wrapper.find(".map-play-button");
    expect(playButton.exists()).toBe(true);
    await playButton.trigger("click");
    await flushNavigation();
    expect(router.currentRoute.value.path).toBe("/game");
  });

  it("keeps locked markers inert and disables the Play button", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.ensureThemeProgress("default").highestUnlockedMap = 0;
    await router.replace("/map-select");
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    await markerByLabel(wrapper, "2")!.trigger("click");
    const playButton = wrapper.find(".details-play-btn");
    expect(playButton.text()).toBe("Locked");
    expect(playButton.attributes("disabled")).toBeDefined();
    await markerByLabel(wrapper, "2")!.trigger("dblclick");
    await flushNavigation();
    expect(router.currentRoute.value.path).toBe("/map-select");
  });

  it("unlocks the level-1 progressive marker and keeps the level-5 branch locked", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.ensureThemeProgress("default").highestUnlockedMap = 0;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const oneEntry = markerByLabel(wrapper, "P1");
    const twoEntry = markerByLabel(wrapper, "P2");
    expect(oneEntry).toBeTruthy();
    expect(twoEntry).toBeTruthy();
    expect(oneEntry!.classes()).not.toContain("locked");
    expect(twoEntry!.classes()).toContain("locked");
    expect(oneEntry!.find("title").text()).toContain("Verdant Marches Progressive 1");
    expect(twoEntry!.find("title").text()).toContain("Verdant Marches Progressive 2");
  });

  it("reactively updates locked status when highestUnlockedMap changes", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.ensureThemeProgress("default").highestUnlockedMap = 0;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(wrapper.findAll(".map-node.locked").length).toBe(14);
    persistStore.ensureThemeProgress("default").highestUnlockedMap = 5;
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".map-node.locked").length).toBe(8);
  });

  it("map markers are tab-selectable with tabindex, role, and keyboard selection", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const mapNodes = wrapper.findAll(".map-node");
    expect(mapNodes.length).toBe(16);
    for (const marker of mapNodes) {
      expect(marker.attributes("tabindex")).toBe("0");
      expect(marker.attributes("role")).toBe("button");
    }
    await markerByLabel(wrapper, "1")!.trigger("keydown", { key: "Enter" });
    expect(wrapper.find(".details-name").text()).toContain("Verdant Marches Map 1");
  });

  it("hides the custom map forms until a header button opens them", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(document.body.querySelector(".form-overlay")).toBeNull();
    const generateButton = wrapper.findAll("button").find((button) => button.text() === "Generate");
    const progressiveButton = wrapper.findAll("button").find((button) => button.text() === "Progressive");
    expect(generateButton).toBeTruthy();
    expect(progressiveButton).toBeTruthy();
  });

  it("opens the generated map dialog from the Generate header button", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Generate")!
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
      .find((button) => button.text() === "Generate")!
      .trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Progressive")!
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
      .find((button) => button.text() === "Progressive")!
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
      .find((button) => button.text() === "Progressive")!
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
      .find((button) => button.text() === "Generate")!
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
    expect(gameStore.mapIndex).toBe(customRandomMapIndex);
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
      .find((button) => button.text() === "Progressive")!
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
    expect(gameStore.mapIndex).toBe(customProgressiveMapIndex);
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
      .find((button) => button.text() === "Progressive")!
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
      .find((button) => button.text() === "Progressive")!
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
      .find((button) => button.text() === "Generate")!
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
