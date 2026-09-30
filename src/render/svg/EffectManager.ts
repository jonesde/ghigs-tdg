import { TOWER_BASE, TOWER_LEVEL_RANGE_MULT } from "@/sim/ConstantsTower.js";
import { GRID_TILE_SIZE, LIGHTNING_POOL_SIZE, STUN_POOL_SIZE, SVG_NS } from "./types.js";

interface LightningEffect {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  life: number;
  maxLife: number;
  seed: number;
}

interface StunEffect {
  id: string;
  x: number;
  y: number;
  remainingLife: number;
  maxLife: number;
}

// Minimal structural view of the Grid needed to anchor the splash circle on a
// nearby unoccupied path tile. The main-thread `Grid` (gameStore.grid) satisfies
// this shape structurally, so no import of the sim Grid type is required.
interface SplashGridQuery {
  isPath(x: number, y: number): boolean;
  inBounds(x: number, y: number): boolean;
  blocked: Set<string>;
}

const LIGHTNING_SEGMENTS = 5;
const LIGHTNING_STROKE_WIDTH = 2;
const LIGHTNING_LIFE_SECONDS = 1 / 3;
const LIGHTNING_PERP_OFFSET = 6;
const LIGHTNING_COLOR_PRIMARY = "#40a0ff";

const STUN_ARC_SEGMENTS = 8;
const STUN_ARC_RADIUS = 14;
const STUN_WIGGLE_RANGE = 4;
const STUN_FLASH_HZ = 9;
const STUN_PULSE_HZ = 2;
const STUN_COLOR_OUTER = "#40a0ff";
const STUN_COLOR_INNER = "#ffffff";
const STUN_STROKE_OUTER = 2.5;
const STUN_STROKE_INNER = 1.5;

const TILE_SIZE = 36;

export class EffectManager {
  private lightningPool: SVGPolylineElement[] = [];
  private stunPool: SVGGElement[] = [];
  private buildPreviewEl: SVGRectElement | null = null;
  private buildPreviewSpriteEl: SVGUseElement | null = null;
  private rangeCircleEl: SVGCircleElement | null = null;
  private buildRangeCircleEl: SVGCircleElement | null = null;
  private splashCircleEl: SVGCircleElement | null = null;
  private upgradeButtonEl: SVGGElement | null = null;
  private upgradeButtonBgEl: SVGRectElement | null = null;
  private upgradeButtonTextEl: SVGTextElement | null = null;
  private selectedTileRectEl: SVGRectElement | null = null;

  private lightningEffects: Map<string, LightningEffect> = new Map();
  private stunEffects: Map<string, StunEffect> = new Map();

  private nextLightningId: number = 0;
  private nextStunId: number = 0;

  private buildPreviewSpriteLastId = "";
  private buildPreviewSpriteLastTransform = "";
  private buildPreviewSpriteLastSize = "";
  private buildPreviewSpriteLastColor = "";
  private lastBuildPreviewKey: string | null = null;
  private lastSelectedTowerId: string | null = null;
  private lastSelectedTowerLevel: number = 0;

