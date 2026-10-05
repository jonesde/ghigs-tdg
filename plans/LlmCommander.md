# Plan: LLM Enemy Commander (via OpenAI-compatible API)

## Status
Reviewed, revised, and **implemented**. Merges three resolved design decisions
and corrects two factual errors found during codebase research (see §13). The
feature is fully built and the test suite is green (~1110 tests, plus lint /
typecheck / `check:sim-boundary`). Deviations from the original text discovered
during implementation are recorded in §17 and reflected inline below.

## Resolved decisions
1. **Async brain interface.** `CommanderBrain.decide()` becomes
   `Promise<Command[]>`. Stub brains resolve synchronously; the LLM brain awaits
   `fetch`. `CommanderWorker` awaits `decide()` and owns the in-flight guard +
   cadence throttle. **Signature/coupling change:** `createBrain(kind)` currently
   takes only `kind: "stubby" | "stubbs"`. It must become
   `createBrain(kind, config?)` and the protocol `CommanderKind` must gain
   `"llm"`, so `start` can carry `config` for the `"llm"` kind. The worker's
   `start` handler (`src/commanders/CommanderWorker.ts:49`) calls
   `createBrain(message.kind)` today with **no** config — update it to pass
   `message.config` when `kind === "llm"`.
2. **Persisted registry keyed by id.** `uiStore.enemyCommander` becomes
   `string | "none"`. Built-in ids `"stubby"`/`"stubbs"` are reserved constants
   (not stored in the registry). User LLM commanders live in a persisted
   `llmCommanders` registry keyed by id. Activation = `setEnemyCommander(id)`,
   whether from the `/commanders` screen "Activate" button or the in-game
   drop-down.
3. **New route `/commanders`.** A dedicated `CommandersScreen.vue` opened from a
   "Commanders" button on `MainMenu.vue`. Not reachable in-game.

## What already exists (reuse, do not rebuild)
- `src/commanders/` already has the full spine: `CommanderWorker.ts` (worker
  entry), `relay.ts` (~4 Hz `SnapshotStore` reader, `RELAY_INTERVAL_MS = 250`),
  `observation.ts` (projection `CommanderSnapshotSlice` → `CommanderObservation`),
  `brain.ts` (`CommanderBrain` interface + `createBrain(kind)` factory),
  `protocol.ts`, `index.ts` (`setEnemyCommander`/`stopEnemyCommander`), and the
  two stub brains `stubby/brain.ts`, `stubbs/brain.ts`.
- `llm:*` commands are already implemented in `src/sim/applyCommand.ts:91-137`:
  `llm:routeGroup` (hold / waypoint-to-base), `llm:setTargeting`, and the
  worker-internal `llm:gridLayoutToggle`. The LLM brain emits `routeGroup`,
  `siegeTower`, and `setTargeting`.
- Growl notifications: `uiStore.showNotification` (`src/stores/ui.ts:102`) →
  toast in `src/components/GameHud.vue:126`. **Important channel correction:**
  because the commander worker's relay runs on the **main thread**, the
  `notify`/`chat` messages the worker posts are forwarded by the *relay* directly
  to `uiStore.showNotification` — they do **not** travel through the sim's
  `HostBindings.notifyUi` (`src/sim/HostBindings.ts:54`,
  `src/sim/WorkerHostBindings.ts:24`, which is the *sim-worker* seam). The sim
  `HostBindings` is unrelated to the commander transport. `notify` is the channel
  for connect / error / disconnect messages.
- Pause is observable: `SnapshotMeta.state` ships every tick
  (`src/sim/SimulationSnapshot.ts:73`); `GameState.PAUSED` is the sentinel to
  skip requests.
- `CommanderMemory` (`src/commanders/brain.ts:10`) is the worker-owned scratch
  store; extend it for LLM state (conversation, token accounting, last
  observation for diffing).

## 1. OpenAPI client (`src/commanders/llm/apiClient.ts`)
- Framework-free native `fetch` wrapper. **No external libraries** (per plan; a
  worker already keeps the main thread free — see §13.2 on CORS).
