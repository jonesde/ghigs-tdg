import type { SimulationSnapshot } from "@/sim/SimulationSnapshot.js";
import { type TextRenderScale, textPixelX, textPixelY } from "./types.js";

const PATH_COLOR = "rgba(255,255,255,0.4)";
const PATH_LINE_WIDTH = 1.5;

// Draws the worker-authoritative walkable navmesh corridor as a faint line on
// the minimap canvas overlay. The worker ships `snapshot.navMeshCorridor` (a
// walkable triangle mesh in game (x,y) vertex pairs + indices); we stroke each
// triangle's edges as the faint overlay so the walkable area is shown. The
// corridor is `null` on ticks where the route has not changed (the worker omits
// it), so we cache the last non-null copy and keep drawing it across omitted frames.
export class TextPathRenderer {
  private lastCorridor: { positions: number[]; indices: number[] } | null = null;

  render(ctx: CanvasRenderingContext2D, snapshot: SimulationSnapshot, scale: TextRenderScale): void {
    if (snapshot.navMeshCorridor) {
      this.lastCorridor = snapshot.navMeshCorridor;
    }
    if (!this.lastCorridor) return;
    this.renderCorridor(ctx, this.lastCorridor, scale);
  }

  // Strokes each corridor triangle's three edges as a faint outline. Positions
  // are game (x,y) pairs already in world units; indices reference vertex pairs.
  private renderCorridor(
    ctx: CanvasRenderingContext2D,
    corridor: { positions: number[]; indices: number[] },
    scale: TextRenderScale,
  ): void {
    const { positions, indices } = corridor;
    ctx.strokeStyle = PATH_COLOR;
    ctx.lineWidth = PATH_LINE_WIDTH;
    for (let triangle = 0; triangle < indices.length; triangle += 3) {
      const a = indices[triangle]! * 2;
      const b = indices[triangle + 1]! * 2;
      const c = indices[triangle + 2]! * 2;
      ctx.beginPath();
      ctx.moveTo(textPixelX(positions[a]!, scale), textPixelY(positions[a + 1]!, scale));
      ctx.lineTo(textPixelX(positions[b]!, scale), textPixelY(positions[b + 1]!, scale));
      ctx.lineTo(textPixelX(positions[c]!, scale), textPixelY(positions[c + 1]!, scale));
      ctx.closePath();
      ctx.stroke();
    }
  }
}
