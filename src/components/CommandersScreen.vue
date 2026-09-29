<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { BUILTIN_STUBBS, BUILTIN_STUBBY } from "@/commanders/index.js";
import { createApiClient, normalizeEndpointUrl } from "@/commanders/llm/apiClient.js";
import {
  DEFAULT_LLM_SYSTEM_PROMPT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type LlmCommanderConfig,
  MAX_REQUEST_TIMEOUT_MS,
  MIN_REQUEST_TIMEOUT_MS,
} from "@/commanders/llm/types.js";
import { postUpdateInstructions } from "@/commanders/relay.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

const router = useRouter();
const persistStore = usePersistStore();
const uiStore = useUiStore();

const showForm = ref(false);
const notificationVisible = ref(false);
let notificationCheckId: ReturnType<typeof setInterval> | null = null;

function shouldShowNotification(): boolean {
  const notification = uiStore.notification;
  if (!notification) return false;
  if (Date.now() > notification.expires) {
    uiStore.hideNotification();
    return false;
  }
  return true;
}

watch(
  () => uiStore.notification,
  () => {
    notificationVisible.value = shouldShowNotification();
  },
);

onMounted(() => {
  notificationCheckId = setInterval(() => {
    notificationVisible.value = shouldShowNotification();
  }, 200);
});

onUnmounted(() => {
  if (notificationCheckId !== null) clearInterval(notificationCheckId);
});
const editingId = ref<string | null>(null);
const formError = ref("");

const formName = ref("");
const formEndpointUrl = ref("");
const formToken = ref("");
const formModelName = ref("");
const formContextLimit = ref(32768);
const formCommanderInstructions = ref("");
const formSystemPrompt = ref(DEFAULT_LLM_SYSTEM_PROMPT);
const formRequestTimeoutSeconds = ref(DEFAULT_REQUEST_TIMEOUT_MS / 1000);
const formPauseForCommander = ref(false);

function requestTimeoutMsFromSeconds(secondsValue: number): number {
  const milliseconds = Math.round(Number(secondsValue) * 1000);
  if (!Number.isFinite(milliseconds)) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(MAX_REQUEST_TIMEOUT_MS, Math.max(MIN_REQUEST_TIMEOUT_MS, milliseconds));
}

function openNewForm() {
  editingId.value = null;
  formName.value = "";
  formEndpointUrl.value = "";
  formToken.value = "";
  formModelName.value = "";
  formContextLimit.value = 32768;
  formCommanderInstructions.value = "";
  formSystemPrompt.value = DEFAULT_LLM_SYSTEM_PROMPT;
  formRequestTimeoutSeconds.value = DEFAULT_REQUEST_TIMEOUT_MS / 1000;
  formPauseForCommander.value = false;
  formError.value = "";
  showForm.value = true;
}

function openEditForm(config: LlmCommanderConfig) {
  editingId.value = config.id;
  formName.value = config.name;
  formEndpointUrl.value = config.endpointUrl;
  formToken.value = config.token;
  formModelName.value = config.modelName;
  formContextLimit.value = config.contextLimit;
  formCommanderInstructions.value = config.commanderInstructions;
  formSystemPrompt.value = config.systemPrompt;
  formRequestTimeoutSeconds.value = config.requestTimeoutMs / 1000;
  formPauseForCommander.value = config.pauseForCommander === true;
  formError.value = "";
  showForm.value = true;
}

function closeForm() {
  showForm.value = false;
  editingId.value = null;
}

function saveForm() {
  if (!formName.value.trim() || !formEndpointUrl.value.trim() || !formSystemPrompt.value.trim()) {
    formError.value = "Name, Endpoint URL, and System Prompt are required.";
    return;
  }
  const contextLimit = Number.parseInt(String(formContextLimit.value), 10);
  const previous = editingId.value
    ? persistStore.llmCommanders.find((entry) => entry.id === editingId.value)
    : undefined;
  const config: LlmCommanderConfig = {
    id: editingId.value ?? persistStore.generateCommanderId(),
    name: formName.value.trim(),
    endpointUrl: normalizeEndpointUrl(formEndpointUrl.value.trim()),
    token: formToken.value.trim(),
    modelName: formModelName.value.trim(),
    contextLimit: Number.isFinite(contextLimit) && contextLimit > 0 ? contextLimit : 32768,
    commanderInstructions: formCommanderInstructions.value,
    systemPrompt: formSystemPrompt.value.trim(),
    requestTimeoutMs: requestTimeoutMsFromSeconds(formRequestTimeoutSeconds.value),
    pauseForCommander: formPauseForCommander.value,
  };
  if (editingId.value) {
    persistStore.updateLlmCommander(config);
    if (
      previous &&
      uiStore.enemyCommander === config.id &&
      previous.commanderInstructions !== config.commanderInstructions
    ) {
      postUpdateInstructions(config.commanderInstructions);
    }
  } else {
    persistStore.addLlmCommander(config);
  }
  closeForm();
}