- Constructed with an injected `fetchFn` (defaults to global `fetch`) so unit
  tests use a fake and never hit the network.
- Endpoint normalization (`normalizeEndpointUrl`):
  - Starts with `http://` or `https://` → used verbatim as the base.
  - Otherwise treated as `host[:port][/path]` → `http://{host}/v1`, unless the
    path already ends in `/v1` (case insensitive), in which case it is stored as
    `http://{stripped}` once.
- Request body: OpenAI-compatible chat-completions shape
  (`messages`, `model` only when a model name is configured — omit `model` when
  empty so the server's default is used, `temperature`, `stream: false`).
  `Authorization: Bearer {token}` only when a token is configured.
- **Timeout** (`AbortController` + `setTimeout`): `config.requestTimeoutMs`, default
  30 s, integer range 1000–180000. On timeout, log + retry on the next iteration
  (escalating back-off, see below). Request temperature is `0.2`.
- **Escalating back-off**: base 3 s, double each failure, cap **30 s**. Reset to
  base after any successful response. Back-off delays the *next* request; it does
  not stack on top of the relay interval (avoid double-penalizing cadence).
- **Empty / error / malformed handling**: on non-2xx, empty body, or
  unparseable/non-JSON, log + retry next iteration (respecting back-off).
- **Token accounting**: read `usage.prompt_tokens` from the response (when
  present) to track running context size for compression (§7).

## 2. LLM commander config + persistence
- `LlmCommanderConfig` type (`src/commanders/llm/types.ts`):
  - `id: string` (uuid/genId, stable key)
  - `name: string`
  - `endpointUrl: string` (required)
  - `token: string` (optional)
  - `modelName: string` (optional)
  - `contextLimit: number` (tokens; default 32768)
  - `commanderInstructions: string` (optional, blank default)
  - `systemPrompt: string` (required; defaulted from a const at create time)
  - `requestTimeoutMs: number` (default 30000; range 1000–180000)
  - `pauseForCommander: boolean` (default false; backfilled on load, no save-version bump)
- Persist slice: add `llmCommanders: LlmCommanderConfig[]` to the serialized
  shape in `persist.ts` (`PersistStateShape`, `src/stores/persist.ts`,
  `load` / `save` / `migrateToCurrent`) plus `defaultState()` default `[]`.
  Built-ins (`stubby`/`stubbs`) are NOT in this array. **`llmCommanders` is NOT
  added to `src/sim/PersistState.ts`** — it is UI-only and the engine never reads
  it; the commander worker receives its config via the `start` message, so the sim
  `PersistState` field would be a dead pass-through (see §17, deviation D1).
  **Schema migration:** `CURRENT_SAVE_VERSION` is `4`. `migrateV2ToV3` deep-merges
  and backfills `llmCommanders: []` (deviation D2). `migrateV3ToV4` deep-merges and
  fills `requestTimeoutMs: 30000` on each commander before `PersistStateSchema`
  requires the field. `pauseForCommander` is filled in the same pass (`true` only
  when the saved value is boolean true) and the schema requires it; save version
  stays 4. When the active config has it set, the commander worker posts
  `{ type: "hold" }` around the in-flight decide (including backoff). The relay
  dispatches `action:commanderHold`, which zeroes the sim clock while
  `meta.state` stays `playing`. `GameState.PAUSED` would make the worker skip
  decide. `stopRelay` releases the hold because `terminate()` drops the worker's
   matching release. Key remains `ghigs_save_1`.
- Built-in id constants: `BUILTIN_STUBBY = "stubby"`, `BUILTIN_STUBBS = "stubbs"`
  in `src/commanders/index.ts`.

## 3. Selection / activation (`src/commanders/index.ts`, `src/stores/ui.ts`)
- `uiStore.enemyCommander: string | "none"` (`src/stores/ui.ts:20,59,188`).
- `setEnemyCommander(id: string | "none")` calls `stopEnemyCommander()` first for
  every id, including built-ins. `"none"` returns after that call. A built-in id
  then `startRelay(kind)`. Any other id looks up `LlmCommanderConfig` and
  `startRelay("llm", config)`.
- `stopEnemyCommander()` dispatches `llm:routeGroup(enemyIds, hold: false, [])`
  and `llm:setTargeting(enemyIds, mode: "default")` for every live enemy, then
  `stopRelay`. `releaseToDefault` keeps the engagement policy; the second command
  clears it so the next intent does not re-siege under a commander that did not
  set it.
- `startRelay(kind, config?)` (`src/commanders/relay.ts:23`) receives the config
  for the `"llm"` kind; `MainToCommanderMessage.start` carries it.

## 4. Protocol extensions (`src/commanders/protocol.ts`)
- `MainToCommanderMessage`:
  - `start` gains optional `config?: LlmCommanderConfig` (only for `"llm"`).
  - add `{ type: "chat"; text: string }` (player → LLM).
  - add `{ type: "updateInstructions"; text: string }` (live Commander
    Instructions rewrite).
- `CommanderToMainMessage`:
  - existing `{ type: "commands"; commands: Command[] }`.
  - add `{ type: "notify"; message: string }` (error / connect / disconnect →
    relay forwards to `uiStore.showNotification`, the growl toast).
  - add `{ type: "chat"; text: string; from: "commander" }` (LLM → player).
- `CommanderSnapshotSlice` unchanged (relay still ships full `enemies`/`towers`/
  `spawnStates`/`meta` + cached `gridLayout`; the LLM brain diffs in the worker).

## 5. LLM brain (`src/commanders/llm/brain.ts`)
- `createLlmBrain(config, { onChat, onNotify, fetchFn })` returns a
  `CommanderBrain` whose `decide()` is `async` and returns `Promise<Command[]>`.
  (The `CommanderBrain.decide` signature is `Command[] | Promise<Command[]>` so
  stub brains stay synchronous — see §17, deviation D5.) `onChat`/`onNotify` are
  callbacks the worker injects (they post `chat`/`notify` `CommanderToMainMessage`s);
  `fetchFn` defaults to `globalThis.fetch` for testability.
- **Factory factoring (deviation D7):** the worker's `start` handler calls
  `createLlmBrain(config, callbacks)` directly rather than through
  `createBrain("llm", config)`. `createBrain` still has an `"llm"` case (throws
  without config) but it is now unreachable from the worker.
- `decide(observation, memory)`:
  - If `memory.isCompressing` or building the first prompt, assemble the full
    prompt (system + instructions + snapshot, §6) and clear delta history.
  - Otherwise append a delta block (§7) + any queued player chat messages.
  - Call the API client (§1). On success, strip one markdown fence (or, if that
    still fails, the slice from the first `{`/`[` through the last `}`/`]`), then
    validate (§12) and translate to `llm:routeGroup`, `llm:siegeTower`, and
    `llm:setTargeting` commands. A soft-reject that still yields commands applies
    those commands and keeps the assistant turn. A transport failure, empty body,
    JSON parse failure, or a rejection that yields zero commands restores the
    pre-turn transcript and `lastObservation`. A parse failure or a zero-command
    rejection also sets `memory.rejectionNote`; the next user message appends
    `Previous reply was rejected: …`. Transport failures do not set the note.
    Identical failure toasts are skipped until an accepted reply clears that memory.
  - Update `memory` token count from `usage.prompt_tokens`; if
    `tokenCount + estimatedNext >= config.contextLimit`, set a compress flag so
    the next `decide` rebuilds the full prompt.
  - Return the commands (may be empty on malformed/empty response; client already
    retried per §1).
- **Transcript is resent (D6 reversed):** `decide` sends `memory.conversation`.
  The system entry stays in memory; `complete` prepends it, and adjacent messages
  of the same role are coalesced into one before the request. Each successful turn
  appends the assistant reply. The model sees the map from the last full snapshot,
  later deltas, and its own prior commands. See §17.
- **In-flight guard + cadence** (`src/commanders/CommanderWorker.ts`): an async
  `decideLlm()` tracks a `deciding` boolean; when a new `observation` arrives
  while `deciding`, it skips issuing a new `decide` (drops the tick). A timestamp
  throttle targets ~1 Hz (`LLM_DECISION_INTERVAL_MS = 1000`) so even at 4 Hz
  relay polling we only call the API ~once per second. **This guard/cadence/
  pause-skip applies to the LLM path only**; stub brains remain synchronous and
  decide on every observation (deviation D5 — keeps the existing ~1000 tests
  green).
- `updateInstructions` updates `memory.commanderInstructions` and sets
  `isCompressing` only when the text differs, so the next `decide` rebuilds the
  system prompt. A runId change drops the transcript (it names the previous run's
  enemies) and the rejection note, and keeps instructions and queued player messages.
- `chat` (player) message is enqueued in `memory.pendingPlayerMessages` and
  appended on the next `decide`.

## 6. System prompt + Commander Instructions
- `src/commanders/llm/systemPrompt.ts`: `buildSystemPrompt(config)` assembles a
  template filled at **runtime** from real constants so values can't drift:
  - Game objective: destroy the defender base by routing enemies to it.
  - Map/grid: grid is tile-based with `meta.tileSize` (default 36,
    `SimulationSnapshot.ts:95`); `gridLayout` semantics (`0=terrain,1=path,2=base,3=spawn`,
    `protocol.ts:10`); spawn + base tiles. Pathing is the Recast navmesh with
    DetourCrowd local avoidance. Newly built towers are obstacles; enemies route
    around them while a corridor remains. A fully blocked corridor stops default
    movement until that tower is sieged and ghosted.
  - Enemy types + stats from `ENEMY_TYPES` (`src/sim/ConstantsEnemy.ts:21`,
    with `ENEMY_LEVEL_HP_MULT`/`ENEMY_WAVE_DAMAGE_MULT` formulas). Per-enemy
    `type`, routing, and `targetingMode` are in the data stream (D8 reversed).
  - Tower level scaling uses `TOWER_LEVEL_DMG_MULT`, `TOWER_LEVEL_RATE_MULT`, and
    `TOWER_LEVEL_RANGE_MULT`. Victory uses `VICTORY_WAVE`.
  - Tower types + stats from `ConstantsTower.ts`.
  - Waves: inter-wave countdown (`BETWEEN_WAVES_TIMER`) and preemptive next-wave
    timer `PRE_EMPTIVE_WAVE_TIMER = 90` game-seconds
    (`src/sim/Constants.ts:118`); victory wave; spawning from a queue
    (`src/sim/waves/WaveManager.ts`). **NOTE: there is NO "max active enemies"
    cap** — concurrency is implicitly bounded by spawn pacing, not a hard limit;
    describe it that way (see §13.1).
  - Data stream description: what each `decide` delta contains (§7).
  - Command syntax + allowlist (`routeGroup`, `siegeTower`, `setTargeting` — §12).
    `setTargeting` modes are `default`, `base`, `nearest`, `strongest`, `weakest`,
    and `strongestAhead`. `strongestAhead` uses the snapped tower `distanceToBase`
    (nearest path, spawn, or base tile; -1 is not ahead). Any other mode string is
    stored and does not change engagement. The generated command section overrides
    any shorter command list in a saved preface. `llm:gridLayoutToggle` is banned.
    The wave summary the model sees includes `baseHp`, `maxBaseHp`, and
    `countdownSeconds`. Tower records include snapped `distanceToBase`.
  - Default `systemPrompt` const used to populate new configs' required field.
- Commander Instructions: user-provided, appended after the system prompt;
  blank by default; editable live (§5 `updateInstructions`).

## 7. Deltas (worker-side diff)
- Keep `memory.lastObservation` (previous `CommanderObservation`). On each
  `decide` (after the initial snapshot), build a compact delta:
  - Enemies: new ids and changed ids ship a full record (type, level, tile,
    hp/maxHp, routingMode, attackingBase, blocked tile, targetingMode,
    distanceToBase). A known enemy is omitted only when every one of those fields
    is unchanged, so a `distanceToBase` change is shipped. Removed ids ship in
    `removedEnemyIds`.
  - Towers: new live tiles and tiles whose hp, maxHp, level, or snapped
    `distanceToBase` changed ship type, tile, level, hp/maxHp, and that distance.
    A tower with `hp <= 0` is omitted; leaving the live set ships `{x, y}` in
    `removedTowers`.
  - Wave summary: `currentWave`, `pendingEnemyCount`, `remainingScheduledSpawns`,
    `active`, `baseHp`, `maxBaseHp`, `countdownSeconds`.
  - Timestamp (`meta` frame id / wall clock).
- The delta scheme's benefit is **token reduction** (fewer tokens per request
  than re-sending the whole snapshot). The client still resends the transcript
  (§5), so the model keeps the last full snapshot and its own replies. A changed
  enemy is a full record (tile, hp, routingMode, attackingBase, blocked tile,
  targetingMode, distanceToBase). Removals ship as `removedEnemyIds` and
  `removedTowers`. On compression (§5 token limit: reported `prompt_tokens`, or a
  character estimate, plus 2048), the next `decide` replaces the transcript with
  the same system + instructions text and a fresh full snapshot.
