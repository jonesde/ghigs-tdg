import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
// Latches ?perf=1 from the loaded document URL before the router can strip it.
import "./perfSession.js";
import { TowerIds } from "./content/towerIds.js";
import type { TowerVisualMeta } from "./render/themes/index.js";
import router from "./router";
import { populateSkillTreeTheme } from "./sim/towers/SkillTree.js";
import { useMapThemeStore } from "./stores/mapTheme";
import { usePersistStore } from "./stores/persist";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

// Load persisted state from localStorage
usePersistStore().load();
(async () => {
  try {
    await useMapThemeStore().preloadDefault();
    const mapThemeStore = useMapThemeStore();
    const defaultTowerVisuals: Record<string, TowerVisualMeta> = {};
    for (const id of Object.values(TowerIds)) {
      const visual = mapThemeStore.getDefaultTowerVisual(id);
      if (visual) defaultTowerVisuals[id] = visual;
    }
    populateSkillTreeTheme(defaultTowerVisuals);
  } catch (err) {
    console.error("Failed to preload default map theme:", err);
  }
})();

app.mount("#app");
