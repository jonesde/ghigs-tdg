import { getGameContent } from "@/content/gameContent.js";
import { bossAbilityLabel } from "@/sim/bossAbilities.js";
import { baseHealthFillColor } from "@/sim/WaveGraphTracker.js";
import type { Grid } from "../../sim/grid/Grid.js";
import type {
  EnemySnapshot,
  SpawnStateSnapshot,
  TowerSnapshot,
  WaveTopTowerSnapshot,
} from "../../sim/SimulationSnapshot.js";
import {
  BOSS_TEXT_POOL_SIZE,
  HP_BAR_POOL_SIZE,
  SHIELD_BAR_POOL_SIZE,
  SVG_NS,
  TOWER_HP_BAR_POOL_SIZE,
  TOWER_SCALED_SIZE,
} from "./types.js";

// The medals are stamped when a wave ends, so they cover the whole between-waves
// countdown rather than a copy of its length that could drift from the pack.
const waveTopMedals = ["🥇", "🥈", "🥉"];

export class UiOverlayManager {
  private hpBarPool: SVGRectElement[] = [];
  private shieldBarPool: SVGRectElement[] = [];
  private bossTextPool: SVGTextElement[] = [];
  private pendingTextPool: SVGTextElement[] = [];
  // Dirty-check caches: parallel arrays indexed by bar group (every 3 elements = 1 bar)
  private hpLastTransform: string[] = [];
  private hpLastWidth: string[] = [];
  private hpLastFill: string[] = [];
  private shieldLastTransform: string[] = [];
  private shieldLastWidth: string[] = [];
  private bossLastTransform: string[] = [];
  private bossLastText: string[] = [];
  private pendingLastTransform: string[] = [];
  private pendingLastText: string[] = [];
  private pendingLastCounts: number[] = [];
  private baseHealthBarPool: SVGRectElement[] = [];
  private baseHealthLastTransform: string = "";
  private baseHealthLastWidth: string = "";
  private baseHealthLastFill: string = "";
  // Tower HP bars: shown only while a tower is damaged (health < maxHealth).
  private towerHpBarPool: SVGRectElement[] = [];
  private towerHpLastTransform: string[] = [];
  private towerHpLastWidth: string[] = [];
  private towerHpLastFill: string[] = [];
  private waveTopMedalPool: SVGTextElement[] = [];