async function testEndpoint(): Promise<void> {
  const probeText = "Reply with [] and nothing else.";
  const config: LlmCommanderConfig = {
    id: "endpoint-test",
    name: "endpoint-test",
    endpointUrl: formEndpointUrl.value,
    token: formToken.value.trim(),
    modelName: formModelName.value.trim(),
    contextLimit: 32768,
    commanderInstructions: "",
    systemPrompt: probeText,
    requestTimeoutMs: requestTimeoutMsFromSeconds(formRequestTimeoutSeconds.value),
    pauseForCommander: formPauseForCommander.value,
  };
  // Ornith/Qwen chat templates reject a system-only body. The probe needs a user turn.
  const result = await createApiClient().complete(config.systemPrompt, [{ role: "user", content: probeText }], config);
  if ("content" in result) {
    uiStore.showNotification("Endpoint accepted a request.");
    return;
  }
  const reason = "error" in result ? result.error : "empty response";
  uiStore.showNotification(`LLM request failed: ${reason}`);
}

function deleteCommander(id: string) {
  if (uiStore.enemyCommander === id) uiStore.setEnemyCommander("none");
  persistStore.deleteLlmCommander(id);
}

function isActive(id: string): boolean {
  return uiStore.enemyCommander === id;
}

function goBack() {
  router.push("/");
}
</script>

<template>
  <div class="commanders-screen">
    <Teleport to="body">
      <div v-if="notificationVisible" class="commander-toast">{{ uiStore.notification?.message }}</div>
    </Teleport>
    <div class="commanders-content">
      <h1 class="screen-title">Enemy Commanders</h1>

      <section class="commander-section">
        <h2 class="section-title">Built-in Commanders</h2>
        <div class="card-row">
          <div class="commander-card">
            <div class="card-name">Sergeant Stubby</div>
            <div class="card-desc">Holds emerging enemies, then rushes the wave to the base.</div>
            <div class="card-actions">
              <span v-if="isActive(BUILTIN_STUBBY)" class="active-badge">Active</span>
              <button class="card-btn" @click="uiStore.setEnemyCommander(BUILTIN_STUBBY)">Activate</button>
            </div>
          </div>
          <div class="commander-card">
            <div class="card-name">Commander Stubbs</div>
            <div class="card-desc">Aggressively routes enemies to the highest-HP tower ahead.</div>
            <div class="card-actions">
              <span v-if="isActive(BUILTIN_STUBBS)" class="active-badge">Active</span>
              <button class="card-btn" @click="uiStore.setEnemyCommander(BUILTIN_STUBBS)">Activate</button>
            </div>
          </div>
        </div>
      </section>

      <section class="commander-section">
        <h2 class="section-title">LLM Commanders</h2>
        <div v-if="persistStore.llmCommanders.length === 0" class="empty-hint">
          No LLM commanders yet.
        </div>
        <div v-else class="card-row">
          <div v-for="commander in persistStore.llmCommanders" :key="commander.id" class="commander-card">
            <div class="card-name">{{ commander.name }}</div>
            <div class="card-desc">{{ commander.endpointUrl }}</div>
            <div class="card-actions">
              <span v-if="isActive(commander.id)" class="active-badge">Active</span>
              <button class="card-btn" @click="uiStore.setEnemyCommander(commander.id)">Activate</button>
              <button class="card-btn" @click="openEditForm(commander)">Edit</button>
              <button class="card-btn danger" @click="deleteCommander(commander.id)">Delete</button>
            </div>
          </div>
        </div>
        <button class="new-btn" @click="openNewForm()">New LLM Commander</button>
      </section>

      <button class="back-btn" @click="goBack()">Back</button>
    </div>

    <Teleport to="body">
      <div v-if="showForm" class="form-overlay" @click.self="closeForm()">
        <div class="form-dialog">
          <div class="form-title">{{ editingId ? "Edit LLM Commander" : "New LLM Commander" }}</div>
          <div v-if="editingId && isActive(editingId)" class="form-hint">
            Endpoint, token, model name, request timeout, and Pause for Enemy Commander apply the next time this
            commander is activated. Commander Instructions apply immediately.
          </div>
          <div v-if="formError" class="form-error">{{ formError }}</div>

          <label class="form-label">Name *</label>
          <input class="form-input" v-model="formName" type="text" />

          <label class="form-label">Endpoint URL *</label>
          <input class="form-input" v-model="formEndpointUrl" type="text" placeholder="host:port or https://..." />
          <div class="form-hint">
            A bare host:port becomes http://host:port/v1. A bare value that already ends in /v1 is kept once. An
            http:// or https:// URL is stored as entered.
          </div>

          <label class="form-label">Token / API Key</label>
          <input class="form-input" v-model="formToken" type="password" />

          <label class="form-label">Model name</label>
          <input class="form-input" v-model="formModelName" type="text" placeholder="optional" />

          <label class="form-label">Context limit (tokens)</label>
          <input class="form-input" v-model="formContextLimit" type="number" />

          <label class="form-label">Request timeout (seconds)</label>
          <input class="form-input" v-model.number="formRequestTimeoutSeconds" type="number" min="1" max="180" />

          <label class="form-check">
            <input class="commander-pause" type="checkbox" v-model="formPauseForCommander" />
            Pause for Enemy Commander
          </label>
          <div class="form-hint">
            Stops the sim clock while a request is in flight and resumes it when the reply is applied. A manual pause
            stays paused.
          </div>

          <label class="form-label">Commander Instructions</label>
          <textarea class="form-textarea" v-model="formCommanderInstructions" rows="3"></textarea>

          <label class="form-label">System Prompt *</label>
          <textarea class="form-textarea" v-model="formSystemPrompt" rows="5"></textarea>

          <div class="form-actions">
            <button class="form-btn cancel" @click="closeForm()">Cancel</button>
            <button class="form-btn" @click="testEndpoint()">Test</button>
            <button class="form-btn confirm" @click="saveForm()">Save</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.commanders-screen {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  background: rgba(0, 0, 0, 0.7);
  overflow-y: auto;
}

