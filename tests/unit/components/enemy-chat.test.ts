// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EnemyChat from "@/components/EnemyChat.vue";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

vi.mock("@/commanders/relay.js", () => ({ postChatToCommander: vi.fn(), postUpdateInstructions: vi.fn() }));

import { postChatToCommander, postUpdateInstructions } from "@/commanders/relay.js";

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
    await textarea.trigger("change");
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
    });
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    uiStore.enemyCommander = "l_2";
    await wrapper.vm.$nextTick();
    const textarea = wrapper.find("textarea.chat-instructions");
    expect((textarea.element as HTMLTextAreaElement).value).toBe("second orders");
    await textarea.trigger("blur");
    expect(postUpdateInstructions).not.toHaveBeenCalled();
  });

  it("renders commander chat entries from the relay", () => {
    activateLlm();
    uiStore.appendChatLog({ from: "commander", text: "hello" });
    const wrapper = mount(EnemyChat, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("hello");
  });
});
