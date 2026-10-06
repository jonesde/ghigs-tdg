export interface RegionMapNodeView {
  kind: "level" | "progressive";
  level: number;
  x: number;
  y: number;
  label: string;
  tooltip: string;
  locked: boolean;
  mapIndex: number;
  bestWave: number;
  cleared: boolean;
}
