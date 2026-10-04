import type { EnemySnapshot } from "../../sim/SimulationSnapshot.js";
import type { EnemyVisualMeta, MapThemeAnimation, MapThemeData } from "../themes/index.js";
import { ENEMY_POOL_SIZE, ENEMY_SCALED_SIZE, SVG_NS } from "./types.js";

export class EnemyManager {
  private pool: EnemyRenderProxy[] = [];
  // Active run theme + default-theme fallback, passed in by SvgGameRoot. The
  // serializer no longer ships per-enemy animation payloads; frame timing is
  // resolved by enemy.type from these same theme objects the <defs> symbols are
  // built from, so sprite ids and frame progression stay identical to the
  // pre-sparseness behavior.
  private theme: MapThemeData | null;
  private defaultEnemyVisuals: Record<string, EnemyVisualMeta>;

  constructor(theme: MapThemeData | null = null, defaultEnemyVisuals: Record<string, EnemyVisualMeta> = {}) {
    this.theme = theme;
    this.defaultEnemyVisuals = defaultEnemyVisuals;
  }

  init(layer: SVGGElement): void {
    for (let i = 0; i < ENEMY_POOL_SIZE; i++) {
      const el = document.createElementNS(SVG_NS, "use") as SVGUseElement;
      el.style.visibility = "hidden";
      layer.appendChild(el);

      const proxy = new EnemyRenderProxy(el);
      this.pool.push(proxy);
    }
  }

  syncFromGameEngine(enemies: EnemySnapshot[]): void {
    let proxyIndex = 0;

    for (const enemy of enemies) {
      if (proxyIndex >= this.pool.length) break;

      const proxy = this.pool[proxyIndex]!;
      proxy.sync(enemy, this.resolveEnemyVisual(enemy.type), this.resolveEnemyVisual("healer"));
      proxyIndex++;
    }

    for (let i = proxyIndex; i < this.pool.length; i++) {
      this.pool[i]!.hide();
    }
  }

  // Mirrors the worker's spawn-time visual chain (Enemy constructor): the active
  // theme's enemy visual first, else the default-theme visual. Only the animation
  // timing fields are read here; the theme supplier is fixed per run, so the
  // lookup is a plain record read with no allocation.
  private resolveEnemyVisual(enemyType: string): EnemyVisualMeta | null {
    return this.theme?.enemies[enemyType] ?? this.defaultEnemyVisuals[enemyType] ?? null;
  }

  dispose(): void {
    for (const proxy of this.pool) {
      proxy.dispose();
    }
    this.pool = [];
  }
}

function animationFrameCount(animation: MapThemeAnimation | null): number {
  return animation?.referenceImages.length || 1;
}

function computeEnemyFrame(enemy: EnemySnapshot, walking: MapThemeAnimation | null): number {
  if (!walking || walking.duration <= 0) return 0;
  const frameCount = animationFrameCount(walking);
  return Math.floor((enemy.gameSeconds / walking.duration) * frameCount) % frameCount;
}

class EnemyRenderProxy {
  private el: SVGUseElement;
  private lastSpriteId: string = "";
  private active: boolean = false;

  private lastTransform: string = "";
  private lastWidth: string = "";
  private lastHeight: string = "";
  private lastFilter: string = "";
  private overlay: SVGUseElement | null = null;
  private overlaySpriteId = "";

  constructor(el: SVGUseElement) {
    this.el = el;
  }

  getEl(): SVGUseElement {
    return this.el;
  }

