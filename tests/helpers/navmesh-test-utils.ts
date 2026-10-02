import type { Grid } from "@/sim/grid/Grid.js";

// Computes an ordered list of walkable tiles (path|base|spawn) from a spawn to the
// base using a BFS over Grid's tile predicates. The old grid path provider was deleted
// with the BFS pathfinding module; tests that previously needed an ordered path tile
// list use this instead. It is a test-only helper and must not be used in production.
// Returns null when no walkable spawn-to-base route exists: callers must treat a
// disconnected map as a failure, not as a path through walls.
export function orderedPath(grid: Grid, spawnIndex: number): { x: number; y: number }[] | null {
  const start = grid.spawns[spawnIndex]!;
  const goalTiles = new Set(grid.getBaseGoalTiles().map((tile) => `${tile.x},${tile.y}`));
  const prev = new Map<string, string | null>();
  const visited = new Set<string>();
  const startKey = `${start.x},${start.y}`;
  visited.add(startKey);
  const queue: { x: number; y: number }[] = [start];
  prev.set(startKey, null);
  while (queue.length) {
    const current = queue.shift()!;
    const key = `${current.x},${current.y}`;
    if (goalTiles.has(key)) break;
    for (const neighbor of [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ]) {
      if (!grid.inBounds(neighbor.x, neighbor.y)) continue;
      const walkable =
        grid.isPath(neighbor.x, neighbor.y) ||
        grid.isBase(neighbor.x, neighbor.y) ||
        grid.isSpawn(neighbor.x, neighbor.y);
      if (!walkable) continue;
      const neighborKey = `${neighbor.x},${neighbor.y}`;
      if (visited.has(neighborKey)) continue;
      visited.add(neighborKey);
      prev.set(neighborKey, key);
      queue.push(neighbor);
    }
  }
  const goalKey = [...goalTiles].find((key) => visited.has(key));
  if (!goalKey) return null;
  const path: { x: number; y: number }[] = [];
  let currentKey: string | null = goalKey;
  while (currentKey) {
    const coordinates = currentKey.split(",");
    const x = Number(coordinates[0]);
    const y = Number(coordinates[1]);
    path.unshift({ x, y });
    currentKey = prev.get(currentKey) ?? null;
  }
  return path;
}