- Diffing is pure worker-side using `CommanderMemory`; no sim/`SnapshotStore`
  change. Concept mirrors `plans/SnapshotDelta.md` but lives in the LLM brain.

## 8. In-game chat (`src/components/EnemyChat.vue`)
- Floating, draggable dialog on the game screen, shown **only** when an LLM-type
  commander is active (`uiStore.enemyCommander` resolves to an LLM config). No
  close button; visibility follows activation.
- Layout:
  - Top: 3-line `Commander Instructions` textarea. A change posts
    `updateInstructions` and saves the text on the active commander. Blur with
    the same text does not (§5). Switching the active LLM commander resyncs the
    textarea from that commander's saved instructions.
  - Middle: scrolling message log (last ~20, kept in a `chatLog` slice on
    `uiStore`).
  - Bottom: message input + Send button. Send posts `chat` to the worker and
    logs the player message locally.
- Messages from the LLM arrive via `notify`/`chat` worker messages (§4),
  forwarded by the relay into `uiStore.chatLog`.
- New `chatLog` slice in `src/stores/ui.ts` (array of `{ from: "player"|"commander"; text: string }`,
  capped at 20). Cleared on commander change/stop.

## 9. Configuration screen (route `/commanders`)
- `src/components/CommandersScreen.vue` + router entry in
  `src/router/index.ts` (guarded like other screens; **not** linked from in-game
  menus).
