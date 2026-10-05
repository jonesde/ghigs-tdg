import type { BuildingKind } from "@/sim/mapSites.js";
import { BUILDING_COLORS } from "@/sim/mapSites.js";
import type { SimulationSnapshot } from "@/sim/SimulationSnapshot.js";
import { type TextRenderScale, textPixelX, textPixelY } from "./types.js";

const BUILDING_LETTERS: Record<BuildingKind, string> = {
  armory: "A",
  magazine: "M",
  beacon: "B",
  foundry: "F",
  clocktower: "C",
  aviary: "V",
};

function buildingLetter(kind: BuildingKind): string {
  return BUILDING_LETTERS[kind];
}

const HP_BAR_HALF_WIDTH = 6;
const HP_BAR_OFFSET = 8;
const PROJECTILE_RADIUS = 1.5;

// Canvas overlay for the thin "minimized" effects: projectile dots, enemy HP
// bars, lightning lines, and stun marks. Mirrors the SVG ProjectileManager +
// UiOverlayManager + EffectManager but with dots/lines only — no sprites,
// particles, range circles, or build preview.
export class TextOverlayRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    snapshot: SimulationSnapshot,
    scale: TextRenderScale,
    showPhysicsDebug = false,
  ): void {
    if (showPhysicsDebug) {
      this.renderPhysicsDebug(ctx, snapshot, scale);
      this.renderNextCorners(ctx, snapshot, scale);
    }
    this.renderProjectiles(ctx, snapshot, scale);
    this.renderSites(ctx, snapshot, scale);
    this.renderHealthBars(ctx, snapshot, scale);
    this.renderLightning(ctx, snapshot, scale);
    this.renderStuns(ctx, snapshot, scale);
  }

  private renderPhysicsDebug(
    ctx: CanvasRenderingContext2D,
    snapshot: SimulationSnapshot,
    scale: TextRenderScale,
  ): void {
    const vertices = snapshot.debugPhysics?.vertices;
    if (!vertices || vertices.length < 4) return;
    ctx.strokeStyle = "rgba(80, 200, 255, 0.85)";
    ctx.lineWidth = 1.5;
    for (let index = 0; index + 3 < vertices.length; index += 4) {
      ctx.beginPath();
      ctx.moveTo(textPixelX(vertices[index]!, scale), textPixelY(vertices[index + 1]!, scale));
      ctx.lineTo(textPixelX(vertices[index + 2]!, scale), textPixelY(vertices[index + 3]!, scale));
      ctx.stroke();
    }
  }

  private renderNextCorners(ctx: CanvasRenderingContext2D, snapshot: SimulationSnapshot, scale: TextRenderScale): void {
    ctx.strokeStyle = "rgba(255, 220, 80, 0.7)";
    ctx.lineWidth = 1;
    for (const enemy of snapshot.enemies) {
      const corner = enemy.nextCorner;
      if (!corner) continue;
      ctx.beginPath();
      ctx.moveTo(textPixelX(enemy.x, scale), textPixelY(enemy.y, scale));
      ctx.lineTo(textPixelX(corner.x, scale), textPixelY(corner.y, scale));
      ctx.stroke();
    }
  }

  private renderProjectiles(ctx: CanvasRenderingContext2D, snapshot: SimulationSnapshot, scale: TextRenderScale): void {
    for (const projectile of snapshot.projectiles) {
      const pixelX = textPixelX(projectile.x, scale);
      const pixelY = textPixelY(projectile.y, scale);
      ctx.fillStyle = projectile.color || "#ffffff";
      ctx.beginPath();
      ctx.arc(pixelX, pixelY, PROJECTILE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderSites(ctx: CanvasRenderingContext2D, snapshot: SimulationSnapshot, scale: TextRenderScale): void {
    const meta = snapshot.meta;
    if (!meta) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.max(8, 11 * scale.scaleY)}px sans-serif`;
    for (const drop of meta.supplyDrops ?? []) {
      ctx.fillStyle = "#e0c040";
      ctx.fillText("$", textPixelX(drop.worldX, scale), textPixelY(drop.worldY, scale));
    }
    for (const cache of meta.mapCaches ?? []) {
      ctx.fillStyle = "#c08050";
      ctx.fillText("C", textPixelX(cache.worldX, scale), textPixelY(cache.worldY, scale));
      if (cache.hp >= cache.maxHp) continue;
      const fraction = cache.maxHp > 0 ? Math.max(0, Math.min(1, cache.hp / cache.maxHp)) : 0;
      const centerX = textPixelX(cache.worldX, scale);
      const topY = textPixelY(cache.worldY, scale) - HP_BAR_OFFSET * scale.scaleY;
      const barWidth = HP_BAR_HALF_WIDTH * scale.scaleX;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX - barWidth, topY);
      ctx.lineTo(centerX + barWidth, topY);
      ctx.stroke();
      ctx.strokeStyle = fraction > 0.5 ? "#00ff00" : fraction > 0.25 ? "#ffff00" : "#ff0000";
      ctx.beginPath();
      ctx.moveTo(centerX - barWidth, topY);
      ctx.lineTo(centerX - barWidth + barWidth * 2 * fraction, topY);
      ctx.stroke();
    }
    for (const building of meta.mapBuildings ?? []) {
      ctx.fillStyle = BUILDING_COLORS[building.kind];
      // An unpowered building pays nothing, so the letter fades with it. The
      // enclosing save()/restore() puts alpha back for the next frame.
      ctx.globalAlpha = building.active ? 1 : 0.45;
      ctx.fillText(
        buildingLetter(building.kind),
        textPixelX(building.worldX, scale),
        textPixelY(building.worldY, scale),
      );
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private renderHealthBars(ctx: CanvasRenderingContext2D, snapshot: SimulationSnapshot, scale: TextRenderScale): void {
    for (const enemy of snapshot.enemies) {
      const hpFraction = enemy.maxHp > 0 ? Math.max(0, Math.min(1, enemy.hp / enemy.maxHp)) : 0;
      if (hpFraction >= 1) continue;
      const centerX = textPixelX(enemy.x, scale);
      const topY = textPixelY(enemy.y, scale) - HP_BAR_OFFSET * scale.scaleY - enemy.radius * scale.scaleY;
      const barWidth = HP_BAR_HALF_WIDTH * scale.scaleX;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX - barWidth, topY);
      ctx.lineTo(centerX + barWidth, topY);
      ctx.stroke();
      ctx.strokeStyle = hpFraction > 0.5 ? "#00ff00" : hpFraction > 0.25 ? "#ffff00" : "#ff0000";
      ctx.beginPath();
      ctx.moveTo(centerX - barWidth, topY);
      ctx.lineTo(centerX - barWidth + barWidth * 2 * hpFraction, topY);
      ctx.stroke();
    }

    for (const tower of snapshot.towers ?? []) {
      const hpFraction = tower.maxHealth > 0 ? Math.max(0, Math.min(1, tower.health / tower.maxHealth)) : 0;
      if (hpFraction >= 1) continue;
      const centerX = textPixelX(tower.x, scale);
      const topY = textPixelY(tower.y, scale) - HP_BAR_OFFSET * scale.scaleY;
      const barWidth = HP_BAR_HALF_WIDTH * scale.scaleX;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX - barWidth, topY);
      ctx.lineTo(centerX + barWidth, topY);
      ctx.stroke();
      ctx.strokeStyle = hpFraction > 0.5 ? "#00ff00" : hpFraction > 0.25 ? "#ffff00" : "#ff0000";
      ctx.beginPath();
      ctx.moveTo(centerX - barWidth, topY);
      ctx.lineTo(centerX - barWidth + barWidth * 2 * hpFraction, topY);
      ctx.stroke();
    }
  }

  private renderLightning(ctx: CanvasRenderingContext2D, snapshot: SimulationSnapshot, scale: TextRenderScale): void {
    ctx.strokeStyle = "#40a0ff";
    ctx.lineWidth = 1;
    for (const bolt of snapshot.lightningEffects ?? []) {
      ctx.beginPath();
      ctx.moveTo(textPixelX(bolt.x1, scale), textPixelY(bolt.y1, scale));
      ctx.lineTo(textPixelX(bolt.x2, scale), textPixelY(bolt.y2, scale));
      ctx.stroke();
    }
  }

  private renderStuns(ctx: CanvasRenderingContext2D, snapshot: SimulationSnapshot, scale: TextRenderScale): void {
    ctx.fillStyle = "#40a0ff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const stun of snapshot.stunEffects ?? []) {
      const pixelX = textPixelX(stun.x, scale);
      const pixelY = textPixelY(stun.y, scale);
      ctx.fillText("*", pixelX, pixelY);
    }
  }
}
