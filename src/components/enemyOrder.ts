// The roster as the UI presents it: ground units, then the airborne types, then
// the boss. Written out rather than taken from the pack key order because the
// help table and the stats composition list both read it as the display order,
// and the pack interleaves the airborne types with the ground ones.
export const enemyOrder: readonly string[] = [
  "minion",
  "runner",
  "tank",
  "shielded",
  "healer",
  "mender",
  "flyer",
  "jet",
  "aegis",
  "skyhold",
  "broodwing",
  "boss",
];