- Main menu: add a "Commanders" button to `src/components/MainMenu.vue` that
  routes to `/commanders`.
- Screen contents:
  - **List of Enemy Commanders**:
    - Sergeant Stubby + Commander Stubbs: shown, **not editable** (may gain
      parameter forms later). "Activate" button = `setEnemyCommander(builtinId)`.
    - User LLM commanders: Name, **Edit** (same form, pre-populated),
      **Activate** (`setEnemyCommander(id)`), **Delete**.
  - **New LLM Commander** button → popup dialog (reuse `ConfirmDialog`-style
    modal pattern) with the form:
    - endpoint URL (required; normalized per §1).
    - token/key (optional).
    - model name (optional; omitted from requests when blank).
    - context limit (tokens; default 32768).
    - request timeout in seconds (stored as `requestTimeoutMs`; default 30).
    - Test calls `complete` with the unsaved endpoint, token, model, and timeout
      and does not save or start the relay.
    - Commander Instructions (large textarea, optional, blank default).
    - System Prompt (large textarea, required, defaulted from const).
   - Persist on save via `persistStore` (§2).
   - **In-game Commander select (§3/§9):** `src/components/PauseMenu.vue:47-90`
     currently hardcodes a 3-option `<select>` (none/stubby/stubbs) and casts the
     value to `"none" | "stubby" | "stubbs"`. Make it **dynamic**: render
     `none` + the two built-ins + one `<option>` per `persistStore.llmCommanders`
     id, and widen the cast (in `handleCommanderChange`) to `string` so LLM ids
     flow through `uiStore.setEnemyCommander(id)`.

