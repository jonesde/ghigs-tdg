export const TowerIds = {
  BASIC: "basic",
  ICE: "ice",
  SNIPER: "sniper",
  CANNON: "cannon",
  LIGHTNING: "lightning",
  RAILGUN: "railgun",
  STURDY_WALL: "sturdyWall",
  SHOTGUN_TANK: "shotgunTank",
} as const;

export type TowerId = (typeof TowerIds)[keyof typeof TowerIds];

// Card and HUD copy for a tower type. Theme visuals also carry display names, but
// the sim needs a name that does not depend on which theme is active.
export const towerTypeLabels: Record<TowerId, string> = {
  [TowerIds.BASIC]: "Basic",
  [TowerIds.ICE]: "Ice",
  [TowerIds.SNIPER]: "Sniper",
  [TowerIds.CANNON]: "Cannon",
  [TowerIds.LIGHTNING]: "Lightning",
  [TowerIds.RAILGUN]: "Railgun",
  [TowerIds.STURDY_WALL]: "Sturdy Wall",
  [TowerIds.SHOTGUN_TANK]: "Shotgun Tank",
};
