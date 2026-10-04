import type { SpawnState } from "@/render/themes/index.js";
import { SVG_NS, GRID_TILE_SIZE as TILE_SIZE } from "./types.js";

interface SpawnElement {
  useEl: SVGUseElement;
  lastVisualState: string;
}

interface SpawnPoint {
  x: number;
  y: number;
}

// Owns the spawn marker <use> nodes in a dedicated layer. The markers are
// dynamic (their href flips closed/transition/open per snapshot) so they must
// not live in the v-html grid layer: that layer's children are replaced
// whenever its string changes, which would leave the captured nodes detached.
export class SpawnManager {
  private elements: SpawnElement[] = [];
  private layer: SVGGElement | null = null;

  init(layer: SVGGElement, spawns: readonly SpawnPoint[], originX: number, originY: number): void {
    this.clearLayer();
    this.layer = layer;
    this.elements = spawns.map((spawn) => {
      const useEl = document.createElementNS(SVG_NS, "use");
      useEl.setAttribute("class", "spawn-marker");
      useEl.setAttribute("href", "#spawn-closed");
      useEl.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#spawn-closed");
      useEl.setAttribute("x", String(originX + spawn.x * TILE_SIZE));
      useEl.setAttribute("y", String(originY + spawn.y * TILE_SIZE));
      useEl.setAttribute("width", String(TILE_SIZE));
      useEl.setAttribute("height", String(TILE_SIZE));
      layer.appendChild(useEl);
      return { useEl, lastVisualState: "closed" };
    });
  }

  sync(spawnStates: SpawnState[]): void {
    for (let i = 0; i < this.elements.length; i++) {
      const spawnState = spawnStates[i];
      if (!spawnState) continue;
      const spawnEl = this.elements[i]!;
      if (spawnState.visualState !== spawnEl.lastVisualState) {
        spawnEl.useEl.setAttribute("href", `#spawn-${spawnState.visualState}`);
        spawnEl.useEl.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#spawn-${spawnState.visualState}`);
        spawnEl.lastVisualState = spawnState.visualState;
      }
    }
  }

  getElements(): SpawnElement[] {
    return this.elements;
  }

  dispose(): void {
    this.clearLayer();
    this.layer = null;
  }

  private clearLayer(): void {
    if (!this.layer) return;
    for (const element of this.elements) {
      this.layer.removeChild(element.useEl);
    }
    this.elements = [];
  }
}
