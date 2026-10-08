// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TowerPanel from "@/components/TowerPanel.vue";
import type { Command } from "@/sim/Command.js";
import { setCommandDispatcher } from "@/sim/commandBus.js";
import type { TowerUpgradeCheck } from "@/sim/SimulationSnapshot.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

interface TowerStatsSnapshot {
  damage: number;
  range: number;
  fireRate: number;
  splash: number;
  chain: number;
  groundOnly: boolean;
}

// The selected tower is the worker-projected TowerSnapshot (read-only plain
// data). The panel reads these fields directly and dispatches commands for
// actions rather than calling engine methods.
interface MockTower {
  id: string;
  type: string;
  level: number;
  color: string;
  targeting: string;
  variant: string | null;
  stats: TowerStatsSnapshot;
  totalDamageDealt: number;
  waveDamage: number;
  canUpgrade: TowerUpgradeCheck;
  upgradeCostAt5: number;
  levelCosts: number[];
  totalInvested: number;
  sellValue: number;
  sellCredit: number;
  downgradeRefund: number;
  isGhost: boolean;
  health: number;
  maxHealth: number;
  milestoneBonus: { damagePct: number; speedPct: number; tiers: number; threshold: number };
  base: { fixedAim: boolean };
  fixedAimDir: string | null;
  // Elapsed sim ms since place. TowerPanel derives canCancel/cancelRemaining
  // from this (sim-time cancel window; 0 = just placed).
  placedAt: number;
}

function makeMockTower(overrides: Partial<MockTower> = {}): MockTower {
  const level = overrides.level ?? 1;
  const levelCosts = overrides.levelCosts ?? Array.from({ length: level }, (_, i) => 20 + i * 10);
  return {
    id: "t1",
    type: "basic",
    level,
    color: "#8fbc8f",
    targeting: "first",
    variant: null,
    stats: { damage: 8, range: 3.5, fireRate: 1.2, splash: 0, chain: 0, groundOnly: false },
    totalDamageDealt: 100,
    waveDamage: 50,
    canUpgrade: { ok: true, nextLevel: 2, cost: 20 },
    upgradeCostAt5: 100,
    levelCosts,
    totalInvested: 20,
    sellValue: 12,
    sellCredit: 12,
    downgradeRefund: 0,
    isGhost: false,
    health: 100,
    maxHealth: 100,
    milestoneBonus: { damagePct: 0, speedPct: 0, tiers: 0, threshold: 0 },
    base: { fixedAim: false },
    fixedAimDir: null,
    placedAt: 0,
    ...overrides,
  };
}

interface MountResult {
  pinia: ReturnType<typeof createPinia>;
  gameStore: ReturnType<typeof useGameStore>;
  themeStore: ReturnType<typeof useMapThemeStore>;
  persistStore: ReturnType<typeof usePersistStore>;
  uiStore: ReturnType<typeof useUiStore>;
  commands: Command[];
}

function mountTowerPanel(tower: MockTower | null = null): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const themeStore = useMapThemeStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  themeStore.defaultTheme = {
    id: "default",
    towers: {
      basic: { name: "Rifle Tower" },
      ice: { name: "Frost Pylon" },
      power: { name: "Power Tower" },
      sniper: { name: "Sniper Nest" },
      poison: { name: "Poison Tower" },
      splash: { name: "Splash Tower" },
      railgun: { name: "Rail Cannon" },
    },
    enemies: {},
    regions: [],
  } as never;
  themeStore.activeTheme = themeStore.defaultTheme;
  gameStore.selectedTower = tower as unknown as Tower;
  gameStore.gold = 500;
  const commands: Command[] = [];
  const dispatcher = { dispatch: (command: Command) => commands.push(command) };
  // Tower actions are routed through the global command bus (worker dispatch).
  setCommandDispatcher(dispatcher as never);
  return { pinia, gameStore, themeStore, persistStore, uiStore, commands };
}

