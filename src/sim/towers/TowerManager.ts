import type { MapThemeData, TowerVisualMeta } from "@/render/themes/index.js";
import type { SoundPlayer } from "@/sim/HostBindings.js";
import type { ParticleSpawner } from "@/sim/ParticleSystem.js";
import type { PersistState } from "@/sim/PersistState.js";
import { Tower } from "./Tower.js";

interface EnemyManagerRef {
  enemies: {
    x: number;
    y: number;
    removed: boolean;
    maxHp: number;
    hp: number;
    id: number;
    applySlow(amount: number, duration: number): void;
    applyStun?(duration: number): void;
    takeDamage(amount: number, armorPiercing?: boolean): number | undefined;
  }[];
  getEnemiesInRange(
    x: number,
    y: number,
    range: number,
  ): {
    x: number;
    y: number;
    removed: boolean;
    maxHp: number;
    hp: number;
    id: number;
    applySlow(amount: number, duration: number): void;
    applyStun?(duration: number): void;
    takeDamage(amount: number, armorPiercing?: boolean): number | undefined;
  }[];
  getEnemyById(id: number): { id: number; removed: boolean; x: number; y: number; hp: number } | null;
  forEachEnemyInRange(
    x: number,
    y: number,
    range: number,
    cb: (enemy: {
      x: number;
      y: number;
      removed: boolean;
      maxHp: number;
      hp: number;
      id: number;
      applySlow(amount: number, duration: number): void;
      applyStun?(duration: number): void;
      takeDamage(amount: number, armorPiercing?: boolean): number | undefined;
    }) => void,
  ): void;
  towerAt(x: number, y: number): Tower | null;
}

interface ProjectileManagerRef {
  spawn(opts: {
    x: number;
    y: number;
    damage: number;
    speed: number;
    range: number;
    towerType: string;
    towerLevel: number;
    targetId: number;
    slowAmt?: number;
    slowDur?: number;
    towerId?: string;
    napalm?: boolean;
    variant?: "A" | "B" | null;
    splash?: number;
  }): void;
  fireLightning(opts: {
    originX: number;
    originY: number;
    damage: number;
    towerLevel: number;
    targetId: number;
    stunDuration: number;
    towerId?: string;
    chain?: number;
    stormcall?: boolean;
  }): void;
}

interface GridRef {
  tileSize: number;
  canBuild(x: number, y: number): boolean;
  registerTower(x: number, y: number): boolean;
  unregisterTower(x: number, y: number): boolean;
  clearTowerGhost(x: number, y: number): void;
  getBase(): { x: number; y: number };
  tileToWorld(tx: number, ty: number): { x: number; y: number };
  worldToTile(wx: number, wy: number): { x: number; y: number };
}

export class TowerManager {
  grid: GridRef;
  particles: ParticleSpawner;
  projectiles: ProjectileManagerRef;
  sound: SoundPlayer;
  towers: Tower[];
  private nextTowerId: number = 0;
  private towerMap: Map<string, Tower> = new Map();
  private tileMap: Map<string, Tower> = new Map();
  theme: MapThemeData | null;
  defaultTowerVisuals: Record<string, TowerVisualMeta>;
  navDistanceToBase: ((tileX: number, tileY: number, flyingHeight?: number) => number) | null = null;

  constructor(
    grid: GridRef,
    particles: ParticleSpawner,
    projectiles: ProjectileManagerRef,
    sound: SoundPlayer,
    theme: MapThemeData | null = null,
    defaultTowerVisuals: Record<string, TowerVisualMeta> = {},
  ) {
    this.grid = grid;
    this.particles = particles;
    this.projectiles = projectiles;
    this.sound = sound;
    this.theme = theme;
    this.defaultTowerVisuals = defaultTowerVisuals;
    this.towers = [];
  }

  setNavDistanceToBase(lookup: ((tileX: number, tileY: number, flyingHeight?: number) => number) | null): void {
    this.navDistanceToBase = lookup;
    for (const tower of this.towers) {
      tower.navDistanceToBase = lookup;
    }
  }

