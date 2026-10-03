import { computed } from "vue";
import type { MapThemeData } from "@/render/themes/index.js";
import type { Grid } from "@/sim/grid/Grid.js";
import { mulberry32 } from "@/sim/grid/Map.js";
import { progressiveTileRotation } from "@/sim/grid/ProgressiveMap.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { GRID_TILE_SIZE as TILE_SIZE } from "./types.js";

interface BaseSvgParams {
  x: number;
  y: number;
  size: number;
  regionId?: number;
}

function renderBaseSvg(params: BaseSvgParams): string {
  const { x, y, size } = params;
  const padding = size * 0.15;
  const cornerR = size * 0.6;
  const width = size * 2.7;
  const height = size * 2.7;
  const centerX = x + padding + width / 2;
  const centerY = y + padding + height / 2;

  const mainPath = [
    `M${x + padding + cornerR},${y + padding}`,
    `L${x + padding + width - cornerR},${y + padding}`,
    `A${cornerR},${cornerR} 0 0 1 ${x + padding + width},${y + padding + cornerR}`,
    `L${x + padding + width},${y + padding + height - cornerR}`,
    `A${cornerR},${cornerR} 0 0 1 ${x + padding + width - cornerR},${y + padding + height}`,
    `L${x + padding + cornerR},${y + padding + height}`,
    `A${cornerR},${cornerR} 0 0 1 ${x + padding},${y + padding + height - cornerR}`,
    `L${x + padding},${y + padding + cornerR}`,
    `A${cornerR},${cornerR} 0 0 1 ${x + padding + cornerR},${y + padding}`,
    "Z",
  ].join(" ");

  const innerStrokePath = [
    `M${x + padding + cornerR + 3},${y + padding + 4}`,
    `L${x + padding + width - cornerR - 3},${y + padding + 4}`,
    `A${cornerR - 6},${cornerR - 6} 0 0 1 ${x + padding + width - 3},${y + padding + cornerR + 3}`,
    `L${x + padding + width - 3},${y + padding + height - cornerR - 3}`,
    `A${cornerR - 6},${cornerR - 6} 0 0 1 ${x + padding + width - cornerR - 3},${y + padding + height - 3}`,
    `L${x + padding + cornerR + 3},${y + padding + height - 3}`,
    `A${cornerR - 6},${cornerR - 6} 0 0 1 ${x + padding + 3},${y + padding + height - cornerR - 3}`,
    `L${x + padding + 3},${y + padding + cornerR + 3}`,
    `A${cornerR - 6},${cornerR - 6} 0 0 1 ${x + padding + cornerR + 3},${y + padding + 3}`,
    "Z",
  ].join(" ");

  const gemSize = size * 0.12;
  const gems: [number, number][] = [
    [x + padding + cornerR + 2, y + padding + cornerR + 2],
    [x + padding + width - cornerR - 2, y + padding + cornerR + 2],
    [x + padding + cornerR + 2, y + padding + height - cornerR - 2],
    [x + padding + width - cornerR - 2, y + padding + height - cornerR - 2],
  ];

  const gemCircles = gems
    .map(([gemX, gemY]) => {
      const highlightR = gemSize * 0.4;
      const highlightX = gemX - gemSize * 0.25;
      const highlightY = gemY - gemSize * 0.25;
      return (
        `<circle cx="${gemX}" cy="${gemY}" r="${gemSize}" fill="#5fd0ff" stroke="rgba(95,208,255,0.6)" stroke-width="1"/>` +
        `<circle cx="${highlightX}" cy="${highlightY}" r="${highlightR}" fill="rgba(255,255,255,0.5)"/>`
      );
    })
    .join("\n      ");

  const emblemR = size * 0.55;
  const hexPointsMain: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 - Math.PI / 6;
    const emblemX = centerX + Math.cos(angle) * emblemR;
    const emblemY = centerY + Math.sin(angle) * emblemR;
    hexPointsMain.push(`${emblemX},${emblemY}`);
  }

  const innerR = emblemR * 0.55;
  const hexPointsInner: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const emblemX = centerX + Math.cos(angle) * innerR;
    const emblemY = centerY + Math.sin(angle) * innerR;
    hexPointsInner.push(`${emblemX},${emblemY}`);
  }

  const highlightR = innerR * 0.35;
  const highlightX = centerX - innerR * 0.15;
  const highlightY = centerY - innerR * 0.15;

  return (
    `<g id="base-structure">` +
    `<path d="${mainPath}" fill="url(#base-gradient)" stroke="#5fd0ff" stroke-width="2.5"/>` +
    `<path d="${innerStrokePath}" fill="none" stroke="rgba(95,208,255,0.3)" stroke-width="1"/>` +
    gemCircles +
    `<polygon points="${hexPointsMain.join(" ")}" fill="rgba(95,208,255,0.15)" stroke="#5fd0ff" stroke-width="1.5"/>` +
    `<polygon points="${hexPointsInner.join(" ")}" fill="#5fd0ff"/>` +
    `<circle cx="${highlightX}" cy="${highlightY}" r="${highlightR}" fill="rgba(255,255,255,0.45)"/>` +
    `</g>`
  );
}

