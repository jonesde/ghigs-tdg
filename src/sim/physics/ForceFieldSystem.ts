import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { PhysicsWorld } from "./PhysicsWorld.js";

export type ForceFieldMode = "radial" | "directional";

export interface ForceField {
  id: string;
  origin: { x: number; y: number };
  radius: number;
  mode: ForceFieldMode;
  // Continuous force magnitude. Radial: positive = push outward, negative = pull.
  strength: number;
  direction?: { x: number; y: number };
  ownerId?: string;
}

// Registers continuous push/pull fields applied each tick via Rapier addForce.
// No tower types ship yet; callers register fields directly (tests + future towers).
export class ForceFieldSystem {
  private fields = new Map<string, ForceField>();

  addField(field: ForceField): void {
    this.fields.set(field.id, field);
  }

  removeField(fieldId: string): void {
    this.fields.delete(fieldId);
  }

  clearOwner(ownerId: string): void {
    for (const [fieldId, field] of this.fields) {
      if (field.ownerId === ownerId) this.fields.delete(fieldId);
    }
  }

  clear(): void {
    this.fields.clear();
  }

  getFields(): ForceField[] {
    return Array.from(this.fields.values());
  }

  // Soft velocity bias for optional blend with crowd desired velocity (world units/sec).
  sampleVelocityBias(enemy: Enemy): { x: number; y: number } {
    let biasX = 0;
    let biasY = 0;
    for (const field of this.fields.values()) {
      const sample = this.sampleFieldAt(field, enemy.x, enemy.y);
      if (!sample) continue;
      // Convert force-ish strength into a small velocity bias; full force is applied
      // via addForce in apply(). Bias keeps crowd steering from fully cancelling fields.
      const biasScale = 0.05;
      biasX += sample.forceX * biasScale;
      biasY += sample.forceY * biasScale;
    }
    return { x: biasX, y: biasY };
  }

  // Applies continuous forces to live enemy bodies. Re-applied each tick so Rapier
  // integrates them during step even when crowd resets linvel next frame.
  apply(_deltaSeconds: number, enemies: Enemy[], physicsWorld?: PhysicsWorld | null): void {
    if (this.fields.size === 0) return;
    if (physicsWorld) {
      for (const field of this.fields.values()) {
        physicsWorld.forEachEnemyInRange(field.origin.x, field.origin.y, field.radius, (enemy) => {
          if (enemy.removed || !enemy.body) return;
          if (enemy.ballisticTimer > 0) return;
          if (enemy.motionLock === "park") return;
          const sample = this.sampleFieldAt(field, enemy.x, enemy.y);
          if (!sample) return;
          enemy.body.addForce({ x: sample.forceX, y: sample.forceY }, true);
        });
      }
      return;
    }
    for (const enemy of enemies) {
      if (enemy.removed || !enemy.body) continue;
      if (enemy.ballisticTimer > 0) continue;
      if (enemy.motionLock === "park") continue;
      let totalForceX = 0;
      let totalForceY = 0;
      for (const field of this.fields.values()) {
        const sample = this.sampleFieldAt(field, enemy.x, enemy.y);
        if (!sample) continue;
        totalForceX += sample.forceX;
        totalForceY += sample.forceY;
      }
      if (totalForceX !== 0 || totalForceY !== 0) {
        enemy.body.addForce({ x: totalForceX, y: totalForceY }, true);
      }
    }
  }

  private sampleFieldAt(field: ForceField, pointX: number, pointY: number): { forceX: number; forceY: number } | null {
    const deltaX = pointX - field.origin.x;
    const deltaY = pointY - field.origin.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance > field.radius || field.radius <= 0) return null;
    // Falloff: full strength at center, zero at edge.
    const falloff = 1 - distance / field.radius;
    if (field.mode === "directional") {
      const directionX = field.direction?.x ?? 1;
      const directionY = field.direction?.y ?? 0;
      const directionLength = Math.hypot(directionX, directionY) || 1;
      return {
        forceX: (directionX / directionLength) * field.strength * falloff,
        forceY: (directionY / directionLength) * field.strength * falloff,
      };
    }
    // Radial: positive strength pushes outward; at exact center no direction.
    if (distance < 1e-6) return null;
    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    return { forceX: unitX * field.strength * falloff, forceY: unitY * field.strength * falloff };
  }
}