## 10. Pause handling + test (important)
- In `src/commanders/CommanderWorker.ts`, before issuing `decide` for an LLM
  brain: if `slice.meta.state === GameState.PAUSED`, **skip** the API request
  (and skip advancing cadence). Let any in-flight request finish, then idle until
  unpaused. Stub brains are cheap and remain pause-agnostic.
- **Test** (`tests/integration/commander-llm.test.ts` or extend
  `tests/integration/commander.test.ts`): with a fake fetch, drive the worker
  with `meta.state === PAUSED` and assert **zero** `fetch` calls; unpause and
  assert the next tick issues exactly one request.

## 11. Notifications (growl)
- On error / empty / invalid-JSON / schema-rejected responses, the LLM brain
  posts `{ type: "notify"; message }` (§4). The relay forwards to
  `uiStore.showNotification` (`src/stores/ui.ts`) → `GameHud.vue` toast.
- **Gap (deviation D10):** the plan also called for `notify` on API *connect
  attempt* and *first success*; these were not implemented. Only error/back-off
  notifications are emitted. The channel itself (`notify` → relay →
  `showNotification`) is fully wired, so adding connect/first-success toasts later
  is a one-line change in `llm/brain.ts`.
- Same channel is available for worker/relay connect/disconnect lifecycle notes
  (not currently emitted).

