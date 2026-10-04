// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import HelpDialog from "@/components/HelpDialog.vue";
import { getGameContent } from "@/content/gameContent.js";
import { TOWER_BASE } from "@/sim/ConstantsTower.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { useUiStore } from "@/stores/ui.js";
import { mockDefaultTheme } from "../../helpers/mock-stores";

function mountHelpDialog() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const themeStore = useMapThemeStore();
  themeStore.defaultTheme = mockDefaultTheme;
  themeStore.activeTheme = mockDefaultTheme;
  return mount(HelpDialog, { global: { plugins: [pinia] } });
}

function tabLabels() {
  return Array.from(document.querySelectorAll(".help-tab")).map((tab) => tab.textContent.trim());
}

function clickTab(index) {
  document.querySelectorAll(".help-tab")[index].click();
}

function setSlider(selector, value) {
  const input = document.querySelector(selector);
  input.value = String(value);
  input.dispatchEvent(new Event("input"));
}

function statRows() {
  return Array.from(document.querySelectorAll(".stat-table tbody tr"));
}

function cellText(row, index) {
  return row.children[index].textContent.trim();
}

describe("HelpDialog", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the dialog", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    mount(HelpDialog, { global: { plugins: [pinia] } });
    expect(document.querySelector(".help-dialog")).not.toBeNull();
  });

  it("renders the debug bug button", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    mount(HelpDialog, { global: { plugins: [pinia] } });
    const bugBtn = document.querySelector(".debug-bug");
    expect(bugBtn).not.toBeNull();
    expect(bugBtn.getAttribute("aria-label")).toBe("Open Debug Panel");
  });

  it("opens debug panel when bug is clicked", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const uiStore = useUiStore();
    uiStore.showHelpDialog = true;
    mount(HelpDialog, { global: { plugins: [pinia] } });
    const bugBtn = document.querySelector(".debug-bug");
    bugBtn.click();
    expect(uiStore.debugPanelVisible).toBe(true);
  });

  it("closes when overlay background is clicked", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const uiStore = useUiStore();
    uiStore.showHelpDialog = true;
    mount(HelpDialog, { global: { plugins: [pinia] } });
    const overlay = document.querySelector(".help-overlay");
    overlay.click();
    expect(uiStore.showHelpDialog).toBe(false);
  });

  describe("stat tabs", () => {
    it("shows three tabs and opens on How to Play", () => {
      mountHelpDialog();
      expect(tabLabels()).toEqual(["How to Play", "Towers", "Enemies"]);
      expect(document.querySelector(".help-tab.active").textContent.trim()).toBe("How to Play");
      expect(document.querySelector(".help-table")).not.toBeNull();
      expect(document.querySelector("#help-tower-level")).toBeNull();
      expect(document.querySelector("#help-enemy-wave")).toBeNull();
    });

    it("lists one row per tower type at level 1", async () => {
      mountHelpDialog();
      clickTab(1);
      await nextTick();
      expect(document.querySelector("#help-tower-level")).not.toBeNull();
      expect(document.querySelector(".help-table")).toBeNull();
      expect(statRows().length).toBe(Object.keys(TOWER_BASE).length);
      const basicRow = statRows()[0];
      expect(cellText(basicRow, 1)).toContain("Rifle Tower");
      expect(cellText(basicRow, 4)).toBe(String(Number(TOWER_BASE.basic.damage.toFixed(1))));
      expect(basicRow.querySelector(".sprite svg")).not.toBeNull();
    });

    it("shows both specializations once the level slider reaches 5", async () => {
      mountHelpDialog();
      clickTab(1);
      await nextTick();
      setSlider("#help-tower-level", 7);
      await nextTick();
      expect(statRows().length).toBe(Object.keys(TOWER_BASE).length * 2);
      const basicRows = statRows().slice(0, 2);
      expect(basicRows[0].querySelector(".variant-badge").textContent.trim()).toBe("Rapid");
      expect(basicRows[1].querySelector(".variant-badge").textContent.trim()).toBe("Heavy");
      expect(basicRows[1].textContent).toContain("Heavy");
    });

    it("lists every enemy type with the wave context", async () => {
      mountHelpDialog();
      clickTab(2);
      await nextTick();
      expect(document.querySelector("#help-enemy-wave")).not.toBeNull();
      expect(statRows().length).toBe(9);
      const context = document.querySelector(".wave-context").textContent;
      expect(context).toContain("Enemy level 1");
      expect(context).toContain("No boss");
      expect(statRows()[0].querySelector(".sprite svg")).not.toBeNull();
    });

    it("dims enemies that cannot spawn yet at wave 1", async () => {
      mountHelpDialog();
      clickTab(2);
      await nextTick();
      const dimmed = statRows().filter((row) => row.classList.contains("row-dim"));
      expect(statRows()[0].classList.contains("row-dim")).toBe(false);
      expect(dimmed.length).toBeGreaterThan(0);
      setSlider("#help-enemy-wave", 10);
      await nextTick();
      const dimmedAtEnd = statRows().filter((row) => row.classList.contains("row-dim"));
      expect(dimmedAtEnd.length).toBe(0);
    });

    it("maps slider positions to wave stops 1, 10, ..., 100", async () => {
      mountHelpDialog();
      clickTab(2);
      await nextTick();
      setSlider("#help-enemy-wave", 1);
      await nextTick();
      expect(document.querySelector(".help-slider-value").textContent.trim()).toBe("Wave 10");
      setSlider("#help-enemy-wave", 10);
      await nextTick();
      expect(document.querySelector(".help-slider-value").textContent.trim()).toBe("Wave 100");
    });

    it("grows enemy health with the wave stop", async () => {
      mountHelpDialog();
      clickTab(2);
      await nextTick();
      const minionHpAtStart = Number(cellText(statRows()[0], 2));
      setSlider("#help-enemy-wave", 10);
      await nextTick();
      const minionHpAtEnd = Number(cellText(statRows()[0], 2));
      const baseHp = getGameContent().enemies.types.minion.baseHp;
      expect(minionHpAtStart).toBe(Math.round(baseHp));
      expect(minionHpAtEnd).toBeGreaterThan(minionHpAtStart);
    });

    it("returns to How to Play and hides the stat tables", async () => {
      mountHelpDialog();
      clickTab(2);
      await nextTick();
      expect(document.querySelector(".stat-table")).not.toBeNull();
      clickTab(0);
      await nextTick();
      expect(document.querySelector(".stat-table")).toBeNull();
      expect(document.querySelector(".help-table")).not.toBeNull();
    });
  });
});
