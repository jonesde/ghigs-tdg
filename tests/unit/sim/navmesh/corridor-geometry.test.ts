import { describe, expect, it } from "vitest";
import { Grid } from "@/sim/grid/Grid.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { makeBastionMap } from "../../../helpers/mock-grid.js";

// Flag-independent: getCorridorGeometry reads straight off the built navmesh, so
// it exercises the navmesh corridor shipping shape.
describe("NavMeshBuilder.getCorridorGeometry", () => {
  it("returns a walkable triangle mesh in game coordinates within map bounds", () => {
    const grid = new Grid(makeBastionMap());
    const builder = new NavMeshBuilder(grid);
    expect(builder.isSuccess()).toBe(true);

    const corridor = builder.getCorridorGeometry();
    expect(corridor).not.toBeNull();
    if (!corridor) throw new Error("expected corridor geometry");

    const { positions, indices } = corridor;
    // Flat (x, y) pairs: even length, and non-empty (walkable tiles produce tris).
    expect(positions.length % 2).toBe(0);
    expect(positions.length).toBeGreaterThan(0);
    // Triangle index list: a whole number of triangles.
    expect(indices.length % 3).toBe(0);
    expect(indices.length).toBeGreaterThan(0);

    const maxX = grid.width * grid.tileSize;
    const maxY = grid.height * grid.tileSize;
    for (let i = 0; i < positions.length; i += 2) {
      const x = positions[i]!;
      const y = positions[i + 1]!;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(maxX);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(maxY);
    }
  });
});
