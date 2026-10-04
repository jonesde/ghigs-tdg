import { describe, expect, it } from "vitest";
import { SpawnManager } from "@/render/svg/SpawnManager.js";
import type { SpawnState } from "@/render/themes/index.js";

function createSpawnLayer(): { svg: SVGSVGElement; layer: SVGGElement } {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  layer.setAttribute("class", "spawn-layer");
  svg.appendChild(layer);
  document.body.appendChild(svg);
  return { svg, layer };
}

describe("SpawnManager", () => {
  it("creates one use marker per spawn point at its tile position", () => {
    const { svg, layer } = createSpawnLayer();
    const manager = new SpawnManager();
    manager.init(
      layer,
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      36,
      0,
    );

    expect(manager.getElements()).toHaveLength(3);
    expect(layer.children).toHaveLength(3);
    const positions = Array.from(layer.children).map((child) => ({
      x: child.getAttribute("x"),
      y: child.getAttribute("y"),
    }));
    expect(positions).toEqual([
      { x: "36", y: "0" },
      { x: "72", y: "0" },
      { x: "36", y: "36" },
    ]);
    for (const child of Array.from(layer.children)) {
      expect(child.getAttribute("class")).toBe("spawn-marker");
      expect(child.getAttribute("href")).toBe("#spawn-closed");
      expect(child.getAttribute("width")).toBe("36");
      expect(child.getAttribute("height")).toBe("36");
    }

    manager.dispose();
    svg.remove();
  });

  it("updates href when visualState changes", () => {
    const { svg, layer } = createSpawnLayer();
    const manager = new SpawnManager();
    manager.init(
      layer,
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      0,
      0,
    );

    const states: SpawnState[] = [
      { visualState: "open", closeTransitionTimer: 0 },
      { visualState: "closed", closeTransitionTimer: 0 },
    ];
    manager.sync(states);

    expect(layer.children[0]!.getAttribute("href")).toBe("#spawn-open");
    expect(layer.children[0]!.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#spawn-open");
    expect(layer.children[1]!.getAttribute("href")).toBe("#spawn-closed");
    expect(layer.children[1]!.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#spawn-closed");

    manager.dispose();
    svg.remove();
  });

  it("keeps markers attached across re-init with a different spawn count", () => {
    const { svg, layer } = createSpawnLayer();
    const manager = new SpawnManager();
    manager.init(
      layer,
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      0,
      0,
    );
    expect(layer.children).toHaveLength(3);

    manager.init(layer, [{ x: 5, y: 5 }], 0, 0);
    expect(layer.children).toHaveLength(1);
    expect(layer.children[0]!.getAttribute("x")).toBe("180");
    expect(layer.children[0]!.getAttribute("y")).toBe("180");

    manager.dispose();
    svg.remove();
  });

  it("skips DOM write when state has not changed", () => {
    const { svg, layer } = createSpawnLayer();
    const manager = new SpawnManager();
    manager.init(layer, [{ x: 0, y: 0 }], 0, 0);

    const states: SpawnState[] = [{ visualState: "closed", closeTransitionTimer: 0 }];
    manager.sync(states);
    manager.sync(states);

    expect(layer.children[0]!.getAttribute("href")).toBe("#spawn-closed");

    manager.dispose();
    svg.remove();
  });

  it("handles all three visual states", () => {
    const { svg, layer } = createSpawnLayer();
    const manager = new SpawnManager();
    manager.init(
      layer,
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      0,
      0,
    );

    const states: SpawnState[] = [
      { visualState: "closed", closeTransitionTimer: 0 },
      { visualState: "transition", closeTransitionTimer: 0.5 },
      { visualState: "open", closeTransitionTimer: 0 },
    ];
    manager.sync(states);

    expect(layer.children[0]!.getAttribute("href")).toBe("#spawn-closed");
    expect(layer.children[0]!.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#spawn-closed");
    expect(layer.children[1]!.getAttribute("href")).toBe("#spawn-transition");
    expect(layer.children[1]!.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#spawn-transition");
    expect(layer.children[2]!.getAttribute("href")).toBe("#spawn-open");
    expect(layer.children[2]!.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#spawn-open");

    manager.dispose();
    svg.remove();
  });

  it("removes markers from the layer on dispose", () => {
    const { svg, layer } = createSpawnLayer();
    const manager = new SpawnManager();
    manager.init(
      layer,
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      0,
      0,
    );
    manager.dispose();
    expect(manager.getElements()).toHaveLength(0);
    expect(layer.children).toHaveLength(0);
    manager.dispose();

    svg.remove();
  });
});
