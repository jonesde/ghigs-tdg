import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import ProgressivePlacement from "@/components/ProgressivePlacement.vue";
import { progressivePatternMarkup, progressivePreviewFill } from "@/components/progressivePreview.js";
import { generateProgressiveCatalog, progressiveConfigForIndex } from "@/sim/grid/ProgressiveMap.js";
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
    expect(selected).toContain('stroke="#5fd0ff"');
    expect(selected).not.toContain("rgba(95,208,255,0.22)");
    const fills = new Set([...selected.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((match) => match[1]));
    expect(fills.has("#d7b072")).toBe(true);
    expect([...fills].filter((fill) => fill !== "#d7b072").length).toBeGreaterThanOrEqual(2);
    const plain = progressivePatternMarkup(catalog, templateIndex, 1, 0, 0, 36, false);
    expect(plain).toContain('opacity="0.45"');
    expect(plain).not.toContain('stroke="#5fd0ff"');
  });
});
