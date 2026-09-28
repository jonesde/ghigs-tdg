import { GHOST_OPACITY } from "@/sim/ConstantsTower.js";
import type { TowerSnapshot } from "../../sim/SimulationSnapshot.js";
import { SVG_NS, TOWER_SCALED_SIZE } from "./types.js";

export class TowerManager {
  private layer: SVGGElement | null = null;
  private towerMap: Map<string, TowerRenderProxy> = new Map();
  private pipMap: Map<string, SVGCircleElement[]> = new Map();
  private activeIds: Set<string> = new Set();
  init(layer: SVGGElement): void {
    this.layer = layer;
  }

  syncFromGameEngine(towers: TowerSnapshot[], dt: number): void {
    if (!this.layer) return;

    this.activeIds.clear();
    const activeIds = this.activeIds;

    for (const tower of towers) {
      const towerId = tower.id;
      activeIds.add(towerId);

      if (!this.towerMap.has(towerId)) {
        const el = document.createElementNS(SVG_NS, "use") as SVGUseElement;
        el.style.visibility = "hidden";
        this.layer.appendChild(el);
        this.towerMap.set(towerId, new TowerRenderProxy(el));
      }

      const proxy = this.towerMap.get(towerId) as TowerRenderProxy;
      proxy.sync(tower, dt);

      const pipCount = Math.max(0, tower.level - 1);
      let pips = this.pipMap.get(towerId);
      if (!pips) {
        pips = [];
        this.pipMap.set(towerId, pips);
      }

      while (pips.length < pipCount) {
        const pip = document.createElementNS(SVG_NS, "circle");
        pip.setAttribute("r", "2");
        // Dark ring so the light silver/gold fill stays readable on pale tiles.
        // Width stays under the 5-unit pip spacing so neighboring rings do not merge.
        pip.setAttribute("stroke", "#1a140c");
        pip.setAttribute("stroke-width", "0.75");
        pip.style.visibility = "hidden";
        this.layer.appendChild(pip);
        pips.push(pip);
      }

      while (pips.length > pipCount) {
        const removed = pips.pop() as SVGCircleElement;
        if (removed.parentNode) {
          removed.parentNode.removeChild(removed);
        }
      }

      const pipFill = tower.level >= 5 ? "#ffd700" : "#c0c0c0";
      for (let p = 0; p < pips.length; p++) {
        const pip = pips[p]!;
        pip.style.visibility = "visible";
        const pipX = tower.x + (p - (pipCount - 1) / 2) * 5;
        const pipY = tower.y + 12;
        const pipTransform = `translate(${pipX}, ${pipY})`;
        if (pip.getAttribute("transform") !== pipTransform) {
          pip.setAttribute("transform", pipTransform);
        }
        if (pip.getAttribute("fill") !== pipFill) {
          pip.setAttribute("fill", pipFill);
        }
      }
    }

    for (const [towerId, proxy] of this.towerMap) {
      if (!activeIds.has(towerId)) {
        proxy.dispose();
        this.towerMap.delete(towerId);
      }
    }

    for (const [towerId, pips] of this.pipMap) {
      if (!activeIds.has(towerId)) {
        for (const pip of pips) {
          if (pip.parentNode) {
            pip.parentNode.removeChild(pip);
          }
        }
        this.pipMap.delete(towerId);
      }
    }
  }

  dispose(): void {
    if (!this.layer) return;

    for (const proxy of this.towerMap.values()) {
      proxy.dispose();
    }
    this.towerMap.clear();

    for (const pips of this.pipMap.values()) {
      for (const pip of pips) {
        if (pip.parentNode) {
          pip.parentNode.removeChild(pip);
        }
      }
    }
    this.pipMap.clear();

    this.layer = null;
  }
}

function computeTowerFrame(
  animConfig: { duration: number; referenceImages?: unknown[] } | null,
  elapsed: number,
): number {
  if (!animConfig || animConfig.duration <= 0) return 0;
  const refImages = animConfig.referenceImages;
  const frameCount = refImages?.length || 1;
  if (elapsed >= animConfig.duration) return 0;
  return Math.floor((elapsed / animConfig.duration) * frameCount);
}

class TowerRenderProxy {
  private el: SVGUseElement;
  private lastSpriteId: string = "";
  private scaledElapsed: number = 0;
  private lastSeenFireAnimTime: number = 0;
  private animStartElapsed: number = 0;
  private animConfig: { duration: number; referenceImages?: unknown[] } | null = null;
  private lastTransform: string = "";
  private lastWidth: string = "";
  private lastHeight: string = "";
  private lastColor: string = "";

  constructor(el: SVGUseElement) {
    this.el = el;
  }

  getEl(): SVGUseElement {
    return this.el;
  }

  sync(tower: TowerSnapshot, dt: number): void {
    this.el.style.visibility = "visible";
    this.el.style.opacity = tower.isGhost ? String(GHOST_OPACITY) : "1";
    if (tower.color !== this.lastColor) {
      this.el.style.color = tower.color;
      this.lastColor = tower.color;
    }

    const fireAnimTime = tower.fireAnimTime;
    if (fireAnimTime > 0 && fireAnimTime !== this.lastSeenFireAnimTime) {
      this.lastSeenFireAnimTime = fireAnimTime;
      const config = tower.animation;
      if (config && config.duration > 0) {
        this.animConfig = config;
        this.animStartElapsed = this.scaledElapsed;
      }
    }

    this.scaledElapsed += dt;

    let frameIdx = 0;
    if (this.animConfig) {
      const elapsed = this.scaledElapsed - this.animStartElapsed;
      frameIdx = computeTowerFrame(this.animConfig, elapsed);
      if (elapsed >= this.animConfig.duration) {
        this.animConfig = null;
      }
    }
    const spriteId = `tower-${tower.type}-f${frameIdx}`;
    if (spriteId !== this.lastSpriteId) {
      this.el.setAttribute("href", `#${spriteId}`);
      this.lastSpriteId = spriteId;
    }

    const widthStr = String(TOWER_SCALED_SIZE);
    const heightStr = String(TOWER_SCALED_SIZE);
    if (widthStr !== this.lastWidth) {
      this.el.setAttribute("width", widthStr);
      this.lastWidth = widthStr;
    }
    if (heightStr !== this.lastHeight) {
      this.el.setAttribute("height", heightStr);
      this.lastHeight = heightStr;
    }

    const rotationDeg = (tower.angle || 0) * (180 / Math.PI);
    const halfSize = TOWER_SCALED_SIZE / 2;
    const transform = `translate(${tower.x - halfSize}, ${tower.y - halfSize}) rotate(${rotationDeg}, ${halfSize}, ${halfSize})`;
    if (transform !== this.lastTransform) {
      this.el.setAttribute("transform", transform);
      this.lastTransform = transform;
    }
  }

  dispose(): void {
    if (this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
    this.lastSpriteId = "";
    this.lastTransform = "";
    this.lastWidth = "";
    this.lastHeight = "";
    this.lastColor = "";
  }
}
