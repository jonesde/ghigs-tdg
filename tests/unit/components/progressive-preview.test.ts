import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import ProgressivePlacement from "@/components/ProgressivePlacement.vue";
import {
  progressiveCellRects,
  progressivePatternMarkup,
  progressivePreviewFill,
} from "@/components/progressivePreview.js";
import type { MapThemeData, RegionVisualMeta } from "@/render/themes/index.js";
import * as commandBus from "@/sim/commandBus.js";
import { GameState } from "@/sim/GameRunState.js";
import {
  type BlockTemplate,
  generateProgressiveCatalog,
  generateProgressiveMap,
  progressiveConfigForIndex,
} from "@/sim/grid/ProgressiveMap.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { mockDefaultTheme } from "../../helpers/mock-stores.js";

const knownPathFill = "#a01020";
const knownTerrainFills = ["#b03040", "#c05060", "#d07080", "#e090a0"];

function tileSvgWithFill(fill: string): string {
  return `<svg viewBox="0 0 36 36"><rect width="36" height="36" fill="${fill}"/></svg>`;
}

function mockRegionVisualWithKnownFills(regionId: number): RegionVisualMeta {
  return {
    id: regionId,
    name: "Known Region",
    tiles: {
      path: [tileSvgWithFill(knownPathFill), tileSvgWithFill("#551122")],
      terrain1: [tileSvgWithFill(knownTerrainFills[0]!)],
      terrain2: [tileSvgWithFill(knownTerrainFills[1]!)],
      terrain3: [tileSvgWithFill(knownTerrainFills[2]!)],
      terrain4: [tileSvgWithFill(knownTerrainFills[3]!)],
    },
    base: "",
    mapImage: "",
    mapLayout: { viewBox: "0 0 100 100", nodes: [], connections: [] },
  };
}

function mockThemeWithKnownFills(): MapThemeData {
  return { ...mockDefaultTheme, regions: [0, 1, 2].map((regionId) => mockRegionVisualWithKnownFills(regionId)) };
}

