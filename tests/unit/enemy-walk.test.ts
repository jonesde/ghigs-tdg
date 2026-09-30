import { describe, expect, it } from "vitest";
import { buildBaseVertices, vertsToPathD } from "@/render/svg/EnemyWalk.js";

describe("EnemyWalk", () => {
  it("caches vertices per (shape, radius)", () => {
    const first = buildBaseVertices("circle", 10);
    const second = buildBaseVertices("circle", 10);
    expect(second).toBe(first);
    expect(buildBaseVertices("circle", 12)).not.toBe(first);
  });

  it("returns frozen cached vertex lists", () => {
    const verts = buildBaseVertices("square", 8);
    expect(Object.isFrozen(verts)).toBe(true);
    expect(Object.isFrozen(verts[0])).toBe(true);
  });

  it("traces a proper 12-vertex cross outline with axis-aligned edges", () => {
    const verts = buildBaseVertices("cross", 10);
    expect(verts).toHaveLength(12);
    for (let index = 0; index < verts.length; index++) {
      const current = verts[index]!;
      const next = verts[(index + 1) % verts.length]!;
      const sameX = current[0] === next[0];
      const sameY = current[1] === next[1];
      // A bow-tie/hourglass outline connects diagonal corners; the real outline
      // only ever moves along one axis per edge.
      expect(sameX || sameY).toBe(true);
    }
  });

  it("vertsToPathD builds a closed path", () => {
    expect(vertsToPathD(buildBaseVertices("triangle", 5))).toMatch(/^M.* Z$/);
    expect(vertsToPathD([])).toBe("");
  });
});
