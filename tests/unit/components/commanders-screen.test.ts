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
});
