import { computed } from "vue";
import { fieldFillOf, hexChannels } from "@/render/themes/fieldFill.js";
import { type MapThemeData, TILE_KINDS, type TileKind } from "@/render/themes/index.js";
import { tileImagesOf, tileSymbolId, tileVariantIndex } from "@/render/themes/tileArt.js";
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
        `<circle cx="${gemX}" cy="${gemY}" r="${gemSize}" fill="var(--color-gem)" stroke="var(--color-gem)" stroke-opacity="0.6" stroke-width="1"/>` +
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
    `<path d="${mainPath}" fill="url(#base-gradient)" stroke="var(--color-accent)" stroke-width="2.5"/>` +
    `<path d="${innerStrokePath}" fill="none" stroke="var(--color-accent)" stroke-opacity="0.3" stroke-width="1"/>` +
    gemCircles +
    `<polygon points="${hexPointsMain.join(" ")}" fill="var(--color-accent-soft)" stroke="var(--color-accent)" stroke-width="1.5"/>` +
    `<polygon points="${hexPointsInner.join(" ")}" fill="var(--color-accent)"/>` +
    `<circle cx="${highlightX}" cy="${highlightY}" r="${highlightR}" fill="rgba(255,255,255,0.45)"/>` +
    `</g>`
  );
}

