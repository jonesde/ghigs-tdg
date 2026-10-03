import type { ProjectileSnapshot } from "../../sim/SimulationSnapshot.js";
import { PROJECTILE_POOL_SIZE, SVG_NS } from "./types.js";

export class ProjectileManager {
  private pool: SVGTextElement[] = [];
  private idToIndex: Map<number, number> = new Map();
  private freeIndexStack: number[] = [];
  private overflowIds: Set<number> = new Set();
  private activeIdScratch: Set<number> = new Set();
  private lastRadius: string[] = [];
  private lastFill: string[] = [];
  private lastIcon: string[] = [];

  init(layer: SVGGElement): void {
    for (let i = PROJECTILE_POOL_SIZE - 1; i >= 0; i--) {
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.setAttribute("font-size", "6");
      text.setAttribute("fill", "#ffffff");
      text.style.visibility = "hidden";
      layer.appendChild(text);
      this.pool.push(text);
      this.freeIndexStack.push(i);
      this.lastRadius.push("");
      this.lastFill.push("");
      this.lastIcon.push("");
    }
  }

  syncFromGameEngine(projectiles: ProjectileSnapshot[]): void {
    for (let i = 0; i < projectiles.length; i++) {
      const proj = projectiles[i]!;
      if (!this.idToIndex.has(proj.id) && !this.overflowIds.has(proj.id)) {
        const freeIndex = this.freeIndexStack.pop();
        if (freeIndex !== undefined) {
          this.idToIndex.set(proj.id, freeIndex);
        } else {
          this.overflowIds.add(proj.id);
        }
      }
      const poolIndex = this.idToIndex.get(proj.id);
      if (poolIndex === undefined) continue;
      const text = this.pool[poolIndex]!;
      text.style.visibility = "visible";
      text.setAttribute("transform", `translate(${proj.x}, ${proj.y})`);
      const fontSizeString = String(proj.radius * 2);
      if (fontSizeString !== this.lastRadius[poolIndex]) {
        text.setAttribute("font-size", fontSizeString);
        this.lastRadius[poolIndex] = fontSizeString;
      }
      const fillColor = proj.color || "#ffffff";
      if (fillColor !== this.lastFill[poolIndex]) {
        text.setAttribute("fill", fillColor);
        this.lastFill[poolIndex] = fillColor;
      }
      const iconText = proj.icon || "•";
      if (iconText !== this.lastIcon[poolIndex]) {
        text.textContent = iconText;
        this.lastIcon[poolIndex] = iconText;
      }
    }

    this.activeIdScratch.clear();
    for (const p of projectiles) this.activeIdScratch.add(p.id);
    for (const [id, index] of this.idToIndex) {
      const text = this.pool[index]!;
      if (!this.activeIdScratch.has(id)) {
        text.style.visibility = "hidden";
        this.freeIndexStack.push(index);
        this.idToIndex.delete(id);
      }
    }
    for (const overflowId of this.overflowIds) {
      if (!this.activeIdScratch.has(overflowId)) {
        this.overflowIds.delete(overflowId);
      }
    }
  }

  dispose(): void {
    for (const text of this.pool) {
      if (text.parentNode) {
        text.parentNode.removeChild(text);
      }
    }
    this.pool = [];
    this.idToIndex.clear();
    this.freeIndexStack = [];
    this.overflowIds.clear();
  }
}
