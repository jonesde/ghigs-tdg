// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { RouteRecordRaw } from "vue-router";
import { createMemoryHistory, createRouter } from "vue-router";
import SkillTree from "@/components/SkillTree.vue";
import { getGameContent } from "@/content/gameContent.js";
import { resetCommandBusForTests } from "@/sim/commandBus.js";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

const sellOptionGemCost = getGameContent().economy.sellOptionGemCost;

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
    { path: "/skill-tree", name: "skill-tree", component: { template: "<div>SkillTree</div>" } },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

function mountSkillTree(): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  gameStore.resetToMenu();
  const router = createRouterWithRoutes();
  return { pinia, gameStore, persistStore, uiStore, router };
}

describe("SkillTree", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  it("renders all 8 tower types", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountSkillTree();
    const wrapper = mount(SkillTree, { global: { plugins: [router, pinia] } });
    const cols = wrapper.findAll(".skill-col");
    expect(cols.length).toBe(8);
  });

  it("labels each tower column Ground only or Air & Ground per its capability", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountSkillTree();
    const wrapper = mount(SkillTree, { global: { plugins: [router, pinia] } });
    const labels = wrapper.findAll(".skill-col-targets").map((element) => element.text().trim());
    expect(labels.filter((label) => label === "Ground only")).toHaveLength(4);
    expect(labels.filter((label) => label === "Air & Ground")).toHaveLength(4);
    expect(wrapper.text()).toContain("Shots can target and hit flying enemies.");
  });

  it("flips the cannon column to Air & Ground when Anti-Air is unlocked", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountSkillTree();
    persistStore.unlocked.cannon.addons = [false, false, true];
    const wrapper = mount(SkillTree, { global: { plugins: [router, pinia] } });
    const labels = wrapper.findAll(".skill-col-targets").map((element) => element.text().trim());
    expect(labels.filter((label) => label === "Ground only")).toHaveLength(3);
    expect(labels.filter((label) => label === "Air & Ground")).toHaveLength(5);
  });

  it("shows tower level unlocks", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountSkillTree();
    const wrapper = mount(SkillTree, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Level 3");
    expect(wrapper.text()).toContain("Level 4");
  });

  it("shows variant options at level 4", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountSkillTree();
    const wrapper = mount(SkillTree, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Specialization A");
    expect(wrapper.text()).toContain("Specialization B");
  });

  it("displays gem cost for each upgrade", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountSkillTree();
    const wrapper = mount(SkillTree, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("💎");
  });

  it("shows general add-ons section", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountSkillTree();
    const wrapper = mount(SkillTree, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Starting Gold");
  });

  it("shows refund option for unlocked skills", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountSkillTree();
    const unlocked = persistStore.unlocked;
    unlocked.basic.levels[2] = true;
    const wrapper = mount(SkillTree, { global: { plugins: [router, pinia] } });
    const unlockedNodes = wrapper.findAll(".skill-node.unlocked");
    expect(unlockedNodes.length).toBeGreaterThan(0);
  });

  it("navigates back on close when not in game", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountSkillTree();
    const wrapper = mount(SkillTree, { global: { plugins: [router, pinia] } });
    const backBtn = wrapper.findAll("button").find((button) => button.text().includes("Back"))!;
    await backBtn.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/");
  });

  it("highlights available upgrades with node-cost", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountSkillTree();
    const wrapper = mount(SkillTree, { global: { plugins: [router, pinia] } });
    const nodeHeaders = wrapper.findAll(".node-header");
    expect(nodeHeaders.length).toBeGreaterThan(0);
  });

  it("renders gem count display", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountSkillTree();
    persistStore.gems = 150;
    const wrapper = mount(SkillTree, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("150");
  });

  it("displays gem count", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountSkillTree();
    persistStore.gems = 100;
    const wrapper = mount(SkillTree, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("100");
  });

  // Sell Flexibility is ONE purchase with two mutually exclusive positions. Every row of
  // this table is one step of the click table: state before the click, mode clicked, the gem
  // delta that click must cause, and the sellActive value after it.
  const sellClickTable = [
    { startMode: null, clickIndex: 0, delta: -sellOptionGemCost, endMode: "refund", confirms: false },
    { startMode: null, clickIndex: 1, delta: -sellOptionGemCost, endMode: "discount", confirms: false },
    { startMode: "refund", clickIndex: 0, delta: sellOptionGemCost, endMode: null, confirms: true },
    { startMode: "refund", clickIndex: 1, delta: 0, endMode: "discount", confirms: false },
    { startMode: "discount", clickIndex: 0, delta: 0, endMode: "refund", confirms: false },
    { startMode: "discount", clickIndex: 1, delta: sellOptionGemCost, endMode: null, confirms: true },
  ];

  describe("Sell Flexibility: one purchase, two mutually exclusive modes", () => {
    function mountWithGems(gems: number) {
      // biome-ignore lint/correctness/noUnusedVariables: unused gameStore from mount helper
      const { pinia, gameStore, persistStore, uiStore, router } = mountSkillTree();
      resetCommandBusForTests();
      persistStore.gems = gems;
      const wrapper = mount(SkillTree, { global: { plugins: [router, pinia] } });
      return { wrapper, persistStore, uiStore };
    }

    function sellModeButtons(wrapper: ReturnType<typeof mount>) {
      const card = wrapper
        .findAll(".category-economy .general-card")
        .find((element) => element.text().includes("Sell Flexibility"))!;
      return card.findAll("button");
    }

    function modesShown(wrapper: ReturnType<typeof mount>) {
      return sellModeButtons(wrapper).map((button) => button.text());
    }

    it.each(sellClickTable)("from $startMode, clicking mode $clickIndex costs $delta gems and leaves $endMode", async ({
      startMode,
      clickIndex,
      delta,
      endMode,
      confirms,
    }) => {
      const { wrapper, persistStore, uiStore } = mountWithGems(200);
      persistStore.generalAddons.sellActive = startMode;
      const gemsBefore = persistStore.gems;

      await sellModeButtons(wrapper)[clickIndex].trigger("click");

      if (confirms) {
        expect(uiStore.confirmDialog).not.toBeNull();
        uiStore.executeConfirm();
      } else {
        expect(uiStore.confirmDialog).toBeNull();
      }
      expect(persistStore.gems).toBe(gemsBefore + delta);
      expect(persistStore.generalAddons.sellActive).toBe(endMode);
    });

    it("shows the gem cost on both buttons while the purchase is not owned", () => {
      const { wrapper } = mountWithGems(100);
      expect(modesShown(wrapper)).toEqual([
        `Full Refund · ${sellOptionGemCost} 💎`,
        `Discounted · ${sellOptionGemCost} 💎`,
      ]);
      expect(wrapper.text()).not.toContain("Unlock Sell Flexibility");
    });

    it("hides the gem cost on both buttons once one mode is in effect", async () => {
      const { wrapper } = mountWithGems(100);
      await sellModeButtons(wrapper)[0].trigger("click");
      expect(modesShown(wrapper)).toEqual(["Full Refund", "Discounted"]);
      await sellModeButtons(wrapper)[1].trigger("click");
      expect(modesShown(wrapper)).toEqual(["Full Refund", "Discounted"]);
    });

    it("brings both costs back after the active mode is refunded", async () => {
      const { wrapper, persistStore, uiStore } = mountWithGems(100);
      await sellModeButtons(wrapper)[0].trigger("click");
      expect(modesShown(wrapper)).toEqual(["Full Refund", "Discounted"]);
      await sellModeButtons(wrapper)[0].trigger("click");
      expect(uiStore.confirmDialog?.message).toContain('Revoke "Full Refund"');
      uiStore.executeConfirm();
      expect(persistStore.generalAddons.sellActive).toBeNull();
      await wrapper.vm.$nextTick();
      expect(modesShown(wrapper)).toEqual([
        `Full Refund · ${sellOptionGemCost} 💎`,
        `Discounted · ${sellOptionGemCost} 💎`,
      ]);
    });

    it("highlights only the mode in effect and leaves the other clickable", async () => {
      const { wrapper, persistStore } = mountWithGems(100);
      await sellModeButtons(wrapper)[0].trigger("click");
      const owned = sellModeButtons(wrapper);
      expect(owned[0].classes()).toContain("active");
      expect(owned[0].classes()).not.toContain("unavailable");
      expect(owned[1].classes()).not.toContain("active");
      expect(owned[1].classes()).not.toContain("unavailable");
      await owned[1].trigger("click");
      expect(persistStore.generalAddons.sellActive).toBe("discount");
      const switched = sellModeButtons(wrapper);
      expect(switched[1].classes()).toContain("active");
      expect(switched[0].classes()).not.toContain("active");
    });

    it("marks both modes unavailable only while unowned and unaffordable", () => {
      const { wrapper } = mountWithGems(0);
      for (const button of sellModeButtons(wrapper)) expect(button.classes()).toContain("unavailable");
    });

    it("keeps both modes clickable when owned and out of gems", async () => {
      const { wrapper, persistStore } = mountWithGems(sellOptionGemCost);
      await sellModeButtons(wrapper)[0].trigger("click");
      persistStore.gems = 0;
      const owned = sellModeButtons(wrapper);
      for (const button of owned) expect(button.classes()).not.toContain("unavailable");
      await owned[1].trigger("click");
      expect(persistStore.generalAddons.sellActive).toBe("discount");
      expect(persistStore.gems).toBe(0);
    });

    it("charges exactly one purchase across repeated switching", async () => {
      const { wrapper, persistStore } = mountWithGems(sellOptionGemCost * 3);
      for (let click = 0; click < 6; click++) {
        await sellModeButtons(wrapper)[click % 2].trigger("click");
      }
      expect(persistStore.gems).toBe(sellOptionGemCost * 2);
      expect(["refund", "discount"]).toContain(persistStore.generalAddons.sellActive);
    });
  });
});
