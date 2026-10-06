<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { progressiveRerollGoldPerWave } from "@/sim/Constants.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { useUiStore } from "@/stores/ui.js";
import HelpEnemyTab from "./HelpEnemyTab.vue";
import HelpTowerTab from "./HelpTowerTab.vue";

const uiStore = useUiStore();
const themeStore = useMapThemeStore();

// The re-roll row has to quote the active world's price, not the content-pack
// default: a theme maps override changes what the button actually charges.
const rerollGoldPerWave = computed(() => progressiveRerollGoldPerWave(themeStore.activeTheme?.maps));

type HelpTabId = "howto" | "towers" | "enemies";
const helpTabs: Array<{ id: HelpTabId; label: string }> = [
  { id: "howto", label: "How to Play" },
  { id: "towers", label: "Towers" },
  { id: "enemies", label: "Enemies" },
];
const activeHelpTab = ref<HelpTabId>("howto");

// WAI-ARIA tabs pattern: one tab stop for the whole strip, arrow keys move
// between tabs and select as they go. Selection has to carry focus with it —
// the newly selected tab is the one with tabindex="0", so leaving focus on the
// deselected one strands the keyboard user on a tab they can no longer reach.
const tabElements = new Map<HelpTabId, HTMLButtonElement>();

function setTabElement(id: HelpTabId, element: unknown): void {
  if (element instanceof HTMLButtonElement) {
    tabElements.set(id, element);
  } else {
    tabElements.delete(id);
  }
}

function selectTab(id: HelpTabId): void {
  activeHelpTab.value = id;
  void nextTick(() => tabElements.get(id)?.focus());
}

function onTabKeydown(event: KeyboardEvent): void {
  const currentIndex = helpTabs.findIndex((tab) => tab.id === activeHelpTab.value);
  let nextIndex: number;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % helpTabs.length;
  else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + helpTabs.length) % helpTabs.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = helpTabs.length - 1;
  else return;
  event.preventDefault();
  const nextTab = helpTabs[nextIndex];
  if (nextTab) selectTab(nextTab.id);
}

const KEYBOARD_Y = 70;
const KEY_SIZE = 28;
const KEY_STEP = 30;
const ROW_STEP = 32;

const buildRow = (
  rowIndex: number,
  keys: Array<{ label: string; width: number; highlighted?: boolean }>,
  arrowOffset = false,
) => {
  const baseY = KEYBOARD_Y + rowIndex * ROW_STEP + (arrowOffset ? 8 : 0);
  let currentX = 0;
  return keys.map((key) => {
    const keyData = {
      label: key.label,
      width: key.width,
      x: currentX,
      y: baseY,
      highlighted: key.highlighted ?? false,
    };
    currentX += key.width + 2;
    return keyData;
  });
};

const row0 = buildRow(0, [
  { label: "Esc", width: KEY_SIZE, highlighted: true },
  ...Array.from({ length: 9 }, (_, i) => ({ label: String(i + 1), width: KEY_SIZE, highlighted: true })),
  { label: "0", width: KEY_SIZE },
  { label: "-", width: KEY_SIZE },
  { label: "=", width: KEY_SIZE },
  { label: "⌫", width: 88 },
]);

const row1 = buildRow(1, [
  { label: "Tab", width: 42, highlighted: true },
  ...["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"].map((label) => ({
    label,
    width: KEY_SIZE,
    highlighted: label === "W" || label === "U" || label === "E",
  })),
  { label: "[", width: KEY_SIZE },
  { label: "]", width: KEY_SIZE },
  { label: "\\", width: 74 },
]);

const row2 = buildRow(2, [
  { label: "Caps", width: 58 },
  ...["A", "S", "D", "F", "G", "H", "J", "K", "L"].map((label) => ({
    label,
    width: KEY_SIZE,
    highlighted: ["A", "S", "D", "F"].includes(label),
  })),
  { label: ";", width: KEY_SIZE },
  { label: "'", width: KEY_SIZE },
  { label: "Enter", width: 88, highlighted: true },
]);