interface TileInfo {
  type: "terrain" | "path" | "base" | "spawn" | "void";
  height: number;
}

interface RegionInfo {
  pathImage: string;
  terrainImages: readonly string[];
  base: string;
}

interface MapInfo {
  width: number;
  height: number;
  tiles: TileInfo[][];
  spawns: { x: number; y: number }[];
  base: { x: number; y: number };
  regionId?: number;
  seed: number;
  style?: string;
  originTileX?: number;
  originTileY?: number;
}

function stripSvgWrapper(svgText: string): string {
  const openTagMatch = svgText.match(/^<svg[^>]*>/);
  const closeTagMatch = svgText.match(/<\/svg>\s*$/);
  if (openTagMatch && closeTagMatch) {
    return svgText.slice(openTagMatch[0].length, svgText.length - closeTagMatch[0].length);
  }
  return svgText;
}

function buildSymbolsFromConstants(themeOverride?: MapThemeData | null): string {
  const symbolParts: string[] = [];
  const activeTheme = themeOverride ?? useMapThemeStore().activeTheme ?? useMapThemeStore().defaultTheme;
  if (!activeTheme) return "";

  for (const [typeId, enemyVisual] of Object.entries(activeTheme.enemies)) {
    const walking = enemyVisual.walking;
    if (!walking) continue;
    for (let frameIndex = 0; frameIndex < walking.referenceImages.length; frameIndex++) {
      const frame = walking.referenceImages[frameIndex]!;
      const innerContent = stripSvgWrapper(frame.svg);
      symbolParts.push(`<symbol id="enemy-${typeId}-f${frameIndex}" viewBox="-1 -1 2 2">${innerContent}</symbol>`);
    }
    const hitReaction = enemyVisual.hitReaction;
    if (hitReaction) {
      for (let frameIndex = 0; frameIndex < hitReaction.referenceImages.length; frameIndex++) {
        const frame = hitReaction.referenceImages[frameIndex]!;
        const innerContent = stripSvgWrapper(frame.svg);
        symbolParts.push(
          `<symbol id="enemy-${typeId}-hit-f${frameIndex}" viewBox="-1 -1 2 2">${innerContent}</symbol>`,
        );
      }
    }
    const attack = enemyVisual.attack;
    if (attack) {
      for (let frameIndex = 0; frameIndex < attack.referenceImages.length; frameIndex++) {
        const frame = attack.referenceImages[frameIndex]!;
        const innerContent = stripSvgWrapper(frame.svg);
        symbolParts.push(
          `<symbol id="enemy-${typeId}-attack-f${frameIndex}" viewBox="-1 -1 2 2">${innerContent}</symbol>`,
        );
      }
    }
  }

  for (const [typeId, towerVisual] of Object.entries(activeTheme.towers)) {
    const animation = towerVisual.animation;
    if (!animation) continue;
    for (let frameIndex = 0; frameIndex < animation.referenceImages.length; frameIndex++) {
      const frame = animation.referenceImages[frameIndex]!;
      const innerContent = stripSvgWrapper(frame.svg);
      symbolParts.push(`<symbol id="tower-${typeId}-f${frameIndex}" viewBox="-16 -16 32 32">${innerContent}</symbol>`);
    }
  }

  // Spawn symbols — use theme SVGs if available, otherwise fallback red rect
  const spawnFallback = `<rect x="2" y="2" width="32" height="32" fill="rgba(255,50,50,0.5)"/>`;
  const spawnClosed = activeTheme.spawns?.closed ?? spawnFallback;
  const spawnOpen = activeTheme.spawns?.open ?? spawnFallback;
  const spawnTransition = activeTheme.spawns?.transition ?? spawnFallback;
  symbolParts.push(`<symbol id="spawn-closed" viewBox="0 0 36 36">${stripSvgWrapper(spawnClosed)}</symbol>`);
  symbolParts.push(`<symbol id="spawn-open" viewBox="0 0 36 36">${stripSvgWrapper(spawnOpen)}</symbol>`);
  symbolParts.push(`<symbol id="spawn-transition" viewBox="0 0 36 36">${stripSvgWrapper(spawnTransition)}</symbol>`);

  return symbolParts.join("\n");
}

