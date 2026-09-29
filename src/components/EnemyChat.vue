<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { postChatToCommander, postUpdateInstructions } from "@/commanders/relay.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

const uiStore = useUiStore();
const persistStore = usePersistStore();

const visible = computed(() => uiStore.activeCommanderIsLlm);

const activeCommander = computed(() =>
  persistStore.llmCommanders.find((config) => config.id === uiStore.enemyCommander),
);

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
    :style="{ left: position.x + 'px', top: position.y + 'px' }"
    @dragstart.prevent
  >
    <div class="chat-header" @mousedown="onHeaderMouseDown">Enemy Commander</div>

    <textarea
      class="chat-instructions"
      v-model="instructionsText"
      placeholder="Commander Instructions"
      rows="3"
      @change="onInstructionsChange"
      @blur="onInstructionsChange"
    ></textarea>

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
</template>

<style scoped>
.enemy-chat {
  position: fixed;
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  z-index: 50;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.chat-header {
  font-size: var(--font-md);
  font-weight: bold;
  color: var(--color-accent);
  cursor: move;
  user-select: none;
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
