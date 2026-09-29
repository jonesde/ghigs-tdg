import { describe, expect, it } from "vitest";
import type { CommanderMemory } from "@/commanders/brain.js";
import type {
  CommanderObservation,
  ObservationEnemy,
  ObservationNav,
  ObservationTower,
} from "@/commanders/observation.js";
import { createStubbsBrain } from "@/commanders/stubbs/brain.js";
import type { Command } from "@/sim/Command.js";

type SyncBrain = { decide(observation: CommanderObservation, memory: CommanderMemory): Command[] };

import { makeBastionMap } from "../../helpers/mock-grid.js";

// Build a commander gridLayout (0=terrain,1=path,2=base,3=spawn) from the bastion
// mock map: a single straight path row with the base at the right edge.
const bastionMap = makeBastionMap();
const gridLayout: number[][] = bastionMap.tiles.map((row) =>
  row.map((tile) => (tile.type === "path" ? 1 : tile.type === "base" ? 2 : tile.type === "spawn" ? 3 : 0)),
);

// Tower-aware distance field: BFS from base over path tiles (no towers blocked
// in these unit tests). Mirrors NavDistanceField output shape.
function buildOpenDistanceField(): number[][] {
  const height = gridLayout.length;
  const width = gridLayout[0]?.length ?? 0;
  const distances: number[][] = Array.from({ length: height }, () => Array(width).fill(-1) as number[]);
  const queue: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gridLayout[y]![x] === 2) {
        distances[y]![x] = 0;
        queue.push({ x, y });
      }
    }
  }
  const offsets = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head]!;
    head += 1;
    const currentDistance = distances[current.y]![current.x]!;
    for (const offset of offsets) {
      const nextX = current.x + offset.x;
      const nextY = current.y + offset.y;
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
      const tileValue = gridLayout[nextY]![nextX];
      if (tileValue === undefined || tileValue === 0) continue;
      if (distances[nextY]![nextX] !== -1) continue;
      distances[nextY]![nextX] = currentDistance + 1;
      queue.push({ x: nextX, y: nextY });
    }
  }
  return distances;
}

const openNav: ObservationNav = { pathVersion: 0, distanceToBase: buildOpenDistanceField(), spawnReachable: [true] };

function freshMemory(): CommanderMemory {
  return {
    phase: "idle",
    seenByWave: new Map<number, Set<number>>(),
    lastRushWaveNumber: null,
    lastRoutedTowerSignature: "",
    gridLayout: undefined,
    conversation: [],
    tokenCount: 0,
    lastObservation: null,
    commanderInstructions: "",
    pendingPlayerMessages: [],
    isCompressing: false,
    rejectionNote: null,
  };
}

function enemy(id: number, tileX: number, tileY: number): ObservationEnemy {
  return { id, tileX, tileY, level: 1, hp: 10, maxHp: 10 };
}

function tower(tileX: number, tileY: number, hp: number, maxHp = hp, level = 1): ObservationTower {
  return { tileX, tileY, level, hp, maxHp };
}

function observation(opts: {
  currentWave?: number;
  enemies?: ObservationEnemy[];
  towers?: ObservationTower[];
  nav?: ObservationNav | undefined;
}): CommanderObservation {
  return {
    map: gridLayout,
    enemies: opts.enemies ?? [],
    towers: opts.towers ?? [],
    wave: {
      currentWave: opts.currentWave ?? 1,
      pendingEnemyCount: 0,
      spawnStates: [],
      remainingScheduledSpawns: 0,
      active: true,
      baseHealth: 20,
      maxBaseHealth: 20,
      countdownRemaining: null,
    },
    nav: opts.nav === undefined ? openNav : opts.nav,
  };
}

function siegeTowerTile(commands: Command[]) {
  const command = commands.find((c) => c.type === "llm:siegeTower");
  if (command?.type !== "llm:siegeTower") return null;
  return command.towerTile;
}

describe("StubbsBrain", () => {
  it("sieges newly-seen enemies immediately (no hold) toward the highest-hp ahead tower", () => {
    const brain = createStubbsBrain() as unknown as SyncBrain;
    const memory = freshMemory();
    const commands = brain.decide(
      observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100), tower(3, 3, 60)] }),
      memory,
    );
    const hold = commands.find((c) => c.type === "llm:routeGroup" && c.hold === true);
    expect(hold).toBeUndefined();
    const target = siegeTowerTile(commands);
    expect(target).toEqual({ x: 5, y: 3 });
  });

  it("excludes towers behind the group and keeps the behind tower untargeted", () => {
    const brain = createStubbsBrain() as unknown as SyncBrain;
    const memory = freshMemory();
    const commands = brain.decide(
      observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100), tower(0, 3, 200)] }),
      memory,
    );
    expect(siegeTowerTile(commands)).toEqual({ x: 5, y: 3 });
  });

  it("emits no command when no live towers are ahead (default pathing)", () => {
    const brain = createStubbsBrain() as unknown as SyncBrain;
    const memory = freshMemory();
    const commands = brain.decide(observation({ enemies: [enemy(1, 2, 3)], towers: [tower(0, 3, 200)] }), memory);
    expect(commands).toHaveLength(0);
  });

  it("emits no command when nav field is missing", () => {
    const brain = createStubbsBrain() as unknown as SyncBrain;
    const memory = freshMemory();
    const bare: CommanderObservation = {
      map: gridLayout,
      enemies: [enemy(1, 1, 3)],
      towers: [tower(5, 3, 100)],
      wave: {
        currentWave: 1,
        pendingEnemyCount: 0,
        spawnStates: [],
        remainingScheduledSpawns: 0,
        active: true,
        baseHealth: 20,
        maxBaseHealth: 20,
        countdownRemaining: null,
      },
    };
    expect(brain.decide(bare, memory)).toHaveLength(0);
  });

  it("does NOT re-route when only a tower's hp changes (stable signature)", () => {
    const brain = createStubbsBrain() as unknown as SyncBrain;
    const memory = freshMemory();
    brain.decide(observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100), tower(3, 3, 60)] }), memory);
    const reroute = brain.decide(
      observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 30), tower(3, 3, 60)] }),
      memory,
    );
    expect(reroute).toHaveLength(0);
  });

  it("re-routes when a tower is upgraded (level change shifts the signature)", () => {
    const brain = createStubbsBrain() as unknown as SyncBrain;
    const memory = freshMemory();
    brain.decide(
      observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100, 100, 1), tower(3, 3, 60, 60, 1)] }),
      memory,
    );
    const reroute = brain.decide(
      observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100, 100, 2), tower(3, 3, 60, 60, 1)] }),
      memory,
    );
    expect(siegeTowerTile(reroute)).toEqual({ x: 5, y: 3 });
  });

  it("is idempotent per wave: a second identical observation emits nothing", () => {
    const brain = createStubbsBrain() as unknown as SyncBrain;
    const memory = freshMemory();
    brain.decide(observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100)] }), memory);
    const second = brain.decide(observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100)] }), memory);
    expect(second).toHaveLength(0);
  });

  it("resets across waves: a new wave's unseen enemy is routed", () => {
    const brain = createStubbsBrain() as unknown as SyncBrain;
    const memory = freshMemory();
    brain.decide(observation({ currentWave: 1, enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100)] }), memory);
    const next = brain.decide(
      observation({ currentWave: 2, enemies: [enemy(2, 1, 3)], towers: [tower(5, 3, 100)] }),
      memory,
    );
    expect(siegeTowerTile(next)).toEqual({ x: 5, y: 3 });
  });
});
