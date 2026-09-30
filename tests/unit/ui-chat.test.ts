// @ts-nocheck
/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/commanders/index.js", () => ({
  BUILTIN_STUBBY: "stubby",
  BUILTIN_STUBBS: "stubbs",
  setEnemyCommander: vi.fn(),
}));

import { createTestUiStore } from "../helpers/mock-stores";

describe("UiStore chat log", () => {
  let store: ReturnType<typeof createTestUiStore>;

  beforeEach(() => {
    store = createTestUiStore();
  });

  it("starts with an empty chatLog", () => {
    expect(store.chatLog).toEqual([]);
  });

  it("appendChatLog pushes entries", () => {
    store.appendChatLog({ from: "player", text: "hi" });
    expect(store.chatLog).toEqual([{ from: "player", text: "hi" }]);
  });

  it("appendChatLog caps at the most recent 20 entries", () => {
    for (let index = 0; index < 25; index++) {
      store.appendChatLog({ from: "commander", text: `m${index}` });
    }
    expect(store.chatLog.length).toBe(20);
    expect(store.chatLog[0]).toEqual({ from: "commander", text: "m5" });
    expect(store.chatLog[19]).toEqual({ from: "commander", text: "m24" });
  });

  it("clearChatLog empties the log", () => {
    store.appendChatLog({ from: "player", text: "hi" });
    store.clearChatLog();
    expect(store.chatLog).toEqual([]);
  });

  it("setEnemyCommander clears the chatLog", () => {
    store.appendChatLog({ from: "player", text: "hi" });
    store.setEnemyCommander("none");
    expect(store.chatLog).toEqual([]);
  });

  it("appendLlmTrace caps at the most recent 50 entries and trims a long response", () => {
    store.appendLlmTrace({ responseText: "x".repeat(8001), commandSummary: "no commands" });
    expect(store.llmTraceLog[0].responseText).toBe(`${"x".repeat(8000)}…`);
    for (let index = 0; index < 50; index++) {
      store.appendLlmTrace({ responseText: `r${index}`, commandSummary: "no commands" });
    }
    expect(store.llmTraceLog.length).toBe(50);
    expect(store.llmTraceLog[0].responseText).toBe("r0");
    expect(store.llmTraceLog[49].responseText).toBe("r49");
  });

  it("setEnemyCommander clears the llm trace log", () => {
    store.appendLlmTrace({ responseText: "[]", commandSummary: "no commands" });
    store.setEnemyCommander("none");
    expect(store.llmTraceLog).toEqual([]);
  });

  it("activeCommanderIsLlm is false for none", () => {
    store.enemyCommander = "none";
    expect(store.activeCommanderIsLlm).toBe(false);
  });

  it("activeCommanderIsLlm is false for built-ins", () => {
    store.enemyCommander = "stubby";
    expect(store.activeCommanderIsLlm).toBe(false);
    store.enemyCommander = "stubbs";
    expect(store.activeCommanderIsLlm).toBe(false);
  });

  it("activeCommanderIsLlm is true for an LLM id", () => {
    store.enemyCommander = "l_some-id";
    expect(store.activeCommanderIsLlm).toBe(true);
  });
});
