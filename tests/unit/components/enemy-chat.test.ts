// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EnemyChat from "@/components/EnemyChat.vue";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

vi.mock("@/commanders/relay.js", () => ({
  postChatToCommander: vi.fn(),
  postUpdateInstructions: vi.fn(),
  postUpdateCallSettings: vi.fn(),
}));

import { postChatToCommander, postUpdateCallSettings, postUpdateInstructions } from "@/commanders/relay.js";

describe("EnemyChat", () => {
  let pinia: ReturnType<typeof createPinia>;
  let persistStore: ReturnType<typeof usePersistStore>;
  let uiStore: ReturnType<typeof useUiStore>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    persistStore = usePersistStore();
    uiStore = useUiStore();
    vi.clearAllMocks();
  });

  function activateLlm() {
    persistStore.addLlmCommander({
      id: "l_1",
      name: "My LLM",
      endpointUrl: "http://localhost:11434/v1",
      token: "",
      modelName: "",
      contextLimit: 32768,
      commanderInstructions: "hold the line",
      systemPrompt: "sys",
      requestTimeoutMs: 30000,
      pauseForCommander: false,
      decisionIntervalMs: 1000,
      reasoningEnabled: false,
    });
    uiStore.enemyCommander = "l_1";
  }

  it("is hidden when no LLM commander is active", () => {
    uiStore.enemyCommander = "none";
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    expect(wrapper.find(".enemy-chat").exists()).toBe(false);
  });

  it("is hidden for a built-in commander", () => {
    uiStore.enemyCommander = "stubby";
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    expect(wrapper.find(".enemy-chat").exists()).toBe(false);
  });

  it("renders when an LLM commander is active", () => {
    activateLlm();
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    expect(wrapper.find(".enemy-chat").exists()).toBe(true);
  });

  it("send appends a player message and forwards to the relay", async () => {
    activateLlm();
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    const input = wrapper.find("input.chat-input");
    await input.setValue("attack now");
    await wrapper.find("button.chat-send").trigger("click");
    expect(postChatToCommander).toHaveBeenCalledWith("attack now");
    expect(uiStore.chatLog).toEqual([{ from: "player", text: "attack now" }]);
  });

  it("does not send an empty message", async () => {
    activateLlm();
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    await wrapper.find("button.chat-send").trigger("click");
    expect(postChatToCommander).not.toHaveBeenCalled();
  });

  it("forwards instruction edits to the relay", async () => {
    activateLlm();
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    const textarea = wrapper.find("textarea.chat-instructions");
    await textarea.setValue("new instructions");
    await textarea.trigger("change");
    expect(postUpdateInstructions).not.toHaveBeenCalled();
    await textarea.trigger("blur");
    expect(postUpdateInstructions).toHaveBeenCalledWith("new instructions");
  });

  it("does not post instructions when blur leaves the synced text unchanged", async () => {
    activateLlm();
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    await wrapper.vm.$nextTick();
    const textarea = wrapper.find("textarea.chat-instructions");
    expect((textarea.element as HTMLTextAreaElement).value).toBe("hold the line");
    await textarea.trigger("blur");
    expect(postUpdateInstructions).not.toHaveBeenCalled();
  });

  it("persists an edited instruction once and ignores the following blur", async () => {
    activateLlm();
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    const textarea = wrapper.find("textarea.chat-instructions");
    await textarea.setValue("new orders");
    await textarea.trigger("blur");
    expect(postUpdateInstructions).toHaveBeenCalledTimes(1);
    expect(postUpdateInstructions).toHaveBeenCalledWith("new orders");
    expect(persistStore.llmCommanders[0].commanderInstructions).toBe("new orders");
    await textarea.trigger("blur");
    expect(postUpdateInstructions).toHaveBeenCalledTimes(1);
  });

  it("resyncs the textarea when the active commander changes", async () => {
    activateLlm();
    persistStore.addLlmCommander({
      id: "l_2",
      name: "Second",
      endpointUrl: "http://localhost:11434/v1",
      token: "",
      modelName: "",
      contextLimit: 32768,
      commanderInstructions: "second orders",
      systemPrompt: "sys",
      requestTimeoutMs: 30000,
      pauseForCommander: false,
      decisionIntervalMs: 1000,
      reasoningEnabled: false,
    });
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    uiStore.enemyCommander = "l_2";
    await wrapper.vm.$nextTick();
    const textarea = wrapper.find("textarea.chat-instructions");
    expect((textarea.element as HTMLTextAreaElement).value).toBe("second orders");
    await textarea.trigger("blur");
    expect(postUpdateInstructions).not.toHaveBeenCalled();
  });

  it("reflects the saved pause flag and a 1s call delay", () => {
    activateLlm();
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    const pauseInput = wrapper.find("input.chat-pause");
    expect((pauseInput.element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.text()).toContain("Pause for Enemy Commander");
    expect(wrapper.text()).toContain("Reasoning");
    expect((wrapper.find("input.chat-reasoning").element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.text()).toContain("Delay between calls");
    expect(wrapper.text()).toContain("1s");
  });

  it("persists and posts pause when the checkbox is checked", async () => {
    activateLlm();
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    const pauseInput = wrapper.find("input.chat-pause");
    (pauseInput.element as HTMLInputElement).checked = true;
    await pauseInput.trigger("change");
    expect(postUpdateCallSettings).toHaveBeenCalledWith(true, 1000, false);
    expect(persistStore.llmCommanders[0].pauseForCommander).toBe(true);
    expect(persistStore.llmCommanders[0].decisionIntervalMs).toBe(1000);
  });

  it("persists and posts the call delay from the slider", async () => {
    activateLlm();
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    const slider = wrapper.find("input.chat-delay-slider");
    await slider.setValue("4");
    expect(postUpdateCallSettings).toHaveBeenCalledTimes(1);
    expect(postUpdateCallSettings).toHaveBeenCalledWith(false, 4000, false);
    expect(persistStore.llmCommanders[0].decisionIntervalMs).toBe(4000);
    expect(wrapper.text()).toContain("4s");
    await slider.trigger("input");
    expect(postUpdateCallSettings).toHaveBeenCalledTimes(1);
  });

  it("does not post call settings when the slider stays on the saved delay", async () => {
    activateLlm();
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    const slider = wrapper.find("input.chat-delay-slider");
    await slider.setValue("1");
    await slider.trigger("input");
    expect(postUpdateCallSettings).not.toHaveBeenCalled();
  });

  it("persists and posts reasoning when the checkbox is checked", async () => {
    activateLlm();
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    const reasoningInput = wrapper.find("input.chat-reasoning");
    (reasoningInput.element as HTMLInputElement).checked = true;
    await reasoningInput.trigger("change");
    expect(postUpdateCallSettings).toHaveBeenCalledWith(false, 1000, true);
    expect(persistStore.llmCommanders[0].reasoningEnabled).toBe(true);
  });

  it("renders commander chat entries from the relay", () => {
    activateLlm();
    uiStore.appendChatLog({ from: "commander", text: "hello" });
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("hello");
  });

  it("opens the response log and closes it without clearing entries", async () => {
    activateLlm();
    uiStore.appendLlmTrace({ responseText: '{"commands":[]}', commandSummary: "no commands" });
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    expect(wrapper.find(".trace-column").exists()).toBe(false);
    const toggle = wrapper.find("button.chat-log-toggle");
    await toggle.trigger("mousedown");
    await toggle.trigger("click");
    expect(wrapper.find(".trace-column").exists()).toBe(true);
    expect(wrapper.text()).toContain('{"commands":[]}');
    expect(wrapper.text()).toContain("no commands");
    await wrapper.find("button.trace-close").trigger("click");
    expect(wrapper.find(".trace-column").exists()).toBe(false);
    expect(uiStore.llmTraceLog).toHaveLength(1);
  });

  it("shows an empty response log until a turn arrives", async () => {
    activateLlm();
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    await wrapper.find("button.chat-log-toggle").trigger("click");
    expect(wrapper.text()).toContain("No responses yet.");
  });
});
