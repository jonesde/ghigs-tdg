<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { BUILTIN_STUBBS, BUILTIN_STUBBY } from "@/commanders/index.js";
import { normalizeEndpointUrl } from "@/commanders/llm/apiClient.js";
import { DEFAULT_LLM_SYSTEM_PROMPT, type LlmCommanderConfig } from "@/commanders/llm/types.js";
import { postUpdateInstructions } from "@/commanders/relay.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

const router = useRouter();
const persistStore = usePersistStore();
const uiStore = useUiStore();

const showForm = ref(false);
const editingId = ref<string | null>(null);
const formError = ref("");

const formName = ref("");
const formEndpointUrl = ref("");
const formToken = ref("");
const formModelName = ref("");
const formContextLimit = ref(32768);
const formCommanderInstructions = ref("");
const formSystemPrompt = ref(DEFAULT_LLM_SYSTEM_PROMPT);

function openNewForm() {
  editingId.value = null;
  formName.value = "";
  formEndpointUrl.value = "";
  formToken.value = "";
  formModelName.value = "";
  formContextLimit.value = 32768;
  formCommanderInstructions.value = "";
  formSystemPrompt.value = DEFAULT_LLM_SYSTEM_PROMPT;
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
            Endpoint, token, and model name apply the next time this commander is activated. Commander Instructions
            apply immediately.
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

          <label class="form-label">Commander Instructions</label>
          <textarea class="form-textarea" v-model="formCommanderInstructions" rows="3"></textarea>

          <label class="form-label">System Prompt *</label>
          <textarea class="form-textarea" v-model="formSystemPrompt" rows="5"></textarea>

          <div class="form-actions">
            <button class="form-btn cancel" @click="closeForm()">Cancel</button>
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

.form-btn.confirm {
  background: rgba(95, 208, 255, 0.15);
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
