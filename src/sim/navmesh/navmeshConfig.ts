import { ENEMY_TYPES } from "@/sim/ConstantsEnemy.js";

// How far each inside-corner wall vertex is chamfered back into the non-walkable
// side. At an inside bend the two corridor walls meet at a sharp convex vertex; an
// enemy circle clips that vertex and the physics shove reroutes it. Cutting the
// vertex back by ~1.5× the tank radius (and shortening the two flanking wall
// segments to meet a diagonal) rounds the catch point into a pocket the enemy can
// follow. Only the catch vertex moves — straight wall runs stay at the tile edge,
// so corridor containment (and the base perimeter) is unchanged.
export const CORRIDOR_WALL_TANK_FACTOR = 1.5;

export function corridorWallInsetWorld(tileSize: number): number {
  return ENEMY_TYPES.tank!.radius * tileSize * 0.5 * CORRIDOR_WALL_TANK_FACTOR;
}