interface TileInfo {
  type: "terrain" | "path" | "base" | "spawn" | "void";
  height: number;
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
      symbolParts.push(
        `<symbol id="enemy-${typeId}-f${frameIndex}" viewBox="-1 -1 2 2">${stripSvgWrapper(frame.svg)}</symbol>`,
      );
    }
    const hitReaction = enemyVisual.hitReaction;
    if (hitReaction) {
      for (let frameIndex = 0; frameIndex < hitReaction.referenceImages.length; frameIndex++) {
        const frame = hitReaction.referenceImages[frameIndex]!;
        symbolParts.push(
          `<symbol id="enemy-${typeId}-hit-f${frameIndex}" viewBox="-1 -1 2 2">${stripSvgWrapper(frame.svg)}</symbol>`,
        );
      }
    }
    const attack = enemyVisual.attack;
    if (attack) {
      for (let frameIndex = 0; frameIndex < attack.referenceImages.length; frameIndex++) {
        const frame = attack.referenceImages[frameIndex]!;
        symbolParts.push(
          `<symbol id="enemy-${typeId}-attack-f${frameIndex}" viewBox="-1 -1 2 2">${stripSvgWrapper(frame.svg)}</symbol>`,
        );
      }
    }
  }

  for (const [typeId, towerVisual] of Object.entries(activeTheme.towers)) {
    const animation = towerVisual.animation;
    if (!animation) continue;
    for (let frameIndex = 0; frameIndex < animation.referenceImages.length; frameIndex++) {
      const frame = animation.referenceImages[frameIndex]!;
      symbolParts.push(
        `<symbol id="tower-${typeId}-f${frameIndex}" viewBox="-16 -16 32 32">${stripSvgWrapper(frame.svg)}</symbol>`,
      );
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

  // Map site art (buildings, caches, boss packages), authored in the same 36x36
  // space as tile art. MapSiteLayer falls back to its procedural marks when the
  // theme ships no `sites` block, so nothing here is required.
  const siteArt = activeTheme.sites;
  if (siteArt) {
    for (const [kind, content] of Object.entries(siteArt.buildings)) {
      symbolParts.push(`<symbol id="site-building-${kind}" viewBox="0 0 36 36">${stripSvgWrapper(content)}</symbol>`);
    }
    for (const [state, content] of Object.entries(siteArt.caches)) {
      symbolParts.push(`<symbol id="site-cache-${state}" viewBox="0 0 36 36">${stripSvgWrapper(content)}</symbol>`);
    }
    if (siteArt.supplyDrop) {
      symbolParts.push(
        `<symbol id="site-supply-drop" viewBox="0 0 36 36">${stripSvgWrapper(siteArt.supplyDrop)}</symbol>`,
      );
    }
  }

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
 * Builds <symbol> elements for every tile variant of every region (path +
 * terrain1-4), so gridContent can reference them via <use> for small, fast
 * strings. Variant 0 keeps the plain `tile-r{regionId}-{kind}` id.
 */
function buildTileSymbols(activeTheme: MapThemeData | null): string {
  if (!activeTheme) return "";
  const parts: string[] = [];
  for (const region of activeTheme.regions) {
    for (const kind of TILE_KINDS) {
      const variants = tileImagesOf(region.tiles, kind);
      for (let variantIndex = 0; variantIndex < variants.length; variantIndex++) {
        const symbolId = tileSymbolId(region.id, kind, variantIndex);
        parts.push(`<symbol id="${symbolId}" viewBox="0 0 36 36">${stripSvgWrapper(variants[variantIndex]!)}</symbol>`);
      }
    }
  }
  return parts.join("\n");
}

/**
 * Ported from Shapes.ts drawTile() — returns the SVG elements for a single cell
 * from the tile symbol the grid layer picked for it (see tileKindOf and the
 * variant hash in the gridContent loop).
 */
function getTileSvg(symbolId: string, x: number, y: number, rotation: number): string {
  const size = TILE_SIZE;
  const cellCenter = size / 2;

  // Theme ink may extend past the 36 viewBox. A fill-box rotation follows that ink and
  // slides the cell off the grid. This viewport clips the overflow to the cell, and the
  // rotation is around the cell center.
  let svg = `<g transform="translate(${x}, ${y})">`;
  svg += `<svg x="0" y="0" width="${size}" height="${size}"`;
  svg += ` viewBox="0 0 ${size} ${size}" overflow="hidden">`;
  if (rotation !== 0) {
    svg += `<g transform="rotate(${rotation} ${cellCenter} ${cellCenter})">`;
  }
  svg += `<use href="#${symbolId}" width="${size}" height="${size}" />`;
  if (rotation !== 0) {
    svg += `</g>`;
  }
  svg += `</svg></g>`;
  return svg;
}

// Spawn and base tiles paint with the path art; terrain height 1-4 selects the
// ramp step, clamped because the ramp is four wide.
function tileKindOf(tile: TileInfo): TileKind {
  if (tile.type !== "terrain") return "path";
  // TILE_KINDS is ["path", "terrain1".."terrain4"], so the clamped height is the index.
  return TILE_KINDS[Math.min(4, Math.max(1, tile.height))]!;
}

interface ContourEdgeData {
  cliffThin: string;
  cliffThick: string;
  border: string;
}

// Terrain keeps its authored height (1–4). Path, spawn, and base sit one step
// below the lowest terrain, so a path edge against height 1 is the thin contour
// and a taller neighbor is the thick contour. Adjacent walkable tiles share
// level 0 and draw no interior edge.
function contourLevel(tile: TileInfo): number {
  return tile.type === "terrain" ? tile.height : 0;
}

function appendContourEdge(edges: ContourEdgeData, leftTile: TileInfo, rightTile: TileInfo, segment: string): void {
  const heightDelta = Math.abs(contourLevel(leftTile) - contourLevel(rightTile));
  if (heightDelta === 0) return;
  if (heightDelta === 1) {
    edges.cliffThin += `${segment} `;
  } else {
    edges.cliffThick += `${segment} `;
  }
}

// Classifies each internal edge exactly once, via the right and bottom neighbors; the
// top and left sides only ever emit border segments, since an interior top/left edge is
// the classified bottom/right edge of the neighbor tile. OOB or void neighbors make
// the segment a border.
function buildContourEdges(map: MapInfo, originX: number, originY: number): ContourEdgeData {
  const edges: ContourEdgeData = { cliffThin: "", cliffThick: "", border: "" };
  const tileAt = (tileX: number, tileY: number): TileInfo | null =>
    tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height ? null : map.tiles[tileY]![tileX]!;
  for (let tileY = 0; tileY < map.height; tileY++) {
    for (let tileX = 0; tileX < map.width; tileX++) {
      const tile = map.tiles[tileY]![tileX]!;
      if (tile.type === "void") continue;
      const left = originX + tileX * TILE_SIZE;
      const top = originY + tileY * TILE_SIZE;
      const rightEdgeX = left + TILE_SIZE;
      const bottomEdgeY = top + TILE_SIZE;
      const rightTile = tileAt(tileX + 1, tileY);
      if (!rightTile || rightTile.type === "void") {
        edges.border += `M${rightEdgeX},${top} L${rightEdgeX},${bottomEdgeY} `;
      } else {
        appendContourEdge(edges, tile, rightTile, `M${rightEdgeX},${top} L${rightEdgeX},${bottomEdgeY}`);
      }
      const bottomTile = tileAt(tileX, tileY + 1);
      if (!bottomTile || bottomTile.type === "void") {
        edges.border += `M${left},${bottomEdgeY} L${rightEdgeX},${bottomEdgeY} `;
      } else {
        appendContourEdge(edges, tile, bottomTile, `M${left},${bottomEdgeY} L${rightEdgeX},${bottomEdgeY}`);
      }
      const topTile = tileAt(tileX, tileY - 1);
      if (!topTile || topTile.type === "void") {
        edges.border += `M${left},${top} L${rightEdgeX},${top} `;
      }
      const leftTile = tileAt(tileX - 1, tileY);
      if (!leftTile || leftTile.type === "void") {
        edges.border += `M${left},${top} L${left},${bottomEdgeY} `;
      }
    }
  }
  return edges;
}

function contourEdgeMarkup(edges: ContourEdgeData): string {
  const strokeSpecs: { edgeName: string; pathData: string; strokeColor: string; strokeWidth: number }[] = [
    { edgeName: "cliff-thin", pathData: edges.cliffThin, strokeColor: "rgba(0,0,0,0.45)", strokeWidth: 1.2 },
    { edgeName: "cliff-thick", pathData: edges.cliffThick, strokeColor: "rgba(0,0,0,0.45)", strokeWidth: 1.8 },
    { edgeName: "border", pathData: edges.border, strokeColor: "rgba(0,0,0,0.5)", strokeWidth: 1 },
  ];
  return strokeSpecs
    .filter((strokeSpec) => strokeSpec.pathData.trim().length > 0)
    .map(
      (strokeSpec) =>
        `<path data-edge="${strokeSpec.edgeName}" d="${strokeSpec.pathData.trim()}" fill="none" ` +
        `stroke="${strokeSpec.strokeColor}" stroke-width="${strokeSpec.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`,
    )
    .join("");
}

const BACKDROP_FALLBACK_RGB = "40,40,40";
const BACKDROP_SCALE = 0.65;

function regionBackdropRgb(terrain2Content: string | undefined): string {
  const fieldFill = terrain2Content ? fieldFillOf(terrain2Content) : null;
  const channels = fieldFill ? hexChannels(fieldFill) : null;
  if (!channels) return BACKDROP_FALLBACK_RGB;
  return channels.map((channel) => Math.round(channel * BACKDROP_SCALE)).join(",");
}

const VIGNETTE_GRADIENT =
  `<radialGradient id="map-vignette" cx="50%" cy="50%" r="75%">` +
  `<stop offset="55%" stop-color="rgba(0,0,0,0)" />` +
  `<stop offset="100%" stop-color="rgba(0,0,0,0.32)" />` +
  `</radialGradient>`;

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
      `<stop offset="0%" stop-color="#4a3e2c" />` +
      `<stop offset="100%" stop-color="#241d14" />` +
      `</linearGradient>` +
      VIGNETTE_GRADIENT +
      tileSymbols
    );
  });

  // Static grid layer: backdrop, tiles, contour edges, vignette, base. Spawn
  // markers live in SpawnManager's own imperative layer, because v-html
  // replaces this layer's children whenever the string changes (currentMap,
  // the active theme, or currentGrid all feed it) and would detach any node a
  // manager captured earlier.
  const gridContent = computed(() => {
    const map = currentMap.value;
    if (!map) return "";

    const activeTheme = currentTheme?.value ?? useMapThemeStore().activeTheme;
    const regionId = map.regionId ?? 0;
    const regionVisual = activeTheme?.regions.find((r) => r.id === regionId);
    let svg = "";

    // The backdrop is the tone behind void and unstamped cells: the region's
    // mid-ramp field fill scaled 65% toward black.
    const backdropRgb = regionBackdropRgb(tileImagesOf(regionVisual?.tiles, "terrain2")[0]);
    const originTileX = map.originTileX ?? 0;
    const originTileY = map.originTileY ?? 0;
    const originX = originTileX * TILE_SIZE;
    const originY = originTileY * TILE_SIZE;
    const progressive = map.style === "progressive";
    const mapWidthPx = map.width * TILE_SIZE;
    const mapHeightPx = map.height * TILE_SIZE;
    svg += `<rect x="${originX}" y="${originY}" width="${mapWidthPx}" height="${mapHeightPx}" fill="rgba(${backdropRgb},1)" />`;

    const tileRng = progressive ? null : mulberry32(map.seed);
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const tile = map.tiles[ty]![tx] as TileInfo;
        if (tile.type === "void") continue;
        const rotation = progressive
          ? progressiveTileRotation(map.seed, originTileX + tx, originTileY + ty) * 90
          : Math.floor(tileRng!() * 4) * 90;
        const kind = tileKindOf(tile);
        const variantCount = tileImagesOf(regionVisual?.tiles, kind).length;
        const variantIndex = tileVariantIndex(map.seed, originTileX + tx, originTileY + ty, variantCount);
        const symbolId = tileSymbolId(regionId, kind, variantIndex);
        svg += getTileSvg(symbolId, originX + tx * TILE_SIZE, originY + ty * TILE_SIZE, rotation);
      }
    }

    svg += contourEdgeMarkup(buildContourEdges(map, originX, originY));
    svg += `<rect x="${originX}" y="${originY}" width="${mapWidthPx}" height="${mapHeightPx}" fill="url(#map-vignette)" />`;

    if (map.base) {
      svg += renderBaseStructure(map.base, regionVisual?.base || "", originX, originY);
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
