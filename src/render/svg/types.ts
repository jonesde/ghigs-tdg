export const SVG_NS = "http://www.w3.org/2000/svg";

export const GRID_TILE_SIZE = 36;
export const TOWER_SCALED_SIZE = GRID_TILE_SIZE * 0.75;
export const ENEMY_SCALED_SIZE = GRID_TILE_SIZE * 0.75;

/*
| Render Manager   | Pool           | Size | Const Name            | Exhaustion Strategy | Behavior                              |
|------------------|----------------|------|-----------------------|---------------------|---------------------------------------|
| ParticleManager  | Particles      | 300  | PARTICLE_POOL_SIZE    | Skip excess         | Silently drops excess particles       |
| ProjectileManager| Projectiles    | 150  | PROJECTILE_POOL_SIZE  | Skip excess         | Silently drops excess projectiles     |
| EnemyManager     | Enemies        | 100  | ENEMY_POOL_SIZE       | Sequential break    | Only first N enemies rendered         |
| EffectManager    | Lightning      | 20   | LIGHTNING_POOL_SIZE   | Circular buffer     | Oldest effect overwritten by newest   |
| EffectManager    | Stun           | 50   | STUN_POOL_SIZE        | Circular buffer     | Oldest stun overwritten               |
| UiOverlayManager | HP bars        | 100  | HP_BAR_POOL_SIZE      | Sequential break    | Only first N HP bars rendered         |
| UiOverlayManager | Shield bars    | 100  | SHIELD_BAR_POOL_SIZE  | Sequential break    | Only first N shield bars rendered     |
| UiOverlayManager | Boss text      | 10   | BOSS_TEXT_POOL_SIZE   | Sequential break    | Only first N boss texts rendered      |
| UiOverlayManager | Tower HP bars  | 100  | TOWER_HP_BAR_POOL_SIZE| Sequential break    | Only first N tower HP bars rendered   |
 */

export const ENEMY_POOL_SIZE = 100;
export const PROJECTILE_POOL_SIZE = 150;
export const PARTICLE_POOL_SIZE = 300;

export const LIGHTNING_POOL_SIZE = 20;
export const STUN_POOL_SIZE = 50;

export const HP_BAR_POOL_SIZE = 100;
export const SHIELD_BAR_POOL_SIZE = 100;
export const BOSS_TEXT_POOL_SIZE = 10;
export const TOWER_HP_BAR_POOL_SIZE = 100;

export interface Projectile {
  id: number;
  x: number;
  y: number;
  radius: number;
  color: string;
  icon: string;
}

export interface Particle {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  opacity: number;
}