.commanders-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 32px;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 16px;
  min-width: 520px;
  max-width: 720px;
}

.screen-title {
  font-size: var(--font-2xl);
  color: var(--color-accent);
  text-align: center;
}

.section-title {
  font-size: var(--font-lg);
  color: var(--color-text-dim);
  margin-bottom: 8px;
}

.card-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.commander-card {
  flex: 1 1 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
}

.card-name {
  font-size: var(--font-md);
  font-weight: bold;
  color: var(--color-text);
}

.card-desc {
  font-size: var(--font-xs);
  color: var(--color-text-dim);
  flex: 1;
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.card-btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text);
  cursor: pointer;
  font-size: var(--font-sm);
}

.card-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.card-btn.danger {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.active-badge {
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(95, 208, 255, 0.15);
  border: 1px solid var(--color-accent);
  color: var(--color-accent);
  font-size: var(--font-xs);
}

.empty-hint {
  font-size: var(--font-sm);
  color: var(--color-text-dim);
  margin-bottom: 8px;
}

.new-btn {
  margin-top: 12px;
  padding: 10px 18px;
  border-radius: 8px;
  border: 1px solid var(--color-accent);
  background: rgba(95, 208, 255, 0.12);
  color: var(--color-accent);
  cursor: pointer;
  align-self: flex-start;
  font-size: var(--font-md);
}

.back-btn {
  padding: 10px 18px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text);
  cursor: pointer;
  align-self: center;
  font-size: var(--font-md);
}

.form-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.form-dialog {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 20px 24px;
  width: 460px;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-title {
  font-size: var(--font-xl);
  font-weight: bold;
  color: var(--color-accent);
  margin-bottom: 8px;
}

.form-error {
  color: var(--color-danger);
  font-size: var(--font-sm);
}

.form-label {
  font-size: var(--font-sm);
  color: var(--color-text-dim);
  margin-top: 6px;
}

.form-check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: var(--font-sm);
  color: var(--color-text);
}

.form-input,
.form-textarea {
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text);
  font-size: var(--font-sm);
  font-family: var(--font-main);
}

.form-textarea {
  resize: vertical;
}

.form-hint {
  font-size: var(--font-xs);
  color: var(--color-text-dim);
}

.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}

.form-btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  cursor: pointer;
  font-size: var(--font-md);
}

.form-btn.cancel {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text);
}

.commander-toast {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 400;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 8px 16px;
  color: var(--color-text);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.form-btn.confirm {
  background: rgba(95, 208, 255, 0.15);
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
