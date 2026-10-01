// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import GameShop from "@/components/GameShop.vue";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

interface MountResult {
  pinia: ReturnType<typeof createPinia>;
  gameStore: ReturnType<typeof useGameStore>;
  persistStore: ReturnType<typeof usePersistStore>;
  uiStore: ReturnType<typeof useUiStore>;
}

function mountGameShop(): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  return { pinia, gameStore, persistStore, uiStore };
}

describe("GameShop", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  it("renders all 8 tower types", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameShop();
    const wrapper = mount(GameShop, { global: { plugins: [pinia] } });
    const towers = wrapper.findAll(".shop-tower");
    expect(towers.length).toBe(8);
  });

  it("displays tower cost for each type", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameShop();
    const wrapper = mount(GameShop, { global: { plugins: [pinia] } });
    const costs = wrapper.findAll(".tower-cost");
    expect(costs.length).toBe(8);
    costs.forEach((cost) => {
      expect(cost.text()).toMatch(/\d+/);
    });
  });

  it("shows discounted cost when sellActive=discount", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameShop();
    persistStore.generalAddons.sellActive = "discount";
    const wrapper = mount(GameShop, { global: { plugins: [pinia] } });
    const costs = wrapper.findAll(".tower-cost");
    const firstCost = parseInt(costs[0].text().match(/\d+/)[0], 10);
    expect(firstCost).toBe(15);
  });

  it("highlights selected tower type", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameShop();
    gameStore.gold = 1000;
    const wrapper = mount(GameShop, { global: { plugins: [pinia] } });
    const firstTower = wrapper.findAll(".shop-tower")[0];
    await firstTower.trigger("click");
    expect(firstTower.classes("selected")).toBe(true);
  });

  it("selects tower type on click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameShop();
    gameStore.gold = 1000;
    const wrapper = mount(GameShop, { global: { plugins: [pinia] } });
    const firstTower = wrapper.findAll(".shop-tower")[0];
    await firstTower.trigger("click");
    expect(gameStore.selectedTowerType).toBeTruthy();
  });

  it("disables towers player cannot afford", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameShop();
    gameStore.gold = 0;
    const wrapper = mount(GameShop, { global: { plugins: [pinia] } });
    const disabledTowers = wrapper.findAll(".shop-tower.disabled");
    expect(disabledTowers.length).toBe(8);
  });

  it("does not select unaffordable tower on click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameShop();
    gameStore.gold = 0;
    const wrapper = mount(GameShop, { global: { plugins: [pinia] } });
    const firstTower = wrapper.findAll(".shop-tower")[0];
    await firstTower.trigger("click");
    expect(gameStore.selectedTowerType).toBeNull();
  });

  it("snaps the build hover to the selected tower tile", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameShop();
    gameStore.gold = 1000;
    gameStore.selectedTower = { tileX: 4, tileY: 7 };
    gameStore.hoverTile = { tileX: 1, tileY: 1 };
    const wrapper = mount(GameShop, { global: { plugins: [pinia] } });
    await wrapper.findAll(".shop-tower")[0].trigger("click");
    expect(gameStore.selectedTowerType).toBeTruthy();
    expect(gameStore.hoverTile).toEqual({ tileX: 4, tileY: 7 });
    expect(gameStore.buildHoverHeld).toBe(true);
    expect(gameStore.selectedTower).toEqual({ tileX: 4, tileY: 7 });
  });

  it("deselects when clicking already-selected affordable tower", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameShop();
    gameStore.gold = 1000;
    const wrapper = mount(GameShop, { global: { plugins: [pinia] } });
    const firstTower = wrapper.findAll(".shop-tower")[0];
    await firstTower.trigger("click");
    expect(gameStore.selectedTowerType).toBeTruthy();
    await firstTower.trigger("click");
    expect(gameStore.selectedTowerType).toBeNull();
  });
});
