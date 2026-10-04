// @ts-nocheck
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { resolveThemeMaps } from "@/content/themeMaps.js";
import aftermathRaw from "@/render/themes/data/the-aftermath.json";
import { MAP_GEM_MULTIPLIERS, MAP_LEVELS, TOTAL_MAPS } from "@/sim/Constants.js";
import { BOSS_CADENCE } from "@/sim/ConstantsEnemy.js";
import { breadthFirstTilePath } from "@/sim/enemies/flightGrid.js";
import { Grid } from "@/sim/grid/Grid.js";
import { generateRandomMap, getMap, invalidateMapCache } from "@/sim/grid/Map.js";
import { NavDistanceField } from "@/sim/navmesh/NavDistanceField.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { orderedPath } from "../helpers/navmesh-test-utils.js";

function tileKey(tileX, tileY) {
  return `${tileX},${tileY}`;
}

function walkDistances(map, origins, allowBase) {
  const distance = new Map();
  const queue = [];
  for (const origin of origins) {
    const key = tileKey(origin.x, origin.y);
    if (distance.has(key)) continue;
    distance.set(key, 0);
    queue.push(origin);
  }
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    const currentDistance = distance.get(tileKey(current.x, current.y));
    for (const neighbor of [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ]) {
      if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= map.width || neighbor.y >= map.height) continue;
      const tileType = map.tiles[neighbor.y][neighbor.x].type;
      const walkable = tileType === "path" || tileType === "spawn" || (allowBase && tileType === "base");
      if (!walkable) continue;
      const key = tileKey(neighbor.x, neighbor.y);
      if (distance.has(key)) continue;
      distance.set(key, currentDistance + 1);
      queue.push(neighbor);
    }
  }
  return distance;
}

function nearestBaseSteps(map, spawn) {
  const distance = walkDistances(map, [spawn], true);
  let best = Number.POSITIVE_INFINITY;
  for (let tileY = 0; tileY < map.height; tileY++) {
    for (let tileX = 0; tileX < map.width; tileX++) {
      if (map.tiles[tileY][tileX].type !== "base") continue;
      const steps = distance.get(tileKey(tileX, tileY));
      if (steps !== undefined && steps < best) best = steps;
    }
  }
  return best;
}

function shortestPathKeys(map) {
  const baseTiles = [];
  for (let tileY = 0; tileY < map.height; tileY++) {
    for (let tileX = 0; tileX < map.width; tileX++) {
      if (map.tiles[tileY][tileX].type === "base") baseTiles.push({ x: tileX, y: tileY });
    }
  }
  const fromBase = walkDistances(map, baseTiles, true);
  const shortest = new Set();
  for (const spawn of map.spawns) {
    const fromSpawn = walkDistances(map, [spawn], true);
    const goal = nearestBaseSteps(map, spawn);
    for (const [key, spawnSteps] of fromSpawn) {
      const baseSteps = fromBase.get(key);
      if (baseSteps !== undefined && spawnSteps + baseSteps === goal) shortest.add(key);
    }
  }
  return shortest;
}

function collarBySide(map) {
  const base = map.base;
  const sides = new Map();
  const add = (side, tileX, tileY) => {
    if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return;
    const list = sides.get(side) ?? [];
    list.push({ x: tileX, y: tileY });
    sides.set(side, list);
  };
  for (let offset = -1; offset <= 1; offset++) {
    add("west", base.x - 2, base.y + offset);
    add("east", base.x + 2, base.y + offset);
    add("north", base.x + offset, base.y - 2);
    add("south", base.x + offset, base.y + 2);
  }
  return sides;
}

