import type { BaseSentrySnapshot, TowerSnapshot } from "@/sim/SimulationSnapshot.js";
import { type TextRenderScale, type TextThemeAccess, textPixelX, textPixelY } from "./types.js";

// Draws each tower's theme icon at its world center. The snapshot already stores that
// center on tower.x / tower.y, and the scale subtracts a progressive world origin.
export class TextTowerManager {
  render(
    ctx: CanvasRenderingContext2D,
    towers: TowerSnapshot[],
    themeAccess: TextThemeAccess,
    scale: TextRenderScale,
  ): void {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const tower of towers) {
      const visual = themeAccess.getTowerVisual(tower.type);
      const icon = visual?.icon ?? "T";
      const color = visual?.color ?? "#ffffff";
      const pixelX = textPixelX(tower.x, scale);
      const pixelY = textPixelY(tower.y, scale);
      ctx.fillStyle = color;
      ctx.fillText(icon, pixelX, pixelY);
    }
  }

  renderBaseSentries(
    ctx: CanvasRenderingContext2D,
    sentries: BaseSentrySnapshot[],
    themeAccess: TextThemeAccess,
    scale: TextRenderScale,
  ): void {
    if (sentries.length === 0) return;
    const visual = themeAccess.getTowerVisual("basic");
    const icon = visual?.icon ?? "T";
    const color = visual?.color ?? "#ffffff";
    const previousFont = ctx.font;
    ctx.font = previousFont.replace(/(\d+(?:\.\d+)?)px/, (_match, size: string) => `${Number(size) * 0.55}px`);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    for (const sentry of sentries) {
      ctx.fillText(icon, textPixelX(sentry.x, scale), textPixelY(sentry.y, scale));
    }
    ctx.font = previousFont;
  }
}
