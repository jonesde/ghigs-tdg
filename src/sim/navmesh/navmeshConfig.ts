import { getGameContent } from "@/content/gameContent.js";

// Corridor wall cuboids are centered on the walkable/non-walkable tile-edge line,
// so this much of each wall intrudes into the walkable side. Shared with the
// physics corridor builder (PhysicsWorld.rebuildCorridor) so the chamfer math and
// the actual wall thickness cannot drift apart.
export function corridorWallHalfThicknessWorld(tileSize: number): number {
  return tileSize * 0.05;
}

// World radius of the largest ground enemy (flyingHeight <= 0). Flying types steer
// on the flight grid and drop the corridor collision group, so they never clip a
// corridor wall and must not size the chamfer.
export function maxGroundEnemyRadiusWorld(tileSize: number): number {
  let maxRadius = 0;
  for (const meta of Object.values(getGameContent().enemies.types)) {
    if ((meta.flyingHeight ?? 0) > 0) continue;
    maxRadius = Math.max(maxRadius, meta.radius);
  }
  return maxRadius * tileSize * 0.5;
}

// Extra pocket depth beyond the largest body radius, as a fraction of that radius.
// At a grazing fit (pocket depth == body radius) the body's center reaches the
// catch point only while its steering velocity is aimed into the contact, so it can
// stall; a margin gives real clearance for the turn-anticipation tangential slide.
const corridorChamferMarginFraction = 0.25;

// How far each inside-corner wall vertex is chamfered back. At an inside bend the
// two corridor walls meet at a sharp convex vertex; an enemy circle clips that
// vertex and the physics shove reroutes it. Cutting the vertex with a 45-degree
// diagonal (and shortening the two flanking wall segments to meet it) rounds the
// catch point into a pocket the enemy can follow. The pocket depth from the vertex
// is inset/sqrt(2); the diagonal's inner face sits hw inside that, so a body of
// world radius r clears the corner when inset/sqrt(2) - hw >= r, i.e.
// inset >= (r + hw) * sqrt(2). Sizing r to the largest ground enemy keeps every
// ground type from pinning on an inside corner.
export function corridorWallInsetWorld(tileSize: number): number {
  const halfThickness = corridorWallHalfThicknessWorld(tileSize);
  const maxGroundRadius = maxGroundEnemyRadiusWorld(tileSize);
  const targetRadius = maxGroundRadius * (1 + corridorChamferMarginFraction);
  return (targetRadius + halfThickness) * Math.SQRT2;
}
