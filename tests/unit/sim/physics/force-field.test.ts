import { beforeAll, describe, expect, it } from "vitest";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { Grid } from "@/sim/grid/Grid.js";
import { ForceFieldSystem } from "@/sim/physics/ForceFieldSystem.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { initPhysics } from "@/sim/physics/rapierContext.js";
import { fixedDeltaSeconds } from "@/sim/stepBudget.js";
import { makeBastionMap } from "../../../helpers/mock-grid.js";

beforeAll(async () => {
  await initPhysics();
});

describe("ForceFieldSystem", () => {
  it("applies radial push so an enemy accelerates outward", () => {
    const grid = new Grid(makeBastionMap());
    const physics = new PhysicsWorld(grid);
    const enemy = new Enemy("minion", 1, 0, grid, 1, 0, null, null, null);
    // Place enemy near origin of field.
    enemy.x = 100;
    enemy.y = 100;
    enemy.centerX = 100;
    enemy.centerY = 100;
    physics.addEnemy(enemy);

    const fields = new ForceFieldSystem();
    fields.addField({ id: "push", origin: { x: 100, y: 100 }, radius: 80, mode: "radial", strength: 5000 });

    // Offset slightly so radial has a direction.
    enemy.body!.setTranslation({ x: 110, y: 100 }, true);
    enemy.x = 110;
    enemy.y = 100;
    enemy.body!.setLinvel({ x: 0, y: 0 }, true);

    fields.apply(fixedDeltaSeconds, [enemy]);
    physics.step();

    const velocity = enemy.body!.linvel();
    // Pushed outward along +x from field center.
    expect(velocity.x).toBeGreaterThan(0);

    physics.dispose();
  });

  it("tanks resist push more than runners (mass)", () => {
    const grid = new Grid(makeBastionMap());
    const physics = new PhysicsWorld(grid);
    const runner = new Enemy("runner", 1, 0, grid, 1, 0, null, null, null);
    const tank = new Enemy("tank", 1, 0, grid, 1, 0, null, null, null);
    for (const enemy of [runner, tank]) {
      enemy.x = 110;
      enemy.y = 100;
      enemy.centerX = 110;
      enemy.centerY = 100;
      physics.addEnemy(enemy);
      enemy.body!.setLinvel({ x: 0, y: 0 }, true);
    }

    const fields = new ForceFieldSystem();
    fields.addField({ id: "push", origin: { x: 100, y: 100 }, radius: 80, mode: "radial", strength: 8000 });

    fields.apply(fixedDeltaSeconds, [runner, tank]);
    physics.step();

    const runnerSpeed = Math.hypot(runner.body!.linvel().x, runner.body!.linvel().y);
    const tankSpeed = Math.hypot(tank.body!.linvel().x, tank.body!.linvel().y);
    expect(runnerSpeed).toBeGreaterThan(tankSpeed);

    physics.dispose();
  });

  it("clearOwner removes only that owner's fields", () => {
    const fields = new ForceFieldSystem();
    fields.addField({ id: "a", origin: { x: 0, y: 0 }, radius: 10, mode: "radial", strength: 1, ownerId: "tower-1" });
    fields.addField({ id: "b", origin: { x: 0, y: 0 }, radius: 10, mode: "radial", strength: 1, ownerId: "tower-2" });
    fields.clearOwner("tower-1");
    expect(fields.getFields()).toHaveLength(1);
    expect(fields.getFields()[0]!.id).toBe("b");
  });
});
