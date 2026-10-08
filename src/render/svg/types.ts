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
| EffectManager    | Lightning      | 20   | LIGHTNING_POOL_SIZE   | Evict oldest on add | Newest bolts kept, stale ones evicted  |
| EffectManager    | Stun           | 50   | STUN_POOL_SIZE        | Evict oldest on add | Newest marks kept, one per enemy      |
| UiOverlayManager | HP bars        | 100  | HP_BAR_POOL_SIZE      | Sequential break    | Only first N HP bars rendered         |
| UiOverlayManager | Shield bars    | 100  | SHIELD_BAR_POOL_SIZE  | Sequential break    | Only first N shield bars rendered     |
| UiOverlayManager | Boss text      | 10   | BOSS_TEXT_POOL_SIZE   | Sequential break    | Only first N boss texts rendered      |
| UiOverlayManager | Tower HP bars  | 100  | TOWER_HP_BAR_POOL_SIZE| Sequential break    | Only first N tower HP bars rendered   |
 */

// The lightning and stun pools are capped on insert, not on draw, and they evict
// the OLDEST live effect. The map holding them is insertion-ordered, so overflow
// keeps the newest batch — the bolts and marks the player just saw the sim fire.
// An effect that arrives older than its own lifetime is dropped outright (see
// EffectManager.syncVisualEffectsFromSnapshot), so a stalled snapshot stream
// thins the effects instead of replaying stale ones.

export const ENEMY_POOL_SIZE = 100;
export const PROJECTILE_POOL_SIZE = 150;
export const PARTICLE_POOL_SIZE = 300;

export const LIGHTNING_POOL_SIZE = 20;
export const STUN_POOL_SIZE = 50;

export const HP_BAR_POOL_SIZE = 100;
export const SHIELD_BAR_POOL_SIZE = 100;
export const BOSS_TEXT_POOL_SIZE = 10;
export const TOWER_HP_BAR_POOL_SIZE = 100;
