// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import GameHud from "@/components/GameHud.vue";
import type { Command } from "@/sim/Command.js";
import { setCommandDispatcher } from "@/sim/commandBus.js";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

interface MountResult {
  pinia: ReturnType<typeof createPinia>;
  gameStore: ReturnType<typeof useGameStore>;
  persistStore: ReturnType<typeof usePersistStore>;
  uiStore: ReturnType<typeof useUiStore>;
  commands: Command[];
}

function mountGameHud(): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  const commands: Command[] = [];
  const dispatcher = { dispatch: (command: Command) => commands.push(command) };
  // The pause button routes through the global command bus (worker dispatch).
  setCommandDispatcher(dispatcher as never);
  return { pinia, gameStore, persistStore, uiStore, commands };
}

describe("GameHud", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    setCommandDispatcher(null);
  });

  it("displays current lives", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.baseHealth = 15;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("15");
  });

  it("rounds fractional base health to an integer", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.baseHealth = 14.6;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(wrapper.get(".base-health .hud-value").text()).toBe("15");
    gameStore.baseHealth = 14.4;
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".base-health .hud-value").text()).toBe("14");
  });

  it("displays current gold", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.gold = 250;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("250");
  });

  it("displays current wave", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.currentWave = 25;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("25");
  });

  it("displays current time scale", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.timeScale = 2;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("2×");
  });

  it("opens menu on menu button click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    const menuBtn = wrapper.find("#menuBtn");
    await menuBtn.trigger("click");
    expect(uiStore.showPauseMenu).toBe(true);
  });

  it("cycles time scale on speed button", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.timeScale = 1;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    const speedBtn = wrapper.find("#speedBtn");
    await speedBtn.trigger("click");
    expect(gameStore.timeScale).toBe(2);
  });

  it("toggles sound on sound button click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    const soundBtn = wrapper.find("#soundBtn");
    expect(persistStore.soundEnabled).toBe(true);
    expect(soundBtn.text()).toBe("🔊");
    expect(soundBtn.classes()).not.toContain("muted");
    await soundBtn.trigger("click");
    expect(persistStore.soundEnabled).toBe(false);
    expect(wrapper.find("#soundBtn").text()).toBe("🔇");
    expect(wrapper.find("#soundBtn").classes()).toContain("muted");
    await wrapper.find("#soundBtn").trigger("click");
    expect(persistStore.soundEnabled).toBe(true);
  });

  it("toggles pause on pause button click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, commands } = mountGameHud();
    gameStore.state = "playing";
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    const pauseBtn = wrapper.find("#pauseBtn");
    await pauseBtn.trigger("click");
    expect(commands.some((command) => command.type === "action:togglePause")).toBe(true);
  });
});
