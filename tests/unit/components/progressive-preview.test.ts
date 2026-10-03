import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import ProgressivePlacement from "@/components/ProgressivePlacement.vue";
import { progressivePatternMarkup, progressivePreviewFill } from "@/components/progressivePreview.js";
import { GameState } from "@/sim/Constants.js";
import * as commandBus from "@/sim/commandBus.js";
import {
  generateProgressiveCatalog,
  generateProgressiveMap,
  progressiveConfigForIndex,
} from "@/sim/grid/ProgressiveMap.js";
import { useGameStore } from "@/stores/game.js";

describe("progressivePreviewFill", () => {
  it("keeps path on its own color and shades terrain from height 1 to 4", () => {
    expect(progressivePreviewFill({ type: "path", height: 1 })).toBe("#d7b072");
    expect(progressivePreviewFill({ type: "terrain", height: 1 })).toBe("#6e8f7a");
    expect(progressivePreviewFill({ type: "terrain", height: 2 })).toBe("#4d6658");
    expect(progressivePreviewFill({ type: "terrain", height: 3 })).toBe("#2c3a32");
    expect(progressivePreviewFill({ type: "terrain", height: 4 })).toBe("#1b2620");
    expect(progressivePreviewFill({ type: "terrain", height: 0 })).toBe("#6e8f7a");
    expect(progressivePreviewFill({ type: "terrain", height: 5 })).toBe("#1b2620");
  });
});

describe("ProgressivePlacement offer cards", () => {
  it("draws a varied height profile with the path color and more than one terrain step", () => {
    const config = progressiveConfigForIndex(36);
    if (!config) throw new Error("progressive config 36 missing");
    const catalog = generateProgressiveCatalog(config.seed);
    const templateIndex = catalog.findIndex((template) => {
      const terrainHeights = new Set<number>();
      for (const row of template.tiles) {
        for (const tile of row) {
          if (tile.type === "terrain") terrainHeights.add(tile.height);
        }
      }
      return terrainHeights.size > 1;
    });
    expect(templateIndex).toBeGreaterThanOrEqual(0);

    const pinia = createPinia();
    setActivePinia(pinia);
    const gameStore = useGameStore();
    gameStore.map = generateProgressiveMap(config);
    gameStore.mapIndex = 36;
    gameStore.progressivePlacementHold = true;
    gameStore.progressiveRotation = 0;
    gameStore.progressiveOffer = [templateIndex];

    const wrapper = mount(ProgressivePlacement, { global: { plugins: [pinia] } });
    const fills = new Set(
      [...wrapper.find("svg").element.querySelectorAll("rect")].map((rect) => rect.getAttribute("fill")),
    );
    expect(fills.has("#d7b072")).toBe(true);
    const terrainFills = [...fills].filter((fill) => fill !== "#d7b072");
    expect(terrainFills.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps Enter from rotating a focused card or re-rolling", async () => {
    const config = progressiveConfigForIndex(36);
    if (!config) throw new Error("progressive config 36 missing");
    const pinia = createPinia();
    setActivePinia(pinia);
    const gameStore = useGameStore();
    gameStore.map = generateProgressiveMap(config);
    gameStore.mapIndex = 36;
    gameStore.progressivePlacementHold = true;
    gameStore.progressiveRotation = 0;
    gameStore.progressiveSelectedOffer = 0;
    gameStore.progressiveOffer = [0, 1];
    gameStore.gold = 500;
    gameStore.currentWave = 3;
    const rotate = vi.spyOn(gameStore, "rotateProgressiveBlock");
    const dispatch = vi.spyOn(commandBus, "dispatchCommand");

    const wrapper = mount(ProgressivePlacement, { global: { plugins: [pinia] } });
    const card = wrapper.get(".progressive-card");
    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    card.element.dispatchEvent(mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(card.element);

    const cardEnter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    card.element.dispatchEvent(cardEnter);
    expect(cardEnter.defaultPrevented).toBe(true);
    expect(rotate).not.toHaveBeenCalled();
    expect(gameStore.progressiveRotation).toBe(0);

    await card.trigger("click");
    expect(rotate).toHaveBeenCalled();

    const reroll = wrapper.get(".progressive-reroll");
    const rerollEnter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    reroll.element.dispatchEvent(rerollEnter);
    expect(rerollEnter.defaultPrevented).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();

    await reroll.trigger("click");
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "action:rerollProgressiveOffer" }));
  });

  it("disables re-roll only when gold is below the printed wave cost", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const gameStore = useGameStore();
    gameStore.progressivePlacementHold = true;
    gameStore.currentWave = 3;
    gameStore.gold = 8;
    const wrapper = mount(ProgressivePlacement, { global: { plugins: [pinia] } });
    const button = wrapper.get(".progressive-reroll").element as HTMLButtonElement;
    expect(button.textContent).toContain("9");
    expect(button.disabled).toBe(true);
    gameStore.gold = 9;
    await wrapper.vm.$nextTick();
    expect(button.disabled).toBe(false);
    gameStore.gold = 10;
    await wrapper.vm.$nextTick();
    expect(button.disabled).toBe(false);
  });
});

