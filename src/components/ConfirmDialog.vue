<script setup lang="ts">
import { useUiStore } from "@/stores/ui.js";

const uiStore = useUiStore();
</script>

<template>
  <Teleport to="body">
    <div v-if="uiStore.confirmDialog" class="confirm-overlay" @click.self="uiStore.hideConfirm()">
      <div class="confirm-dialog">
        <div class="confirm-title">{{ uiStore.confirmDialog.title }}</div>
        <div class="confirm-message">{{ uiStore.confirmDialog.message }}</div>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="uiStore.hideConfirm()">
            {{ uiStore.confirmDialog.cancelLabel }}
          </button>
          <button class="confirm-btn confirm" @click="uiStore.executeConfirm()">
            {{ uiStore.confirmDialog.confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.confirm-dialog {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 20px 24px;
  min-width: 300px;
  max-width: 420px;
}

.confirm-title {
  font-size: var(--font-xl);
  font-weight: bold;
  margin-bottom: 12px;
  color: var(--color-accent);
}

.confirm-message {
  font-size: var(--font-md);
  color: var(--color-text);
  margin-bottom: 16px;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.confirm-btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--color-line-strong);
  cursor: pointer;
  font-size: var(--font-md);
  transition: background 0.15s;
}

.confirm-btn.cancel {
  background: var(--color-surface);
  color: var(--color-text);
}

.confirm-btn.cancel:hover {
  background: var(--color-surface-hover);
}

.confirm-btn.confirm {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.confirm-btn.confirm:hover {
  background: var(--color-accent-hover);
}
</style>