## 12. Response processing + command schema
- `src/commanders/llm/schema.ts`: define the JSON command schema and a validator.
  - Allowed command types: `llm:routeGroup`, `llm:siegeTower`, and
    `llm:setTargeting`. `llm:gridLayoutToggle` is worker-internal and must NOT be
    accepted from the LLM.
  - `routeGroup`: `{ enemyIds: number[]; hold?: boolean; holdTile?: {x,y};
    waypoints: {x,y}[] }`. **Coordinate space (corrected):** waypoints and
    `holdTile` are **tile** coords. The LLM works in the tile space described in
    the system prompt, and the brain emits tile coords directly — there is **no**
    tile→world conversion anywhere. `applyCommand.ts` passes `command.waypoints`
    straight into `enemy.grid.computeRoute(...)` alongside `enemy.currentTile()`
    (both tile coords; `Grid.computeRoute` takes tiles, `Enemy.currentTile()`
    returns tiles). So emit tile coords from the brain and do not convert to world.
  - `siegeTower`: `{ enemyIds: number[]; towerTile: {x,y} }`. A live tower is
    sieged and its `targetingMode` is cleared so the next intent does not replace
    the explicit tower. A missing or ghost tower releases to default and keeps
    the policy. `routeGroup` does not clear the policy; hold and route pause it.
  - `setTargeting`: `{ enemyIds: number[]; mode: string }`. `default` stores null
    (stuck auto-siege). `base` paths to the base and skips auto-siege. `nearest`,
    `strongest`, and `weakest` siege a live tower by Euclidean tile distance or
    current health (ties: nearer, then smaller y, then smaller x). `strongestAhead`
    requires a nav distance >= 0 that is strictly closer to the base than the
    enemy; terrain distance -1 is not ahead. Any other string is stored and does
    not change engagement.
- A response that yields zero commands (unrecognized shape, or every entry
  rejected) restores the transcript and returns no commands. A soft-reject keeps
  the valid siblings, applies them, and still appends the assistant turn. The
  schema is also embedded in the system prompt so the model knows the exact syntax.
