// An aviary raises every damage number its neighbours deal to a flying target, and
// only those, so the multiplier is read per hit rather than folded into tower damage
// (the same shot has to stay worth its base value against a ground enemy). Shared by
// the projectile pipeline and by the tower's own damage sources — electric fence and
// thorn reflect — so one rule decides what an aviary is worth everywhere.
export function damageAgainstFlying(
  damage: number,
  flyingDamageMult: number,
  flyingHeight: number | undefined,
): number {
  if (!flyingHeight || flyingDamageMult === 1) return damage;
  return damage * flyingDamageMult;
}
