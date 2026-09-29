import type { CommanderMemory } from "@/commanders/brain.js";
import type { CommanderObservation, ObservationEnemy } from "@/commanders/observation.js";
import { createStubbyBrain } from "@/commanders/stubby/brain.js";
import type { Command } from "@/sim/Command.js";

type SyncBrain = { decide(observation: CommanderObservation, memory: CommanderMemory): Command[] };

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

function observation(opts: {
  currentWave: number;
  remainingScheduledSpawns: number;
  pendingEnemyCount?: number;
  enemies?: ObservationEnemy[];
}): CommanderObservation {
  const pendingEnemyCount = opts.pendingEnemyCount ?? 0;
  return {
    map: undefined,
    enemies: opts.enemies ?? [],
    towers: [],
    wave: {
      currentWave: opts.currentWave,
      pendingEnemyCount,
      spawnStates: [],
      remainingScheduledSpawns: opts.remainingScheduledSpawns,
      active: opts.remainingScheduledSpawns > 0,
      baseHealth: 20,
      maxBaseHealth: 20,
      countdownRemaining: null,
    },
  };
}

describe("StubbyBrain", () => {
  it("holds newly-seen enemies at their current tile while spawning", () => {
    const brain = createStubbyBrain() as unknown as SyncBrain;
    const memory = freshMemory();
    const commands = brain.decide(
      observation({ currentWave: 1, remainingScheduledSpawns: 3, enemies: [enemy(1, 2, 3), enemy(2, 4, 3)] }),
      memory,
    );
    expect(commands).toHaveLength(2);
    for (const command of commands) {
      expect(command.type).toBe("llm:routeGroup");
      if (command.type === "llm:routeGroup") {
        expect(command.hold).toBe(true);
        expect(command.enemyIds).toHaveLength(1);
        const id = command.enemyIds[0]!;
        const expectedTile = id === 1 ? { x: 2, y: 3 } : { x: 4, y: 3 };
        expect(command.holdTile).toEqual(expectedTile);
      }
    }
    expect(memory.seenByWave.get(1)).toEqual(new Set([1, 2]));
  });

  it("does not re-dispatch holds for already-seen enemies (idempotent)", () => {
    const brain = createStubbyBrain() as unknown as SyncBrain;
    const memory = freshMemory();
    brain.decide(observation({ currentWave: 1, remainingScheduledSpawns: 3, enemies: [enemy(1, 2, 3)] }), memory);
    const second = brain.decide(
      observation({ currentWave: 1, remainingScheduledSpawns: 2, enemies: [enemy(1, 2, 3)] }),
      memory,
    );
    expect(second).toHaveLength(0);
    expect(memory.seenByWave.get(1)).toEqual(new Set([1]));
  });

  it("emits exactly one empty-waypoint rush when the wave has fully emerged", () => {
    const brain = createStubbyBrain() as unknown as SyncBrain;
    const memory = freshMemory();
    brain.decide(
      observation({ currentWave: 1, remainingScheduledSpawns: 1, enemies: [enemy(1, 2, 3), enemy(2, 4, 3)] }),
      memory,
    );
    const rush = brain.decide(
      observation({
        currentWave: 1,
        remainingScheduledSpawns: 0,
        pendingEnemyCount: 0,
        enemies: [enemy(1, 2, 3), enemy(2, 4, 3)],
      }),
      memory,
    );
    expect(rush).toHaveLength(1);
    const command = rush[0]!;
    expect(command.type).toBe("llm:routeGroup");
    if (command.type === "llm:routeGroup") {
      expect(command.hold).toBe(false);
      expect(command.waypoints).toEqual([]);
      expect(command.enemyIds).toEqual([1, 2]);
    }
    expect(memory.seenByWave.get(1)).toBeUndefined();
    expect(memory.lastRushWaveNumber).toBe(1);
  });

  it("does NOT rush while remainingScheduledSpawns > 0", () => {
    const brain = createStubbyBrain() as unknown as SyncBrain;
    const memory = freshMemory();
    brain.decide(observation({ currentWave: 1, remainingScheduledSpawns: 5, enemies: [enemy(1, 2, 3)] }), memory);
    // Overflow pending cleared but wave still has scheduled spawns → no rush.
    const commands = brain.decide(
      observation({ currentWave: 1, remainingScheduledSpawns: 4, pendingEnemyCount: 0, enemies: [enemy(1, 2, 3)] }),
      memory,
    );
    expect(commands.some((c) => c.type === "llm:routeGroup" && c.hold === false)).toBe(false);
  });

  it("rush captures only the current wave's seen ids across a wave boundary", () => {
    const brain = createStubbyBrain() as unknown as SyncBrain;
    const memory = freshMemory();
    // Wave 1 holds enemies 1 and 2.
    brain.decide(
      observation({ currentWave: 1, remainingScheduledSpawns: 3, enemies: [enemy(1, 2, 3), enemy(2, 4, 3)] }),
      memory,
    );
    // Wave 2 begins spawning — enemy 3 is held, but wave 1's rush must not fire.
    brain.decide(observation({ currentWave: 2, remainingScheduledSpawns: 5, enemies: [enemy(3, 6, 3)] }), memory);
    expect(memory.seenByWave.get(1)).toEqual(new Set([1, 2]));
    expect(memory.seenByWave.get(2)).toEqual(new Set([3]));
    // Wave 2 fully emerges — the rush releases ONLY wave 2's ids (3), not wave 1's.
    const rush = brain.decide(
      observation({ currentWave: 2, remainingScheduledSpawns: 0, pendingEnemyCount: 0, enemies: [enemy(3, 6, 3)] }),
      memory,
    );
    expect(rush).toHaveLength(1);
    const command = rush[0]!;
    expect(command.type).toBe("llm:routeGroup");
    if (command.type === "llm:routeGroup") {
      expect(command.hold).toBe(false);
      expect(command.enemyIds).toEqual([3]);
    }
    // Wave 1's ids were never released — proven by their continued presence.
    expect(memory.seenByWave.get(1)).toEqual(new Set([1, 2]));
  });

  it("resets per wave: a fresh wave's enemies are not treated as already-seen", () => {
    const brain = createStubbyBrain() as unknown as SyncBrain;
    const memory = freshMemory();
    brain.decide(observation({ currentWave: 1, remainingScheduledSpawns: 3, enemies: [enemy(1, 2, 3)] }), memory);
    // New wave with a previously-seen id reused — it must be held again for the new wave.
    const commands = brain.decide(
      observation({ currentWave: 2, remainingScheduledSpawns: 3, enemies: [enemy(1, 2, 3)] }),
      memory,
    );
    const holds = commands.filter((c) => c.type === "llm:routeGroup" && c.hold === true);
    expect(holds).toHaveLength(1);
    if (holds[0]!.type === "llm:routeGroup") {
      expect(holds[0]!.enemyIds).toEqual([1]);
    }
    expect(memory.seenByWave.get(2)).toEqual(new Set([1]));
  });
});
