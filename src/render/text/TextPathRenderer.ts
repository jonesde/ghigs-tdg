import type { SimulationSnapshot } from "@/sim/SimulationSnapshot.js";
import { type TextRenderScale, textPixelX, textPixelY } from "./types.js";

const PATH_COLOR = "rgba(255,255,255,0.4)";
const PATH_LINE_WIDTH = 1.5;

interface CorridorGeometry {
  positions: number[];
  indices: number[];
}

// Counts each undirected vertex-index edge over the triangle list and keeps only
// the edges used by exactly one triangle: the corridor's boundary silhouette.
// Interior edges (used twice) are skipped, so the walkable area reads as an
// outline instead of a wireframe. Edges shared across Recast tile seams carry
// duplicated vertex indices, so those seam edges count once and are drawn; that
// is the limit of index-based boundary detection.
function buildBoundarySegments(corridor: CorridorGeometry): number[] {
  const { positions, indices } = corridor;
  const vertexCount = positions.length / 2;
  const edgeCounts = new Map<number, number>();
  const edgeKey = (firstVertex: number, secondVertex: number): number =>
    firstVertex < secondVertex ? firstVertex * vertexCount + secondVertex : secondVertex * vertexCount + firstVertex;

  const countEdge = (firstVertex: number, secondVertex: number): void => {
    const key = edgeKey(firstVertex, secondVertex);
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  };

  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const vertexA = indices[triangle]!;
    const vertexB = indices[triangle + 1]!;
    const vertexC = indices[triangle + 2]!;
    countEdge(vertexA, vertexB);
    countEdge(vertexB, vertexC);
    countEdge(vertexC, vertexA);
  }

  const segments: number[] = [];
  const emitBoundaryEdge = (firstVertex: number, secondVertex: number): void => {
    if (edgeCounts.get(edgeKey(firstVertex, secondVertex)) !== 1) return;
    const firstOffset = firstVertex * 2;
    const secondOffset = secondVertex * 2;
    segments.push(
      positions[firstOffset]!,
      positions[firstOffset + 1]!,
      positions[secondOffset]!,
      positions[secondOffset + 1]!,
    );
  };

  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const vertexA = indices[triangle]!;
    const vertexB = indices[triangle + 1]!;
    const vertexC = indices[triangle + 2]!;
    emitBoundaryEdge(vertexA, vertexB);
    emitBoundaryEdge(vertexB, vertexC);
    emitBoundaryEdge(vertexC, vertexA);
  }
  return segments;
}

// Draws the worker-authoritative walkable navmesh corridor as a faint outline on
// the minimap canvas overlay. The worker ships `snapshot.navMeshCorridor` (a
// walkable triangle mesh in game (x,y) vertex pairs + indices) only on a
// pathVersion change and `null` between those posts, so we cache the last
// non-null copy and keep drawing it across omitted frames. The boundary segment
// list is derived once per corridor object identity — every non-null arrival is a
// fresh structured clone, so identity change == new geometry — and world
// coordinates are converted with the current scale each frame (progressive origin
// shifts move `originX/Y` without changing the corridor).
export class TextPathRenderer {
  private lastCorridor: CorridorGeometry | null = null;
  private boundarySegments: number[] | null = null;
  private boundarySegmentsFor: CorridorGeometry | null = null;

  render(ctx: CanvasRenderingContext2D, snapshot: SimulationSnapshot, scale: TextRenderScale): void {
    if (snapshot.navMeshCorridor) {
      this.lastCorridor = snapshot.navMeshCorridor;
    }
    const corridor = this.lastCorridor;
    if (!corridor) return;

    let segments = this.boundarySegments;
    if (segments === null || this.boundarySegmentsFor !== corridor) {
      segments = buildBoundarySegments(corridor);
      this.boundarySegments = segments;
      this.boundarySegmentsFor = corridor;
    }

    ctx.strokeStyle = PATH_COLOR;
    ctx.lineWidth = PATH_LINE_WIDTH;
    ctx.beginPath();
    for (let index = 0; index < segments.length; index += 4) {
      ctx.moveTo(textPixelX(segments[index]!, scale), textPixelY(segments[index + 1]!, scale));
      ctx.lineTo(textPixelX(segments[index + 2]!, scale), textPixelY(segments[index + 3]!, scale));
    }
    ctx.stroke();
  }
}