  init(layer: SVGGElement): void {
    for (let i = 0; i < LIGHTNING_POOL_SIZE; i++) {
      const polyline = document.createElementNS(SVG_NS, "polyline");
      polyline.setAttribute("fill", "none");
      polyline.setAttribute("stroke", LIGHTNING_COLOR_PRIMARY);
      polyline.setAttribute("stroke-width", String(LIGHTNING_STROKE_WIDTH));
      polyline.setAttribute("stroke-linecap", "round");
      polyline.setAttribute("stroke-linejoin", "round");
      polyline.setAttribute("filter", "url(#glow)");
      polyline.style.visibility = "hidden";
      layer.appendChild(polyline);
      this.lightningPool.push(polyline);
    }

    for (let i = 0; i < STUN_POOL_SIZE; i++) {
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("filter", "url(#glow)");
      group.style.visibility = "hidden";
      layer.appendChild(group);
      this.stunPool.push(group);
    }

    this.buildPreviewEl = document.createElementNS(SVG_NS, "rect");
    this.buildPreviewEl.setAttribute("fill", "rgba(0,255,0,0.3)");
    this.buildPreviewEl.setAttribute("stroke", "none");
    this.buildPreviewEl.style.visibility = "hidden";
    layer.appendChild(this.buildPreviewEl);

    this.buildPreviewSpriteEl = document.createElementNS(SVG_NS, "use");
    this.buildPreviewSpriteEl.style.visibility = "hidden";
    this.buildPreviewSpriteEl.style.opacity = "0.6";
    layer.appendChild(this.buildPreviewSpriteEl);

    this.rangeCircleEl = document.createElementNS(SVG_NS, "circle");
    this.rangeCircleEl.setAttribute("fill", "none");
    this.rangeCircleEl.setAttribute("stroke", "rgba(255,255,255,0.4)");
    this.rangeCircleEl.setAttribute("stroke-width", "1.5");
    this.rangeCircleEl.style.visibility = "hidden";
    layer.appendChild(this.rangeCircleEl);

    this.buildRangeCircleEl = document.createElementNS(SVG_NS, "circle");
    this.buildRangeCircleEl.setAttribute("fill", "none");
    this.buildRangeCircleEl.setAttribute("stroke", "rgba(0,255,0,0.6)");
    this.buildRangeCircleEl.setAttribute("stroke-width", "1.5");
    this.buildRangeCircleEl.setAttribute("stroke-dasharray", "4,3");
    this.buildRangeCircleEl.style.visibility = "hidden";
    layer.appendChild(this.buildRangeCircleEl);

    this.splashCircleEl = document.createElementNS(SVG_NS, "circle");
    this.splashCircleEl.setAttribute("fill", "none");
    this.splashCircleEl.setAttribute("stroke", "rgba(255,180,40,0.75)");
    this.splashCircleEl.setAttribute("stroke-width", "1.5");
    this.splashCircleEl.setAttribute("stroke-dasharray", "3,3");
    this.splashCircleEl.style.visibility = "hidden";
    layer.appendChild(this.splashCircleEl);

    this.upgradeButtonEl = document.createElementNS(SVG_NS, "g");
    this.upgradeButtonEl.style.visibility = "hidden";

    this.upgradeButtonBgEl = document.createElementNS(SVG_NS, "rect");
    this.upgradeButtonBgEl.setAttribute("fill", "#00004a");
    this.upgradeButtonBgEl.setAttribute("stroke", "#40a0ff");
    this.upgradeButtonBgEl.setAttribute("stroke-width", "1");
    this.upgradeButtonBgEl.setAttribute("rx", "2");
    this.upgradeButtonBgEl.setAttribute("ry", "2");
    this.upgradeButtonBgEl.setAttribute("width", "10");
    this.upgradeButtonBgEl.setAttribute("height", "10");
    this.upgradeButtonEl.appendChild(this.upgradeButtonBgEl);

    this.upgradeButtonTextEl = document.createElementNS(SVG_NS, "text");
    this.upgradeButtonTextEl.setAttribute("fill", "#ffffff");
    this.upgradeButtonTextEl.setAttribute("font-size", "8");
    this.upgradeButtonTextEl.setAttribute("font-weight", "bold");
    this.upgradeButtonTextEl.setAttribute("font-family", "sans-serif");
    this.upgradeButtonTextEl.setAttribute("text-anchor", "middle");
    this.upgradeButtonTextEl.setAttribute("dominant-baseline", "central");
    this.upgradeButtonEl.appendChild(this.upgradeButtonTextEl);

    layer.appendChild(this.upgradeButtonEl);

    this.selectedTileRectEl = document.createElementNS(SVG_NS, "rect");
    this.selectedTileRectEl.setAttribute("fill", "none");
    this.selectedTileRectEl.setAttribute("stroke", "rgba(95,208,255,0.8)");
    this.selectedTileRectEl.setAttribute("stroke-width", "2");
    this.selectedTileRectEl.style.visibility = "hidden";
    layer.appendChild(this.selectedTileRectEl);
  }

  addLightningEffect(startX: number, startY: number, endX: number, endY: number): string {
    const id = this.generateLightningId();
    const effect: LightningEffect = {
      id,
      startX,
      startY,
      endX,
      endY,
      life: LIGHTNING_LIFE_SECONDS,
      maxLife: LIGHTNING_LIFE_SECONDS,
      seed: Math.random() * 1000,
    };
    this.lightningEffects.set(id, effect);
    return id;
  }

