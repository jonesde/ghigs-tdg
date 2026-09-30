<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { DEFAULT_DECISION_INTERVAL_MS, normalizeDecisionIntervalMs } from "@/commanders/llm/types.js";
import { postChatToCommander, postUpdateCallSettings, postUpdateInstructions } from "@/commanders/relay.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

const uiStore = useUiStore();
const persistStore = usePersistStore();

const visible = computed(() => uiStore.activeCommanderIsLlm);

const activeCommander = computed(() =>
  persistStore.llmCommanders.find((config) => config.id === uiStore.enemyCommander),
);

const pauseForCommander = computed(() => activeCommander.value?.pauseForCommander === true);
const reasoningEnabled = computed(() => activeCommander.value?.reasoningEnabled === true);
const callDelaySeconds = computed(() =>
  Math.round((activeCommander.value?.decisionIntervalMs ?? DEFAULT_DECISION_INTERVAL_MS) / 1000),
);

function applyCallSettings(nextPause: boolean, decisionIntervalMs: number, nextReasoning: boolean) {
  const active = activeCommander.value;
  if (!active) return;
  const intervalMs = normalizeDecisionIntervalMs(decisionIntervalMs);
  if (
    active.pauseForCommander === nextPause &&
    active.decisionIntervalMs === intervalMs &&
    active.reasoningEnabled === nextReasoning
  ) {
    return;
  }
  postUpdateCallSettings(nextPause, intervalMs, nextReasoning);
  persistStore.updateLlmCommander({
    ...active,
    pauseForCommander: nextPause,
    decisionIntervalMs: intervalMs,
    reasoningEnabled: nextReasoning,
  });
}

function onPauseChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const active = activeCommander.value;
  if (!active) return;
  applyCallSettings(input.checked, active.decisionIntervalMs, active.reasoningEnabled === true);
}

function onReasoningChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const active = activeCommander.value;
  if (!active) return;
  applyCallSettings(active.pauseForCommander === true, active.decisionIntervalMs, input.checked);
}

function onDelayInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const active = activeCommander.value;
  if (!active) return;
  const seconds = Number(input.value);
  applyCallSettings(active.pauseForCommander === true, Math.round(seconds * 1000), active.reasoningEnabled === true);
}

const traceOpen = ref(false);
const traceLogElement = ref<HTMLElement | null>(null);

function scrollTraceToBottom(): void {
  const element = traceLogElement.value;
  if (!element) return;
  element.scrollTop = element.scrollHeight;
}

watch(
  () => uiStore.llmTraceLog.length,
  async () => {
    const element = traceLogElement.value;
    if (!traceOpen.value || !element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    await nextTick();
    if (nearBottom) scrollTraceToBottom();
  },
);

watch(traceOpen, async (open) => {
  if (!open) return;
  await nextTick();
  scrollTraceToBottom();
});

const instructionsText = ref("");
const lastPostedInstructions = ref("");
const messageText = ref("");
const position = ref({ x: 24, y: 24 });
const dragging = ref(false);
let dragOffsetX = 0;
let dragOffsetY = 0;

function syncInstructions() {
  instructionsText.value = activeCommander.value?.commanderInstructions ?? "";
  lastPostedInstructions.value = instructionsText.value;
}

function onInstructionsChange() {
  if (instructionsText.value === lastPostedInstructions.value) return;
  const nextText = instructionsText.value;
  lastPostedInstructions.value = nextText;
  postUpdateInstructions(nextText);
  const active = activeCommander.value;
  if (!active || active.commanderInstructions === nextText) return;
  persistStore.updateLlmCommander({ ...active, commanderInstructions: nextText });
}

function sendMessage() {
  const text = messageText.value.trim();
  if (!text) return;
  postChatToCommander(text);
  uiStore.appendChatLog({ from: "player", text });
  messageText.value = "";
}

function onHeaderMouseDown(event: MouseEvent) {
  if (!visible.value) return;
  dragging.value = true;
  dragOffsetX = event.clientX - position.value.x;
  dragOffsetY = event.clientY - position.value.y;
  if (typeof window !== "undefined") {
    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);
  }
}

function onWindowMouseMove(event: MouseEvent) {
  if (!dragging.value) return;
  position.value = { x: event.clientX - dragOffsetX, y: event.clientY - dragOffsetY };
}

function onWindowMouseUp() {
  dragging.value = false;
  if (typeof window !== "undefined") {
    window.removeEventListener("mousemove", onWindowMouseMove);
    window.removeEventListener("mouseup", onWindowMouseUp);
  }
}

onMounted(() => {
  syncInstructions();
});

watch(
  () => activeCommander.value?.id,
  () => syncInstructions(),
);

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("mousemove", onWindowMouseMove);
    window.removeEventListener("mouseup", onWindowMouseUp);
  }
});
</script>