  init(layer: SVGGElement): void {
    for (let i = 0; i < HP_BAR_POOL_SIZE; i++) {
      const bg = document.createElementNS(SVG_NS, "rect");
      bg.style.visibility = "hidden";
      bg.setAttribute("width", "24");
      bg.setAttribute("height", "3");
      bg.setAttribute("fill", "#000000");
      bg.setAttribute("opacity", "0.6");
      layer.appendChild(bg);

      const border = document.createElementNS(SVG_NS, "rect");
      border.style.visibility = "hidden";
      border.setAttribute("width", "24");
      border.setAttribute("height", "3");
      border.setAttribute("fill", "none");
      border.setAttribute("stroke", "#000000");
      border.setAttribute("stroke-width", "0.5");
      layer.appendChild(border);

      const fg = document.createElementNS(SVG_NS, "rect");
      fg.style.visibility = "hidden";
      fg.setAttribute("width", "24");
      fg.setAttribute("height", "3");
      fg.setAttribute("fill", "#00ff00");
      layer.appendChild(fg);

      this.hpBarPool.push(bg, border, fg);
      this.hpLastTransform.push("");
      this.hpLastWidth.push("");
      this.hpLastFill.push("");
    }

    // One rect per slot: the shield fill rides on top of the health fill in the
    // same bar row, so the health bar's own background and border back the pair.
    // The shield pool is appended after the health pool, which is what puts the
    // cyan fill in front.
    for (let i = 0; i < SHIELD_BAR_POOL_SIZE; i++) {
      const fg = document.createElementNS(SVG_NS, "rect");
      fg.style.visibility = "hidden";
      fg.setAttribute("width", "24");
      fg.setAttribute("height", "3");
      fg.setAttribute("fill", "#00ffff");
      layer.appendChild(fg);

      this.shieldBarPool.push(fg);
      this.shieldLastTransform.push("");
      this.shieldLastWidth.push("");
    }

    for (let i = 0; i < BOSS_TEXT_POOL_SIZE; i++) {
      const text = document.createElementNS(SVG_NS, "text");
      text.style.visibility = "hidden";
      text.setAttribute("fill", "#ffffff");
      text.setAttribute("font-size", "6");
      text.setAttribute("font-weight", "bold");
      text.setAttribute("font-family", "sans-serif");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      layer.appendChild(text);
      this.bossTextPool.push(text);
      this.bossLastTransform.push("");
      this.bossLastText.push("");
    }

    for (let i = 0; i < 4; i++) {
      const text = document.createElementNS(SVG_NS, "text");
      text.style.visibility = "hidden";
      text.setAttribute("fill", "#ffff00");
      text.setAttribute("font-size", "8");
      text.setAttribute("font-weight", "bold");
      text.setAttribute("font-family", "sans-serif");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      layer.appendChild(text);
      this.pendingTextPool.push(text);
      this.pendingLastTransform.push("");
      this.pendingLastText.push("");
    }

    const baseBg = document.createElementNS(SVG_NS, "rect");
    baseBg.style.visibility = "hidden";
    baseBg.setAttribute("width", "108");
    baseBg.setAttribute("height", "5");
    baseBg.setAttribute("fill", "#000000");
    baseBg.setAttribute("opacity", "0.6");
    layer.appendChild(baseBg);

    const baseBorder = document.createElementNS(SVG_NS, "rect");
    baseBorder.style.visibility = "hidden";
    baseBorder.setAttribute("width", "108");
    baseBorder.setAttribute("height", "5");
    baseBorder.setAttribute("fill", "none");
    baseBorder.setAttribute("stroke", "#000000");
    baseBorder.setAttribute("stroke-width", "0.5");
    layer.appendChild(baseBorder);

    const baseFg = document.createElementNS(SVG_NS, "rect");
    baseFg.style.visibility = "hidden";
    baseFg.setAttribute("width", "108");
    baseFg.setAttribute("height", "5");
    baseFg.setAttribute("fill", baseHealthFillColor(1));
    layer.appendChild(baseFg);

    this.baseHealthBarPool = [baseBg, baseBorder, baseFg];

    for (let i = 0; i < TOWER_HP_BAR_POOL_SIZE; i++) {
      const bg = document.createElementNS(SVG_NS, "rect");
      bg.style.visibility = "hidden";
      bg.setAttribute("width", "28");
      bg.setAttribute("height", "4");
      bg.setAttribute("fill", "#000000");
      bg.setAttribute("opacity", "0.6");
      layer.appendChild(bg);

      const border = document.createElementNS(SVG_NS, "rect");
      border.style.visibility = "hidden";
      border.setAttribute("width", "28");
      border.setAttribute("height", "4");
      border.setAttribute("fill", "none");
      border.setAttribute("stroke", "#000000");
      border.setAttribute("stroke-width", "0.5");
      layer.appendChild(border);

      const fg = document.createElementNS(SVG_NS, "rect");
      fg.style.visibility = "hidden";
      fg.setAttribute("width", "28");
      fg.setAttribute("height", "4");
      fg.setAttribute("fill", "#00ff00");
      layer.appendChild(fg);

      this.towerHpBarPool.push(bg, border, fg);
      this.towerHpLastTransform.push("");
      this.towerHpLastWidth.push("");
      this.towerHpLastFill.push("");
    }

    for (let i = 0; i < waveTopMedals.length; i++) {
      const text = document.createElementNS(SVG_NS, "text");
      text.style.visibility = "hidden";
      text.setAttribute("fill", "var(--color-gold)");
      text.setAttribute("font-size", "12");
      text.setAttribute("font-family", "sans-serif");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      layer.appendChild(text);
      this.waveTopMedalPool.push(text);
    }
  }

