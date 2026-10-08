import { getGameContent } from "@/content/gameContent.js";
import { type FlightGrid, flightDistanceGrid, type LiveTowerAt } from "@/sim/enemies/flightGrid.js";

// One 4-connected distance-to-base grid per flyingHeight above 0. The live-tower
// set is part of the graph, so a pathVersion bump (build, sell, ghost, restore)
// rebuilds every field and a quiet tick does not.
export class FlightDistanceField {
  private grid: FlightGrid;
  private pathVersion = -1;
  private liveTowerAt: LiveTowerAt = () => false;
  private fields = new Map<number, number[][]>();

  constructor(grid: FlightGrid) {
    this.grid = grid;
  }

  ensureUpToDate(liveTowerAt: LiveTowerAt, pathVersion: number): void {
    if (this.pathVersion === pathVersion && this.fields.size > 0) return;
    this.rebuild(liveTowerAt, pathVersion);
  }

  rebuild(liveTowerAt: LiveTowerAt, pathVersion: number): void {
    this.pathVersion = pathVersion;
    this.liveTowerAt = liveTowerAt;
    this.fields.clear();
    const heights = new Set<number>();
    for (const meta of Object.values(getGameContent().enemies.types)) {
      const flyingHeight = meta.flyingHeight ?? 0;
      if (flyingHeight > 0) heights.add(flyingHeight);
    }
    for (const flyingHeight of heights) {
      this.fields.set(flyingHeight, flightDistanceGrid(this.grid, flyingHeight, liveTowerAt));
    }
  }

  getDistanceToBase(tileX: number, tileY: number, flyingHeight: number): number {
    if (flyingHeight <= 0) return -1;
    let field = this.fields.get(flyingHeight);
    if (!field) {
      field = flightDistanceGrid(this.grid, flyingHeight, this.liveTowerAt);
      this.fields.set(flyingHeight, field);
    }
    if (tileY < 0 || tileY >= field.length) return -1;
    const row = field[tileY];
    if (!row || tileX < 0 || tileX >= row.length) return -1;
    return row[tileX] ?? -1;
  }
}
