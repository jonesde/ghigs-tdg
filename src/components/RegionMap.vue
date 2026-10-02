<script setup lang="ts">
import { computed } from "vue";
import type { RegionMapNodeView } from "@/components/RegionMapNodeView.js";
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
        <text class="map-node-label" text-anchor="middle" dominant-baseline="central">{{ node.label }}</text>
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
  stroke: rgba(255, 255, 255, 0.32);
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
  fill: rgba(95, 208, 255, 0.16);
  stroke: rgba(95, 208, 255, 0.75);
  stroke-width: 5;
}

.map-node.progressive .map-node-circle {
  stroke-dasharray: 14 10;
}

.map-node:hover:not(.locked) .map-node-circle {
  fill: rgba(95, 208, 255, 0.32);
}

.map-node.selected .map-node-circle {
  fill: rgba(95, 208, 255, 0.4);
  stroke-width: 9;
}

.map-node-label {
  fill: var(--color-text);
  font-size: 30px;
  font-weight: 700;
  pointer-events: none;
}

.map-play-button {
  cursor: pointer;
}

.map-play-rect {
  fill: rgba(68, 170, 255, 0.3);
  stroke: rgba(68, 170, 255, 0.8);
  stroke-width: 4;
}

.map-play-button:hover .map-play-rect {
  fill: rgba(68, 170, 255, 0.5);
}

.map-play-icon {
  fill: var(--color-text);
  pointer-events: none;
}
</style>