describe("ProgressivePlacement undo", () => {
  function mountPanel() {
    const pinia = createPinia();
    setActivePinia(pinia);
    const gameStore = useGameStore();
    const dispatch = vi.spyOn(commandBus, "dispatchCommand");
    dispatch.mockClear();
    const wrapper = mount(ProgressivePlacement, { global: { plugins: [pinia] } });
    return { gameStore, dispatch, wrapper };
  }

  it("shows the undo button only in the paused window and dispatches undo", async () => {
    const { gameStore, dispatch, wrapper } = mountPanel();
    gameStore.state = GameState.PAUSED;
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".progressive-undo").exists()).toBe(false);

    gameStore.progressiveUndoAvailable = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".progressive-undo").exists()).toBe(true);
    expect(wrapper.find(".progressive-card").exists()).toBe(false);

    const undo = wrapper.get(".progressive-undo");
    const undoEnter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    undo.element.dispatchEvent(undoEnter);
    expect(undoEnter.defaultPrevented).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();

    await undo.trigger("click");
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "action:undoProgressivePlacement" }));

    gameStore.progressiveUndoAvailable = false;
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".progressive-undo").exists()).toBe(false);
  });

  it("hides the undo button while the run is playing", async () => {
    const { gameStore, wrapper } = mountPanel();
    gameStore.state = GameState.PLAYING;
    gameStore.progressiveUndoAvailable = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".progressive-undo").exists()).toBe(false);
  });

  it("keeps the offer cards on screen while a hold is open, even with a stale undo flag", async () => {
    const { gameStore, wrapper } = mountPanel();
    gameStore.state = GameState.PAUSED;
    gameStore.progressivePlacementHold = true;
    gameStore.progressiveOffer = [0, 1];
    gameStore.progressiveUndoAvailable = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".progressive-card").exists()).toBe(true);
    expect(wrapper.find(".progressive-undo").exists()).toBe(false);
  });
});

describe("progressivePatternMarkup", () => {
  it("draws the pattern at world cell size and strokes only the cursor site", () => {
    const config = progressiveConfigForIndex(36);
    if (!config) throw new Error("progressive config 36 missing");
    const catalog = generateProgressiveCatalog(config.seed);
    const templateIndex = catalog.findIndex((template) => {
      const terrainHeights = new Set<number>();
      for (const row of template.tiles) {
        for (const tile of row) {
          if (tile.type === "terrain") terrainHeights.add(tile.height);
        }
      }
      return terrainHeights.size > 1 && template.pattern !== "terrain";
    });
    expect(templateIndex).toBeGreaterThanOrEqual(0);
    const selected = progressivePatternMarkup(catalog, templateIndex, 1, 72, 108, 36, true);
    expect(selected).toContain('x="72"');
    expect(selected).toContain('y="108"');
    expect(selected).toContain('width="36"');
    expect(selected).toContain('fill="#d7b072"');
    expect(selected).toContain('opacity="0.75"');
    expect(selected).toContain('stroke="var(--color-accent)"');
    expect(selected).not.toContain("rgba(95,208,255,0.22)");
    const fills = new Set([...selected.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((match) => match[1]));
    expect(fills.has("#d7b072")).toBe(true);
    expect([...fills].filter((fill) => fill !== "#d7b072").length).toBeGreaterThanOrEqual(2);
    const plain = progressivePatternMarkup(catalog, templateIndex, 1, 0, 0, 36, false);
    expect(plain).toContain('opacity="0.45"');
    expect(plain).not.toContain('stroke="var(--color-accent)"');
  });
});