  clear(): void {
    this.towers = [];
    this.towerMap.clear();
    this.tileMap.clear();
  }

  build(
    type: string,
    tileX: number,
    tileY: number,
    save: PersistState | undefined,
    grid: GridRef,
    paidCost?: number,
  ): Tower | null {
    if (!this.grid.canBuild(tileX, tileY)) return null;
    const tower = new Tower(
      type,
      tileX,
      tileY,
      save,
      grid,
      this.theme,
      this.defaultTowerVisuals[type] ?? null,
      undefined,
      paidCost,
    );
    // Register on the grid first so a failed registration does not burn a tower ID.
    if (!this.grid.registerTower(tileX, tileY)) return null;
    tower.id = `tower-${++this.nextTowerId}`;
    tower.navDistanceToBase = this.navDistanceToBase;
    this.towers.push(tower);
    this.towerMap.set(tower.id, tower);
    this.tileMap.set(`${tileX},${tileY}`, tower);
    this.particles.spawn(tower.x, tower.y, tower.color, 10, { speed: 50, life: 0.4 });
    this.sound.playSound("place");
    return tower;
  }

  sell(tower: Tower, _save: PersistState | undefined): void {
    this.grid.unregisterTower(tower.tileX, tower.tileY);
    this.towers = this.towers.filter((t) => t.id !== tower.id);
    this.towerMap.delete(tower.id);
    this.tileMap.delete(`${tower.tileX},${tower.tileY}`);
    this.particles.spawn(tower.x, tower.y, "#ffcf4d", 14, { speed: 70, life: 0.5 });
    this.sound.playSound("sell");
  }

  cancelBuild(tower: Tower): number {
    this.grid.unregisterTower(tower.tileX, tower.tileY);
    this.towers = this.towers.filter((t) => t.id !== tower.id);
    this.towerMap.delete(tower.id);
    this.tileMap.delete(`${tower.tileX},${tower.tileY}`);
    this.particles.spawn(tower.x, tower.y, "#88ff88", 14, { speed: 70, life: 0.5 });
    this.sound.playSound("cancel");
    return tower.totalInvested;
  }

  downgradeTower(tower: Tower): number {
    if (tower.level <= 1) return 0;
    let removedCost = 0;
    if (tower.variant) {
      removedCost = tower.levelCosts.pop() ?? 0;
      tower.totalInvested -= removedCost;
      tower.level--;
      // Clear the specialization only once the tower is back down to level 4.
      if (tower.level <= 4) {
        tower.variant = null;
        tower.level = 4;
      }
    } else {
      const levelIndex = tower.level - 1;
      removedCost = tower.levelCosts[levelIndex] ?? 0;
      tower.levelCosts.pop();
      tower.totalInvested -= removedCost;
      tower.level--;
    }
    if (tower.totalInvested < 0) tower.totalInvested = 0;
    tower._statsCache = null;
    tower.recomputeMaxHealth();
    this.particles.spawn(tower.x, tower.y, "#ffd060", 10, { speed: 50, life: 0.4 });
    return removedCost;
  }

  update(dt: number, enemyManager: EnemyManagerRef): void {
    for (const tower of this.towers) tower.update(dt, enemyManager, this.projectiles, this.sound);
  }

  getTowerById(id: string): Tower | undefined {
    return this.towerMap.get(id);
  }

  towerAt(tileX: number, tileY: number): Tower | undefined {
    return this.tileMap.get(`${tileX},${tileY}`);
  }

  // Tile indices move with the grid origin; world positions (tower.x/y) stay
  // where they are. The fresh map avoids a shifted tower's new key clobbering
  // another tower's old key when the two sit exactly one shift apart.
  shiftLayoutIndices(shiftX: number, shiftY: number): void {
    if (shiftX === 0 && shiftY === 0) return;
    const shifted = new Map<string, Tower>();
    for (const tower of this.towers) {
      tower.tileX += shiftX;
      tower.tileY += shiftY;
      shifted.set(`${tower.tileX},${tower.tileY}`, tower);
    }
    this.tileMap = shifted;
  }
}