  addStunEffect(x: number, y: number, duration: number): string {
    const key = `${x.toFixed(1)},${y.toFixed(1)}`;
    const existing = this.stunEffects.get(key);
    if (existing) {
      existing.remainingLife = Math.max(existing.remainingLife, duration);
      return existing.id;
    }
    const id = this.generateStunId();
    const effect: StunEffect = { id, x, y, remainingLife: duration, maxLife: duration };
    this.stunEffects.set(key, effect);
    return id;
  }

  syncFromGameEngine(
    buildTilePos: { tileX: number; tileY: number } | null,
    selectedTowerType: string | null,
    buildPreviewColor: string | null,
    selectedTower: { x: number; y: number; type: string; level: number } | null,
    buildValid: boolean,
    dt: number,
    grid?: SplashGridQuery | null,
  ): void {
    this.syncLightning(dt);
    this.syncStun(dt);
    this.syncBuildPreview(buildTilePos, selectedTowerType, buildPreviewColor, buildValid);
    this.syncUpgradeButton(selectedTower, grid);
  }

  // Returns the splash radius (in tiles) from the tower's computed stats.splash,
  // which already includes base value + per-level scaling + variant tier + addons.
  // Mirrors ProjectileManager, so the previewed circle matches the actual AoE.
  private computeSplashRadiusTiles(statsSplash: number): number {
    return statsSplash ?? 0;
  }