- **Invalid waypoints are silently ignored (deviation D4):** the LLM emits tile
  coords, but if it emits an out-of-bounds or non-path tile, `applyCommand.ts`
  drops that leg (`computeRoute` returns empty) and the enemy simply skips that
  waypoint (or falls back to `releaseToDefault` if every leg fails). No error is
  surfaced. The brain does not currently validate/snap waypoints to valid path
  tiles; this is accepted engine behavior, not a bug to fix here.

## 13. Corrections from review (must reflect in implementation)
### 13.1 "max active enemies" does not exist
`WaveManager.ts` has no active-enemy cap. Only `PRE_EMPTIVE_WAVE_TIMER = 90`
(`Constants.ts:118`) governs wave timing. The system prompt must describe wave
spawning as a queue with inter-wave + preemptive timers, **not** a max-concurrent
figure.

### 13.2 CORS is not solved by the worker
Running `fetch` in the commander worker does **not** bypass CORS — a worker is
still subject to CORS for cross-origin requests. The benefit of the worker is
keeping the main thread free and impervious to main-thread jank. The user must
run an LLM server that sends permissive CORS headers (common for localhost Ollama
/ LM Studio / llama.cpp). No library is needed; document this requirement in the
config screen help text.

## 14. Conventions (AGENTS.md)
- Descriptive variable names (no single letters); ~100-char lines; avoid comments
  except for cross-boundary side effects. Framework-free client (native `fetch`).

## 15. Build order (keeps ~1000 existing tests green)
 1. Protocol types: `notify`, `chat`, `updateInstructions`, `start`-with-config
    (`src/commanders/protocol.ts`).
 2. `LlmCommanderConfig` + `llmCommanders` persist slice (`persist.ts`
    `PersistStateShape` + `defaultState`) + v2→v3 migration (`CURRENT_SAVE_VERSION`
    2→3, deep-merge + backfill `[]` — **not** on sim `PersistState`, see §2/§17 D1).
 3. `setEnemyCommander(id)` resolution + `startRelay(kind, config?)` + built-in id
    constants (`index.ts`, `relay.ts`).
 4. `apiClient.ts` (injectable `fetch`) + timeout/retry/back-off/parse unit tests.
 5. `systemPrompt.ts` (runtime-filled template) + `schema.ts` (allowlist +
    validator).
 6. LLM brain (async `decide`) + `CommanderWorker` `decideLlm` await + in-flight
    guard + cadence + pause-skip + delta diff + compression; `CommanderMemory`
    extended. `CommanderKind` gains `"llm"`; the worker `start` handler calls
    `createLlmBrain(config, callbacks)` directly (§5, deviation D7).
 7. Pause skip in worker + pause test (§10).
 8. `EnemyChat.vue` + `chatLog` slice + `notify`/chat relay wiring (§8, §11).
 9. `/commanders` route + `CommandersScreen.vue` + MainMenu button + dynamic
    `PauseMenu` select (widen cast to `string`, render LLM ids from
    `persistStore.llmCommanders`; §3, §9).
 10. Tests: LLM brain round-trip with fake fetch, pause test (§10),
     malformed-response test, plus a v2→v3 migration test
     (`tests/unit/persist-migration.test.ts`).

**Implementation was batched into 4 chunks** (foundation/types+persistence+UI
resolution; LLM core; UI screens+chat; migration test+full `npm run check`) rather
than the 10 linear steps above — functionally equivalent (deviation D9).