const row3 = buildRow(3, [
  { label: "Shift", width: 74, highlighted: true },
  ...["Z", "X", "C", "V", "B", "N", "M"].map((label) => ({
    label,
    width: KEY_SIZE,
    highlighted: label === "X" || label === "C",
  })),
  { label: ",", width: KEY_SIZE },
  { label: ".", width: KEY_SIZE },
  { label: "/", width: KEY_SIZE },
  { label: "Shift", width: 58 },
]);

const row3Arrows = buildRow(3, [{ label: "↑", width: KEY_SIZE, highlighted: true }], true);
row3Arrows[0].x = 450;

const row4 = buildRow(4, [
  { label: "Ctrl", width: 42 },
  { label: "Meta", width: 42 },
  { label: "Alt", width: 42 },
  { label: "Space", width: 182, highlighted: true },
  { label: "Alt", width: KEY_SIZE },
  { label: "Fn", width: KEY_SIZE },
  { label: "Ctrl", width: KEY_SIZE },
]);

const row4Arrows = buildRow(
  4,
  [
    { label: "←", width: KEY_SIZE, highlighted: true },
    { label: "↓", width: KEY_SIZE, highlighted: true },
    { label: "→", width: KEY_SIZE, highlighted: true },
  ],
  true,
);
row4Arrows[0].x = 420;
row4Arrows[1].x = 450;
row4Arrows[2].x = 480;

const keyboardKeys = [...row0, ...row1, ...row2, ...row3, ...row3Arrows, ...row4, ...row4Arrows];
</script>

