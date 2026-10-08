import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, type Pinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BasePanel from "@/components/BasePanel.vue";
import type { Command } from "@/sim/Command.js";
import type { CommandDispatcher } from "@/sim/CommandDispatcher.js";
import { setCommandDispatcher } from "@/sim/commandBus.js";
import type { BaseGunStatsSnapshot } from "@/sim/SimulationSnapshot.js";
import { baseSelectionId } from "@/sim/towers/BaseDefense.js";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";

interface MockBaseDefense {
  level: number;
  maxLevel: number;
  targeting: string;
  totalDamageDealt: number;
  waveDamage: number;
  previousWaveDamage: number;
  upgradeCost: number;
  nextLevel: number;
  canUpgrade: boolean;
  blockedReason: string | null;
  downgradeRefund: number;
  shortStats: BaseGunStatsSnapshot | null;
  longStats: BaseGunStatsSnapshot | null;
}

function makeBaseDefense(overrides: Partial<MockBaseDefense> = {}): MockBaseDefense {
  return {
    level: 2,
    maxLevel: 4,
    targeting: "first",
    totalDamageDealt: 1200,
    waveDamage: 340,
    previousWaveDamage: 860,
    upgradeCost: 90,
    nextLevel: 3,
    canUpgrade: true,
    blockedReason: null,
    downgradeRefund: 40,
    shortStats: { damage: 12, range: 3.5, fireRate: 2 },
    longStats: { damage: 30, range: 6, fireRate: 0.5 },
    ...overrides,
  };
}

interface Harness {
  pinia: Pinia;
  gameStore: ReturnType<typeof useGameStore>;
  dispatched: Command[];
}

function setup(overrides: Partial<MockBaseDefense> = {}): Harness {
  const pinia = createPinia();
  setActivePinia(pinia);
  usePersistStore();
  const gameStore = useGameStore();
  gameStore.selectedTowerId = baseSelectionId;
  gameStore.gold = 1000;
  gameStore.baseDefense = makeBaseDefense(overrides) as never;
  // The bus stamps its own commandId, so assertions match on the fields the
  // panel actually chose rather than the whole object.
  const dispatched: Command[] = [];
  const recorder: CommandDispatcher = {
    dispatch(command) {
      dispatched.push(command);
    },
  };
  setCommandDispatcher(recorder);
  return { pinia, gameStore, dispatched };
}

function dispatchedTypes(harness: Harness): string[] {
  return harness.dispatched.map((command) => command.type);
}

// vue-test-utils indexing is typed as possibly-undefined; the panel always
// renders these buttons, so failing loudly beats a non-null assertion.
function actionButton(wrapper: VueWrapper, index: number) {
  const button = wrapper.findAll(".action-btn")[index];
  if (!button) throw new Error(`BasePanel rendered no .action-btn at index ${index}`);
  return button;
}

function mountPanel(harness: Harness) {
  return mount(BasePanel, { global: { plugins: [harness.pinia] } });
}

describe("BasePanel", () => {
  beforeEach(() => {
    setCommandDispatcher(null);
  });

  it("renders nothing until the base is selected", () => {
    const harness = setup();
    harness.gameStore.selectedTowerId = null;
    const wrapper = mountPanel(harness);
    expect(wrapper.find(".base-panel").exists()).toBe(false);
  });

  it("renders the base level and both gun stat blocks", () => {
    const harness = setup();
    const wrapper = mountPanel(harness);
    expect(wrapper.find(".panel-header").text()).toContain("Base Lv 2");
    expect(wrapper.text()).toContain("Short Range");
    expect(wrapper.text()).toContain("Long Range");
  });

  it("omits a gun block the base has not unlocked", () => {
    const harness = setup({ longStats: null });
    const wrapper = mountPanel(harness);
    expect(wrapper.text()).toContain("Short Range");
    expect(wrapper.text()).not.toContain("Long Range");
  });

  it("dispatches upgrade and downgrade commands", async () => {
    const harness = setup();
    const wrapper = mountPanel(harness);
    await actionButton(wrapper, 0).trigger("click");
    await actionButton(wrapper, 1).trigger("click");
    expect(dispatchedTypes(harness)).toEqual(["action:upgradeSelected", "action:downgradeSelected"]);
  });

  it("disables the upgrade button when gold is short", () => {
    const harness = setup();
    harness.gameStore.gold = 10;
    const wrapper = mountPanel(harness);
    expect(actionButton(wrapper, 0).attributes("disabled")).toBeDefined();
  });

  it("shows the blocked reason instead of an upgrade button at the level cap", () => {
    const harness = setup({ canUpgrade: false, blockedReason: "Max level reached" });
    const wrapper = mountPanel(harness);
    expect(actionButton(wrapper, 0).text()).toBe("Max level reached");
  });

  it("reports a slow fire rate as seconds per shot", () => {
    const harness = setup();
    const wrapper = mountPanel(harness);
    expect(wrapper.text()).toContain("2.00/s");
    expect(wrapper.text()).toContain("2.00 s/shot");
  });

  it("dispatches a targeting change from the select", async () => {
    const harness = setup();
    const wrapper = mountPanel(harness);
    await wrapper.find(".target-select").setValue("strong");
    expect(harness.dispatched).toHaveLength(1);
    expect(harness.dispatched[0]).toMatchObject({ type: "action:setTargeting", mode: "strong" });
  });

  it("moves basePanelPos on a header drag without disturbing towerPanelPos", async () => {
    const harness = setup();
    harness.gameStore.basePanelPos = { x: 100, y: 100 };
    harness.gameStore.towerPanelPos = { x: 7, y: 9 };
    const wrapper = mountPanel(harness);

    await wrapper.find(".panel-header").trigger("mousedown", { button: 0, clientX: 0, clientY: 0 });
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 30, clientY: 20 }));
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 30, clientY: 20 }));

    expect(harness.gameStore.basePanelPos).toEqual({ x: 130, y: 120 });
    expect(harness.gameStore.towerPanelPos).toEqual({ x: 7, y: 9 });
  });

  it("ignores a non-primary header press", async () => {
    const harness = setup();
    harness.gameStore.basePanelPos = { x: 100, y: 100 };
    const wrapper = mountPanel(harness);

    await wrapper.find(".panel-header").trigger("mousedown", { button: 2, clientX: 0, clientY: 0 });
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 30, clientY: 20 }));

    expect(harness.gameStore.basePanelPos).toEqual({ x: 100, y: 100 });
  });

  it("stops updating the position after unmount", async () => {
    const harness = setup();
    harness.gameStore.basePanelPos = { x: 100, y: 100 };
    const wrapper = mountPanel(harness);

    await wrapper.find(".panel-header").trigger("mousedown", { button: 0, clientX: 0, clientY: 0 });
    wrapper.unmount();
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 30, clientY: 20 }));

    expect(harness.gameStore.basePanelPos).toEqual({ x: 100, y: 100 });
  });

  it("leaves the drag listeners clean when the component unmounts mid-drag", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const harness = setup();
    const wrapper = mountPanel(harness);
    wrapper.find(".panel-header").element.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    wrapper.unmount();
    const removedEvents = removeSpy.mock.calls.map((call) => call[0]);
    expect(removedEvents).toContain("mousemove");
    expect(removedEvents).toContain("mouseup");
    removeSpy.mockRestore();
  });
});