  sync(enemy: EnemySnapshot, visual: EnemyVisualMeta | null, healerVisual: EnemyVisualMeta | null): void {
    if (!this.active) {
      this.lastSpriteId = "";
    }
    this.active = true;
    this.el.style.visibility = "visible";

    const spriteSize = ENEMY_SCALED_SIZE;
    const halfSize = spriteSize / 2;
    const angleDeg = enemy.angle * (180 / Math.PI);
    const posX = enemy.x - halfSize;
    const posY = enemy.y - halfSize;
    const facingLeft = Math.cos(enemy.angle) < 0;
    let transform: string;
    if (facingLeft) {
      const adjustDeg = 180 - angleDeg;
      // Inversion for facing left so rotation doesn't turn image upside-down
      // Note the negated translation with posX broken down to adjust by halfSize in the opposite direction.
      transform = `scale(-1, 1) translate(${-enemy.x - halfSize}, ${posY}) rotate(${adjustDeg}, ${halfSize}, ${halfSize})`;
    } else {
      transform = `translate(${posX}, ${posY}) rotate(${angleDeg}, ${halfSize}, ${halfSize})`;
    }
    if (transform !== this.lastTransform) {
      this.el.setAttribute("transform", transform);
      this.lastTransform = transform;
    }

    const hitReaction = visual?.hitReaction ?? null;
    const attackAnimation = visual?.attack ?? null;
    const gameSeconds = enemy.gameSeconds;
    const inHitReaction =
      hitReaction && enemy.hitAnimTime > 0 && gameSeconds - enemy.hitAnimTime < hitReaction.duration;
    const inAttack =
      !inHitReaction &&
      attackAnimation &&
      enemy.attackAnimTime > 0 &&
      gameSeconds - enemy.attackAnimTime < attackAnimation.duration;

    if (inHitReaction) {
      const elapsedInHit = gameSeconds - enemy.hitAnimTime;
      const frameCount = animationFrameCount(hitReaction);
      const hitFrameIdx = Math.floor((elapsedInHit / hitReaction!.duration) * frameCount) % frameCount;
      const spriteId = `enemy-${enemy.type}-hit-f${hitFrameIdx}`;
      if (spriteId !== this.lastSpriteId) {
        this.el.setAttribute("href", `#${spriteId}`);
        this.lastSpriteId = spriteId;
      }
    } else if (inAttack) {
      const elapsedInAttack = gameSeconds - enemy.attackAnimTime;
      const frameCount = animationFrameCount(attackAnimation);
      const attackFrameIdx = Math.floor((elapsedInAttack / attackAnimation!.duration) * frameCount) % frameCount;
      const spriteId = `enemy-${enemy.type}-attack-f${attackFrameIdx}`;
      if (spriteId !== this.lastSpriteId) {
        this.el.setAttribute("href", `#${spriteId}`);
        this.lastSpriteId = spriteId;
      }
    } else {
      const frameIdx = computeEnemyFrame(enemy, visual?.walking ?? null);
      const spriteId = `enemy-${enemy.type}-f${frameIdx}`;
      if (spriteId !== this.lastSpriteId) {
        this.el.setAttribute("href", `#${spriteId}`);
        this.lastSpriteId = spriteId;
      }
    }

    const widthStr = String(spriteSize);
    const heightStr = String(spriteSize);
    if (widthStr !== this.lastWidth) {
      this.el.setAttribute("width", widthStr);
      this.lastWidth = widthStr;
    }
    if (heightStr !== this.lastHeight) {
      this.el.setAttribute("height", heightStr);
      this.lastHeight = heightStr;
    }

    this.syncMendOverlay(enemy, healerVisual, transform, spriteSize);

    if (enemy.slowFactor < 1) {
      const filterLevel = Math.ceil((1 - enemy.slowFactor) * 10);
      const filterValue = `url(#slow-${filterLevel})`;
      if (filterValue !== this.lastFilter) {
        this.el.setAttribute("filter", filterValue);
        this.lastFilter = filterValue;
      }
    } else {
      if (this.lastFilter !== "") {
        this.el.removeAttribute("filter");
        this.lastFilter = "";
      }
    }
  }

  hide(): void {
    if (this.active) {
      this.el.style.visibility = "hidden";
      this.active = false;
      this.lastSpriteId = "";
      this.lastTransform = "";
      this.lastWidth = "";
      this.lastHeight = "";
      this.lastFilter = "";
    }
    this.hideOverlay();
  }

  dispose(): void {
    this.hide();
    this.overlay?.remove();
    this.overlay = null;
    this.el.remove();
  }

  // Healer walking frames drawn behind a Mend boss. Missing cycle: no overlay.
  // The green ring is drawn by MapSiteLayer either way.
  private syncMendOverlay(
    enemy: EnemySnapshot,
    healerVisual: EnemyVisualMeta | null,
    transform: string,
    spriteSize: number,
  ): void {
    const walking = healerVisual?.walking ?? null;
    const show =
      enemy.type === "boss" &&
      enemy.bossAbility === "healAura" &&
      !enemy.mendSuppressed &&
      !!walking &&
      walking.referenceImages.length > 0;
    if (!show || !walking) {
      this.hideOverlay();
      return;
    }
    const overlay = this.ensureOverlay();
    overlay.style.visibility = "visible";
    overlay.setAttribute("transform", transform);
    overlay.setAttribute("width", String(spriteSize));
    overlay.setAttribute("height", String(spriteSize));
    overlay.setAttribute("opacity", "0.65");
    const frame = computeEnemyFrame(enemy, walking);
    const spriteId = `enemy-healer-f${frame}`;
    if (spriteId !== this.overlaySpriteId) {
      overlay.setAttribute("href", `#${spriteId}`);
      this.overlaySpriteId = spriteId;
    }
  }

  private ensureOverlay(): SVGUseElement {
    if (this.overlay) return this.overlay;
    const overlay = document.createElementNS(SVG_NS, "use");
    overlay.style.visibility = "hidden";
    this.el.parentNode?.insertBefore(overlay, this.el);
    this.overlay = overlay;
    return overlay;
  }

  private hideOverlay(): void {
    if (!this.overlay) return;
    this.overlay.style.visibility = "hidden";
    this.overlaySpriteId = "";
  }
}