  syncFromGameEngine(
    enemies: EnemySnapshot[],
    _selectedTower: TowerSnapshot | null,
    towers: TowerSnapshot[] = [],
  ): void {
    let barIndex = 0;
    let bossIndex = 0;
    let hpBarGroup = 0;
    let shieldBarGroup = 0;
    let bossGroup = 0;

    for (const enemy of enemies) {
      if (barIndex + 2 >= this.hpBarPool.length) break;

      const bg = this.hpBarPool[barIndex]!;
      const border = this.hpBarPool[barIndex + 1]!;
      const fg = this.hpBarPool[barIndex + 2]!;
      barIndex += 3;

      // One bar row per enemy. A live shield shares the health row, so the health
      // fill is the background the cyan drains away to reveal.
      const hasShield = enemy.shield > 0 && enemy.maxShield > 0;
      const barX = enemy.x - 12;
      const barY = enemy.y - 12;
      const barTransform = `translate(${barX}, ${barY})`;

      const hpGroupIdx = hpBarGroup;
      if (this.hpLastTransform[hpGroupIdx] !== barTransform) {
        bg.setAttribute("transform", barTransform);
        border.setAttribute("transform", barTransform);
        fg.setAttribute("transform", barTransform);
        this.hpLastTransform[hpGroupIdx] = barTransform;
      }
      // Full-HP enemies render no bar (matches the text renderer and the
      // damaged-only tower bars), except while a shield is up — the shield bar
      // needs the health fill behind it even at full health. The pool slot stays
      // reserved either way so group indices remain pinned to enemy order.
      const hpPercent = enemy.maxHp > 0 ? Math.max(0, Math.min(1, enemy.hp / enemy.maxHp)) : 0;
      const showHpBar = hpPercent < 1 || hasShield;
      bg.style.visibility = showHpBar ? "visible" : "hidden";
      border.style.visibility = showHpBar ? "visible" : "hidden";
      fg.style.visibility = showHpBar ? "visible" : "hidden";

      if (showHpBar) {
        const hpWidth = `${24 * hpPercent}`;
        const hpFill = hpPercent > 0.5 ? "#00ff00" : hpPercent > 0.25 ? "#ffff00" : "#ff0000";
        if (this.hpLastWidth[hpGroupIdx] !== hpWidth) {
          fg.setAttribute("width", hpWidth);
          this.hpLastWidth[hpGroupIdx] = hpWidth;
        }
        if (this.hpLastFill[hpGroupIdx] !== hpFill) {
          fg.setAttribute("fill", hpFill);
          this.hpLastFill[hpGroupIdx] = hpFill;
        }
      }
      hpBarGroup++;

      if (hasShield && shieldBarGroup < this.shieldBarPool.length) {
        const shieldFg = this.shieldBarPool[shieldBarGroup]!;

        if (this.shieldLastTransform[shieldBarGroup] !== barTransform) {
          shieldFg.setAttribute("transform", barTransform);
          this.shieldLastTransform[shieldBarGroup] = barTransform;
        }
        shieldFg.style.visibility = "visible";

        const shieldPercent = Math.max(0, Math.min(1, enemy.shield / enemy.maxShield));
        const shieldWidth = `${24 * shieldPercent}`;
        if (this.shieldLastWidth[shieldBarGroup] !== shieldWidth) {
          shieldFg.setAttribute("width", shieldWidth);
          this.shieldLastWidth[shieldBarGroup] = shieldWidth;
        }
        shieldBarGroup++;
      }

      if (enemy.type === "boss" && bossIndex < this.bossTextPool.length) {
        const text = this.bossTextPool[bossIndex]!;
        bossIndex++;
        text.style.visibility = "visible";
        const bossTransform = `translate(${enemy.x}, ${enemy.y - 20})`;
        if (this.bossLastTransform[bossGroup] !== bossTransform) {
          text.setAttribute("transform", bossTransform);
          this.bossLastTransform[bossGroup] = bossTransform;
        }
        const bossName = enemy.bossAbility ? bossAbilityLabel(enemy.bossAbility) : "Boss";
        const bossHpText = `${bossName} ${Math.ceil(enemy.hp).toLocaleString()}`;
        if (this.bossLastText[bossGroup] !== bossHpText) {
          text.textContent = bossHpText;
          this.bossLastText[bossGroup] = bossHpText;
        }
        bossGroup++;
      }
    }

    for (let g = hpBarGroup; g < this.hpLastTransform.length; g++) {
      if (g * 3 + 2 >= this.hpBarPool.length) break;
      this.hpBarPool[g * 3]!.style.visibility = "hidden";
      this.hpBarPool[g * 3 + 1]!.style.visibility = "hidden";
      this.hpBarPool[g * 3 + 2]!.style.visibility = "hidden";
    }
    for (let g = shieldBarGroup; g < this.shieldLastTransform.length; g++) {
      this.shieldBarPool[g]!.style.visibility = "hidden";
    }
    for (let i = bossGroup; i < this.bossTextPool.length; i++) {
      this.bossTextPool[i]!.style.visibility = "hidden";
    }

    let towerHpBarGroup = 0;
    for (const tower of towers) {
      if (tower.maxHealth <= 0 || tower.health >= tower.maxHealth) continue;
      if (towerHpBarGroup * 3 + 2 >= this.towerHpBarPool.length) break;

      const towerBg = this.towerHpBarPool[towerHpBarGroup * 3]!;
      const towerBorder = this.towerHpBarPool[towerHpBarGroup * 3 + 1]!;
      const towerFg = this.towerHpBarPool[towerHpBarGroup * 3 + 2]!;
      towerHpBarGroup++;

      const towerBarWidth = 28;
      const barX = tower.x - towerBarWidth / 2;
      const barY = tower.y - TOWER_SCALED_SIZE / 2 - 6;
      const towerBarTransform = `translate(${barX}, ${barY})`;
      if (this.towerHpLastTransform[towerHpBarGroup - 1] !== towerBarTransform) {
        towerBg.setAttribute("transform", towerBarTransform);
        towerBorder.setAttribute("transform", towerBarTransform);
        towerFg.setAttribute("transform", towerBarTransform);
        this.towerHpLastTransform[towerHpBarGroup - 1] = towerBarTransform;
      }
      towerBg.style.visibility = "visible";
      towerBorder.style.visibility = "visible";
      towerFg.style.visibility = "visible";

      const towerHpPercent = Math.max(0, tower.health / tower.maxHealth);
      const towerHpWidth = `${28 * towerHpPercent}`;
      const towerHpFill = towerHpPercent > 0.5 ? "#00ff00" : towerHpPercent > 0.25 ? "#ffff00" : "#ff0000";
      if (this.towerHpLastWidth[towerHpBarGroup - 1] !== towerHpWidth) {
        towerFg.setAttribute("width", towerHpWidth);
        this.towerHpLastWidth[towerHpBarGroup - 1] = towerHpWidth;
      }
      if (this.towerHpLastFill[towerHpBarGroup - 1] !== towerHpFill) {
        towerFg.setAttribute("fill", towerHpFill);
        this.towerHpLastFill[towerHpBarGroup - 1] = towerHpFill;
      }
    }

    for (let g = towerHpBarGroup; g < this.towerHpLastTransform.length; g++) {
      if (g * 3 + 2 >= this.towerHpBarPool.length) break;
      this.towerHpBarPool[g * 3]!.style.visibility = "hidden";
      this.towerHpBarPool[g * 3 + 1]!.style.visibility = "hidden";
      this.towerHpBarPool[g * 3 + 2]!.style.visibility = "hidden";
    }
  }

