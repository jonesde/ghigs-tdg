// @ts-nocheck
import { beforeEach, describe, expect, it, type vi } from "vitest";
import { TextEnemyManager } from "@/render/text/TextEnemyManager.js";
import { TextOverlayRenderer } from "@/render/text/TextOverlayRenderer.js";
import { TextPathRenderer } from "@/render/text/TextPathRenderer.js";
import { TextTowerManager } from "@/render/text/TextTowerManager.js";
import type { TextRenderScale, TextThemeAccess } from "@/render/text/types.js";
import { createTestMapThemeStore } from "../helpers/mock-stores";
import { mockCtx } from "../setup";

function makeCtx(): CanvasRenderingContext2D {
  // Reset the shared mock's call history between tests.
  (mockCtx.fillText as ReturnType<typeof vi.fn>).mockClear();
  (mockCtx.fillStyle as unknown) = "";
  return mockCtx as unknown as CanvasRenderingContext2D;
}

const scale: TextRenderScale = { scaleX: 1, scaleY: 1 };

describe("TextTowerManager", () => {
  it("draws the tower theme icon at its tile-center pixel", () => {
    const ctx = makeCtx();
    const themeAccess: TextThemeAccess = {
      getTowerVisual: (type: string) => (type === "basic" ? { icon: "─", color: "#8fbc8f" } : undefined),
      getEnemyVisual: () => undefined,
      getEnemyGlyph: (shape: string) => shape,
    };
    const manager = new TextTowerManager();
    manager.render(ctx, [{ id: "t1", type: "basic", tileX: 2, tileY: 1 } as never], themeAccess, scale);
    expect(mockCtx.fillText).toHaveBeenCalledWith("─", 90, 54);
    expect(mockCtx.fillStyle).toBe("#8fbc8f");
  });
});

describe("TextEnemyManager", () => {
  it("draws the resolved glyph at the enemy's scaled continuous position", () => {
    const ctx = makeCtx();
    const themeAccess: TextThemeAccess = {
      getTowerVisual: () => undefined,
      getEnemyVisual: () => ({ shape: "circle", color: "#e85a6a" }),
      getEnemyGlyph: (shape: string) => (shape === "circle" ? "●" : shape),
    };
    const manager = new TextEnemyManager();
    manager.render(ctx, [{ id: 1, type: "minion", x: 50, y: 60, isBoss: false } as never], themeAccess, scale);
    expect(mockCtx.fillText).toHaveBeenCalledWith("●", 50, 60);
    expect(mockCtx.fillStyle).toBe("#e85a6a");
  });

  it("uses the theme shape glyph for bosses (no isBoss branching)", () => {
    const ctx = makeCtx();
    const themeAccess: TextThemeAccess = {
      getTowerVisual: () => undefined,
      getEnemyVisual: () => ({ shape: "star", color: "#c98aff" }),
      getEnemyGlyph: (shape: string) => (shape === "star" ? "★" : shape),
    };
    const manager = new TextEnemyManager();
    manager.render(ctx, [{ id: 2, type: "boss", x: 10, y: 20, isBoss: true } as never], themeAccess, scale);
    expect(mockCtx.fillText).toHaveBeenCalledWith("★", 10, 20);
  });
});

describe("getEnemyGlyph (theme store)", () => {
  let themeStore: ReturnType<typeof createTestMapThemeStore>;

  beforeEach(() => {
    themeStore = createTestMapThemeStore();
  });

  it("returns Aftermath-style raw glyphs verbatim", () => {
    expect(themeStore.getEnemyGlyph("●")).toBe("●");
    expect(themeStore.getEnemyGlyph("◆")).toBe("◆");
    expect(themeStore.getEnemyGlyph("■")).toBe("■");
    expect(themeStore.getEnemyGlyph("◇")).toBe("◇");
    expect(themeStore.getEnemyGlyph("▲")).toBe("▲");
    expect(themeStore.getEnemyGlyph("★")).toBe("★");
  });

  it("maps default-theme semantic names to glyphs", () => {
    expect(themeStore.getEnemyGlyph("circle")).toBe("●");
    expect(themeStore.getEnemyGlyph("triangle")).toBe("▲");
    expect(themeStore.getEnemyGlyph("square")).toBe("■");
    expect(themeStore.getEnemyGlyph("hexagon")).toBe("⬢");
    expect(themeStore.getEnemyGlyph("cross")).toBe("✚");
    expect(themeStore.getEnemyGlyph("star")).toBe("★");
  });

  it("falls back to a dot for unknown shapes", () => {
    expect(themeStore.getEnemyGlyph("blob")).toBe("●");
  });
});

