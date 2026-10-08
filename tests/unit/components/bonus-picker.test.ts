// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import BonusPicker from "@/components/BonusPicker.vue";
import { setCommandDispatcher } from "@/sim/commandBus.js";
import { cacheOpenGold } from "@/sim/runBonuses.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { mockDefaultTheme } from "../../helpers/mock-stores";

const offer = ["sharpenedType", "smallPurse", "largePurse"];

function mountPicker() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const themeStore = useMapThemeStore();
  themeStore.activeTheme = mockDefaultTheme;
  themeStore.defaultTheme = mockDefaultTheme;
  const commands = [];
  setCommandDispatcher({ dispatch: (command) => commands.push(command) });
  gameStore.currentWave = 0;
  gameStore.bonusPicker = { source: "cache", id: 3, offer: [...offer], wasPlaying: false, specialistType: "basic" };
  gameStore.mapCaches = [
    { id: 3, tileX: 0, tileY: 0, worldX: 0, worldY: 0, hp: 60, maxHp: 60, offer: [...offer], unlocked: false },
  ];
  const wrapper = mount(BonusPicker, { global: { plugins: [pinia] } });
  return { pinia, gameStore, commands, wrapper };
}

describe("BonusPicker", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
    setCommandDispatcher(null);
  });

  it("hides the cards on a locked cache and offers only unlock and leave", () => {
    // biome-ignore lint/correctness/noUnusedVariables: stores set up for the mount
    const { pinia, gameStore, commands, wrapper } = mountPicker();
    expect(wrapper.findAll(".bonus-card")).toHaveLength(0);
    expect(wrapper.find(".bonus-cost").exists()).toBe(false);
    const unlock = wrapper.find(".bonus-unlock");
    expect(unlock.exists()).toBe(true);
    expect(unlock.text()).toBe(`Unlock for ${cacheOpenGold(0)} gold`);
    expect(wrapper.find(".bonus-dismiss").exists()).toBe(true);
    // A sealed cache has no cards to highlight, so the unlock button starts selected.
    expect(unlock.classes()).toContain("selected");
    expect(wrapper.find(".bonus-dismiss").classes()).not.toContain("selected");
    // The hint has to name the options actually on screen.
    expect(wrapper.find(".bonus-hint").text()).toContain("Unlock and Leave it");

    unlock.trigger("click");
    expect(commands).toEqual([expect.objectContaining({ type: "action:unlockCache" })]);
  });

  it("shows the cards with the themed tower name once unlocked", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: stores set up for the mount
    const { pinia, gameStore, commands, wrapper } = mountPicker();
    gameStore.mapCaches[0].unlocked = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".bonus-unlock").exists()).toBe(false);
    const cards = wrapper.findAll(".bonus-card");
    expect(cards).toHaveLength(3);
    expect(cards[0].text()).toContain("Sharpened · Rifle Tower (Basic)");
    expect(cards[0].text()).toContain("Rifle Tower (Basic) tower damage");

    await cards[0].trigger("click");
    expect(commands).toEqual([expect.objectContaining({ type: "action:pickBonus", index: 0 })]);
  });

  it("highlights the first card and follows the keyboard cursor", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: stores set up for the mount
    const { pinia, gameStore, wrapper } = mountPicker();
    gameStore.mapCaches[0].unlocked = true;
    await wrapper.vm.$nextTick();
    const selectedIndexes = () => wrapper.findAll(".bonus-card").map((card) => card.classes().includes("selected"));
    expect(selectedIndexes()).toEqual([true, false, false]);

    gameStore.selectBonusPickerOption(2);
    await wrapper.vm.$nextTick();
    expect(selectedIndexes()).toEqual([false, false, true]);
    expect(wrapper.find(".bonus-dismiss").classes()).not.toContain("selected");

    gameStore.selectBonusPickerOption(3);
    await wrapper.vm.$nextTick();
    expect(selectedIndexes()).toEqual([false, false, false]);
    expect(wrapper.find(".bonus-dismiss").classes()).toContain("selected");
    expect(wrapper.find(".bonus-hint").text()).toContain("the cards and Leave it");
  });

  it("reads a broken cache as free while still showing the cards", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: stores set up for the mount
    const { pinia, gameStore, commands, wrapper } = mountPicker();
    gameStore.mapCaches[0].hp = 0;
    gameStore.mapCaches[0].unlocked = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".bonus-card")).toHaveLength(3);
    expect(wrapper.find(".bonus-cost").text()).toBe("Free");
    expect(wrapper.find(".bonus-unlock").exists()).toBe(false);
  });
});