<template>
  <Teleport to="body">
    <div class="help-overlay" @click.self="uiStore.closeHelpDialog()">
      <div class="help-dialog">
        <div class="help-header">
          <span>Help</span>
          <button class="help-close" @click="uiStore.closeHelpDialog()">X</button>
        </div>

        <div class="help-tabs" role="tablist" aria-label="Help topics" @keydown="onTabKeydown">
          <button
            v-for="helpTab in helpTabs"
            :id="`help-tab-${helpTab.id}`"
            :key="helpTab.id"
            class="help-tab"
            :class="{ active: activeHelpTab === helpTab.id }"
            role="tab"
            type="button"
            :aria-selected="activeHelpTab === helpTab.id"
            :aria-controls="activeHelpTab === helpTab.id ? `help-panel-${helpTab.id}` : undefined"
            :tabindex="activeHelpTab === helpTab.id ? 0 : -1"
            :ref="element => setTabElement(helpTab.id, element)"
            @click="selectTab(helpTab.id)"
          >
            {{ helpTab.label }}
          </button>
        </div>

        <div v-if="activeHelpTab === 'howto'" id="help-panel-howto" role="tabpanel" aria-labelledby="help-tab-howto" tabindex="0">
          <div class="help-section">
            <div class="help-section-title">How to Play</div>
            <p class="help-description">
              • Defend your base against waves of enemies on generated maps
            </p>
            <p class="help-description">
              • Enemies drop <span class="gold">gold</span> for the resources they leave behind on defeat
            </p>
            <p class="help-description">
              • Use <span class="gold">gold</span> to build towers from the Build Bar, then upgrade and specialize them for maximum effect
            </p>
            <p class="help-description">
              • Click the base to select it, then spend gold to upgrade its health and sentries. Gems on the skill tree raise the upgrade cap
            </p>
            <p class="help-description">
              • Earn <span class="gems">gems</span> by reaching high waves and defeating bosses
            </p>
            <p class="help-description">
              • Use <span class="gems">gems</span> to unlock upgrades. You won't get far without them!
            </p>
          </div>

          <div class="help-section keyboard-layout-section">
            <div class="help-section-title">Keyboard Layout</div>
            <p class="help-description">
              • Use only mouse, only keyboard, or mouse + keyboard
            </p>
            <p class="help-description">
              • Fully playable by keyboard alone (friend mode is a future feature)
            </p>
            <svg class="keyboard-diagram" viewBox="0 0 580 300" xmlns="http://www.w3.org/2000/svg">
              <g class="kb-keys">
                <g v-for="(key, idx) in keyboardKeys" :key="idx">
                  <rect :x="key.x" :y="key.y" :width="key.width" height="28" class="kb-key"
                    :class="{ 'kb-key-hl': key.highlighted }" rx="2" />
                  <text :x="key.x + key.width / 2" :y="key.y + 17" class="kb-key-text" text-anchor="middle"
                  >{{ key.label }}</text>
                </g>
              </g>

              <g class="kb-brackets">
                <path class="kb-bracket" d="M 30,62 L 30,56 L 299,56 L 299,62" />
              </g>

              <g class="kb-labels">
                <g class="kb-label-group">
                  <text x="0" y="40" class="kb-label-text">
                    <tspan class="kb-label-key">Esc|X</tspan>
                    <tspan class="kb-label-desc"> Close/Pause</tspan>
                  </text>
                </g>

                <g class="kb-label-group">
                  <text x="139" y="24" class="kb-label-text">
                    <tspan class="kb-label-key">Tab</tspan>
                    <tspan class="kb-label-desc"> Speed↑ ( Build Bar → )</tspan>
                  </text>
                </g>

                <g class="kb-label-group">
                  <text x="110" y="40" class="kb-label-text">
                    <tspan class="kb-label-key">Shift+Tab</tspan>
                    <tspan class="kb-label-desc"> Speed↓ ( Build Bar ← )</tspan>
                  </text>
                </g>

                <g class="kb-label-group">
                  <text x="340" y="58" class="kb-label-text" text-anchor="middle">
                    <tspan class="kb-label-key">1-9</tspan>
                    <tspan class="kb-label-desc"> Tower Build</tspan>
                  </text>
                </g>

                <g class="kb-label-group">
                  <text x="30" y="270" class="kb-label-text">
                    <tspan class="kb-label-key">A</tspan>
                    <tspan class="kb-label-desc"> Speed↓</tspan>
                  </text>
                </g>

                <g class="kb-label-group">
                  <text x="78" y="250" class="kb-label-text">
                    <tspan class="kb-label-key">W|U</tspan>
                    <tspan class="kb-label-desc"> Upgrade</tspan>
                  </text>
                </g>

                <g class="kb-label-group">
                  <text x="88" y="270" class="kb-label-text">
                    <tspan class="kb-label-key">S</tspan>
                    <tspan class="kb-label-desc"> Downgrade/Sell</tspan>
                  </text>
                </g>

                <g class="kb-label-group">
                  <text x="184" y="270" class="kb-label-text">
                    <tspan class="kb-label-key">D</tspan>
                    <tspan class="kb-label-desc"> Speed↑</tspan>
                  </text>
                </g>

                <g class="kb-label-group">
                  <text x="242" y="270" class="kb-label-text">
                    <tspan class="kb-label-key">F</tspan>
                    <tspan class="kb-label-desc"> Cycle Targeting</tspan>
                  </text>
                </g>

                <g class="kb-label-group">
                  <text x="200" y="246" class="kb-label-text">
                    <tspan class="kb-label-key">Space</tspan>
                    <tspan class="kb-label-desc"> Pause/Resume</tspan>
                  </text>
                </g>

                <g class="kb-label-group">
                  <text x="490" y="150" class="kb-label-text">
                    <tspan class="kb-label-key">Enter</tspan>
                    <tspan class="kb-label-desc"> Confirm</tspan>
                  </text>
                </g>

                <g class="kb-label-group">
                  <text x="490" y="182" class="kb-label-text">
                    <tspan class="kb-label-desc">Select Tower</tspan>
                  </text>
                </g>
                <g class="kb-label-group">
                  <text x="490" y="194" class="kb-label-text">
                    <tspan class="kb-label-desc">( Select Build Tile )</tspan>
                  </text>
                </g>
              </g>
            </svg>

            <table class="help-table">
              <tbody>
                <tr>
                  <td><kbd>Esc</kbd> / <kbd>X</kbd></td>
                  <td>Close menus and dialogs; otherwise cancel build mode, deselect your tower, or open the pause menu</td>
                </tr>
                <tr>
                  <td><kbd>Enter</kbd></td>
                  <td>Confirm the highlighted button in an open dialog</td>
                </tr>
                <tr>
                  <td><kbd>Space</kbd></td>
                  <td>Pause or resume the game</td>
                </tr>
                <tr>
                  <td><kbd>Tab</kbd></td>
                  <td>Speed up time (1x → 2x → 4x → 8x → 1x). In build mode: cycle to the next tower type</td>
                </tr>
                <tr>
                  <td><kbd>Shift</kbd> + <kbd>Tab</kbd></td>
                  <td>Slow down time (8x → 4x → 2x → 1x → 8x). In build mode: cycle to the previous tower type</td>
                </tr>
                <tr>
                  <td><kbd>1</kbd>-<kbd>9</kbd></td>
                  <td>Select a tower type to build (matches the shop panel order)</td>
                </tr>
                <tr>
                  <td><kbd>&uarr;</kbd> / <kbd>&darr;</kbd> / <kbd>&larr;</kbd> / <kbd>&rarr;</kbd></td>
                  <td>Move tower selection in that direction. In build mode: move the build tile. Once zoomed in, the view pans when that tile comes within 20% of the screen width of an edge</td>
                </tr>
                <tr>
                  <td><kbd>Ctrl</kbd> + <kbd>&uarr;</kbd> / <kbd>&darr;</kbd> / <kbd>&larr;</kbd> / <kbd>&rarr;</kbd></td>
                  <td>Pan the view about 20% of the screen in the pressed direction</td>
                </tr>
                <tr>
                  <td><kbd>Page Up</kbd> / <kbd>Page Down</kbd></td>
                  <td>Zoom in or out. Page Down returns to the whole map. Zoom stays on the selected tower, build tile, or placement site</td>
                </tr>
                <tr>
                  <td><kbd>Tab</kbd> / <kbd>R</kbd> / arrows / <kbd>Enter</kbd></td>
                  <td>
                    During a block placement the view zooms out to the whole map. Tab cycles the block choices, R, a right
                    click on a placement space, or a second click on the selected choice rotates it, the arrow keys move
                    the placement space (the view pans when that site comes within 20% of the screen width of an edge),
                    and Enter places that block. Re-roll spends {{ rerollGoldPerWave }} gold times the wave
                    number and redraws every choice. After a placement the run stays paused with an Undo button that
                    disappears as soon as you resume.
                  </td>
                </tr>
                <tr>
                  <td><kbd>Tab</kbd> / <kbd>Enter</kbd> / <kbd>1</kbd>-<kbd>3</kbd> / <kbd>Esc</kbd></td>
                  <td>
                    In a bonus picker: <kbd>Tab</kbd> cycles the three cards and Leave it, <kbd>Enter</kbd> takes the
                    highlighted one (Leave it closes the picker without a card), <kbd>1</kbd>-<kbd>3</kbd> claim a
                    card directly, and <kbd>Esc</kbd> leaves. A sealed cache cycles Unlock for N gold and Leave it
                    instead. Tower fire never pauses the run: a broken cache pulses until it is clicked.
                  </td>
                </tr>
                <tr>
                  <td><kbd>W</kbd> / <kbd>U</kbd></td>
                  <td>Upgrade the selected tower. If the tower needs specialization and only one specialization is available, selects it directly</td>
                </tr>
                <tr>
                  <td><kbd>E</kbd> / <kbd>C</kbd></td>
                  <td>When the selected tower needs specialization: <kbd>E</kbd> selects Specialization A, <kbd>C</kbd> selects Specialization B</td>
                </tr>
                <tr>
                  <td><kbd>A</kbd></td>
                  <td>Slow down time (8x → 4x → 2x → 1x → 8x)</td>
                </tr>
                <tr>
                  <td><kbd>S</kbd></td>
                  <td>Downgrade selected tower (level &gt;1) or sell it (level 1)</td>
                </tr>
                <tr>
                  <td><kbd>D</kbd></td>
                  <td>Speed up time (1x → 2x → 4x → 8x → 1x)</td>
                </tr>
                <tr>
                  <td><kbd>F</kbd></td>
                  <td>Cycle targeting mode on the selected tower (first → last → etc)</td>
                </tr>
                <tr>
                  <td>Click empty tile</td>
                  <td>Place your selected tower (when in build mode)</td>
                </tr>
                <tr>
                  <td>Click a tower</td>
                  <td>Select it to view stats, upgrade, or sell</td>
                </tr>
                <tr>
                  <td>Right-click</td>
                  <td>In build mode: exit build mode. Otherwise: deselect the selected tower or base</td>
                </tr>
                <tr>
                  <td>Right-click a placement space</td>
                  <td>During a block placement, rotate the block</td>
                </tr>
                <tr>
                  <td>Mouse wheel</td>
                  <td>Zoom in or out about the cursor</td>
                </tr>
                <tr>
                  <td>Right-drag, or Alt + left-drag, or a left-drag where a click would do nothing</td>
                  <td>Pan the view (a left-drag over a path tile, off the map, or a build tile you cannot place on). A right press that does not move is a right-click instead of a pan</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div
          v-if="activeHelpTab === 'towers'"
          id="help-panel-towers"
          role="tabpanel"
          aria-labelledby="help-tab-towers"
          tabindex="0"
        >
          <HelpTowerTab />
        </div>
        <div
          v-else-if="activeHelpTab === 'enemies'"
          id="help-panel-enemies"
          role="tabpanel"
          aria-labelledby="help-tab-enemies"
          tabindex="0"
        >
          <HelpEnemyTab />
        </div>

        <button class="debug-bug" @click="uiStore.openDebugPanel()" aria-label="Open Debug Panel">🐞</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.help-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.help-dialog {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 20px 24px;
  width: min(1000px, 94vw);
  max-height: 85vh;
  overflow-y: auto;
  position: relative;
}