describe("TextOverlayRenderer", () => {
  it("draws projectile dots, hp bars, lightning lines, and stun marks", () => {
    const ctx = makeCtx();
    (mockCtx.arc as ReturnType<typeof vi.fn>).mockClear();
    (mockCtx.moveTo as ReturnType<typeof vi.fn>).mockClear();
    (mockCtx.lineTo as ReturnType<typeof vi.fn>).mockClear();
    const manager = new TextOverlayRenderer();
    const snapshot = {
      enemies: [
        { id: 1, x: 40, y: 50, hp: 5, maxHp: 10, radius: 8 } as never,
        { id: 2, x: 70, y: 80, hp: 20, maxHp: 20, radius: 8 } as never,
      ],
      projectiles: [{ id: 1, x: 30, y: 30, radius: 2, color: "#ff0" } as never],
      lightningEffects: [{ x1: 10, y1: 10, x2: 20, y2: 20 }],
      stunEffects: [{ x: 5, y: 5 }],
    } as never;
    manager.render(ctx, snapshot, scale);
    expect(mockCtx.arc).toHaveBeenCalled();
    expect(mockCtx.lineTo).toHaveBeenCalled();
    expect(mockCtx.fillText).toHaveBeenCalledWith("*", 5, 5);
  });

  it("strokes Rapier debug segments when showPhysicsDebug is true", () => {
    const ctx = makeCtx();
    (mockCtx.moveTo as ReturnType<typeof vi.fn>).mockClear();
    (mockCtx.lineTo as ReturnType<typeof vi.fn>).mockClear();
    const manager = new TextOverlayRenderer();
    const snapshot = {
      enemies: [],
      projectiles: [],
      lightningEffects: [],
      stunEffects: [],
      debugPhysics: { vertices: [0, 0, 10, 20, 4, 4, 8, 8] },
    } as never;
    manager.render(ctx, snapshot, scale, true);
    expect(mockCtx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(mockCtx.lineTo).toHaveBeenCalledWith(10, 20);
    expect(mockCtx.moveTo).toHaveBeenCalledWith(4, 4);
    expect(mockCtx.lineTo).toHaveBeenCalledWith(8, 8);
    (mockCtx.moveTo as ReturnType<typeof vi.fn>).mockClear();
    manager.render(ctx, snapshot, scale, false);
    expect(mockCtx.moveTo).not.toHaveBeenCalled();
  });

  it("draws HP bars for damaged towers but skips full-health towers", () => {
    const ctx = makeCtx();
    (mockCtx.moveTo as ReturnType<typeof vi.fn>).mockClear();
    (mockCtx.lineTo as ReturnType<typeof vi.fn>).mockClear();
    const manager = new TextOverlayRenderer();
    const snapshot = {
      enemies: [],
      projectiles: [],
      lightningEffects: [],
      stunEffects: [],
      towers: [
        { id: "t1", x: 40, y: 50, health: 5, maxHealth: 10 } as never,
        { id: "t2", x: 70, y: 80, health: 20, maxHealth: 20 } as never,
      ],
    } as never;
    manager.render(ctx, snapshot, scale);
    // Two lines per bar (background + foreground) for the single damaged tower.
    expect(mockCtx.lineTo).toHaveBeenCalledTimes(2);
  });
});

describe("TextPathRenderer", () => {
  it("draws the cached navmesh corridor as triangles through the scaled vertices", () => {
    const ctx = makeCtx();
    (mockCtx.moveTo as ReturnType<typeof vi.fn>).mockClear();
    (mockCtx.lineTo as ReturnType<typeof vi.fn>).mockClear();
    const manager = new TextPathRenderer();
    const snapshot = { navMeshCorridor: { positions: [0, 0, 10, 0, 0, 10], indices: [0, 1, 2] } } as never;
    manager.render(ctx, snapshot, scale);
    // Triangle vertices (0,0) -> (10,0) -> (0,10) under scale 1.
    expect(mockCtx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(mockCtx.lineTo).toHaveBeenCalledWith(10, 0);
    expect(mockCtx.lineTo).toHaveBeenCalledWith(0, 10);
  });

  it("keeps drawing the cached corridor when snapshot.navMeshCorridor is undefined", () => {
    const ctx = makeCtx();
    (mockCtx.moveTo as ReturnType<typeof vi.fn>).mockClear();
    (mockCtx.lineTo as ReturnType<typeof vi.fn>).mockClear();
    const manager = new TextPathRenderer();
    manager.render(ctx, { navMeshCorridor: { positions: [0, 0, 10, 0, 0, 10], indices: [0, 1, 2] } } as never, scale);
    (mockCtx.moveTo as ReturnType<typeof vi.fn>).mockClear();
    manager.render(ctx, { navMeshCorridor: undefined } as never, scale);
    expect(mockCtx.moveTo).toHaveBeenCalledWith(0, 0);
  });
});