// Level i (1..9) maps to saturate 0.9 down to 0.1 (full grayscale at max slow).
const SLOW_SATURATE_LEVELS: readonly number[] = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];

export function buildStaticFiltersContent(): string {
  const glowFilter = `<filter id="glow"><feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blurred" /><feMerge><feMergeNode in="blurred" /><feMergeNode in="SourceGraphic" /></feMerge></filter>`;

  const slowFilters: string[] = [];
  for (let i = 1; i <= 9; i++) {
    const saturateValue = SLOW_SATURATE_LEVELS[i - 1]!;
    const slowFilter = `<filter id="slow-${i}"><feColorMatrix type="saturate" values="${saturateValue}" /></filter>`;
    slowFilters.push(slowFilter);
  }

  return `${glowFilter}\n${slowFilters.join("\n")}`;
}

/**
 * Builds <symbol> elements for each region's tile images (path + terrain1-4),
 * so gridContent can reference them via <use> for small, fast strings.
 */
function buildTileSymbols(activeTheme: MapThemeData | null): string {
  if (!activeTheme) return "";
  const parts: string[] = [];
  for (const region of activeTheme.regions) {
    const prefix = `tile-r${region.id}`;
    parts.push(`<symbol id="${prefix}-path" viewBox="0 0 36 36">${stripSvgWrapper(region.tiles.path)}</symbol>`);
    parts.push(
      `<symbol id="${prefix}-terrain1" viewBox="0 0 36 36">${stripSvgWrapper(region.tiles.terrain1)}</symbol>`,
    );
    parts.push(
      `<symbol id="${prefix}-terrain2" viewBox="0 0 36 36">${stripSvgWrapper(region.tiles.terrain2)}</symbol>`,
    );
    parts.push(
      `<symbol id="${prefix}-terrain3" viewBox="0 0 36 36">${stripSvgWrapper(region.tiles.terrain3)}</symbol>`,
    );
    parts.push(
      `<symbol id="${prefix}-terrain4" viewBox="0 0 36 36">${stripSvgWrapper(region.tiles.terrain4)}</symbol>`,
    );
  }
  return parts.join("\n");
}

/**
 * Ported from Shapes.ts drawTile() — returns SVG elements for a single tile
 * using the theme's tile image via <use>.
 */