.help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--font-xl);
  font-weight: bold;
  color: var(--color-accent);
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}

.help-close {
  background: var(--color-surface);
  border: 1px solid var(--color-line-strong);
  color: var(--color-text);
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-md);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.help-close:hover {
  background: var(--color-surface-hover);
}

.help-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

.help-tab {
  padding: 7px 16px;
  background: var(--color-surface-subtle);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  color: var(--color-text-dim);
  font-size: var(--font-md);
  font-weight: bold;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.15s;
}

.help-tab:hover {
  background: var(--color-surface-hover);
}

.help-tab.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.help-section {
  margin-bottom: 8px;
}

.help-section:last-child {
  margin-bottom: 0;
}

.help-section-title {
  font-size: var(--font-md);
  font-weight: bold;
  color: var(--color-text);
  margin-bottom: 10px;
}

.help-description {
  font-size: var(--font-md);
  color: var(--color-text);
  line-height: 1.5;
}

.help-section .gold {
  color: var(--color-gold);
  font-weight: bold;
}

.help-section .gems {
  color: var(--color-gem);
  font-weight: bold;
}


.help-table {
  width: 100%;
  border-collapse: collapse;
}

.help-table tr {
  border-bottom: 1px solid var(--color-line);
}

.help-table tr:last-child {
  border-bottom: none;
}

