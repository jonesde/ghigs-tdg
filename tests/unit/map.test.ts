// @ts-nocheck
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { MAP_GEM_MULTIPLIERS, MAP_LEVELS, TOTAL_MAPS } from "@/sim/Constants.js";
import { BOSS_CADENCE } from "@/sim/ConstantsEnemy.js";
import { breadthFirstTilePath } from "@/sim/enemies/flightGrid.js";
import { Grid } from "@/sim/grid/Grid.js";
import { generateRandomMap, getMap, invalidateMapCache } from "@/sim/grid/Map.js";
import { orderedPath } from "../helpers/navmesh-test-utils.js";

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
          const isBaseGoal = goalTiles.some((g) => g.x === last.x && g.y === last.y);
          expect(isBaseGoal, `Map ${i}, spawn ${s} path should end on a base/perimeter tile`).toBe(true);
        }
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
          if (map1.tiles[y][x].type !== map2.tiles[y][x].type) different = true;
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

    it("bastion staging hugs the base-side half of the map", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const config = MAP_LEVELS[i];
        if (config.style !== "bastion") continue;
        const map = getMap(i);
        const base = map.base;
        const isLandscape = map.width > map.height;
        const spawn = map.spawns[0]!;
        if (isLandscape) {
          // Spawn on the west half, base in the east: the detour + staging sit between.
          expect(spawn.x, `Map ${i} bastion spawn x`).toBeLessThan(base.x - 2);
          const stagingCol = Math.floor((spawn.x + base.x) / 2);
          let stagingHeight = 0;
          for (let y = 0; y < map.height; y++) {
            if (map.tiles[y]![stagingCol]!.type === "path") stagingHeight++;
          }
          expect(stagingHeight, `Map ${i} bastion staging height`).toBeGreaterThanOrEqual(3);
        } else {
          expect(spawn.y, `Map ${i} bastion spawn y`).toBeLessThan(base.y - 2);
          // The staging rectangle sits just north of the apex: measure its
          // width on the row above the apex instead of the midpoint row, which
          // can land on the single-tile notch corridor.
          const stagingRow = Math.max(1, base.y - Math.max(4, Math.floor(map.height * 0.3)) - 2);
          let stagingWidth = 0;
          for (let x = 0; x < map.width; x++) {
            if (map.tiles[stagingRow]![x]!.type === "path") stagingWidth++;
          }
          expect(stagingWidth, `Map ${i} bastion staging width`).toBeGreaterThanOrEqual(5);
        }
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
          if (map1.tiles[y][x].type !== map2.tiles[y][x].type) different = true;
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
    it("split maps join their arms with a cross-link", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const config = MAP_LEVELS[i];
        if (config.style !== "split") continue;
        const map = getMap(i);
        const grid = new Grid(map);
        // Both spawns reach the base (orderedPath covers this), and the arms
        // share walkable ground mid-map: BFS from spawn 0 visits spawn 1's
        // corridor through the cross-link.
        const start = grid.spawns[0]!;
        const other = grid.spawns[1]!;
        const visited = new Set<string>([`${start.x},${start.y}`]);
        const queue = [{ x: start.x, y: start.y }];
        while (queue.length > 0) {
          const current = queue.shift()!;
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
            queue.push(neighbor);
          }
        }
        expect(visited.has(`${other.x},${other.y}`), `Map ${i} split arms should connect`).toBe(true);
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
  });
});