  // Finds the nearest unoccupied path tile to a tower so the splash circle sits
  // where enemies actually walk, rather than on the tower (or a terrain tile).
  // Expands in Chebyshev rings; returns the tile center, or null if none nearby.
  private findSplashAnchor(
    grid: SplashGridQuery,
    towerTileX: number,
    towerTileY: number,
  ): { cx: number; cy: number } | null {
    const excludeKey = `${towerTileX},${towerTileY}`;
    const maxRing = 6;
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let deltaX = -ring; deltaX <= ring; deltaX++) {
        for (let deltaY = -ring; deltaY <= ring; deltaY++) {
          if (Math.abs(deltaX) !== ring && Math.abs(deltaY) !== ring) continue;
          const neighborX = towerTileX + deltaX;
          const neighborY = towerTileY + deltaY;
          if (!grid.inBounds(neighborX, neighborY)) continue;
          if (!grid.isPath(neighborX, neighborY)) continue;
          const tileKey = `${neighborX},${neighborY}`;
          if (tileKey === excludeKey) continue;
          if (grid.blocked.has(tileKey)) continue;
          return { cx: neighborX * TILE_SIZE + TILE_SIZE / 2, cy: neighborY * TILE_SIZE + TILE_SIZE / 2 };
        }
      }
    }
    return null;
  }

  // Effects are sparse (undefined on quiet ticks), so both arrays are optional
  // here: absence means "nothing new this frame", not "clear existing effects".
  // The renderer's own pool ages and hides effects independently.
  syncVisualEffectsFromSnapshot(
    lightningEffects: Array<{ x1: number; y1: number; x2: number; y2: number }> | undefined,
    stunEffects: Array<{ x: number; y: number }> | undefined,
  ): void {
    for (const bolt of lightningEffects ?? []) {
      this.addLightningEffect(bolt.x1, bolt.y1, bolt.x2, bolt.y2);
    }
    for (const stun of stunEffects ?? []) {
      this.addStunEffect(stun.x, stun.y, 0.3);
    }
  }

  private syncLightning(dt: number): void {
    let slotIndex = 0;
    for (const effect of this.lightningEffects.values()) {
      if (effect.life <= 0) continue;
      if (slotIndex >= this.lightningPool.length) break;

      const polyline = this.lightningPool[slotIndex]!;
      slotIndex++;

      const points = this.generateLightningPoints(
        effect.startX,
        effect.startY,
        effect.endX,
        effect.endY,
        LIGHTNING_SEGMENTS,
        effect.seed,
      );
      const elapsed = effect.maxLife - effect.life;
      const alpha = Math.max(0, 1 - elapsed / effect.maxLife);

      polyline.setAttribute("points", points);
      polyline.setAttribute("opacity", alpha.toFixed(3));
      polyline.style.visibility = "visible";
    }

    for (let i = slotIndex; i < this.lightningPool.length; i++) {
      this.lightningPool[i]!.style.visibility = "hidden";
    }

    const expiredIds: string[] = [];
    for (const [id, effect] of this.lightningEffects) {
      effect.life -= dt;
      if (effect.life <= 0) {
        expiredIds.push(id);
      }
    }
    for (const id of expiredIds) {
      this.lightningEffects.delete(id);
    }
  }

  private generateLightningPoints(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    segments: number,
    seed: number,
  ): string {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (length === 0) {
      return `${startX.toFixed(1)},${startY.toFixed(1)}`;
    }

    const perpX = -deltaY / length;
    const perpY = deltaX / length;
    const stepX = deltaX / (segments + 1);
    const stepY = deltaY / (segments + 1);

    const points: string[] = [];
    points.push(`${startX.toFixed(1)},${startY.toFixed(1)}`);

    for (let i = 1; i <= segments; i++) {
      const baseX = startX + stepX * i;
      const baseY = startY + stepY * i;
      const randomOffset = ((Math.sin(seed + i * 7.3) * 0.5 + 0.5) * 2 - 1) * LIGHTNING_PERP_OFFSET;
      const offsetX = perpX * randomOffset;
      const offsetY = perpY * randomOffset;
      points.push(`${(baseX + offsetX).toFixed(1)},${(baseY + offsetY).toFixed(1)}`);
    }

    points.push(`${endX.toFixed(1)},${endY.toFixed(1)}`);
    return points.join(" ");
  }

  private syncStun(dt: number): void {
    let slotIndex = 0;
    for (const effect of this.stunEffects.values()) {
      if (effect.remainingLife <= 0) continue;
      if (slotIndex >= this.stunPool.length) break;

      const group = this.stunPool[slotIndex]!;
      slotIndex++;
      if (group.childNodes.length === 0) {
        this.initStunGroup(group);
      }

      const elapsed = effect.maxLife - effect.remainingLife;
      const lifeRatio = Math.max(0, effect.remainingLife / effect.maxLife);

      const points = this.generateStunArcPoints(0, 0, STUN_ARC_SEGMENTS, elapsed);

      const outerArc = group.childNodes[0] as SVGPolylineElement;
      const innerArc = group.childNodes[1] as SVGPolylineElement;

      outerArc.setAttribute("points", points);
      innerArc.setAttribute("points", points);

      const outerOpacity = 0.35 + 0.15 * Math.sin(elapsed * STUN_PULSE_HZ * Math.PI * 2);
      outerArc.setAttribute("opacity", outerOpacity.toFixed(3));

      const flash = Math.sin(elapsed * STUN_FLASH_HZ * Math.PI * 2) > 0.2;
      const innerOpacity = flash ? 1.0 : 0.08;
      innerArc.setAttribute("opacity", innerOpacity.toFixed(3));

      group.setAttribute("transform", `translate(${effect.x.toFixed(1)}, ${effect.y.toFixed(1)})`);
      group.setAttribute("opacity", lifeRatio.toFixed(3));
      group.style.visibility = "visible";

      effect.remainingLife -= dt;
    }

    for (let i = slotIndex; i < this.stunPool.length; i++) {
      this.stunPool[i]!.style.visibility = "hidden";
    }

    const expiredKeys: string[] = [];
    for (const [key, effect] of this.stunEffects) {
      if (effect.remainingLife <= 0) {
        expiredKeys.push(key);
      }
    }
    for (const key of expiredKeys) {
      this.stunEffects.delete(key);
    }
  }

  private generateStunArcPoints(centerX: number, centerY: number, segments: number, timeSeed: number): string {
    const points: string[] = [];
    let firstPoint = "";
    for (let i = 0; i < segments; i++) {
      const baseAngle = (i / segments) * Math.PI * 2 - Math.PI / 2;
      const baseX = centerX + Math.cos(baseAngle) * STUN_ARC_RADIUS;
      const baseY = centerY + Math.sin(baseAngle) * STUN_ARC_RADIUS;
      const tangentX = -Math.sin(baseAngle);
      const tangentY = Math.cos(baseAngle);
      const jitter = (Math.sin(timeSeed + i * 3.7) * 0.5 + 0.5) * 2 - 1;
      const offsetX = tangentX * jitter * STUN_WIGGLE_RANGE;
      const offsetY = tangentY * jitter * STUN_WIGGLE_RANGE;
      const point = `${(baseX + offsetX).toFixed(1)},${(baseY + offsetY).toFixed(1)}`;
      if (i === 0) {
        firstPoint = point;
      }
      points.push(point);
    }
    points.push(firstPoint);
    return points.join(" ");
  }

  private initStunGroup(group: SVGGElement): void {
    const outerArc = document.createElementNS(SVG_NS, "polyline") as SVGPolylineElement;
    outerArc.setAttribute("fill", "none");
    outerArc.setAttribute("stroke", STUN_COLOR_OUTER);
    outerArc.setAttribute("stroke-width", String(STUN_STROKE_OUTER));
    outerArc.setAttribute("stroke-linecap", "round");
    outerArc.setAttribute("stroke-linejoin", "round");
    outerArc.setAttribute("filter", "url(#glow)");
    group.appendChild(outerArc);

    const innerArc = document.createElementNS(SVG_NS, "polyline") as SVGPolylineElement;
    innerArc.setAttribute("fill", "none");
    innerArc.setAttribute("stroke", STUN_COLOR_INNER);
    innerArc.setAttribute("stroke-width", String(STUN_STROKE_INNER));
    innerArc.setAttribute("stroke-linecap", "round");
    innerArc.setAttribute("stroke-linejoin", "round");
    innerArc.setAttribute("filter", "url(#glow)");
    group.appendChild(innerArc);
  }

  private syncBuildPreview(
    buildTilePos: { tileX: number; tileY: number } | null,
    selectedTowerType: string | null,
    buildPreviewColor: string | null,
    buildValid: boolean,
  ): void {
    const posKey = buildTilePos ? `${buildTilePos.tileX},${buildTilePos.tileY}` : "";
    const signature = `${posKey}|${selectedTowerType ?? ""}|${buildValid ? 1 : 0}`;
    if (signature === this.lastBuildPreviewKey) return;
    this.lastBuildPreviewKey = signature;
    if (selectedTowerType && buildTilePos) {
      const tileX = buildTilePos.tileX * TILE_SIZE;
      const tileY = buildTilePos.tileY * TILE_SIZE;
      const centerX = tileX + TILE_SIZE / 2;
      const centerY = tileY + TILE_SIZE / 2;

      if (this.buildPreviewEl) {
        this.buildPreviewEl.style.visibility = "visible";
        this.buildPreviewEl.setAttribute("transform", `translate(${tileX}, ${tileY})`);
        this.buildPreviewEl.setAttribute("width", String(TILE_SIZE));
        this.buildPreviewEl.setAttribute("height", String(TILE_SIZE));
        this.buildPreviewEl.setAttribute("fill", buildValid ? "rgba(0,255,0,0.3)" : "rgba(255,0,0,0.3)");
      }

      if (this.buildPreviewSpriteEl) {
        this.buildPreviewSpriteEl.style.visibility = "visible";
        const spriteId = `tower-${selectedTowerType}-f0`;
        if (spriteId !== this.buildPreviewSpriteLastId) {
          this.buildPreviewSpriteEl.setAttribute("href", `#${spriteId}`);
          this.buildPreviewSpriteLastId = spriteId;
        }
        const previewSize = GRID_TILE_SIZE * 0.56;
        const halfPreview = previewSize / 2;
        const spriteTransform = `translate(${centerX - halfPreview}, ${centerY - halfPreview})`;
        if (spriteTransform !== this.buildPreviewSpriteLastTransform) {
          this.buildPreviewSpriteEl.setAttribute("transform", spriteTransform);
          this.buildPreviewSpriteLastTransform = spriteTransform;
        }
        const sizeStr = String(previewSize);
        if (sizeStr !== this.buildPreviewSpriteLastSize) {
          this.buildPreviewSpriteEl.setAttribute("width", sizeStr);
          this.buildPreviewSpriteEl.setAttribute("height", sizeStr);
          this.buildPreviewSpriteLastSize = sizeStr;
        }
        if (buildValid) {
          if (buildPreviewColor && buildPreviewColor !== this.buildPreviewSpriteLastColor) {
            this.buildPreviewSpriteEl.style.color = buildPreviewColor;
            this.buildPreviewSpriteLastColor = buildPreviewColor;
          }
        } else {
          const redColor = "rgba(255,0,0,0.8)";
          if (redColor !== this.buildPreviewSpriteLastColor) {
            this.buildPreviewSpriteEl.style.color = redColor;
            this.buildPreviewSpriteLastColor = redColor;
          }
        }
      }

      if (this.buildRangeCircleEl) {
        this.buildRangeCircleEl.style.visibility = "visible";
        this.buildRangeCircleEl.setAttribute("transform", `translate(${centerX}, ${centerY})`);

        const towerBase = TOWER_BASE[selectedTowerType];
        const rangeTiles = towerBase?.range ?? 3.5;
        const rangePx = rangeTiles * TILE_SIZE;
        this.buildRangeCircleEl.setAttribute("r", String(rangePx));
        this.buildRangeCircleEl.setAttribute("stroke", buildValid ? "rgba(0,255,0,0.6)" : "rgba(255,0,0,0.6)");
      }

      const splashTiles = this.computeSplashRadiusTiles(TOWER_BASE[selectedTowerType]?.splash ?? 0);
      if (this.splashCircleEl) {
        if (splashTiles > 0) {
          this.splashCircleEl.style.visibility = "visible";
          // Splash circle sits one tile above the preview so it does not overlap
          // the centered range circle, keeping the two radii visually distinct.
          this.splashCircleEl.setAttribute("transform", `translate(${centerX}, ${centerY - TILE_SIZE})`);
          this.splashCircleEl.setAttribute("r", String(splashTiles * TILE_SIZE));
          this.splashCircleEl.setAttribute("stroke", buildValid ? "rgba(255,180,40,0.75)" : "rgba(255,0,0,0.6)");
        } else {
          this.splashCircleEl.style.visibility = "hidden";
        }
      }
    } else {
      if (this.buildPreviewEl) {
        this.buildPreviewEl.style.visibility = "hidden";
      }
      if (this.buildPreviewSpriteEl) {
        this.buildPreviewSpriteEl.style.visibility = "hidden";
      }
      if (this.buildRangeCircleEl) {
        this.buildRangeCircleEl.style.visibility = "hidden";
      }
      if (this.splashCircleEl) {
        this.splashCircleEl.style.visibility = "hidden";
      }
    }
  }

  private syncUpgradeButton(
    selectedTower: { x: number; y: number; type: string; level: number } | null,
    grid?: SplashGridQuery | null,
  ): void {
    const tower = selectedTower as {
      x: number;
      y: number;
      type: string;
      level: number;
      id?: string;
      tileX: number;
      tileY: number;
      stats?: { splash: number };
    } | null;
    if (tower) {
      const towerId = tower.id ?? null;
      const cached =
        towerId !== null && towerId === this.lastSelectedTowerId && tower.level === this.lastSelectedTowerLevel;
      if (!cached) {
        this.lastSelectedTowerId = towerId;
        this.lastSelectedTowerLevel = tower.level;
        if (this.upgradeButtonEl) {
          this.upgradeButtonEl.style.visibility = "visible";
          const buttonX = tower.x + TILE_SIZE / 2 - 12;
          const buttonY = tower.y - TILE_SIZE / 2 + 2;
          this.upgradeButtonEl.setAttribute("transform", `translate(${buttonX}, ${buttonY})`);

          if (this.upgradeButtonBgEl) {
            this.upgradeButtonBgEl.setAttribute("x", "0");
            this.upgradeButtonBgEl.setAttribute("y", "0");
            this.upgradeButtonBgEl.setAttribute("width", "10");
            this.upgradeButtonBgEl.setAttribute("height", "10");
          }

          if (this.upgradeButtonTextEl) {
            this.upgradeButtonTextEl.setAttribute("x", "5");
            this.upgradeButtonTextEl.setAttribute("y", "5");
            this.upgradeButtonTextEl.textContent = "^";
          }
        }

        if (this.selectedTileRectEl) {
          this.selectedTileRectEl.style.visibility = "visible";
          const tileX = Math.floor(tower.x / TILE_SIZE) * TILE_SIZE + 1;
          const tileY = Math.floor(tower.y / TILE_SIZE) * TILE_SIZE + 1;
          this.selectedTileRectEl.setAttribute("transform", `translate(${tileX}, ${tileY})`);
          this.selectedTileRectEl.setAttribute("width", String(TILE_SIZE - 2));
          this.selectedTileRectEl.setAttribute("height", String(TILE_SIZE - 2));
        }

        if (this.rangeCircleEl) {
          this.rangeCircleEl.style.visibility = "visible";
          this.rangeCircleEl.setAttribute("transform", `translate(${tower.x}, ${tower.y})`);
          const towerBase = TOWER_BASE[tower.type];
          const baseRange = towerBase?.range ?? 3.5;
          const rangeTiles = baseRange * TOWER_LEVEL_RANGE_MULT ** (tower.level - 1);
          const rangePx = rangeTiles * TILE_SIZE;
          this.rangeCircleEl.setAttribute("r", String(rangePx));
          this.rangeCircleEl.setAttribute("stroke", "rgba(0,255,0,0.6)");
        }
      }

      // Splash circle: recomputed every frame because its anchor depends on nearby
      // path-tile occupancy, which changes when towers are built/sold around it.
      const splashTiles = this.computeSplashRadiusTiles(tower.stats?.splash ?? 0);
      if (this.splashCircleEl) {
        if (splashTiles > 0) {
          const anchor = (grid ? this.findSplashAnchor(grid, tower.tileX, tower.tileY) : null) ?? {
            cx: tower.x,
            cy: tower.y,
          };
          this.splashCircleEl.style.visibility = "visible";
          this.splashCircleEl.setAttribute("transform", `translate(${anchor.cx}, ${anchor.cy})`);
          this.splashCircleEl.setAttribute("r", String(splashTiles * TILE_SIZE));
        } else {
          this.splashCircleEl.style.visibility = "hidden";
        }
      }
    } else {
      this.lastSelectedTowerId = null;
      if (this.upgradeButtonEl) {
        this.upgradeButtonEl.style.visibility = "hidden";
      }
      if (this.selectedTileRectEl) {
        this.selectedTileRectEl.style.visibility = "hidden";
      }
      if (this.rangeCircleEl) {
        this.rangeCircleEl.style.visibility = "hidden";
      }
    }
  }

  private generateLightningId(): string {
    this.nextLightningId += 1;
    return `lightning-${this.nextLightningId}`;
  }

  private generateStunId(): string {
    this.nextStunId += 1;
    return `stun-${this.nextStunId}`;
  }

  dispose(): void {
    for (const polyline of this.lightningPool) {
      if (polyline.parentNode) {
        polyline.parentNode.removeChild(polyline);
      }
    }
    for (const group of this.stunPool) {
      if (group.parentNode) {
        group.parentNode.removeChild(group);
      }
    }
    if (this.buildPreviewEl?.parentNode) {
      this.buildPreviewEl.parentNode.removeChild(this.buildPreviewEl);
    }
    if (this.buildPreviewSpriteEl?.parentNode) {
      this.buildPreviewSpriteEl.parentNode.removeChild(this.buildPreviewSpriteEl);
    }
    if (this.rangeCircleEl?.parentNode) {
      this.rangeCircleEl.parentNode.removeChild(this.rangeCircleEl);
    }
    if (this.buildRangeCircleEl?.parentNode) {
      this.buildRangeCircleEl.parentNode.removeChild(this.buildRangeCircleEl);
    }
    if (this.splashCircleEl?.parentNode) {
      this.splashCircleEl.parentNode.removeChild(this.splashCircleEl);
    }
    if (this.upgradeButtonEl?.parentNode) {
      this.upgradeButtonEl.parentNode.removeChild(this.upgradeButtonEl);
    }
    if (this.selectedTileRectEl?.parentNode) {
      this.selectedTileRectEl.parentNode.removeChild(this.selectedTileRectEl);
    }
    this.lightningPool = [];
    this.stunPool = [];
    this.lightningEffects.clear();
    this.stunEffects.clear();
  }
}
