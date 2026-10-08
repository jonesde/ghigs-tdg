// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import GameHud from "@/components/GameHud.vue";
import type { Command } from "@/sim/Command.js";
import { setCommandDispatcher } from "@/sim/commandBus.js";
import { GameState } from "@/sim/GameRunState.js";
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

  it("floors fractional gold, which the 1.1x bounty multiplier produces", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.gold = 250.7;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(wrapper.get(".gold .hud-value").text()).toBe("250");
    gameStore.gold = 100.2;
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".gold .hud-value").text()).toBe("100");
  });

  it("counts active effects in a chip and lists every one of them in the hover popup", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(wrapper.find(".effects-chip").exists()).toBe(false);

    gameStore.runBonuses.damageMult = 1.2;
    gameStore.runBonuses.bountyMult = 1.1;
    gameStore.runBonuses.typeRangeMult = { basic: 1.2 };
    await wrapper.vm.$nextTick();

    expect(wrapper.get(".effects-chip").text()).toContain("Effects ×3");
    const parts = wrapper.findAll(".effects-part").map((part) => part.text());
    expect(parts).toEqual(["Dmg 1.20×", "Gold 1.10×", "Basic range 1.20×"]);
  });

  it("keeps the effects chip keyboard reachable so the popup is not mouse-only", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.runBonuses.damageMult = 1.2;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    // A native button, so it takes focus without a tabindex attribute, and it
    // reports the popup state the way a disclosure has to.
    const chip = wrapper.get(".effects-chip");
    expect(chip.element.tagName).toBe("BUTTON");
    expect(chip.attributes("aria-expanded")).toBe("false");

    await chip.trigger("click");
    expect(wrapper.get(".effects-chip").attributes("aria-expanded")).toBe("true");
  });

  it("keeps the effects popup focusable so its overflow-x list is not mouse-only", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.runBonuses.damageMult = 1.2;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    // The popup scrolls horizontally once the themed effect strings run long, so
    // it has to be a tab stop of its own rather than a hover-only artifact.
    const popup = wrapper.get(".effects-pop");
    expect(popup.attributes("tabindex")).toBe("0");
    expect(popup.attributes("aria-label")).toBe("Active run effects");
  });

  it("gives every HUD button an accessible name", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    const buttons = wrapper.findAll(".hud-right button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const label = button.attributes("aria-label");
      expect(label, `button ${button.attributes("id") ?? "(no id)"} has no aria-label`).toBeTruthy();
    }
  });

  it("names the pause button by the action it takes, not by a pressed state", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    // isPaused is a getter over state, so drive it through setState.
    gameStore.setState(GameState.PLAYING);
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    // A label that already flips must not also carry aria-pressed: "Resume,
    // pressed" announces a resume control in its pressed state.
    expect(wrapper.get("#pauseBtn").attributes("aria-label")).toBe("Pause");
    expect(wrapper.get("#pauseBtn").attributes("aria-pressed")).toBeUndefined();

    gameStore.setState(GameState.PAUSED);
    await wrapper.vm.$nextTick();
    expect(wrapper.get("#pauseBtn").attributes("aria-label")).toBe("Resume");
    expect(wrapper.get("#pauseBtn").attributes("aria-pressed")).toBeUndefined();
  });

  it("reports the sound toggle with a state-stable label and aria-pressed", async () => {
    const { pinia, persistStore } = mountGameHud();
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    // Static label plus aria-pressed, the minimap pattern: a flipping action
    // label ("Mute sound") together with aria-pressed would announce "Mute
    // sound, pressed", the combination the pause button deliberately avoids.
    expect(wrapper.get("#soundBtn").attributes("aria-label")).toBe("Sound");
    expect(wrapper.get("#soundBtn").attributes("aria-pressed")).toBe("true");

    await wrapper.get("#soundBtn").trigger("click");
    expect(wrapper.get("#soundBtn").attributes("aria-label")).toBe("Sound");
    expect(wrapper.get("#soundBtn").attributes("aria-pressed")).toBe("false");
    expect(persistStore.soundEnabled).toBe(false);
  });

  it("reports the minimap toggle as pressed only while the minimap is open", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(wrapper.get("#minimapBtn").attributes("aria-pressed")).toBe("false");

    await wrapper.get("#minimapBtn").trigger("click");
    expect(wrapper.get("#minimapBtn").attributes("aria-pressed")).toBe("true");
  });

  it("publishes its measured bar height as --hud-height and drops it on unmount", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    // jsdom reports 0 for offsetHeight, which publishBarHeight skips, so stub
    // a laid-out bar before mount the way the panel-drag tests stub panel size.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 124 });
    try {
      const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
      expect(document.documentElement.style.getPropertyValue("--hud-height")).toBe("124px");

      wrapper.unmount();
      expect(document.documentElement.style.getPropertyValue("--hud-height")).toBe("");
    } finally {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptor);
    }
  });

  it("leaves the CSS default in place when the bar has no layout yet", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(document.documentElement.style.getPropertyValue("--hud-height")).toBe("");
    wrapper.unmount();
  });

  it("displays current wave", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.currentWave = 25;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("25");
  });

  it("shows a notification toast and hides it when its expiry timer fires", async () => {
    vi.useFakeTimers();
    try {
      const { pinia, uiStore } = mountGameHud();
      const wrapper = mount(GameHud, { global: { plugins: [pinia] } });

      uiStore.showNotification("Cache opened", 3000);
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".notification-toast").exists()).toBe(true);
      expect(wrapper.get(".notification-message").text()).toBe("Cache opened");

      vi.advanceTimersByTime(3000);
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".notification-toast").exists()).toBe(false);
      expect(uiStore.notification).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not show a notification that arrived already expired", async () => {
    vi.useFakeTimers();
    try {
      const { pinia, uiStore } = mountGameHud();
      const wrapper = mount(GameHud, { global: { plugins: [pinia] } });

      uiStore.showNotification("Stale", 3000);
      await wrapper.vm.$nextTick();
      vi.advanceTimersByTime(5000);
      uiStore.showNotification("Already gone", 1);
      await wrapper.vm.$nextTick();
      vi.advanceTimersByTime(1);
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".notification-toast").exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a pending expiry timer when the notification is replaced", async () => {
    vi.useFakeTimers();
    try {
      const { pinia, uiStore } = mountGameHud();
      const wrapper = mount(GameHud, { global: { plugins: [pinia] } });

      uiStore.showNotification("First", 3000);
      await wrapper.vm.$nextTick();
      vi.advanceTimersByTime(2000);
      uiStore.showNotification("Second", 5000);
      await wrapper.vm.$nextTick();

      // The first notification's timer must not take the second one down early.
      vi.advanceTimersByTime(1500);
      await wrapper.vm.$nextTick();
      expect(wrapper.get(".notification-message").text()).toBe("Second");
    } finally {
      vi.useRealTimers();
    }
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

  it("dispatches a speed cycle from the speed button without writing timeScale itself", async () => {
    const { pinia, gameStore, commands } = mountGameHud();
    gameStore.timeScale = 1;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    const speedBtn = wrapper.find("#speedBtn");
    await speedBtn.trigger("click");
    // gameStore.timeScale mirrors the worker's value through SnapshotStore; the
    // button only expresses intent, so the label updates on the next snapshot.
    expect(gameStore.timeScale).toBe(1);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: "action:cycleSpeed", direction: 1 });
  });

  it("renders the mirrored time scale", async () => {
    const { pinia, gameStore } = mountGameHud();
    gameStore.timeScale = 4;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(wrapper.find("#speedBtn").text()).toBe("4×");
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
