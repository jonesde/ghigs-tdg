// Tags attached to Rapier rigid bodies via userData so contact/event drains can
// resolve a collider back to a gameplay entity without scanning all managers.

export type ColliderTag =
  | { kind: "base" }
  | { kind: "tower"; towerId: string; tileX: number; tileY: number }
  | { kind: "enemy"; enemyId: number }
  | { kind: "projectile"; projectileId: number }
  | { kind: "corridor" }
  | { kind: "sensor"; sensorId: string; ownerId?: string };

export function isColliderTag(value: unknown): value is ColliderTag {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "base" ||
    kind === "tower" ||
    kind === "enemy" ||
    kind === "projectile" ||
    kind === "corridor" ||
    kind === "sensor"
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// Strict per-kind shape validation: every kind declares required fields and this
// returns null when any of them is missing or mistyped, so a malformed userData
// tag can never plant a phantom contact (e.g. a tower hit with no towerId parking
// an enemy forever). isColliderTag above stays kind-only for legacy callers.
export function parseColliderTag(value: unknown): ColliderTag | null {
  if (!isColliderTag(value)) return null;
  const candidate = value as Record<string, unknown>;
  switch (value.kind) {
    case "base":
    case "corridor":
      return value;
    case "tower":
      if (!isNonEmptyString(candidate.towerId)) return null;
      if (!isFiniteNumber(candidate.tileX) || !isFiniteNumber(candidate.tileY)) return null;
      return value;
    case "enemy":
      if (!isFiniteNumber(candidate.enemyId)) return null;
      return value;
    case "projectile":
      if (!isFiniteNumber(candidate.projectileId)) return null;
      return value;
    case "sensor":
      if (!isNonEmptyString(candidate.sensorId)) return null;
      if (candidate.ownerId !== undefined && typeof candidate.ownerId !== "string") return null;
      return value;
  }
}
