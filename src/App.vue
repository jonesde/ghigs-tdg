<script setup lang="ts">
import ConfirmDialog from "@/components/ConfirmDialog.vue";
</script>

<template>
  <div class="app-container">
    <router-view />
    <ConfirmDialog />
  </div>
</template>

<style>
:root {
  --color-bg: #17130f;
  --color-panel: rgba(34, 27, 20, 0.95);
  --color-panel-soft: rgba(34, 27, 20, 0.82);
  --color-surface-subtle: color-mix(in srgb, var(--color-text) 5%, transparent);
  --color-surface: color-mix(in srgb, var(--color-text) 8%, transparent);
  --color-surface-hover: color-mix(in srgb, var(--color-text) 14%, transparent);
  --color-line: color-mix(in srgb, var(--color-text) 14%, transparent);
  --color-line-strong: color-mix(in srgb, var(--color-text) 26%, transparent);
  --color-accent: #d9a441;
  --color-accent-soft: color-mix(in srgb, var(--color-accent) 16%, transparent);
  --color-accent-hover: color-mix(in srgb, var(--color-accent) 30%, transparent);
  --color-accent-border: color-mix(in srgb, var(--color-accent) 45%, transparent);
  --color-accent-strong: color-mix(in srgb, var(--color-accent) 75%, transparent);
  --color-border: var(--color-accent-border);
  --color-on-accent: #241705;
  --color-text: #ece4d6;
  --color-text-dim: #b0a18c;
  --color-gold: #ffd84d;
  --color-gem: #9be7ff;
  --color-success: #5ec46a;
  --color-success-soft: color-mix(in srgb, var(--color-success) 12%, transparent);
  --color-success-border: color-mix(in srgb, var(--color-success) 30%, transparent);
  --color-danger: #e05548;
  --color-danger-soft: color-mix(in srgb, var(--color-danger) 12%, transparent);
  --color-danger-border: color-mix(in srgb, var(--color-danger) 30%, transparent);
  --color-danger-hover: color-mix(in srgb, var(--color-danger) 22%, transparent);
  --color-warning: #e8a83c;
  --color-region-0: #6abf6a;
  --color-region-1: #e8c96a;
  --color-region-2: #9b8e7a;
  --color-scrim: rgba(0, 0, 0, 0.72);
  --color-scrim-heavy: rgba(0, 0, 0, 0.85);
  --font-main: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  --font-xs: 11px;
  --font-sm: 12px;
  --font-md: 14px;
  --font-lg: 16px;
  --font-xl: 18px;
  --font-2xl: 20px;
  --font-title: 32px;
  --font-display: 72px;
  --font-mono: ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--color-bg);
  font-family: var(--font-main);
  color: var(--color-text);
}

#app {
  width: 100%;
  height: 100%;
}

.app-container {
  position: relative;
  width: 100%;
  height: 100%;
}

/* Site glyphs are written into the SVG with innerHTML, so their animation rules
   have to live in the global sheet: a scoped selector never reaches them. */
@keyframes siteDropPulse {
  0%,
  100% {
    stroke-opacity: 0.3;
    stroke-width: 1.5;
  }
  50% {
    stroke-opacity: 1;
    stroke-width: 3;
  }
}

.site-drop-pulse {
  animation: siteDropPulse 1.1s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .site-drop-pulse {
    animation: none;
    stroke-opacity: 0.8;
  }
}
</style>
