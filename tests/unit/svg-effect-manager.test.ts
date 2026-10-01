// @ts-nocheck
import { beforeEach, describe, expect, it } from "vitest";
import { EffectManager } from "@/render/svg/EffectManager.js";
import { LIGHTNING_POOL_SIZE, STUN_POOL_SIZE } from "@/render/svg/types.js";

function makeLayer(): SVGGElement {
  return document.createElementNS("http://www.w3.org/2000/svg", "g") as unknown as SVGGElement;
}

function visibleCount(pool: SVGGElement[] | SVGPolylineElement[]): number {
  let count = 0;
  for (const el of pool) {
    if (el.style.visibility === "visible") count++;
  }
  return count;
}

describe("EffectManager", () => {
  let manager: EffectManager;
  let layer: SVGGElement;

  beforeEach(() => {
    manager = new EffectManager();
    layer = makeLayer();
    manager.init(layer);
  });

  describe("init()", () => {
    it("creates LIGHTNING_POOL_SIZE polyline elements in the layer", () => {
      const polylines = layer.querySelectorAll("polyline");
      expect(polylines.length).toBe(LIGHTNING_POOL_SIZE);
    });

    it("creates STUN_POOL_SIZE group elements in the layer", () => {
      const groups = Array.from(layer.querySelectorAll("g")).filter((g) => g.getAttribute("filter") === "url(#glow)");
      expect(groups.length).toBe(STUN_POOL_SIZE);
    });

    it("hides all pooled elements initially", () => {
      const polylines = layer.querySelectorAll("polyline");
      for (const poly of polylines) {
        expect((poly as SVGPolylineElement).style.visibility).toBe("hidden");
      }
      const groups = layer.querySelectorAll("g");
      for (const group of groups) {
        expect((group as SVGGElement).style.visibility).toBe("hidden");
      }
    });
  });

  describe("lightning effects", () => {
    it("renders a single lightning effect at the given coordinates", () => {
      manager.addLightningEffect(10, 20, 100, 200);
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);

      const polylines = Array.from(layer.querySelectorAll("polyline")) as SVGPolylineElement[];
      expect(polylines[0]!.style.visibility).toBe("visible");
      const points = polylines[0]!.getAttribute("points") ?? "";
      const pointParts = points.split(" ");
      const firstPoint = pointParts[0];
      expect(firstPoint).toBe("10.0,20.0");
      const lastPoint = pointParts[pointParts.length - 1];
      expect(lastPoint).toBe("100.0,200.0");
    });

    it("hides unused lightning pool slots when fewer effects are active", () => {
      manager.addLightningEffect(0, 0, 10, 10);
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);

      const polylines = Array.from(layer.querySelectorAll("polyline")) as SVGPolylineElement[];
      expect(polylines[0]!.style.visibility).toBe("visible");
      for (let i = 1; i < polylines.length; i++) {
        expect(polylines[i]!.style.visibility).toBe("hidden");
      }
    });

    it("assigns multiple active effects to sequential pool slots", () => {
      manager.addLightningEffect(0, 0, 10, 10);
      manager.addLightningEffect(50, 50, 60, 60);
      manager.addLightningEffect(100, 100, 110, 110);
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);

      const polylines = Array.from(layer.querySelectorAll("polyline")) as SVGPolylineElement[];
      expect(polylines[0]!.style.visibility).toBe("visible");
      expect(polylines[1]!.style.visibility).toBe("visible");
      expect(polylines[2]!.style.visibility).toBe("visible");
      expect(polylines[3]!.style.visibility).toBe("hidden");

      expect(polylines[0]!.getAttribute("points")?.split(" ")[0]).toBe("0.0,0.0");
      expect(polylines[1]!.getAttribute("points")?.split(" ")[0]).toBe("50.0,50.0");
      expect(polylines[2]!.getAttribute("points")?.split(" ")[0]).toBe("100.0,100.0");
    });

    it("hides effect after its life expires", () => {
      manager.addLightningEffect(0, 0, 10, 10);
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);
      const polylines = Array.from(layer.querySelectorAll("polyline")) as SVGPolylineElement[];
      expect(polylines[0]!.style.visibility).toBe("visible");

      for (let frame = 0; frame < 45; frame++) {
        manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);
      }

      expect(polylines[0]!.style.visibility).toBe("hidden");
    });

    it("regression: renders effects spawned after pool size is exceeded (original bug)", () => {
      for (let i = 0; i < LIGHTNING_POOL_SIZE + 5; i++) {
        manager.addLightningEffect(i * 10, 0, i * 10 + 5, 0);
      }
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);

      const polylines = Array.from(layer.querySelectorAll("polyline")) as SVGPolylineElement[];
      expect(visibleCount(polylines)).toBe(LIGHTNING_POOL_SIZE);
      const firstPoint = polylines[0]!.getAttribute("points")?.split(" ")[0];
      expect(firstPoint).toBe("0.0,0.0");
      const lastSlotPoint = polylines[LIGHTNING_POOL_SIZE - 1]!.getAttribute("points")?.split(" ")[0];
      expect(lastSlotPoint).toBe(`${(LIGHTNING_POOL_SIZE - 1) * 10}.0,0.0`);
    });

    it("clears expired effects and reuses slots for new effects", () => {
      manager.addLightningEffect(1, 0, 2, 0);
      for (let frame = 0; frame < 45; frame++) {
        manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);
      }
      const polylines = Array.from(layer.querySelectorAll("polyline")) as SVGPolylineElement[];
      expect(polylines[0]!.style.visibility).toBe("hidden");

      manager.addLightningEffect(99, 0, 100, 0);
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);
      expect(polylines[0]!.style.visibility).toBe("visible");
      expect(polylines[0]!.getAttribute("points")?.split(" ")[0]).toBe("99.0,0.0");
    });
  });

  describe("stun effects", () => {
    it("renders a single stun effect at the given coordinates", () => {
      manager.addStunEffect(40, 50, 0.3);
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);

      const groups = Array.from(layer.querySelectorAll("g")) as SVGGElement[];
      expect(groups[0]!.style.visibility).toBe("visible");
      const transform = groups[0]!.getAttribute("transform") ?? "";
      expect(transform).toContain("40.0");
      expect(transform).toContain("50.0");
    });

    it("initializes two polylines lazily inside the stun group", () => {
      manager.addStunEffect(10, 10, 0.3);
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);

      const groups = Array.from(layer.querySelectorAll("g")) as SVGGElement[];
      const polylines = groups[0]!.querySelectorAll("polyline");
      expect(polylines.length).toBe(2);
    });

    it("draws the stun ring at half stroke opacity and keeps the life fade", () => {
      manager.addStunEffect(10, 10, 0.3);
      manager.syncFromGameEngine(null, null, null, null, false, 0);

      const groups = Array.from(layer.querySelectorAll("g")) as SVGGElement[];
      const polylines = groups[0]!.querySelectorAll("polyline");
      expect(groups[0]!.getAttribute("opacity")).toBe("1.000");
      expect(polylines[0]!.getAttribute("opacity")).toBe("0.175");
      expect(polylines[1]!.getAttribute("opacity")).toBe("0.040");
    });

    it("hides unused stun pool slots", () => {
      manager.addStunEffect(10, 10, 0.3);
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);

      const groups = Array.from(layer.querySelectorAll("g")) as SVGGElement[];
      expect(groups[0]!.style.visibility).toBe("visible");
      for (let i = 1; i < groups.length; i++) {
        expect(groups[i]!.style.visibility).toBe("hidden");
      }
    });

    it("assigns multiple stun effects to sequential slots", () => {
      manager.addStunEffect(10, 10, 0.3);
      manager.addStunEffect(20, 20, 0.3);
      manager.addStunEffect(30, 30, 0.3);
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);

      const groups = Array.from(layer.querySelectorAll("g")) as SVGGElement[];
      expect(groups[0]!.style.visibility).toBe("visible");
      expect(groups[1]!.style.visibility).toBe("visible");
      expect(groups[2]!.style.visibility).toBe("visible");
      expect(groups[3]!.style.visibility).toBe("hidden");
      expect(groups[0]!.getAttribute("transform")).toContain("10.0");
      expect(groups[1]!.getAttribute("transform")).toContain("20.0");
      expect(groups[2]!.getAttribute("transform")).toContain("30.0");
    });

    it("hides stun effect after its life expires", () => {
      manager.addStunEffect(10, 10, 0.3);
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);
      const groups = Array.from(layer.querySelectorAll("g")) as SVGGElement[];
      expect(groups[0]!.style.visibility).toBe("visible");

      for (let frame = 0; frame < 20; frame++) {
        manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);
      }

      expect(groups[0]!.style.visibility).toBe("hidden");
    });

    it("regression: renders stun effects after pool size is exceeded (original bug)", () => {
      for (let i = 0; i < STUN_POOL_SIZE + 5; i++) {
        manager.addStunEffect(i, i, 0.3);
      }
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);

      const groups = Array.from(layer.querySelectorAll("g")) as SVGGElement[];
      expect(visibleCount(groups)).toBe(STUN_POOL_SIZE);
    });
  });

  describe("lightning and stun use independent counters", () => {
    it("spawning both types does not cause cross-type slot collisions", () => {
      manager.addLightningEffect(0, 0, 10, 10);
      manager.addStunEffect(20, 20, 0.3);
      manager.addLightningEffect(30, 30, 40, 40);
      manager.addStunEffect(50, 50, 0.3);
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);

      const polylines = Array.from(layer.querySelectorAll("polyline")) as SVGPolylineElement[];
      const groups = Array.from(layer.querySelectorAll("g")) as SVGGElement[];

      expect(visibleCount(polylines)).toBe(2);
      expect(visibleCount(groups)).toBe(2);
      expect(polylines[0]!.getAttribute("points")?.split(" ")[0]).toBe("0.0,0.0");
      expect(polylines[1]!.getAttribute("points")?.split(" ")[0]).toBe("30.0,30.0");
      expect(groups[0]!.getAttribute("transform")).toContain("20.0");
      expect(groups[1]!.getAttribute("transform")).toContain("50.0");
    });
  });

  describe("splash damage circle", () => {
    function splashCircle(): SVGCircleElement {
      const circles = Array.from(layer.querySelectorAll("circle")) as SVGCircleElement[];
      return circles.find((circle) => circle.getAttribute("stroke-dasharray") === "3,3")!;
    }

    function makeGrid(opts: { isPath: (x: number, y: number) => boolean; blocked?: Set<string> }): unknown {
      return { isPath: opts.isPath, inBounds: () => true, blocked: opts.blocked ?? new Set<string>() };
    }

    it("creates a hidden dotted splash circle on init", () => {
      const splash = splashCircle();
      expect(splash).toBeTruthy();
      expect(splash.style.visibility).toBe("hidden");
      expect(splash.getAttribute("stroke-dasharray")).toBe("3,3");
    });

    it("hides the splash circle when nothing is selected or building", () => {
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);
      expect(splashCircle().style.visibility).toBe("hidden");
    });

    it("draws the splash circle one tile above the preview in build mode (cannon)", () => {
      const buildTilePos = { tileX: 2, tileY: 3 };
      manager.syncFromGameEngine(buildTilePos, "cannon", null, null, true, 1 / 60);
      const splash = splashCircle();
      expect(splash.style.visibility).toBe("visible");
      // center of tile (2,3) is (90,126); splash sits one tile (36px) above -> y=90
      expect(splash.getAttribute("transform")).toBe("translate(90, 90)");
      // cannon base splash radius is 0.5 tiles -> r = 18
      expect(splash.getAttribute("r")).toBe("18");
    });

    it("hides the splash circle in build mode for a no-splash tower", () => {
      const buildTilePos = { tileX: 2, tileY: 3 };
      manager.syncFromGameEngine(buildTilePos, "basic", null, null, true, 1 / 60);
      expect(splashCircle().style.visibility).toBe("hidden");
    });

    it("anchors the splash circle on the nearest unoccupied path tile for a selected tower", () => {
      const grid = makeGrid({ isPath: (x, y) => x === 3 && y === 2 });
      const selectedTower = {
        id: "t1",
        x: 90,
        y: 90,
        type: "cannon",
        level: 1,
        tileX: 2,
        tileY: 2,
        stats: { splash: 0.5 },
      } as unknown as { x: number; y: number; type: string; level: number };
      manager.syncFromGameEngine(null, null, null, selectedTower, false, 1 / 60, grid as never);
      const splash = splashCircle();
      expect(splash.style.visibility).toBe("visible");
      // nearest path tile is (3,2) -> center (126,90); tower tile (2,2) is avoided
      expect(splash.getAttribute("transform")).toBe("translate(126, 90)");
      expect(splash.getAttribute("r")).toBe("18");
    });

    it("falls back to the tower center when no path tile is reachable", () => {
      const grid = makeGrid({ isPath: () => false });
      const selectedTower = {
        id: "t1",
        x: 90,
        y: 90,
        type: "cannon",
        level: 1,
        tileX: 2,
        tileY: 2,
        stats: { splash: 0.5 },
      } as unknown as { x: number; y: number; type: string; level: number };
      manager.syncFromGameEngine(null, null, null, selectedTower, false, 1 / 60, grid as never);
      const splash = splashCircle();
      expect(splash.style.visibility).toBe("visible");
      expect(splash.getAttribute("transform")).toBe("translate(90, 90)");
    });

    it("hides the splash circle for a selected no-splash tower", () => {
      const grid = makeGrid({ isPath: (x) => x >= 3 });
      const selectedTower = {
        id: "t1",
        x: 90,
        y: 90,
        type: "basic",
        level: 1,
        tileX: 2,
        tileY: 2,
        stats: { splash: 0 },
      } as unknown as { x: number; y: number; type: string; level: number };
      manager.syncFromGameEngine(null, null, null, selectedTower, false, 1 / 60, grid as never);
      expect(splashCircle().style.visibility).toBe("hidden");
    });

    it("does not crash when grid is null for a selected tower", () => {
      const selectedTower = {
        id: "t1",
        x: 90,
        y: 90,
        type: "cannon",
        level: 1,
        tileX: 2,
        tileY: 2,
        stats: { splash: 0.5 },
      } as unknown as { x: number; y: number; type: string; level: number };
      manager.syncFromGameEngine(null, null, null, selectedTower, false, 1 / 60, null);
      const splash = splashCircle();
      expect(splash.style.visibility).toBe("visible");
      expect(splash.getAttribute("transform")).toBe("translate(90, 90)");
    });
  });

  describe("dispose()", () => {
    it("removes all pooled elements from the layer", () => {
      expect(layer.children.length).toBeGreaterThan(0);
      manager.dispose();
      expect(layer.children.length).toBe(0);
    });

    it("clears active effects so subsequent sync renders nothing", () => {
      manager.addLightningEffect(0, 0, 10, 10);
      manager.addStunEffect(20, 20, 0.3);
      manager.dispose();
      manager.init(layer);
      manager.syncFromGameEngine(null, null, null, null, false, 1 / 60);

      const polylines = Array.from(layer.querySelectorAll("polyline")) as SVGPolylineElement[];
      const groups = Array.from(layer.querySelectorAll("g")) as SVGGElement[];
      expect(visibleCount(polylines)).toBe(0);
      expect(visibleCount(groups)).toBe(0);
    });
  });
});
