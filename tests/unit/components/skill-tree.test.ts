// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { RouteRecordRaw } from "vue-router";
import { createMemoryHistory, createRouter } from "vue-router";
import SkillTree from "@/components/SkillTree.vue";
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
});