  syncWaveTopTowers(
    towers: TowerSnapshot[],
    waveTopTowers: WaveTopTowerSnapshot[] | null | undefined,
    simSeconds: number,
    baseCenter: { x: number; y: number } | null = null,
  ): void {
    const towerById = new Map<string, TowerSnapshot>();
    for (const tower of towers) towerById.set(tower.id, tower);

    let medalIndex = 0;
    if (waveTopTowers) {
      for (const entry of waveTopTowers) {
        if (medalIndex >= this.waveTopMedalPool.length) break;
        if (simSeconds - entry.simSeconds > getGameContent().economy.betweenWavesTimer) continue;
        const tower = entry.towerId === "base" ? null : towerById.get(entry.towerId);
        const medalX = tower?.x ?? (entry.towerId === "base" ? baseCenter?.x : undefined);
        const medalY = tower?.y ?? (entry.towerId === "base" ? baseCenter?.y : undefined);
        if (medalX === undefined || medalY === undefined) continue;
        const medal = this.waveTopMedalPool[medalIndex]!;
        const medalText = waveTopMedals[entry.rank - 1] ?? String(entry.rank);
        medal.style.visibility = "visible";
        medal.textContent = medalText;
        medal.setAttribute("transform", `translate(${medalX}, ${medalY - TOWER_SCALED_SIZE / 2 - 12})`);
        medalIndex++;
      }
    }
    for (let i = medalIndex; i < this.waveTopMedalPool.length; i++) {
      this.waveTopMedalPool[i]!.style.visibility = "hidden";
    }
  }