.help-table td {
  padding: 6px 0;
  font-size: var(--font-md);
  vertical-align: top;
}

.help-table td:first-child {
  width: 160px;
  color: var(--color-text-dim);
  padding-right: 12px;
}

.help-table td:last-child {
  color: var(--color-text);
}

kbd {
  font-family: inherit;
  font-size: var(--font-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-line-strong);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--color-text);
}

.keyboard-layout-section {
  padding: 16px 24px;
  margin: 0 -24px 16px -24px;
}

.keyboard-diagram {
  width: 732px;
  height: auto;
  display: block;
}

.kb-key {
  fill: var(--color-surface-subtle);
  stroke: var(--color-line-strong);
  stroke-width: 1;
}

.kb-key-hl {
  fill: var(--color-accent-soft);
  stroke: var(--color-accent);
}

.kb-key-text {
  font-size: var(--font-xs);
  fill: var(--color-text);
  font-family: var(--font-main);
  pointer-events: none;
}

.kb-bracket {
  fill: none;
  stroke: var(--color-text-dim);
  stroke-width: 1;
}

.kb-label-text {
  font-size: var(--font-xs);
  font-family: var(--font-main);
}

.kb-label-key {
  fill: var(--color-text-dim);
  font-weight: bold;
}

.kb-label-desc {
  fill: var(--color-text);
}

.debug-bug {
  background: transparent;
  width: 100%;
  text-align: right;
  border: none;
  font-size: var(--font-xl);
  cursor: pointer;
  opacity: 0.3;
  transition: opacity 0.15s;
  padding: 4px;
  line-height: 1;
}

.debug-bug:hover {
  opacity: 0.8;
}
</style>
