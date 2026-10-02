import type { RegionMapConnection, RegionMapLayout, RegionMapNode } from "@/render/themes/index.js";

export const mockRegionMapImage = '<svg viewBox="0 0 400 300"><rect width="400" height="300" fill="#223044"/></svg>';

const PROGRESSIVE_BRANCH_LEVELS = [1, 5, 9, 12];

function mockConnections(): RegionMapConnection[] {
  const chain: RegionMapConnection[] = [];
  for (let level = 1; level < 12; level++) {
    chain.push({ from: { kind: "level", level }, to: { kind: "level", level: level + 1 } });
  }
  const branches = PROGRESSIVE_BRANCH_LEVELS.map(
    (level): RegionMapConnection => ({ from: { kind: "level", level }, to: { kind: "progressive", level } }),
  );
  return [...chain, ...branches];
}

export function makeMockRegionMapLayout(): RegionMapLayout {
  const nodes: RegionMapNode[] = [];
  for (let level = 1; level <= 12; level++) {
    nodes.push({ kind: "level", level, x: 30 + ((level - 1) % 6) * 66, y: 80 + Math.floor((level - 1) / 6) * 140 });
  }
  for (const level of PROGRESSIVE_BRANCH_LEVELS) {
    const branchFrom = nodes.find((node) => node.kind === "level" && node.level === level);
    if (!branchFrom) continue;
    nodes.push({ kind: "progressive", level, x: branchFrom.x, y: branchFrom.y - 55 });
  }
  return { viewBox: "0 0 400 300", nodes, connections: mockConnections() };
}
