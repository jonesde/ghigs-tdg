// @ts-nocheck
/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParticleManager } from "@/render/svg/ParticleManager.js";
import { PARTICLE_POOL_SIZE } from "@/render/svg/types.js";
import { ParticleSystem } from "@/sim/ParticleSystem.js";

function createMockSVGElement(tagName: string) {
  const attrs: Record<string, string> = {};
  const style: Record<string, string> = {};
  const el: {
    tagName: string;
    attributes: Record<string, string>;
    style: Record<string, string>;
    children: (typeof el)[];
    parentNode: typeof el | null;
    appendChild(child: typeof el): void;
    removeChild(child: typeof el): void;
    setAttribute(key: string, value: string): void;
    getAttribute(key: string): string | null;
  } = {
    tagName,
    attributes: attrs,
    style,
    children: [],
    parentNode: null,
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentNode = null;
      }
    },
    setAttribute(key, value) {
      attrs[key] = value;
    },
    getAttribute(key) {
      return attrs[key] ?? null;
    },
  };
  return el;
}

let documentCreateElementNS: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  documentCreateElementNS = vi.fn((_ns: string, tag: string) => {
    return createMockSVGElement(tag);
  });
  (globalThis as unknown as Record<string, unknown>).document = { createElementNS: documentCreateElementNS };
});

describe("ParticleManager", () => {
  let pm: ParticleManager;
  let circles: ReturnType<typeof createMockSVGElement>[];
  let mockLayer: {
    children: ReturnType<typeof createMockSVGElement>[];
    appendChild: (c: ReturnType<typeof createMockSVGElement>) => void;
    removeChild: (c: ReturnType<typeof createMockSVGElement>) => void;
  };

  beforeEach(() => {
    pm = new ParticleManager();
    circles = [];
    mockLayer = {
      children: [],
      appendChild(child: ReturnType<typeof createMockSVGElement>) {
        mockLayer.children.push(child);
        circles.push(child);
        child.parentNode = mockLayer as unknown as typeof child.parentNode;
      },
      removeChild(child: ReturnType<typeof createMockSVGElement>) {
        const idx = mockLayer.children.indexOf(child);
        if (idx !== -1) {
          mockLayer.children.splice(idx, 1);
          child.parentNode = null;
        }
      },
    };
  });

  describe("init()", () => {
    it("creates PARTICLE_POOL_SIZE circle elements in the layer", () => {
      pm.init(mockLayer as unknown as SVGGElement);
      expect(circles.length).toBe(PARTICLE_POOL_SIZE);
    });

    it("sets r=3 on each circle element", () => {
      pm.init(mockLayer as unknown as SVGGElement);
      for (const circle of circles) {
        expect(circle.getAttribute("r")).toBe("3");
      }
    });

    it("sets fill=#ffffff on each circle element", () => {
      pm.init(mockLayer as unknown as SVGGElement);
      for (const circle of circles) {
        expect(circle.getAttribute("fill")).toBe("#ffffff");
      }
    });

    it("sets visibility:hidden on each circle element", () => {
      pm.init(mockLayer as unknown as SVGGElement);
      for (const circle of circles) {
        expect(circle.style.visibility).toBe("hidden");
      }
    });
  });

  describe("syncFromGameEngine()", () => {
    beforeEach(() => {
      pm.init(mockLayer as unknown as SVGGElement);
    });

    it("shows circle elements for particles", () => {
      pm.syncFromGameEngine([
        { x: 10, y: 20, color: "#ff0000", size: 5, opacity: 1 },
      ] as unknown as import("@/render/svg/types").Particle[]);
      expect(circles[0].style.visibility).toBe("visible");
      expect(circles[0].getAttribute("transform")).toBe("translate(10, 20)");
      expect(circles[0].getAttribute("r")).toBe("5");
      expect(circles[0].getAttribute("fill")).toBe("#ff0000");
    });

    it("hides unused pool elements after sync", () => {
      pm.syncFromGameEngine([
        { x: 0, y: 0, color: "#fff", size: 3, opacity: 1 },
      ] as unknown as import("@/render/svg/types").Particle[]);
      expect(circles[0].style.visibility).toBe("visible");
      expect(circles[1].style.visibility).toBe("hidden");
    });

    it("does not exceed pool bounds", () => {
      const particles = Array.from({ length: PARTICLE_POOL_SIZE + 10 }, (_, i) => ({
        id: i + 1,
        x: i,
        y: i,
        color: "#fff",
        size: 3,
        opacity: 1,
      }));
      pm.syncFromGameEngine(particles as unknown as import("@/render/svg/types").Particle[]);
      for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
        expect(circles[i].style.visibility).toBe("visible");
      }
    });

    it("does not re-create elements on subsequent sync calls", () => {
      const appendCountBefore = mockLayer.children.length;
      pm.syncFromGameEngine([
        { x: 10, y: 20, color: "#fff", size: 3, opacity: 1 },
      ] as unknown as import("@/render/svg/types").Particle[]);
      pm.syncFromGameEngine([
        { x: 30, y: 40, color: "#f00", size: 5, opacity: 0.5 },
      ] as unknown as import("@/render/svg/types").Particle[]);
      expect(mockLayer.children.length).toBe(appendCountBefore);
    });
  });

  describe("dispose()", () => {
    beforeEach(() => {
      pm.init(mockLayer as unknown as SVGGElement);
    });

    it("removes all elements from the layer", () => {
      pm.dispose();
      expect(mockLayer.children.length).toBe(0);
    });

    it("clears the internal pool", () => {
      pm.dispose();
      pm.syncFromGameEngine([
        { x: 0, y: 0, color: "#fff", size: 3, opacity: 1 },
      ] as unknown as import("@/render/svg/types").Particle[]);
      expect(mockLayer.children.length).toBe(0);
    });
  });
});

describe("sim ParticleSystem", () => {
  it("scales render opacity by the spawn opacity factor", () => {
    const system = new ParticleSystem(() => 0.5);
    system.spawn(10, 20, "#ffffff", 4, { speed: 30, life: 0.2, opacity: 0.5 });
    const rendered = system.getRenderData();
    expect(rendered).toHaveLength(4);
    for (const particle of rendered) {
      expect(particle.opacity).toBeCloseTo(0.5);
    }
  });

  it("keeps the full life-ratio fade when no opacity factor is given", () => {
    const system = new ParticleSystem(() => 0.5);
    system.spawn(10, 20, "#ffffff", 4, { speed: 30, life: 0.2 });
    expect(system.getRenderData().every((particle) => particle.opacity > 0.99)).toBe(true);
    system.update(0.1);
    expect(system.getRenderData().every((particle) => Math.abs(particle.opacity - 0.5) < 0.01)).toBe(true);
  });
});
