// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteRecordRaw } from "vue-router";
import { createMemoryHistory, createRouter } from "vue-router";
import CommandersScreen from "@/components/CommandersScreen.vue";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

vi.mock("@/commanders/index.js", () => ({
  BUILTIN_STUBBY: "stubby",
  BUILTIN_STUBBS: "stubbs",
  setEnemyCommander: vi.fn(),
}));

import { setEnemyCommander } from "@/commanders/index.js";

function createTestRouter(): ReturnType<typeof createRouter> {
  const routes: RouteRecordRaw[] = [
    { path: "/", name: "main-menu", component: { template: "<div/>" } },
    { path: "/commanders", name: "commanders", component: { template: "<div/>" } },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

describe("CommandersScreen", () => {
  let pinia: ReturnType<typeof createPinia>;
  let persistStore: ReturnType<typeof usePersistStore>;
  let uiStore: ReturnType<typeof useUiStore>;
  let router: ReturnType<typeof createRouter>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    persistStore = usePersistStore();
    uiStore = useUiStore();
    router = createTestRouter();
  });

  it("renders the two built-in commanders", () => {
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Sergeant Stubby");
    expect(wrapper.text()).toContain("Commander Stubbs");
  });

  it("shows a hint when there are no LLM commanders", () => {
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("No LLM commanders yet.");
  });

  it("renders an LLM commander from the persist store", () => {
    persistStore.addLlmCommander({
      id: "l_1",
      name: "My LLM",
      endpointUrl: "http://localhost:11434/v1",
      token: "",
      modelName: "",
      contextLimit: 32768,
      commanderInstructions: "",
      systemPrompt: "sys",
      requestTimeoutMs: 30000,
      pauseForCommander: false,
      decisionIntervalMs: 1000,
    });
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("My LLM");
  });

  it("adds a new LLM commander through the form", async () => {
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("New LLM Commander"))!
      .trigger("click");
    // The form is rendered via Teleport to <body>, so query the live DOM.
    const inputs = document.body.querySelectorAll("input.form-input");
    const nameInput = inputs[0] as HTMLInputElement;
    const endpointInput = inputs[1] as HTMLInputElement;
    nameInput.value = "Fresh Commander";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    endpointInput.value = "localhost:1234";
    endpointInput.dispatchEvent(new Event("input", { bubbles: true }));
    const saveButton = document.body.querySelector("button.form-btn.confirm") as HTMLButtonElement;
    saveButton.click();
    await Promise.resolve();
    expect(persistStore.llmCommanders.length).toBe(1);
    expect(persistStore.llmCommanders[0].name).toBe("Fresh Commander");
    expect(persistStore.llmCommanders[0].endpointUrl).toBe("http://localhost:1234/v1");
    expect(persistStore.llmCommanders[0].pauseForCommander).toBe(false);
    expect(persistStore.llmCommanders[0].decisionIntervalMs).toBe(1000);
  });

  it("activates a built-in commander via setEnemyCommander", async () => {
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find(
        (button) =>
          button.text() === "Activate" &&
          button.element.parentElement?.parentElement?.textContent?.includes("Sergeant Stubby"),
      )!
      .trigger("click");
    expect(setEnemyCommander).toHaveBeenCalledWith("stubby");
  });

  it("renders an active badge when the built-in is the active commander", () => {
    uiStore.enemyCommander = "stubby";
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Active");
  });

  function addCommander(id: string, name: string) {
    persistStore.addLlmCommander({
      id,
      name,
      endpointUrl: "http://localhost:11434/v1",
      token: "",
      modelName: "",
      contextLimit: 32768,
      commanderInstructions: "",
      systemPrompt: "sys",
      requestTimeoutMs: 30000,
      pauseForCommander: false,
      decisionIntervalMs: 1000,
    });
  }

  it("clears the selection when the active LLM commander is deleted", async () => {
    addCommander("l_1", "My LLM");
    uiStore.enemyCommander = "l_1";
    vi.mocked(setEnemyCommander).mockClear();
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Delete")!
      .trigger("click");
    expect(setEnemyCommander).toHaveBeenCalledWith("none");
    expect(persistStore.llmCommanders).toHaveLength(0);
    expect(uiStore.enemyCommander).toBe("none");
  });

  it("leaves the active commander in place when a different one is deleted", async () => {
    addCommander("l_1", "Kept");
    addCommander("l_2", "Other LLM");
    uiStore.enemyCommander = "l_1";
    vi.mocked(setEnemyCommander).mockClear();
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    const card = wrapper.findAll(".commander-card").find((node) => node.text().includes("Other LLM"));
    await card!
      .findAll("button")
      .find((button) => button.text() === "Delete")!
      .trigger("click");
    expect(setEnemyCommander).not.toHaveBeenCalled();
    expect(uiStore.enemyCommander).toBe("l_1");
    expect(persistStore.llmCommanders.map((commander) => commander.id)).toEqual(["l_1"]);
  });

  it("saves the timeout field as milliseconds", async () => {
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("New LLM Commander"))!
      .trigger("click");
    const inputs = document.body.querySelectorAll("input.form-input");
    const nameInput = inputs[0] as HTMLInputElement;
    const endpointInput = inputs[1] as HTMLInputElement;
    const timeoutInput = inputs[5] as HTMLInputElement;
    nameInput.value = "Timed Commander";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    endpointInput.value = "localhost:1234";
    endpointInput.dispatchEvent(new Event("input", { bubbles: true }));
    timeoutInput.value = "45";
    timeoutInput.dispatchEvent(new Event("input", { bubbles: true }));
    const saveButton = document.body.querySelector("button.form-btn.confirm") as HTMLButtonElement;
    saveButton.click();
    await Promise.resolve();
    expect(persistStore.llmCommanders[0].requestTimeoutMs).toBe(45000);
  });

  it("saves Pause for Enemy Commander when the checkbox is checked", async () => {
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("New LLM Commander"))!
      .trigger("click");
    const inputs = document.body.querySelectorAll("input.form-input");
    const nameInput = inputs[0] as HTMLInputElement;
    const endpointInput = inputs[1] as HTMLInputElement;
    nameInput.value = "Holding Commander";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    endpointInput.value = "localhost:1234";
    endpointInput.dispatchEvent(new Event("input", { bubbles: true }));
    const pauseInput = document.body.querySelector("input.commander-pause") as HTMLInputElement;
    expect(document.body.textContent).toContain("Pause for Enemy Commander");
    pauseInput.click();
    const saveButton = document.body.querySelector("button.form-btn.confirm") as HTMLButtonElement;
    saveButton.click();
    await Promise.resolve();
    expect(persistStore.llmCommanders[0].pauseForCommander).toBe(true);
  });

  it("keeps decisionIntervalMs when an edit is saved", async () => {
    persistStore.addLlmCommander({
      id: "l_1",
      name: "My LLM",
      endpointUrl: "http://localhost:11434/v1",
      token: "",
      modelName: "",
      contextLimit: 32768,
      commanderInstructions: "",
      systemPrompt: "sys",
      requestTimeoutMs: 30000,
      pauseForCommander: true,
      decisionIntervalMs: 4000,
      reasoningEnabled: true,
    });
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Edit")!
      .trigger("click");
    const nameInput = document.body.querySelectorAll("input.form-input")[0] as HTMLInputElement;
    nameInput.value = "Renamed";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    const saveButton = document.body.querySelector("button.form-btn.confirm") as HTMLButtonElement;
    saveButton.click();
    await Promise.resolve();
    expect(persistStore.llmCommanders[0].name).toBe("Renamed");
    expect(persistStore.llmCommanders[0].decisionIntervalMs).toBe(4000);
    expect(persistStore.llmCommanders[0].pauseForCommander).toBe(true);
    expect(persistStore.llmCommanders[0].reasoningEnabled).toBe(true);
  });

  it("saves temperature defaults for a new commander", async () => {
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("New LLM Commander"))!
      .trigger("click");
    const inputs = document.body.querySelectorAll("input.form-input");
    const nameInput = inputs[0] as HTMLInputElement;
    const endpointInput = inputs[1] as HTMLInputElement;
    const temperatureOffInput = inputs[6] as HTMLInputElement;
    const temperatureOnInput = inputs[7] as HTMLInputElement;
    expect(temperatureOffInput.value).toBe("0.7");
    expect(temperatureOnInput.value).toBe("0.6");
    nameInput.value = "Cool Commander";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    endpointInput.value = "localhost:1234";
    endpointInput.dispatchEvent(new Event("input", { bubbles: true }));
    const saveButton = document.body.querySelector("button.form-btn.confirm") as HTMLButtonElement;
    saveButton.click();
    await Promise.resolve();
    expect(persistStore.llmCommanders[0].temperatureReasoningOff).toBe(0.7);
    expect(persistStore.llmCommanders[0].temperatureReasoningOn).toBe(0.6);
  });

  it("saves custom temperatures and preserves them across an edit", async () => {
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("New LLM Commander"))!
      .trigger("click");
    let inputs = document.body.querySelectorAll("input.form-input");
    (inputs[0] as HTMLInputElement).value = "Warm Commander";
    inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    (inputs[1] as HTMLInputElement).value = "localhost:1234";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    (inputs[6] as HTMLInputElement).value = "1.2";
    inputs[6].dispatchEvent(new Event("input", { bubbles: true }));
    (inputs[7] as HTMLInputElement).value = "0.3";
    inputs[7].dispatchEvent(new Event("input", { bubbles: true }));
    (document.body.querySelector("button.form-btn.confirm") as HTMLButtonElement).click();
    await Promise.resolve();
    expect(persistStore.llmCommanders[0].temperatureReasoningOff).toBe(1.2);
    expect(persistStore.llmCommanders[0].temperatureReasoningOn).toBe(0.3);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Edit")!
      .trigger("click");
    inputs = document.body.querySelectorAll("input.form-input");
    expect((inputs[6] as HTMLInputElement).value).toBe("1.2");
    expect((inputs[7] as HTMLInputElement).value).toBe("0.3");
    (document.body.querySelector("button.form-btn.confirm") as HTMLButtonElement).click();
    await Promise.resolve();
    expect(persistStore.llmCommanders[0].temperatureReasoningOff).toBe(1.2);
    expect(persistStore.llmCommanders[0].temperatureReasoningOn).toBe(0.3);
  });

  it("clamps an out-of-range temperature to the default on save", async () => {
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("New LLM Commander"))!
      .trigger("click");
    const inputs = document.body.querySelectorAll("input.form-input");
    (inputs[0] as HTMLInputElement).value = "Clamped Commander";
    inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    (inputs[1] as HTMLInputElement).value = "localhost:1234";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    (inputs[6] as HTMLInputElement).value = "9";
    inputs[6].dispatchEvent(new Event("input", { bubbles: true }));
    (document.body.querySelector("button.form-btn.confirm") as HTMLButtonElement).click();
    await Promise.resolve();
    expect(persistStore.llmCommanders[0].temperatureReasoningOff).toBe(0.7);
    expect(persistStore.llmCommanders[0].temperatureReasoningOn).toBe(0.6);
  });

  it("tests the endpoint without adding a commander", async () => {
    let requestBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        requestBody = typeof init?.body === "string" ? init.body : "";
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: "[]" } }], usage: { prompt_tokens: 1 } }),
        };
      }),
    );
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("New LLM Commander"))!
      .trigger("click");
    const testButton = [...document.body.querySelectorAll("button")].find((button) => button.textContent === "Test");
    testButton?.click();
    await vi.waitUntil(() => document.body.textContent?.includes("Endpoint accepted a request."));
    expect(persistStore.llmCommanders).toHaveLength(0);
    const parsed = JSON.parse(requestBody) as { messages?: Array<{ role?: string; content?: string }> };
    const messages = parsed.messages ?? [];
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage?.role).toBe("user");
    expect(lastMessage?.content).toBe("Reply with [] and nothing else.");
    vi.unstubAllGlobals();
  });

  it("saves decision-interval and reasoning defaults for a new commander", async () => {
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("New LLM Commander"))!
      .trigger("click");
    // An earlier test leaves its form open in <body>; scope to the newest dialog.
    const dialogs = document.body.querySelectorAll(".form-dialog");
    const dialog = dialogs[dialogs.length - 1] as HTMLElement;
    const inputs = dialog.querySelectorAll("input.form-input");
    const decisionInput = inputs[8] as HTMLInputElement;
    const reasoningInput = dialog.querySelector("input.commander-reasoning") as HTMLInputElement;
    expect(decisionInput.value).toBe("1");
    expect(reasoningInput.checked).toBe(false);
    const nameInput = inputs[0] as HTMLInputElement;
    const endpointInput = inputs[1] as HTMLInputElement;
    nameInput.value = "Defaulted Commander";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    endpointInput.value = "localhost:1234";
    endpointInput.dispatchEvent(new Event("input", { bubbles: true }));
    const saveButton = dialog.querySelector("button.form-btn.confirm") as HTMLButtonElement;
    saveButton.click();
    await Promise.resolve();
    expect(persistStore.llmCommanders[0].decisionIntervalMs).toBe(1000);
    expect(persistStore.llmCommanders[0].reasoningEnabled).toBe(false);
  });

  it("saves a custom decision interval and reasoning, preserved across an edit", async () => {
    const wrapper = mount(CommandersScreen, { global: { plugins: [router, pinia] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("New LLM Commander"))!
      .trigger("click");
    let dialogs = document.body.querySelectorAll(".form-dialog");
    let dialog = dialogs[dialogs.length - 1] as HTMLElement;
    let inputs = dialog.querySelectorAll("input.form-input");
    (inputs[0] as HTMLInputElement).value = "Thinking Commander";
    inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    (inputs[1] as HTMLInputElement).value = "localhost:1234";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    (inputs[8] as HTMLInputElement).value = "4";
    inputs[8].dispatchEvent(new Event("input", { bubbles: true }));
    (dialog.querySelector("input.commander-reasoning") as HTMLInputElement).click();
    (dialog.querySelector("button.form-btn.confirm") as HTMLButtonElement).click();
    await Promise.resolve();
    expect(persistStore.llmCommanders[0].decisionIntervalMs).toBe(4000);
    expect(persistStore.llmCommanders[0].reasoningEnabled).toBe(true);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Edit")!
      .trigger("click");
    dialogs = document.body.querySelectorAll(".form-dialog");
    dialog = dialogs[dialogs.length - 1] as HTMLElement;
    inputs = dialog.querySelectorAll("input.form-input");
    expect((inputs[8] as HTMLInputElement).value).toBe("4");
    expect((dialog.querySelector("input.commander-reasoning") as HTMLInputElement).checked).toBe(true);
    (dialog.querySelector("button.form-btn.confirm") as HTMLButtonElement).click();
    await Promise.resolve();
    expect(persistStore.llmCommanders[0].decisionIntervalMs).toBe(4000);
    expect(persistStore.llmCommanders[0].reasoningEnabled).toBe(true);
  });
});