## 16. Open items (deferred, not blocking)
- Streaming responses: out of scope initially (short messages, no thinking).
- Editing Sergeant Stubby / Commander Stubbs parameters: future form.
- Multi-LLM / A-B comparison: out of scope.
- Per-model token-limit auto-detect: rely on user-supplied `contextLimit` for now.
- Connect-attempt / first-success `notify` toasts (see §11, deviation D10).
- Done in the playable pass: release route and targeting on every commander
  switch; per-tower snapped `distanceToBase` (the full nav grid is still not
  sent); `requestTimeoutMs` at save version 4; identical failure toasts once per
  streak; base hp and countdown in the wave summary; fence-tolerant JSON plus a
  rejection note; temperature `0.2`; Test on the commander form. Saved
  `systemPrompt` prefaces are not migrated. Endpoint, token, model, and timeout
  edits on an already-running commander still apply on the next activation. A
  late reply still applies to the observation captured when the request started.
  Invalid waypoints are still dropped by the navmesh with no per-leg note.

## 17. Implementation Deviations (recorded post-build)
These are the ways the shipped code differs from the plan text above. Most were
intentional resolutions from the pre-implementation review; all keep the existing
~1000+ test suite green and `npm run check` passing.

- **D1 — `llmCommanders` not on sim `PersistState`.** Plan §2 said add it to both
  `persist.ts` and `sim/PersistState.ts`. Shipped: only `persistStore`
  (`src/stores/persist.ts`). The engine never reads it; the worker gets its config
  via the `start` message, so the sim field would be a dead pass-through.
- **D2 — `migrateV2ToV3` deep-merges all fields.** Plan §2/§15.2 only said
  "backfill `llmCommanders: []`". Shipped: it mirrors `migrateCurrentVersion`
  (deep-merge every field with defaults) and then backfills `llmCommanders: []` and
  bumps `saveVersion`. Required so v2 saves don't lose data.
- **D3 — "Context-cache reuse" reframed as token reduction.** Plan §7 described
  preserving prompt-cache reuse by never mutating the initial snapshot. Shipped:
  the benefit is reduced tokens per request; the brain rebuilds the prompt each
  call (no prefix-reuse assumption).
- **D4 — Invalid waypoints silently dropped.** Plan §12 implies the brain emits
  valid tile coords. Shipped: if the LLM emits an invalid/OOB/non-path tile,
  `applyCommand.ts` drops that leg (or falls back to default). No validation/snap in
  the brain. Accepted engine behavior.
- **D5 — Guard/cadence/pause apply to the LLM path only; `decide` is
  `Command[] | Promise<Command[]>`.** Plan §5 said both stub and LLM paths go
  through the same guard and `decide` becomes `Promise<Command[]>`. Shipped: stubs
  stay synchronous and decide every observation; only the LLM `decideLlm()` uses
  the in-flight guard + ~1 Hz cadence + pause-skip. The union return type keeps
  stub tests unchanged.
- **D6 — Reversed.** The stateless-call shortcut was removed. `decide` sends the
  accumulated transcript (the client prepends system; adjacent same-role messages
  are coalesced). A failed turn restores that transcript. Compression replaces it
  with a fresh full snapshot when `tokenCount + 2048 >= contextLimit`.
- **D7 — Worker creates the LLM brain directly.** Plan §1/§5 said
  `createBrain("llm", config)` and the worker passes `message.config`. Shipped:
  the worker's `start` handler calls `createLlmBrain(config, { onChat, onNotify })`
  directly; `createBrain`'s `"llm"` case is unreachable from the worker.
- **D8 — Reversed.** Enemy and tower `type` are projected into the observation
  and the LLM data stream. `targetingMode` is projected when set.
- **D9 — Build order batched into 4 chunks** (foundation; LLM core; UI; tests)
  instead of the 10 linear steps in §15. Functionally equivalent.
- **D10 — Connect / first-success notifications not emitted.** Plan §11 wanted
  `notify` on connect attempt and first success. Shipped: only error/empty/
  invalid/ rejected responses post `notify`. The channel is fully wired; adding
  the missing toasts is a one-line change in `llm/brain.ts`.
- **D11 — `chat` → `chatLog` wiring confirmed.** Plan §8/§11: the relay forwards
  `chat` `CommanderToMainMessage`s to `uiStore.appendChatLog({ from: "commander",
  ... })`; player messages are appended locally in `EnemyChat.vue`. This matches
  the plan (recorded for completeness).