describe("TowerPanel", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    setCommandDispatcher(null);
  });

  it("renders when a tower is selected", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower());
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.find(".tower-panel").exists()).toBe(true);
  });

  it("does not render when no tower is selected", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(null);
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.find(".tower-panel").exists()).toBe(false);
  });

  it("displays tower name and level", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, themeStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ level: 3 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Lv 3");
    expect(wrapper.text()).toContain("Rifle Tower");
  });

  it("displays tower stats (damage, fireRate, range)", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower());
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Damage");
    expect(wrapper.text()).toContain("Range");
    expect(wrapper.text()).toContain("Fire Rate");
  });

  it("shows the Ground only targets label for a ground-only tower", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(
      makeMockTower({
        type: "cannon",
        stats: { damage: 16, range: 3.2, fireRate: 0.55, splash: 0.5, chain: 0, groundOnly: true },
      }),
    );
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Targets");
    expect(wrapper.text()).toContain("Ground only");
  });

  it("shows the Air & Ground targets label for an air-capable tower", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower());
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Targets");
    expect(wrapper.text()).toContain("Air & Ground");
  });

  it("shows upgrade button with cost", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower());
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Upgrade");
  });

  it("shows the snapshot upgrade cost without applying Cheaper Upgrades again", () => {
    const { pinia, persistStore } = mountTowerPanel(
      makeMockTower({ canUpgrade: { ok: true, nextLevel: 4, cost: 60 } }),
    );
    persistStore.generalAddons.upgradeCostReduction = 1;
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Upgrade (60g)");
  });

  it("shows the snapshot specialization cost without applying Cheaper Upgrades again", () => {
    const { pinia, persistStore } = mountTowerPanel(
      makeMockTower({
        level: 4,
        canUpgrade: { ok: false, reason: "Choose specialization", needVariant: true },
        upgradeCostAt5: 120,
      }),
    );
    unlockVariantTiers(persistStore, true, false);
    persistStore.generalAddons.upgradeCostReduction = 1;
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("(120g)");
    expect(wrapper.text()).not.toContain("(90g)");
  });

  it("disables upgrade when cannot afford", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(
      makeMockTower({ canUpgrade: { ok: true, nextLevel: 2, cost: 100 } }),
    );
    gameStore.gold = 0;
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    const upgradeBtn = wrapper.find("button.action-btn:not(.sell-btn)");
    expect(upgradeBtn.attributes("disabled")).toBeDefined();
  });

  it("shows the snapshot sell credit rather than the 60% sell value", () => {
    const { pinia } = mountTowerPanel(makeMockTower({ sellValue: 12, sellCredit: 20, placedAt: 120000, level: 2 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Sell (+20g)");
    expect(wrapper.text()).not.toContain("Sell (+12g)");
  });

  it("shows the snapshot downgrade refund", () => {
    const { pinia } = mountTowerPanel(makeMockTower({ level: 2, downgradeRefund: 0 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("+0g");
  });

  it("shows sell button with refund value", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(
      makeMockTower({ sellValue: 12, placedAt: 120000 }),
    );
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Sell");
    expect(wrapper.text()).toContain("12g");
  });

  it("shows downgrade button with level info and refund", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ level: 3 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Downgrade");
    expect(wrapper.text()).toContain("Lv 3");
    expect(wrapper.text()).toContain("Lv 2");
  });

  it("disables downgrade button when tower is level 1", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ level: 1 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    const downgradeBtn = wrapper.findAll("button.action-btn").find((btn) => btn.text().includes("Downgrade"));
    expect(downgradeBtn).toBeDefined();
    expect(downgradeBtn!.attributes("disabled")).toBeDefined();
  });

  it("dispatches action:downgradeSelected when downgrade button is clicked", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, commands } = mountTowerPanel(makeMockTower({ level: 3 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    const downgradeBtn = wrapper.findAll("button.action-btn").find((btn) => btn.text().includes("Downgrade"));
    await downgradeBtn?.trigger("click");
    expect(commands.some((command) => command.type === "action:downgradeSelected")).toBe(true);
  });

  function unlockVariantTiers(persistStore: ReturnType<typeof usePersistStore>, variantA: boolean, variantB: boolean) {
    const basicUnlocks = persistStore.unlocked.basic;
    basicUnlocks.levels[3] = true;
    basicUnlocks.variantA[0] = variantA;
    basicUnlocks.variantB[0] = variantB;
  }

  it("shows only the unlocked specialization button at level 4", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(
      makeMockTower({ level: 4, canUpgrade: { ok: false, reason: "Choose specialization", needVariant: true } }),
    );
    unlockVariantTiers(persistStore, true, false);
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Choose Specialization");
    const variantButtons = wrapper.findAll(".variant-section button");
    expect(variantButtons).toHaveLength(1);
    expect(variantButtons[0]!.text()).toContain("Rapid Fire");
  });

  it("shows both specialization buttons when both are unlocked", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(
      makeMockTower({ level: 4, canUpgrade: { ok: false, reason: "Choose specialization", needVariant: true } }),
    );
    unlockVariantTiers(persistStore, true, true);
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Choose Specialization");
    const variantButtons = wrapper.findAll(".variant-section button");
    expect(variantButtons).toHaveLength(2);
    expect(variantButtons[0]!.text()).toContain("Rapid Fire");
    expect(variantButtons[1]!.text()).toContain("Heavy Shot");
  });

  it("shows max level reached at the level-4 gate when no specialization is unlocked", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(
      makeMockTower({ level: 4, canUpgrade: { ok: false, reason: "Choose specialization", needVariant: true } }),
    );
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).not.toContain("Choose Specialization");
    expect(wrapper.text()).toContain("Max level reached");
  });

  it("updates targetingMode ref when select changes", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ targeting: "first" }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    const select = wrapper.find(".target-select");
    await select.setValue("last");
    expect((select.element as HTMLOptionElement).value).toBe("last");
  });

  it("dispatches action:setTargeting when targeting changes", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, commands } = mountTowerPanel(
      makeMockTower({ targeting: "first" }),
    );
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    const select = wrapper.find(".target-select");
    await select.setValue("closest");
    const command = commands.find((command) => command.type === "action:setTargeting");
    expect(command).toBeDefined();
    expect((command as { mode: string }).mode).toBe("closest");
  });

  it("displays wave damage stat", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ waveDamage: 50 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Wave Damage");
  });

  it("shows cancel build button when tower can be canceled", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(
      makeMockTower({ level: 1, placedAt: 0, totalInvested: 20 }),
    );
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Cancel Build");
  });

  it("does not show cancel build button when tower cannot be canceled", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ placedAt: 120000 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).not.toContain("Cancel Build");
  });

  it("shows specialization badge for specialized tower", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(
      makeMockTower({ level: 5, variant: "A", canUpgrade: { ok: true, nextLevel: 6 } }),
    );
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.find(".spec-badge").exists()).toBe(true);
  });

  it("does not show specialization badge for non-specialized tower", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ variant: null }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.find(".spec-badge").exists()).toBe(false);
  });

  it("shows current health over max health for a normal tower", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ health: 75, maxHealth: 100 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    const healthRow = wrapper.findAll(".stat-row").find((row) => row.text().includes("Health"));
    expect(healthRow).toBeDefined();
    expect(healthRow!.text()).toContain("75");
    expect(healthRow!.text()).toContain("100");
  });

  it("shows Ghost in both columns when the tower is in ghost state", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(
      makeMockTower({ isGhost: true, health: 0, maxHealth: 0 }),
    );
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).not.toContain("Health");
    const ghostRow = wrapper.find(".ghost-row");
    expect(ghostRow.exists()).toBe(true);
    expect(ghostRow.find(".ghost-label").exists()).toBe(true);
    expect(ghostRow.text()).toContain("Ghost");
    expect(ghostRow.text().match(/Ghost/g)?.length).toBe(1);
  });
});