function getTileSvg(tile: TileInfo, x: number, y: number, regionId: number, rotation: number): string {
  const size = TILE_SIZE;
  const cellCenter = size / 2;
  const tileSymbolId =
    tile.type === "path" || tile.type === "spawn"
      ? `tile-r${regionId}-path`
      : `tile-r${regionId}-terrain${Math.min(4, Math.max(1, tile.height))}`;

  // Theme ink may extend past the 36 viewBox. A fill-box rotation follows that ink and
  // slides the cell off the grid. This viewport clips the overflow to the cell, and the
  // rotation is around the cell center.
  let svg = `<g transform="translate(${x}, ${y})">`;
  svg += `<svg x="0" y="0" width="${size}" height="${size}"`;
  svg += ` viewBox="0 0 ${size} ${size}" overflow="hidden">`;
  if (rotation !== 0) {
    svg += `<g transform="rotate(${rotation} ${cellCenter} ${cellCenter})">`;
  }
  svg += `<use href="#${tileSymbolId}" width="${size}" height="${size}" />`;
  if (rotation !== 0) {
    svg += `</g>`;
  }
  svg += `</svg></g>`;
  return svg;
}

/**
 * Ported from Shapes.ts drawBase() via SvgBaseRenderer.ts renderBaseSvg().
 * Renders the base structure as an SVG string with rounded corners,
 * gradient fill, gem decorations, and hexagonal emblem.
 */
function renderBaseStructure(base: { x: number; y: number }, regionBaseSvg: string, originX = 0, originY = 0): string {
  const translateX = originX + (base.x - 1) * TILE_SIZE;
  const translateY = originY + (base.y - 1) * TILE_SIZE;
  if (regionBaseSvg) {
    return `<g id="base-structure" transform="translate(${translateX}, ${translateY})">${stripSvgWrapper(regionBaseSvg)}</g>`;
  }
  return renderBaseSvg({ x: translateX, y: translateY, size: TILE_SIZE });
}