<template>
  <div
    v-if="visible"
    class="enemy-chat"
    :class="{ 'trace-open': traceOpen }"
    :style="{ left: position.x + 'px', top: position.y + 'px' }"
    @dragstart.prevent
  >
    <div class="chat-column">
    <div class="chat-header" @mousedown="onHeaderMouseDown">
      <span>Enemy Commander</span>
      <button type="button" class="chat-log-toggle" @mousedown.stop @click="traceOpen = !traceOpen">Log</button>
    </div>

    <textarea
      class="chat-instructions"
      v-model="instructionsText"
      placeholder="Commander Instructions"
      rows="3"
      @blur="onInstructionsChange"
    ></textarea>

    <label class="chat-check">
      <input class="chat-pause" type="checkbox" :checked="pauseForCommander" @change="onPauseChange" />
      Pause for Enemy Commander
    </label>
    <label class="chat-check">
      <input class="chat-reasoning" type="checkbox" :checked="reasoningEnabled" @change="onReasoningChange" />
      Reasoning
    </label>
    <div class="chat-delay">
      <label class="chat-delay-label" for="commander-call-delay">Delay between calls</label>
      <input
        id="commander-call-delay"
        class="chat-delay-slider"
        type="range"
        min="1"
        max="10"
        step="1"
        :value="callDelaySeconds"
        @input="onDelayInput"
      />
      <span class="chat-delay-value">{{ callDelaySeconds }}s</span>
    </div>

    <div class="chat-log">
      <div v-for="(entry, index) in uiStore.chatLog" :key="index" class="chat-entry" :class="entry.from">
        <span class="chat-sender">{{ entry.from === "player" ? "You" : "Commander" }}:</span>
        <span class="chat-text">{{ entry.text }}</span>
      </div>
    </div>

    <div class="chat-input-row">
      <input
        class="chat-input"
        v-model="messageText"
        type="text"
        placeholder="Message the commander..."
        @keyup.enter="sendMessage"
      />
      <button class="chat-send" @click="sendMessage">Send</button>
    </div>
    </div>

    <div v-if="traceOpen" class="trace-column">
      <div class="trace-fill">
        <div class="trace-header">
          <span>LLM log</span>
          <button type="button" class="trace-close" @mousedown.stop @click="traceOpen = false">Close</button>
        </div>
        <div ref="traceLogElement" class="trace-log">
          <div v-if="uiStore.llmTraceLog.length === 0" class="trace-empty">No responses yet.</div>
          <article v-for="(entry, index) in uiStore.llmTraceLog" :key="index" class="trace-entry">
            <pre class="trace-response">{{ entry.responseText }}</pre>
            <pre class="trace-commands">{{ entry.commandSummary }}</pre>
          </article>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.enemy-chat {
  position: fixed;
  width: 320px;
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  z-index: 50;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.enemy-chat.trace-open {
  width: auto;
  flex-direction: row;
  align-items: stretch;
  gap: 12px;
}

.chat-column {
  width: 296px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.trace-column {
  position: relative;
  width: 360px;
  min-width: 0;
  border-left: 1px solid var(--color-border);
}

/* Out of flow so a long response scrolls inside the chat column instead of stretching the panel. */
.trace-fill {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.trace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--font-sm);
  font-weight: bold;
  color: var(--color-accent);
}

.trace-log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
}

.trace-empty {
  font-size: var(--font-sm);
  color: var(--color-text-dim);
}

.trace-entry {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.trace-response,
.trace-commands {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-main);
  font-size: var(--font-sm);
}

.trace-commands {
  color: var(--color-accent);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--font-md);
  font-weight: bold;
  color: var(--color-accent);
  cursor: move;
  user-select: none;
}

.chat-log-toggle,
.trace-close {
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-accent);
  background: rgba(95, 208, 255, 0.15);
  color: var(--color-accent);
  cursor: pointer;
  font-size: var(--font-sm);
}

.chat-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-sm);
  color: var(--color-text);
}

.chat-delay {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-delay-label {
  font-size: var(--font-sm);
  color: var(--color-text-dim);
  flex-shrink: 0;
}

.chat-delay-slider {
  flex: 1;
  min-width: 0;
}

.chat-delay-value {
  font-size: var(--font-sm);
  color: var(--color-accent);
  width: 2.5em;
  text-align: right;
}

.chat-instructions {
  width: 100%;
  resize: none;
  font-family: var(--font-main);
  font-size: var(--font-sm);
  padding: 6px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text);
}

.chat-log {
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 160px;
  overflow-y: auto;
  padding: 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
  font-size: var(--font-sm);
}

.chat-entry {
  display: flex;
  gap: 4px;
  line-height: 1.3;
}

.chat-entry.player .chat-sender {
  color: var(--color-text-dim);
}

.chat-entry.commander .chat-sender {
  color: var(--color-accent);
}

.chat-sender {
  font-weight: bold;
  flex-shrink: 0;
}

.chat-input-row {
  display: flex;
  gap: 6px;
}

.chat-input {
  flex: 1;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text);
  font-size: var(--font-sm);
}

.chat-send {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-accent);
  background: rgba(95, 208, 255, 0.15);
  color: var(--color-accent);
  cursor: pointer;
  font-size: var(--font-sm);
}
</style>