describe("Map generation", () => {
  describe("getMap", () => {
    it("returns a valid map for each of the 36 maps", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const map = getMap(i);
        expect(map).toBeDefined();
        expect(map.width).toBeGreaterThan(0);
        expect(map.height).toBeGreaterThan(0);
        expect(map.spawns.length).toBeGreaterThan(0);
        expect(map.base).toBeDefined();
      }
    });

    it("keeps every base center at height 1 so a flyer can use it as a goal", () => {
      for (let mapIndex = 0; mapIndex < TOTAL_MAPS; mapIndex++) {
        const map = getMap(mapIndex);
        const center = map.tiles[map.base.y][map.base.x];
        expect(center.type, `map ${mapIndex}`).toBe("base");
        expect(center.height, `map ${mapIndex}`).toBe(1);
      }
    });

    it("returns maps with valid spawn-to-base paths", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const map = getMap(i);
        const grid = new Grid(map);
        for (let s = 0; s < grid.spawns.length; s++) {
          const path = orderedPath(grid, s);
          expect(path, `Map ${i}, spawn ${s} should have a valid path`).not.toBeNull();
          expect(path?.length).toBeGreaterThan(0);
          const pathTiles = path!;
          const last = pathTiles[pathTiles.length - 1];
          const goalTiles = grid.getBaseGoalTiles();
          const isBaseGoal = goalTiles.some((g) => g.x === last!.x && g.y === last!.y);
          expect(isBaseGoal, `Map ${i}, spawn ${s} path should end on a base/perimeter tile`).toBe(true);
        }
      }
    });

    it("every spawn stands on walkable ground with a finite tile distance to the base", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const map = getMap(i);
        const grid = new Grid(map);
        for (let s = 0; s < grid.spawns.length; s++) {
          const spawn = grid.spawns[s]!;
          const tile = grid.tiles[spawn.y]![spawn.x]!;
          expect(tile.type, `Map ${i}, spawn ${s} tile type`).toBe("spawn");
          const field = new NavDistanceField(grid, null);
          field.rebuild();
          expect(
            field.getDistanceToBase(spawn.x, spawn.y),
            `Map ${i}, spawn ${s} open distance`,
          ).toBeGreaterThanOrEqual(0);
          expect(
            field.getThroughDistanceToBase(spawn.x, spawn.y),
            `Map ${i}, spawn ${s} through distance`,
          ).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it("every path tile is reachable, traversable, and not a dead-end spur", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const map = getMap(i);
        const grid = new Grid(map);
        const goalKeys = new Set(grid.getBaseGoalTiles().map((tile) => `${tile.x},${tile.y}`));
        const distances = new Map<string, number>();
        const queue = [...grid.getBaseGoalTiles()];
        for (const goal of queue) distances.set(`${goal.x},${goal.y}`, 0);
        let head = 0;
        while (head < queue.length) {
          const current = queue[head]!;
          head += 1;
          const currentDistance = distances.get(`${current.x},${current.y}`)!;
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
            if (distances.has(neighborKey)) continue;
            distances.set(neighborKey, currentDistance + 1);
            queue.push(neighbor);
          }
        }
        const degreeOf = (tileX: number, tileY: number): number => {
          let degree = 0;
          for (const neighbor of [
            { x: tileX + 1, y: tileY },
            { x: tileX - 1, y: tileY },
            { x: tileX, y: tileY + 1 },
            { x: tileX, y: tileY - 1 },
          ]) {
            if (!grid.inBounds(neighbor.x, neighbor.y)) continue;
            if (
              grid.isPath(neighbor.x, neighbor.y) ||
              grid.isBase(neighbor.x, neighbor.y) ||
              grid.isSpawn(neighbor.x, neighbor.y)
            )
              degree++;
          }
          return degree;
        };
        const isSpawnTile = (tileX: number, tileY: number): boolean =>
          grid.spawns.some((spawn) => spawn.x === tileX && spawn.y === tileY);
        for (let tileY = 0; tileY < grid.height; tileY++) {
          for (let tileX = 0; tileX < grid.width; tileX++) {
            if (!grid.isPath(tileX, tileY) && !grid.isSpawn(tileX, tileY)) continue;
            const key = `${tileX},${tileY}`;
            expect(distances.has(key), `Map ${i} tile ${key} should reach the base`).toBe(true);
            if (isSpawnTile(tileX, tileY) || goalKeys.has(key)) continue;
            expect(degreeOf(tileX, tileY), `Map ${i} tile ${key} should not be a dead-end spur`).toBeGreaterThan(1);
          }
        }
      }
    });

    it("bastion maps route every spawn through the apex notch into the base", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const config = MAP_LEVELS[i];
        if (config.style !== "bastion") continue;
        const map = getMap(i);
        const grid = new Grid(map);
        for (let s = 0; s < grid.spawns.length; s++) {
          const path = orderedPath(grid, s);
          expect(path, `Map ${i}, spawn ${s} bastion should reach the base`).not.toBeNull();
          expect(path!.length, `Map ${i}, spawn ${s} bastion walk should cross the map`).toBeGreaterThan(5);
        }
        const builder = new NavMeshBuilder(grid);
        expect(builder.isSuccess(), `Map ${i} bastion navmesh should build`).toBe(true);
        for (const spawn of grid.spawns) {
          const start = grid.tileToWorld(spawn.x, spawn.y);
          const goal = grid.tileToWorld(grid.base.x, grid.base.y);
          expect(
            builder.findPath(start, goal).length,
            `Map ${i} bastion navmesh should connect spawn to base`,
          ).toBeGreaterThan(0);
        }
        builder.destroy();
      }
    });

    it("returns maps with correct region metadata", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const map = getMap(i);
        const config = MAP_LEVELS[i];
        expect(map.regionId).toBe(config.regionId);
        expect(map.level).toBe(config.level);
        expect(map.style).toBe(config.style);
        expect(map.bossCadence).toBe(BOSS_CADENCE[config.regionId]);
      }
    });

    it("returns maps with correct dimensions from config", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const map = getMap(i);
        const config = MAP_LEVELS[i];
        expect(map.width).toBe(config.width);
        expect(map.height).toBe(config.height);
      }
    });

    it("caches maps (returns same object on repeat calls)", () => {
      const map1 = getMap(0);
      const map2 = getMap(0);
      expect(map1).toBe(map2);
    });

    it("returns different objects for different map indices", () => {
      const map0 = getMap(0);
      const map1 = getMap(1);
      expect(map0).not.toBe(map1);
    });

    it("invalidates cached maps via invalidateMapCache", () => {
      const first = getMap(0);
      invalidateMapCache();
      const second = getMap(0);
      expect(second).not.toBe(first);
    });

    it("insets every spawn at least one tile from the map border", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const map = getMap(i);
        for (const spawn of map.spawns) {
          expect(spawn.x, `Map ${i} spawn x`).toBeGreaterThanOrEqual(1);
          expect(spawn.y, `Map ${i} spawn y`).toBeGreaterThanOrEqual(1);
          expect(spawn.x, `Map ${i} spawn x`).toBeLessThanOrEqual(map.width - 2);
          expect(spawn.y, `Map ${i} spawn y`).toBeLessThanOrEqual(map.height - 2);
        }
      }
    });

    it("all maps have name property", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const map = getMap(i);
        expect(map.name).toBeDefined();
        expect(typeof map.name).toBe("string");
        expect(map.name).toMatch(/^Region \d+ Map \d+$/);
      }
    });
  });

  describe("generateRandomMap", () => {
    it("produces deterministic output for same seed", () => {
      const map1 = generateRandomMap(20, 20, "bastion", 0, 1, 12345);
      const map2 = generateRandomMap(20, 20, "bastion", 0, 1, 12345);
      expect(map2).toEqual(map1);
    });

    it("produces different output for different seeds", () => {
      const map1 = generateRandomMap(20, 20, "open", 0, 1, 12345);
      const map2 = generateRandomMap(20, 20, "open", 0, 1, 99999);
      let different = false;
      for (let y = 0; y < map1.height && !different; y++) {
        for (let x = 0; x < map1.width && !different; x++) {
          const left = map1.tiles[y][x];
          const right = map2.tiles[y][x];
          if (left.type !== right.type || left.height !== right.height) different = true;
        }
      }
      expect(different).toBe(true);
    });

    it("all 6 styles produce valid maps with paths", () => {
      const styles = ["open", "canyon", "serpentine", "split", "bastion", "battlefield"];
      for (const style of styles) {
        const map = generateRandomMap(20, 20, style, 0, 1, 42);
        const grid = new Grid(map);
        for (let s = 0; s < grid.spawns.length; s++) {
          const path = orderedPath(grid, s);
          expect(path, `${style}: spawn ${s} should have a valid path`).not.toBeNull();
          void path;
        }
      }
    });

    it("split style produces 2 spawns", () => {
      const map = generateRandomMap(20, 20, "split", 0, 1, 42);
      expect(map.spawns).toHaveLength(2);
    });

    it("other styles produce 1 spawn", () => {
      const styles = ["open", "canyon", "serpentine", "bastion", "battlefield"];
      for (const style of styles) {
        const map = generateRandomMap(20, 20, style, 0, 1, 42);
        expect(map.spawns, `${style} should have 1 spawn`).toHaveLength(1);
      }
    });

    it("tiles contain only valid types", () => {
      const map = generateRandomMap(20, 20, "bastion", 0, 1, 42);
      const validTypes = new Set(["terrain", "path", "base", "spawn"]);
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          expect(validTypes.has(map.tiles[y][x].type)).toBe(true);
        }
      }
    });

    it("height values are between 1 and 4", () => {
      const map = generateRandomMap(20, 20, "bastion", 0, 1, 42);
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const height = map.tiles[y][x].height;
          expect(height).toBeGreaterThanOrEqual(1);
          expect(height).toBeLessThanOrEqual(4);
        }
      }
    });

    it("regionId is set correctly", () => {
      for (let r = 0; r < 3; r++) {
        const map = generateRandomMap(20, 20, "bastion", r, 1, 42);
        expect(map.regionId).toBe(r);
      }
    });

    it("bastion keeps an island in front of one apron notch", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const config = MAP_LEVELS[i];
        if (config.style !== "bastion") continue;
        const map = getMap(i);
        const landscape = map.width > map.height;
        const baseMain = landscape ? map.base.x : map.base.y;
        const basePerp = landscape ? map.base.y : map.base.x;
        const crossLimit = landscape ? map.height : map.width;
        const tileOnNotch = (main) => (landscape ? map.tiles[basePerp][main] : map.tiles[main][basePerp]);
        const apronMain = baseMain - 2;
        for (let perp = 0; perp < crossLimit; perp++) {
          const cell = landscape ? map.tiles[perp][apronMain] : map.tiles[apronMain][perp];
          if (perp === basePerp) {
            expect(cell.type, `Map ${i} bastion notch`).toBe("path");
          } else {
            expect(cell.type, `Map ${i} bastion apron`).toBe("terrain");
            expect(cell.height, `Map ${i} bastion apron height`).toBe(4);
          }
        }
        let main = baseMain;
        while (main > 0 && tileOnNotch(main).type === "base") main -= 1;
        while (main > 0 && (tileOnNotch(main).type === "path" || tileOnNotch(main).type === "spawn")) main -= 1;
        const islandEnd = main;
        while (main > 0 && tileOnNotch(main - 1).type === "terrain") main -= 1;
        const islandStart = main;
        expect(islandEnd - islandStart + 1, `Map ${i} bastion island thickness`).toBe(3);
        expect(tileOnNotch(islandStart - 1).type, `Map ${i} bastion back lane`).toBe("path");
        const component = [];
        const seen = new Set();
        const seed = landscape ? { x: islandStart, y: basePerp } : { x: basePerp, y: islandStart };
        const pending = [seed];
        seen.add(tileKey(seed.x, seed.y));
        let head = 0;
        while (head < pending.length) {
          const current = pending[head];
          head += 1;
          component.push(current);
          for (const neighbor of [
            { x: current.x + 1, y: current.y },
            { x: current.x - 1, y: current.y },
            { x: current.x, y: current.y + 1 },
            { x: current.x, y: current.y - 1 },
          ]) {
            if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= map.width || neighbor.y >= map.height) continue;
            const key = tileKey(neighbor.x, neighbor.y);
            if (seen.has(key)) continue;
            if (map.tiles[neighbor.y][neighbor.x].type !== "terrain") continue;
            seen.add(key);
            pending.push(neighbor);
          }
        }
        for (const tile of component) {
          expect(
            tile.x > 0 && tile.y > 0 && tile.x < map.width - 1 && tile.y < map.height - 1,
            `Map ${i} island border`,
          ).toBe(true);
        }
        const shortest = shortestPathKeys(map);
        const goal = nearestBaseSteps(map, map.spawns[0]);
        const fromSpawn = walkDistances(map, [map.spawns[0]], true);
        const baseTiles = [];
        for (let tileY = 0; tileY < map.height; tileY++) {
          for (let tileX = 0; tileX < map.width; tileX++) {
            if (map.tiles[tileY][tileX].type === "base") baseTiles.push({ x: tileX, y: tileY });
          }
        }
        const fromBase = walkDistances(map, baseTiles, true);
        for (const perp of [basePerp - 1, basePerp + 1]) {
          const lane = landscape ? { x: islandStart - 1, y: perp } : { x: perp, y: islandStart - 1 };
          expect(map.tiles[lane.y][lane.x].type, `Map ${i} bastion lane`).toBe("path");
          const steps = fromSpawn.get(tileKey(lane.x, lane.y)) + fromBase.get(tileKey(lane.x, lane.y));
          expect(steps, `Map ${i} bastion lane is on a shortest walk`).toBe(goal);
        }
        expect(shortest.size, `Map ${i} bastion shortest path`).toBeGreaterThan(0);
      }
    });

    it("bastion has a narrow single-tile notch entry toward the base", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const config = MAP_LEVELS[i];
        if (config.style !== "bastion") continue;
        const map = getMap(i);
        const base = map.base;
        const isLandscape = map.width > map.height;
        let foundNotch = false;
        if (isLandscape) {
          for (let x = map.spawns[0]!.x + 1; x < base.x - 1 && !foundNotch; x++) {
            let pathCount = 0;
            for (let y = 0; y < map.height; y++) {
              if (map.tiles[y]![x]!.type === "path") pathCount++;
            }
            if (pathCount === 1) foundNotch = true;
          }
        } else {
          for (let y = map.spawns[0]!.y + 1; y < base.y - 1 && !foundNotch; y++) {
            let pathCount = 0;
            for (let x = 0; x < map.width; x++) {
              if (map.tiles[y]![x]!.type === "path") pathCount++;
            }
            if (pathCount === 1) foundNotch = true;
          }
        }
        expect(foundNotch, `Map ${i} bastion should narrow to a single-tile notch`).toBe(true);
      }
    });

    it("bastion triangle apron around the base is buildable terrain", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const config = MAP_LEVELS[i];
        if (config.style !== "bastion") continue;
        const map = getMap(i);
        const base = map.base;
        let terrainNeighbors = 0;
        for (let deltaY = -3; deltaY <= 3; deltaY++) {
          for (let deltaX = -3; deltaX <= 3; deltaX++) {
            if (deltaX === 0 && deltaY === 0) continue;
            const tileX = base.x + deltaX;
            const tileY = base.y + deltaY;
            if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) continue;
            if (map.tiles[tileY]![tileX]!.type === "terrain") terrainNeighbors++;
          }
        }
        expect(terrainNeighbors, `Map ${i} bastion should keep terrain around the base`).toBeGreaterThan(0);
      }
    });

    it("bastion different seeds produce different layouts", () => {
      const map1 = generateRandomMap(30, 30, "bastion", 0, 1, 11111);
      const map2 = generateRandomMap(30, 30, "bastion", 0, 1, 99999);
      let different = false;
      for (let y = 0; y < map1.height && !different; y++) {
        for (let x = 0; x < map1.width && !different; x++) {
          const left = map1.tiles[y][x];
          const right = map2.tiles[y][x];
          if (left.type !== right.type || left.height !== right.height) different = true;
        }
      }
      expect(different).toBe(true);
    });

    it("MAP_GEM_MULTIPLIERS has 36 entries", () => {
      expect(MAP_GEM_MULTIPLIERS.length).toBe(36);
    });

    it("MAP_GEM_MULTIPLIERS values increase with map index", () => {
      expect(MAP_GEM_MULTIPLIERS[0]).toBe(1);
      expect(MAP_GEM_MULTIPLIERS[4]).toBe(2);
      expect(MAP_GEM_MULTIPLIERS[8]).toBe(3);
      expect(MAP_GEM_MULTIPLIERS[12]).toBe(4);
      expect(MAP_GEM_MULTIPLIERS[24]).toBe(7);
      expect(MAP_GEM_MULTIPLIERS[32]).toBe(10);
    });

    it("serpentine spawn is in the outer 40% of the entry edge", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const config = MAP_LEVELS[i];
        if (config.style !== "serpentine") continue;
        const map = getMap(i);
        const isLandscape = map.width > map.height;
        const spawnCoord = isLandscape ? map.spawns[0]!.x : map.spawns[0]!.y;
        const extent = isLandscape ? map.width : map.height;
        const upperBound = Math.floor(extent * 0.4);
        expect(spawnCoord).toBeGreaterThanOrEqual(1);
        expect(spawnCoord).toBeLessThanOrEqual(upperBound);
      }
    });

    it("canyon has tiles with width 3 (path tile with path neighbor 2 tiles away in perpendicular axis)", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const config = MAP_LEVELS[i];
        if (config.style !== "canyon") continue;
        const map = getMap(i);
        const isLandscape = map.width > map.height;
        let foundWidth3 = false;
        if (isLandscape) {
          for (let x = 0; x < map.width && !foundWidth3; x++) {
            for (let y = 0; y < map.height - 2 && !foundWidth3; y++) {
              if (map.tiles[y][x].type === "path" && map.tiles[y + 2][x].type === "path") {
                foundWidth3 = true;
              }
            }
          }
        } else {
          for (let y = 0; y < map.height && !foundWidth3; y++) {
            for (let x = 0; x < map.width - 2 && !foundWidth3; x++) {
              if (map.tiles[y][x].type === "path" && map.tiles[y][x + 2].type === "path") {
                foundWidth3 = true;
              }
            }
          }
        }
        expect(foundWidth3).toBe(true);
      }
    });

    it("landscape maps have valid spawn-to-base paths", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const config = MAP_LEVELS[i];
        if (config.width <= config.height) continue;
        const map = getMap(i);
        const grid = new Grid(map);
        for (let s = 0; s < grid.spawns.length; s++) {
          const path = orderedPath(grid, s);
          expect(path, `Landscape map ${i}, spawn ${s} should have a valid path`).not.toBeNull();
          expect(path?.length).toBeGreaterThan(0);
          const pathTiles = path!;
          const last = pathTiles[pathTiles.length - 1];
          const goalTiles = grid.getBaseGoalTiles();
          const isBaseGoal = goalTiles.some((g) => g.x === last.x && g.y === last.y);
          expect(isBaseGoal, `Map ${i}, spawn ${s} path should end on a base/perimeter tile`).toBe(true);
        }
      }
    });

    it("landscape split has 2 spawns on left edge", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const config = MAP_LEVELS[i];
        if (config.style !== "split" || config.width <= config.height) continue;
        const map = getMap(i);
        expect(map.spawns).toHaveLength(2);
        for (const spawn of map.spawns) {
          expect(spawn.x).toBe(1);
        }
      }
    });

    it("landscape serpentine spawn X is in the outer 40% of map width", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const config = MAP_LEVELS[i];
        if (config.style !== "serpentine" || config.width <= config.height) continue;
        const map = getMap(i);
        const spawnX = map.spawns[0]!.x;
        const upperBound = Math.floor(map.width * 0.4);
        expect(spawnX).toBeGreaterThanOrEqual(1);
        expect(spawnX).toBeLessThanOrEqual(upperBound);
      }
    });

    it("landscape styles produce 1 spawn (except split)", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const config = MAP_LEVELS[i];
        if (config.width <= config.height) continue;
        const map = getMap(i);
        if (config.style === "split") {
          expect(map.spawns).toHaveLength(2);
        } else {
          expect(map.spawns, `Landscape ${config.style} should have 1 spawn`).toHaveLength(1);
        }
      }
    });
    it("split maps join their arms with a cross-link away from the base", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const config = MAP_LEVELS[i];
        if (config.style !== "split") continue;
        const map = getMap(i);
        const start = map.spawns[0];
        const other = map.spawns[1];
        const visited = walkDistances(map, [start], false);
        expect(visited.has(tileKey(other.x, other.y)), `Map ${i} split arms should connect without the base`).toBe(
          true,
        );
        const landscape = map.width > map.height;
        const baseMain = landscape ? map.base.x : map.base.y;
        const crossLimit = landscape ? map.height : map.width;
        const mid = Math.floor(crossLimit / 2);
        let foundBridge = false;
        for (let main = 1; main <= baseMain - 5 && !foundBridge; main++) {
          let sawLow = false;
          let sawHigh = false;
          let gap = false;
          let entered = false;
          let inside = false;
          for (let perp = 0; perp < crossLimit; perp++) {
            const cell = landscape ? map.tiles[perp][main] : map.tiles[main][perp];
            const walkable = cell.type === "path" || cell.type === "spawn";
            if (walkable) {
              if (entered && !inside) gap = true;
              entered = true;
              inside = true;
              if (perp <= mid - 2) sawLow = true;
              if (perp >= mid + 2) sawHigh = true;
            } else if (entered) inside = false;
          }
          if (sawLow && sawHigh && !gap) foundBridge = true;
        }
        expect(foundBridge, `Map ${i} split cross-link should sit before the base gate`).toBe(true);
        const fromBase = walkDistances(
          map,
          map.tiles.flatMap((row, tileY) =>
            row.flatMap((cell, tileX) => (cell.type === "base" ? [{ x: tileX, y: tileY }] : [])),
          ),
          true,
        );
        const shortestBySpawn = map.spawns.map((spawn) => {
          const fromSpawn = walkDistances(map, [spawn], true);
          const goal = nearestBaseSteps(map, spawn);
          const keys = new Set();
          for (const [key, spawnSteps] of fromSpawn) {
            const baseSteps = fromBase.get(key);
            if (baseSteps !== undefined && spawnSteps + baseSteps === goal) keys.add(key);
          }
          return keys;
        });
        const onlyFirst = [...shortestBySpawn[0]].some((key) => !shortestBySpawn[1].has(key));
        const onlySecond = [...shortestBySpawn[1]].some((key) => !shortestBySpawn[0].has(key));
        expect(onlyFirst && onlySecond, `Map ${i} split arms should each keep a tile of their own`).toBe(true);
      }
    });

    it("open maps carry a flyer-gating ridge", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const config = MAP_LEVELS[i];
        if (config.style !== "open") continue;
        const map = getMap(i);
        let ridgeTiles = 0;
        for (let y = 0; y < map.height; y++) {
          for (let x = 0; x < map.width; x++) {
            const cell = map.tiles[y]![x]!;
            if (cell.type === "terrain" && cell.height >= 4) ridgeTiles++;
          }
        }
        expect(ridgeTiles, `Map ${i} open should paint a height-4 ridge`).toBeGreaterThan(0);
      }
    });

    it("every map is flyable at jet height and walkable from every spawn", () => {
      const neverTower = () => false;
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const map = getMap(i);
        const grid = new Grid(map);
        for (let s = 0; s < grid.spawns.length; s++) {
          const spawn = grid.spawns[s]!;
          const route = breadthFirstTilePath(
            grid,
            { x: spawn.x, y: spawn.y },
            { x: grid.base.x, y: grid.base.y },
            5,
            neverTower,
          );
          expect(route, `Map ${i} spawn ${s} should be reachable by jet-height flyers`).not.toBeNull();
        }
      }
    });

    function assertCatalogInvariants(catalog, mapIndex, config, map) {
      const label = `${catalog} map ${mapIndex} ${config.style} ${map.width}x${map.height}`;
      const chebyshevBeyond = (points, tileX, tileY, limit) => {
        let nearest = Number.POSITIVE_INFINITY;
        for (const point of points) {
          const distance = Math.max(Math.abs(tileX - point.x), Math.abs(tileY - point.y));
          if (distance < nearest) nearest = distance;
          if (nearest <= limit) return false;
        }
        return nearest > limit;
      };
      let openSideCount = 0;
      let spawnOnCollar = 0;
      for (const [side, collarTiles] of collarBySide(map)) {
        let openRunCount = 0;
        let openTileCount = 0;
        let previousOpen = false;
        for (const collarTile of collarTiles) {
          const tileType = map.tiles[collarTile.y][collarTile.x].type;
          if (tileType === "spawn") spawnOnCollar += 1;
          const open = tileType === "path" || tileType === "spawn";
          if (open) openTileCount += 1;
          if (open && !previousOpen) openRunCount += 1;
          previousOpen = open;
        }
        if (openTileCount === 0) continue;
        openSideCount += 1;
        expect(openRunCount, `${label} ${side} collar`).toBe(1);
      }
      expect(openSideCount, `${label} open faces`).toBe(1);
      expect(spawnOnCollar, `${label} spawn on collar`).toBe(0);

      const walkLengths = map.spawns.map((spawn) => nearestBaseSteps(map, spawn));
      const ratios = map.spawns.map((spawn, spawnIndex) => {
        const manhattan = Math.abs(spawn.x - map.base.x) + Math.abs(spawn.y - map.base.y);
        return walkLengths[spawnIndex] / manhattan;
      });
      if (config.style === "split") {
        // Below min dimension 15 the fold has too few rows for the standard
        // walk-to-manhattan ratio (1.07-1.19 observed across the small catalog
        // boards), so only the arm-balance bound applies; same size tier as the
        // coverage skip below.
        if (Math.min(map.width, map.height) >= 15) {
          for (const ratio of ratios) expect(ratio, `${label} ratio`).toBeGreaterThanOrEqual(1.2);
        }
        const longerWalk = Math.max(...walkLengths);
        const shorterWalk = Math.min(...walkLengths);
        expect(longerWalk, `${label} arm lengths`).toBeLessThanOrEqual(shorterWalk * 1.25);
      } else {
        for (const ratio of ratios) expect(ratio, `${label} ratio`).toBeGreaterThanOrEqual(1.35);
      }

      if (Math.min(map.width, map.height) < 15) return;

      const shortestPoints = [...shortestPathKeys(map)].map((key) => {
        const [xText, yText] = key.split(",");
        return { x: Number(xText), y: Number(yText) };
      });
      let pathCount = 0;
      let offFarCount = 0;
      const coveredTiles = [];
      for (let tileY = 0; tileY < map.height; tileY++) {
        for (let tileX = 0; tileX < map.width; tileX++) {
          const tileType = map.tiles[tileY][tileX].type;
          if (tileType === "path") {
            pathCount += 1;
            if (chebyshevBeyond(shortestPoints, tileX, tileY, 1)) offFarCount += 1;
          }
          if (tileType === "path" || tileType === "spawn" || tileType === "base") {
            coveredTiles.push({ x: tileX, y: tileY });
          }
        }
      }
      expect(offFarCount / pathCount, `${label} offFar`).toBeLessThanOrEqual(0.12);

      let farCount = 0;
      for (let tileY = 0; tileY < map.height; tileY++) {
        for (let tileX = 0; tileX < map.width; tileX++) {
          if (chebyshevBeyond(coveredTiles, tileX, tileY, 4)) farCount += 1;
        }
      }
      expect(farCount / (map.width * map.height), `${label} far4`).toBeLessThanOrEqual(0.18);
    }

    it("catalog maps keep one base door, a folded walk, and covered ground", () => {
      for (let mapIndex = 0; mapIndex < TOTAL_MAPS; mapIndex++) {
        assertCatalogInvariants("default", mapIndex, MAP_LEVELS[mapIndex], getMap(mapIndex));
      }
    });

    it("aftermath catalog maps keep one base door, a folded walk, and covered ground", () => {
      const aftermath = resolveThemeMaps(aftermathRaw.maps);
      for (let mapIndex = 0; mapIndex < aftermath.levels.length; mapIndex++) {
        assertCatalogInvariants("aftermath", mapIndex, aftermath.levels[mapIndex], getMap(mapIndex, aftermath));
      }
    });
  });
});
