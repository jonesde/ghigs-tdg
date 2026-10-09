<script setup lang="ts">
import { computed } from "vue";
import type { RegionMapNodeView } from "@/components/RegionMapNodeView.js";
import { clearedCrownGlyph, medalGlyphsForBestWave } from "@/components/regionMapProgress.js";
import type { RegionMapConnection } from "@/render/themes/index.js";

const props = defineProps<{
  mapImage: string;
  viewBox: string;
  connections: RegionMapConnection[];
  nodeViews: RegionMapNodeView[];
  selectedIndex: number | null;
}>();

const emit = defineEmits<{ select: [mapIndex: number]; start: [mapIndex: number] }>();

function nodeRefKey(ref: { kind: "level" | "progressive"; level: number }): string {
  return `${ref.kind}:${ref.level}`;
}

interface MedalSlot {
  glyph: string;
  x: number;
  y: number;
}

// The row is one 24px slot per glyph centered on the circle; for 3- and
// 4-glyph rows the two outermost slots drop down so the glyphs curve around
// the top of the circle instead of sitting flat above it.
const medalSlotSpacing = 24;
const medalSlotRowY = -46;
const medalSlotSideDrop = 8;

function medalSlotsForNode(node: RegionMapNodeView): MedalSlot[] {
  const glyphs = medalGlyphsForBestWave(node.bestWave);
  const row = node.cleared ? [...glyphs, clearedCrownGlyph()] : [...glyphs];
  return row.map((glyph, slotIndex) => {
    const isSideSlot = row.length >= 3 && (slotIndex === 0 || slotIndex === row.length - 1);
    return {
      glyph,
      x: (slotIndex - (row.length - 1) / 2) * medalSlotSpacing,
      y: medalSlotRowY + (isSideSlot ? medalSlotSideDrop : 0),
    };
  });
}

interface ResolvedConnection {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  branch: boolean;
}

const resolvedConnections = computed<ResolvedConnection[]>(() => {
  const positionByKey = new Map<string, { x: number; y: number }>();
  for (const node of props.nodeViews) {
    positionByKey.set(nodeRefKey(node), { x: node.x, y: node.y });
  }
  const resolved: ResolvedConnection[] = [];
  props.connections.forEach((connection, index) => {
    const from = positionByKey.get(nodeRefKey(connection.from));
    const to = positionByKey.get(nodeRefKey(connection.to));
    if (!from || !to) return;
    resolved.push({
      key: `${index}`,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      branch: connection.from.kind === "progressive" || connection.to.kind === "progressive",
    });
  });
  return resolved;
});

const selectedPlayableNode = computed(() => {
  const node = props.nodeViews.find((view) => view.mapIndex === props.selectedIndex);
  return node && !node.locked ? node : null;
});

function selectNode(node: RegionMapNodeView) {
  emit("select", node.mapIndex);
}

function startNode(node: RegionMapNodeView) {
  // Locked markers never start a run; MapSelect keeps the matching Play button disabled.
  if (node.locked) return;
  emit("start", node.mapIndex);
}
</script>

<template>
  <svg class="region-map" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet">
    <g class="region-map-art" v-html="props.mapImage"></g>
    <g class="region-map-connections">
      <line
        v-for="connection in resolvedConnections"
        :key="connection.key"
        class="region-map-connection"
        :class="{ branch: connection.branch }"
        :x1="connection.x1"
        :y1="connection.y1"
        :x2="connection.x2"
        :y2="connection.y2"
      />
    </g>
    <g class="region-map-nodes">
      <g
        v-for="node in props.nodeViews"
        :key="nodeRefKey(node)"
        class="map-node"
        :class="{
          locked: node.locked,
          selected: node.mapIndex === props.selectedIndex,
          progressive: node.kind === 'progressive',
          cleared: node.cleared,
        }"
        :transform="`translate(${node.x}, ${node.y})`"
        tabindex="0"
        role="button"
        :aria-label="node.tooltip"
        @click="selectNode(node)"
        @dblclick="startNode(node)"
        @keydown.enter.prevent="selectNode(node)"
        @keydown.space.prevent="selectNode(node)"
      >
        <circle class="map-node-circle" r="34" />
        <text class="map-node-label" y="-9" text-anchor="middle" dominant-baseline="central">{{ node.label }}</text>
        <text class="map-node-wave" y="17" text-anchor="middle" dominant-baseline="central">
          {{ node.bestWave > 0 ? `☠ ${node.bestWave}` : "☠ —" }}
        </text>
        <text v-if="medalSlotsForNode(node).length" class="map-node-medals" text-anchor="middle">
          <tspan
            v-for="(medalSlot, slotIndex) in medalSlotsForNode(node)"
            :key="slotIndex"
            :x="medalSlot.x"
            :y="medalSlot.y"
          >{{ medalSlot.glyph }}</tspan>
        </text>
        <title>{{ node.tooltip }}</title>
      </g>
    </g>
    <g
      v-if="selectedPlayableNode"
      class="map-play-button"
      :transform="`translate(${selectedPlayableNode.x}, ${selectedPlayableNode.y})`"
      role="button"
      tabindex="0"
      aria-label="Play selected map"
      @click.stop="startNode(selectedPlayableNode)"
      @keydown.enter.prevent.stop="startNode(selectedPlayableNode)"
      @keydown.space.prevent.stop="startNode(selectedPlayableNode)"
    >
      <rect class="map-play-rect" x="-34" y="44" width="68" height="34" rx="6" />
      <polygon class="map-play-icon" points="-8,52 16,61 -8,70" />
    </g>
  </svg>
</template>

<style scoped>
.region-map {
  display: block;
  width: 100%;
  height: auto;
  max-height: calc(100vh - 320px);
}

.region-map-connection {
  stroke: var(--color-line-strong);
  stroke-width: 6;
  stroke-linecap: round;
}

.region-map-connection.branch {
  stroke-dasharray: 16 12;
}

.map-node {
  cursor: pointer;
}

.map-node.locked {
  opacity: 0.35;
  cursor: not-allowed;
}

.map-node-circle {
  fill: var(--color-accent-soft);
  stroke: var(--color-accent-strong);
  stroke-width: 5;
}

.map-node.progressive .map-node-circle {
  stroke-dasharray: 14 10;
}

.map-node:hover:not(.locked) .map-node-circle {
  fill: var(--color-accent-hover);
}

.map-node.selected .map-node-circle {
  fill: var(--color-accent-hover);
  stroke-width: 9;
}

.map-node-label {
  fill: var(--color-text);
  font-size: 30px;
  font-weight: 700;
  pointer-events: none;
}

.map-node-wave {
  fill: var(--color-text-dim);
  font-size: 15px;
  font-weight: 600;
  pointer-events: none;
}

.map-node:not(.locked) .map-node-wave {
  opacity: 1;
}

.map-node.locked .map-node-wave {
  opacity: 0.3;
}

.map-node-medals {
  font-size: 18px;
  pointer-events: none;
}

.map-node.cleared .map-node-circle {
  stroke: var(--color-gold-bright);
}

.map-play-button {
  cursor: pointer;
}

.map-play-rect {
  fill: var(--color-accent);
}

.map-play-button:hover .map-play-rect {
  filter: brightness(1.1);
}

.map-play-icon {
  fill: var(--color-on-accent);
  pointer-events: none;
}
</style>