export function useSvgStaticContent(
  currentMap: { value: MapInfo | null },
  currentTheme?: { value: MapThemeData | null },
  currentGrid?: { value: Grid | null },
) {
  const staticFiltersContent = computed(() => buildStaticFiltersContent());
  const staticSymbolsContent = computed(() => buildSymbolsFromConstants(currentTheme?.value));
  const staticDefsContent = computed(() => `${staticFiltersContent.value}\n${staticSymbolsContent.value}`);

  const mapDefsContent = computed(() => {
    const map = currentMap.value;
    if (!map) return "";
    const activeTheme = currentTheme?.value ?? useMapThemeStore().activeTheme;
    const tileSymbols = buildTileSymbols(activeTheme);
    return (
      `<linearGradient id="base-gradient" x1="0%" y1="0%" x2="100%" y2="100%">` +
      `<stop offset="0%" stop-color="#2a3a4a" />` +
      `<stop offset="100%" stop-color="#1a2a3a" />` +
      `</linearGradient>` +
      tileSymbols
    );
  });

  // Static grid layer: background, tiles, grid lines, spawn markers, base.
  // Depends only on currentMap — does NOT re-render when towers are placed.
  const gridContent = computed(() => {
    const map = currentMap.value;
    if (!map) return "";

    const activeTheme = currentTheme?.value ?? useMapThemeStore().activeTheme;
    const regionId = map.regionId ?? 0;
    const regionVisual = activeTheme?.regions.find((r) => r.id === regionId);
    const region: RegionInfo = {
      pathImage: regionVisual?.tiles.path || "",
      terrainImages: [
        regionVisual?.tiles.terrain1 || "",
        regionVisual?.tiles.terrain2 || "",
        regionVisual?.tiles.terrain3 || "",
        regionVisual?.tiles.terrain4 || "",
      ],
      base: regionVisual?.base || "",
    };
    let svg = "";

    const BACKGROUND_RGB = "40,40,40";
    const originTileX = map.originTileX ?? 0;
    const originTileY = map.originTileY ?? 0;
    const originX = originTileX * TILE_SIZE;
    const originY = originTileY * TILE_SIZE;
    const progressive = map.style === "progressive";
    const mapWidthPx = map.width * TILE_SIZE;
    const mapHeightPx = map.height * TILE_SIZE;
    svg += `<rect x="${originX}" y="${originY}" width="${mapWidthPx}" height="${mapHeightPx}" fill="rgba(${BACKGROUND_RGB},1)" />`;

    const tileRng = progressive ? null : mulberry32(map.seed);
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const tile = map.tiles[ty]![tx] as TileInfo;
        if (tile.type === "void") continue;
        const rotation = progressive
          ? progressiveTileRotation(map.seed, originTileX + tx, originTileY + ty) * 90
          : Math.floor(tileRng!() * 4) * 90;
        svg += getTileSvg(tile, originX + tx * TILE_SIZE, originY + ty * TILE_SIZE, regionId, rotation);
      }
    }

    let gridD = "";
    if (progressive) {
      const drawnEdges = new Set<string>();
      const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
        const key = x1 < x2 || (x1 === x2 && y1 <= y2) ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`;
        if (drawnEdges.has(key)) return;
        drawnEdges.add(key);
        gridD += `M${x1},${y1} L${x2},${y2} `;
      };
      for (let ty = 0; ty < map.height; ty++) {
        for (let tx = 0; tx < map.width; tx++) {
          if (map.tiles[ty]![tx]!.type === "void") continue;
          const left = originX + tx * TILE_SIZE;
          const top = originY + ty * TILE_SIZE;
          const right = left + TILE_SIZE;
          const bottom = top + TILE_SIZE;
          addEdge(left, top, right, top);
          addEdge(right, top, right, bottom);
          addEdge(left, bottom, right, bottom);
          addEdge(left, top, left, bottom);
        }
      }
    } else {
      for (let column = 0; column <= map.width; column++) {
        gridD += `M${column * TILE_SIZE},0 L${column * TILE_SIZE},${mapHeightPx} `;
      }
      for (let row = 0; row <= map.height; row++) {
        gridD += `M0,${row * TILE_SIZE} L${mapWidthPx},${row * TILE_SIZE} `;
      }
    }
    svg += `<path d="${gridD}" fill="none" stroke="rgba(${BACKGROUND_RGB},0.8)" stroke-width="0.7" />`;

    for (let spawnIndex = 0; spawnIndex < map.spawns.length; spawnIndex++) {
      const spawn = map.spawns[spawnIndex]!;
      const spawnX = originX + spawn.x * TILE_SIZE;
      const spawnY = originY + spawn.y * TILE_SIZE;
      svg += `<use id="spawn-${spawnIndex}" href="#spawn-closed" x="${spawnX}" y="${spawnY}" width="${TILE_SIZE}" height="${TILE_SIZE}"/>`;
    }

    if (map.base) {
      svg += renderBaseStructure(map.base, region.base, originX, originY);
    }

    // Red target-edge overlay: one <line> per exposed base-edge segment whose
    // outward tile is traversable (path/spawn). This mirrors `Grid.getBaseEdgeSegments`
    // used by Enemy.ts for base-attacking target selection, so the drawn edge is
    // exactly the edge enemies press toward — never a terrain-backed face.
    const grid = currentGrid?.value;
    if (map.base && grid) {
      for (const segment of grid.getBaseEdgeSegments()) {
        svg += `<line x1="${segment.x1}" y1="${segment.y1}" x2="${segment.x2}" y2="${segment.y2}" stroke="rgba(255,40,40,0.85)" stroke-width="2" filter="url(#glow)" />`;
      }
    }

    return svg;
  });

  return { staticDefsContent, mapDefsContent, gridContent };
}
