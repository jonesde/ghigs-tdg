import { KNOCKBACK_BALLISTIC_SECONDS } from "@/sim/ConstantsEnemy.js";
import type { Enemy } from "@/sim/enemies/Enemy.js";

// Single knockback protocol: impulse + ballistic window + motion-lock release. Every
// knockback caller routes through here so parked enemies can be knocked (the lock is
// cleared; ContactProcessor re-parks next step when the contact is still live) and
// every launch gets the same crowd-suppression window. Crowd velocity itself is
// restored on window expiry by CrowdManager.update falling through to the steering
// write. Ballistic seconds override is test-only; production passes the tuned const.
export function launchEnemy(
  enemy: Enemy,
  impulseX: number,
  impulseY: number,
  ballisticSeconds: number = KNOCKBACK_BALLISTIC_SECONDS,
): void {
  if (!enemy.body || enemy.removed) return;
  enemy.body.applyImpulse({ x: impulseX, y: impulseY }, true);
  enemy.ballisticTimer = Math.max(enemy.ballisticTimer, ballisticSeconds);
  enemy.motionLock = "none";
}