describe("progressivePreviewFill", () => {
  it("falls back to the neutral ramp without a region visual", () => {
    expect(progressivePreviewFill({ type: "path", height: 1 }, undefined)).toBe("#7d7259");
    expect(progressivePreviewFill({ type: "terrain", height: 1 }, null)).toBe("#5d6b5d");
    expect(progressivePreviewFill({ type: "terrain", height: 2 }, undefined)).toBe("#475347");
    expect(progressivePreviewFill({ type: "terrain", height: 3 }, undefined)).toBe("#333d33");
    expect(progressivePreviewFill({ type: "terrain", height: 4 }, undefined)).toBe("#222922");
    expect(progressivePreviewFill({ type: "terrain", height: 0 }, undefined)).toBe("#5d6b5d");
    expect(progressivePreviewFill({ type: "terrain", height: 5 }, undefined)).toBe("#222922");
  });

  it("returns the theme's field fills for the region's tiles", () => {
    const regionVisual = mockRegionVisualWithKnownFills(0);
    expect(progressivePreviewFill({ type: "path", height: 1 }, regionVisual)).toBe(knownPathFill);
    expect(progressivePreviewFill({ type: "terrain", height: 1 }, regionVisual)).toBe(knownTerrainFills[0]);
    expect(progressivePreviewFill({ type: "terrain", height: 2 }, regionVisual)).toBe(knownTerrainFills[1]);
    expect(progressivePreviewFill({ type: "terrain", height: 3 }, regionVisual)).toBe(knownTerrainFills[2]);
    expect(progressivePreviewFill({ type: "terrain", height: 4 }, regionVisual)).toBe(knownTerrainFills[3]);
    expect(progressivePreviewFill({ type: "terrain", height: 0 }, regionVisual)).toBe(knownTerrainFills[0]);
    expect(progressivePreviewFill({ type: "terrain", height: 5 }, regionVisual)).toBe(knownTerrainFills[3]);
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
    const themeStore = useMapThemeStore(pinia);
    themeStore.defaultTheme = mockThemeWithKnownFills();
    themeStore.activeTheme = mockThemeWithKnownFills();
    gameStore.map = generateProgressiveMap(config);
    gameStore.mapIndex = 36;
    gameStore.progressivePlacementHold = true;
    gameStore.progressiveRotation = 0;
    gameStore.progressiveOffer = [templateIndex];

    const wrapper = mount(ProgressivePlacement, { global: { plugins: [pinia] } });
    const fills = new Set(
      [...wrapper.find("svg").element.querySelectorAll("rect")].map((rect) => rect.getAttribute("fill")),
    );
    expect(fills.has(knownPathFill)).toBe(true);
    const terrainFills = [...fills].filter((fill) => fill !== knownPathFill);
    expect(terrainFills.length).toBeGreaterThanOrEqual(2);
    expect(wrapper.find("svg").element.querySelector('path[data-edge="path-contour"]')).not.toBeNull();
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

describe("progressive path contour", () => {
  function columnPathCatalog(): BlockTemplate[] {
    const tiles: BlockTemplate["tiles"] = [];
    for (let localY = 0; localY < 5; localY++) {
      const row: BlockTemplate["tiles"][number] = [];
      for (let localX = 0; localX < 5; localX++) {
        row.push(localX === 2 ? { type: "path", height: 1 } : { type: "terrain", height: localX === 0 ? 1 : 4 });
      }
      tiles.push(row);
    }
    return [
      {
        pattern: "straight",
        open: true,
        mouths: ["N", "S"],
        tiles,
        heightPattern: "slope",
        flatHeight: 1,
        peakCorner: 0,
      },
    ];
  }

  function terrainOnlyCatalog(): BlockTemplate[] {
    const tiles: BlockTemplate["tiles"] = [];
    for (let localY = 0; localY < 5; localY++) {
      const row: BlockTemplate["tiles"][number] = [];
      for (let localX = 0; localX < 5; localX++) {
        row.push({ type: "terrain", height: (localX + localY) % 2 === 0 ? 1 : 4 });
      }
      tiles.push(row);
    }
    return [
      { pattern: "terrain", open: false, mouths: [], tiles, heightPattern: "scatter", flatHeight: 1, peakCorner: 0 },
    ];
  }

  function contourSegments(markup: string): string[] {
    const match = markup.match(/<path data-edge="path-contour" d="([^"]*)"/);
    if (!match) return [];
    return match[1]!
      .split(/(?=M)/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
  }

  it("strokes each internal path edge once and skips the block perimeter", () => {
    const markup = progressiveCellRects(columnPathCatalog(), 0, 0, 0, 0, 1, null);
    const segments = contourSegments(markup);
    expect(segments).toHaveLength(10);
    for (let localY = 0; localY < 5; localY++) {
      expect(segments).toContain(`M2,${localY} L2,${localY + 1}`);
      expect(segments).toContain(`M3,${localY} L3,${localY + 1}`);
    }
    expect(segments).not.toContain("M2,0 L3,0");
    expect(segments).not.toContain("M2,5 L3,5");
    expect(markup).toContain('stroke="rgba(0,0,0,0.7)"');
    expect(markup).toContain('stroke-width="0.1"');
  });

  it("draws no contour between terrain heights", () => {
    const markup = progressiveCellRects(terrainOnlyCatalog(), 0, 0, 0, 0, 1, null);
    expect(markup).not.toContain("path-contour");
  });

  it("follows a rotated path and places the ghost contour in world coordinates", () => {
    const rotated = contourSegments(progressiveCellRects(columnPathCatalog(), 0, 1, 0, 0, 1, null));
    expect(rotated).toHaveLength(10);
    for (let localX = 0; localX < 5; localX++) {
      expect(rotated).toContain(`M${localX},2 L${localX + 1},2`);
      expect(rotated).toContain(`M${localX},3 L${localX + 1},3`);
    }

    const ghost = progressivePatternMarkup(columnPathCatalog(), 0, 0, 72, 108, 36, true, null);
    const ghostSegments = contourSegments(ghost);
    expect(ghostSegments).toContain("M144,108 L144,144");
    expect(ghost).toContain('stroke-width="3.6"');
    expect(ghost).toContain('opacity="0.75"');
    expect(ghost).toContain('stroke="var(--color-accent)"');
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
    const regionVisual = mockRegionVisualWithKnownFills(0);
    const selected = progressivePatternMarkup(catalog, templateIndex, 1, 72, 108, 36, true, regionVisual);
    expect(selected).toContain('x="72"');
    expect(selected).toContain('y="108"');
    expect(selected).toContain('width="36"');
    expect(selected).toContain(`fill="${knownPathFill}"`);
    expect(selected).toContain('opacity="0.75"');
    expect(selected).toContain('stroke="var(--color-accent)"');
    expect(selected).not.toContain("rgba(95,208,255,0.22)");
    const fills = new Set([...selected.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((match) => match[1]));
    expect(fills.has(knownPathFill)).toBe(true);
    expect([...fills].filter((fill) => fill !== knownPathFill).length).toBeGreaterThanOrEqual(2);
    const plain = progressivePatternMarkup(catalog, templateIndex, 1, 0, 0, 36, false, regionVisual);
    expect(plain).toContain('opacity="0.45"');
    expect(plain).not.toContain('stroke="var(--color-accent)"');
  });
});
