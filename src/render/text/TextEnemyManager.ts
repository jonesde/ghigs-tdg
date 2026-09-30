import type { EnemySnapshot } from "@/sim/SimulationSnapshot.js";
import { type TextRenderScale, type TextThemeAccess, textPixelX, textPixelY } from "./types.js";

// Draws each enemy's theme glyph at its scaled *continuous* world position
// (enemy.x / enemy.y), converted to canvas px via the shared scale. Enemies
// move smoothly, so the glyph tracks the enemy rather than snapping to a tile
// center. Bosses are drawn with their theme `shape` glyph — there is no
// special-casing on `isBoss` here (keying by theme `shape` keeps the minimap
// in sync with theme changes automatically).
export class TextEnemyManager {
  render(
    ctx: CanvasRenderingContext2D,
    enemies: EnemySnapshot[],
    themeAccess: TextThemeAccess,
    scale: TextRenderScale,
  ): void {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const enemy of enemies) {
      const visual = themeAccess.getEnemyVisual(enemy.type);
      const shape = visual?.shape ?? "circle";
      const color = visual?.color ?? "#ffffff";
      const glyph = themeAccess.getEnemyGlyph(shape);
      const pixelX = textPixelX(enemy.x, scale);
      const pixelY = textPixelY(enemy.y, scale);
      ctx.fillStyle = color;
      ctx.fillText(glyph, pixelX, pixelY);
    }
  }
}