  syncPendingQueueOverlays(grid: Grid, spawnStates: SpawnStateSnapshot[]): void {
    const spawnCount = grid.spawns.length;
    if (spawnCount === this.pendingLastCounts.length) {
      let countsUnchanged = true;
      for (let spawnIndex = 0; spawnIndex < spawnCount; spawnIndex++) {
        const pendingCount = spawnStates[spawnIndex]?.pendingCount ?? 0;
        if (pendingCount !== this.pendingLastCounts[spawnIndex]) {
          countsUnchanged = false;
          break;
        }
      }
      if (countsUnchanged) return;
    } else {
      this.pendingLastCounts = new Array(spawnCount).fill(0);
    }

    let textIndex = 0;
    for (let spawnIndex = 0; spawnIndex < grid.spawns.length; spawnIndex++) {
      const spawnState = spawnStates[spawnIndex];
      const pendingCount = spawnState?.pendingCount ?? 0;
      this.pendingLastCounts[spawnIndex] = pendingCount;
      if (pendingCount <= 0) continue;
      if (textIndex >= this.pendingTextPool.length) break;

      const text = this.pendingTextPool[textIndex]!;
      const spawnTile = grid.spawns[spawnIndex]!;
      const worldPos = grid.tileToWorld(spawnTile.x, spawnTile.y);
      const pendingTransform = `translate(${worldPos.x}, ${worldPos.y})`;
      const pendingText = `+${pendingCount}`;
      text.style.visibility = "visible";
      if (this.pendingLastTransform[textIndex] !== pendingTransform) {
        text.setAttribute("transform", pendingTransform);
        this.pendingLastTransform[textIndex] = pendingTransform;
      }
      if (this.pendingLastText[textIndex] !== pendingText) {
        text.textContent = pendingText;
        this.pendingLastText[textIndex] = pendingText;
      }
      textIndex++;
    }

    for (let i = textIndex; i < this.pendingTextPool.length; i++) {
      this.pendingTextPool[i]!.style.visibility = "hidden";
    }
  }

  syncBaseHealthBar(grid: Grid, baseHealth: number, maxBaseHealth: number): void {
    const bg = this.baseHealthBarPool[0];
    const border = this.baseHealthBarPool[1];
    const fg = this.baseHealthBarPool[2];
    if (!grid || !bg || !border || !fg) return;
    const center = grid.tileToWorld(grid.getBase().x, grid.getBase().y);
    const barWidth = 108;
    const barX = center.x - barWidth / 2;
    // Just inside the top edge of the 3x3 base block, so clipped viewport
    // edges never hide the bar the way an above-the-block bar could be.
    const barY = center.y - grid.tileSize * 1.5 + 4;
    const barTransform = `translate(${barX}, ${barY})`;
    if (this.baseHealthLastTransform !== barTransform) {
      bg.setAttribute("transform", barTransform);
      border.setAttribute("transform", barTransform);
      fg.setAttribute("transform", barTransform);
      this.baseHealthLastTransform = barTransform;
    }
    bg.style.visibility = "visible";
    border.style.visibility = "visible";
    fg.style.visibility = "visible";
    const ratio = maxBaseHealth > 0 ? baseHealth / maxBaseHealth : 0;
    const fgWidth = `${Math.max(0, barWidth * ratio)}`;
    if (this.baseHealthLastWidth !== fgWidth) {
      fg.setAttribute("width", fgWidth);
      this.baseHealthLastWidth = fgWidth;
    }
    const fgFill = baseHealthFillColor(ratio);
    if (this.baseHealthLastFill !== fgFill) {
      fg.setAttribute("fill", fgFill);
      this.baseHealthLastFill = fgFill;
    }
  }

  dispose(): void {
    for (const el of this.hpBarPool) {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    this.hpLastTransform = [];
    this.hpLastWidth = [];
    this.hpLastFill = [];
    for (const el of this.shieldBarPool) {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    this.shieldLastTransform = [];
    this.shieldLastWidth = [];
    for (const el of this.bossTextPool) {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    this.bossLastTransform = [];
    this.bossLastText = [];
    for (const el of this.pendingTextPool) {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    this.pendingLastTransform = [];
    this.pendingLastText = [];
    this.hpBarPool = [];
    this.shieldBarPool = [];
    this.bossTextPool = [];
    this.pendingTextPool = [];
    for (const el of this.baseHealthBarPool) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    this.baseHealthLastTransform = "";
    this.baseHealthLastWidth = "";
    this.baseHealthLastFill = "";
    this.baseHealthBarPool = [];
    for (const el of this.towerHpBarPool) {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    this.towerHpLastTransform = [];
    this.towerHpLastWidth = [];
    this.towerHpLastFill = [];
    this.towerHpBarPool = [];
    for (const el of this.waveTopMedalPool) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    this.waveTopMedalPool = [];
  }
}
