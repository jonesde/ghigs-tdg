# Architecture Comparison: This Tower-Defense Game vs. Moqui Framework

A summary-level comparison of the hobby game in this repository (`ghigs-tdg`) against
the Moqui Framework, written from the architecture described in `TECHNICAL.md` and from
corpus knowledge of Moqui and the design philosophy of its author, David E. Jones
(also the creator of OFBiz / Open For Business).

---

## Prompt Used

(inserted after)
```
Using your corpus knowledge of Moqui Framework and the technical philosophy of
its author, read TECHNICAL.md and write a summary level report comparing the 
architecture of this hobby game to the architecture of Moqui Framework, and 
then offer recommendations on how this project can be improved using 
architectural and technical concepts from Moqui.
```

NOTE: this version of the report written by HY3 using two prompts that I merged into the one above. The original did not request recommendations, wording wasn't quite the same, etc. This is a cleaned up version of the prompt so I have it for future reference and is not meant to be a source of truth for how this file was made.

---

## 1. Moqui Primer (brief)

Moqui is a Java/JVM **enterprise application framework** built around a single, cohesive,
opinionated stack rather than a constellation of glued-together micro-libraries. Its core
is three declarative "facades" plus one central context object:

- **Entity Facade** — entities are declared in XML; the framework generates the schema and
  provides a single ORM over **plain `Map`-based records** (`GenericValue`). It transparently
  handles caching, referential integrity, and transactions.
- **Service Facade** — business logic is declared (XML + Groovy/Java). The framework
  automatically manages **transactions** (REQUIRED / REQUIRES_NEW semantics), **authorization**,
  validation, and metrics from those declarations.
- **Screen Facade** — UI is declared as composable XML screens rendered by one data-driven
  pipeline; cross-cutting concerns (security, caching, templating) are framework-owned.
- **ExecutionContext (`ec`)** — the single object threaded through everything; it is the
  *seam* to the outside world (entity, service, web, user, message, resource).

Jones's philosophy, repeatedly expressed in Moqui's design: prefer a **complete integrated
framework** over "assemble your own stack from microframeworks," push cross-cutting concerns
to declarative framework behavior instead of hand-written glue, keep the core logic isolated
behind typed seams, and treat records as plain data. In short: **declaration over imperative
plumbing, seams over glue, tools (the framework) over bespoke code.**

Concurrency model: Moqui is **highly multi-threaded**. It runs inside a servlet container
(e.g. Jetty) with **web/http worker threads**, a **database connection pool**, 
and **dozens of internal management/maintenance threads** (cache maintenance, scheduled jobs,
entity cache invalidation, etc.). Each web request gets its own `ExecutionContext` on its 
own worker thread; the facades are written to be thread-safe over shared in-memory state.

---

## 2. The Game in One Paragraph

The game's simulation core (`src/sim/GameEngine.ts`) is **framework-free** plain TypeScript:
it holds plain-data state (`GameRunState`, `PersistState`), runs on a fixed-timestep loop
inside a **Web Worker**, and communicates with the rest of the app through exactly three
typed seams — `Command` (intent in), `HostBindings` (how the sim reaches sound/UI/persist),
and `SimulationSnapshot` (state out as a serializable DTO). The main thread renders
imperatively (per-frame `setAttribute`/`style.transform` writes) on a `requestAnimationFrame`
loop, bypassing Vue's reactivity for hot paths; Pinia stores are only a reactive *projection*
of the snapshot for UI binding. A theme system cleanly splits **stats** (constants) from
**visuals** (theme JSON), and a second text/minimap renderer plus an LLM "enemy commander"
consume the same snapshot/command seams without touching the engine.

---

## 3. Comparison Matrix

### 3.1 Central seam to the outside world — *Aligned*
Moqui's `ExecutionContext`/facades are the single, well-defined way logic touches the world;
the game's `GameEngine` is similarly decoupled, reaching out only through `HostBindings` and
receiving intent only through the `Command`/`CommandDispatcher` seam. Both keep the core
logic free of framework and I/O pollution, which is exactly Jones's "isolate the core behind
seams" instinct. (`src/sim/HostBindings.ts`, `src/sim/commandBus.ts`) The single `applyCommand` switch (`src/sim/applyCommand.ts`) is the embryo of Moqui's Service Facade — all intent funnels through one dispatch point — but today it maps onto monolithic `GameEngine` methods rather than named, composable services (see proposal P1).

### 3.2 Plain, serializable data records — *Aligned*
Moqui entities are `Map`-based `GenericValue` records; the game uses plain TypeScript
interfaces and a `SimulationSnapshot` DTO that is structured-cloned across the worker boundary.
Both treat records as plain, serializable data rather than heavyweight ORM objects — easy to
clone, diff, snapshot, and test. (`src/sim/SimulationSnapshot.ts`, `SnapshotSerializer.ts`)

### 3.3 Declarative data / separation of concerns — *Aligned (instinct)*
Moqui moves the data model and behavior-specification into declarative XML. The game makes the
same move on its own terms: gameplay **stats** live in `Constants*.ts`, while **visuals**
(name/color/icon/sprite frames/tile images) live entirely in theme JSON — gameplay code never
references a color. This stats-vs-visuals split is a textbook Jones-style "data, not code"
decision: the engine specifies *what varies*; themes supply the variation.
(`src/render/themes/data/*.json`, `TECHNICAL.md` §Map Theme System)

### 3.4 Declarative-first vs. imperative execution — *Key divergence*
This is the sharpest philosophical contrast. Moqui is **declarative-first**: you declare
screens/services/entities and the framework owns *how* they render and execute. The game, by
contrast, **explicitly rejects** the declarative reactive framework for the hot path — Vue is
used only for structural UI, while per-frame rendering is raw imperative DOM mutation. The
divergence is deliberate and constraint-driven: a 60 Hz real-time loop cannot afford
reactivity-diff overhead, so the game inverts Moqui's "let the framework render" default. The
*data* side stays declarative; the *execution/render* side goes imperative.

### 3.5 Single integrated framework vs. library composition — *Divergence*
Jones's hallmark is the **cohesive integrated framework** as the antithesis to microframeworks
and hand-written glue. The game instead **composes** Vue + Pinia + Vue Router + Vite for its
shell, while keeping the sim core library-free. One could argue the sim core *is* itself a
small cohesive framework for tower defense — but the overall app is a library assembly, the
opposite of Moqui's "one stack to rule them all" posture.

### 3.6 Automatic cross-cutting concerns — *Partial alignment*
Moqui elevates transactions, authorization, and caching to **declarative framework behavior**.
The game shares the *concern* (don't repeat, centralize, don't lose updates) but **hand-rolls**
it: persistence is batched via a `persistDirty` flag flushed only on significant events;
snapshot flow is throttled by an ack-gate backpressure protocol; UI state is mirrored by
snapshot diffing into `gameStore`. Same instinct, manual vs. framework-magical — and, as a
client-side single-user app, the game has no transaction/authorization dimension to elevate.

### 3.7 Clean-seam extension payoff — *Aligned (and demonstrated)*
Moqui's hot-deploy components extend the system purely through the same facades. The game shows
the identical payoff: a **second text/minimap renderer** and an **LLM enemy commander** were
added as consumers of the snapshot/command seams with **zero changes to `GameEngine`**.
This is precisely Jones's thesis — a good seam makes new consumers cheap and the core stable.
(`src/components/TextGameRoot.vue`, `src/commanders/`)

### 3.8 Concurrency model — *Divergence in kind (not in presence)*
Both systems are explicitly and heavily concurrent — but the *models* differ:

- **Moqui**: **shared-memory preemptive multithreading**. Hundreds of Jetty web worker
  threads, a DB connection pool, and internal maintenance threads all share the process heap;
  each request gets its own `ExecutionContext` on its own thread, and the facades are written
  to be thread-safe over shared caches and entities.
- **Game**: **isolated single-threaded worker + explicit message passing**. The simulation
  runs alone in one Web Worker with no shared heap; the only crossing is the typed
  `Command`→`Snapshot` + ack-gate stream (structured clone). There is no shared mutable state
  across the boundary at all.

So the contrast is not "single-threaded vs. multi-threaded" (both are concurrent) but
**shared-memory threads behind a facade vs. isolated-heap actor-style isolation with an
explicit serializable protocol**. The game trades Moqui's shared-state throughput model for
determinism and a hard crash-isolation boundary suited to the browser.

---

## 4. Verdict

The game's **core** is, in spirit, a microcosm of Moqui's architecture philosophy applied to a
real-time browser context: a framework-free engine isolated behind typed seams, plain
serializable data, a declarative split of stats from visuals, a single dispatch path for all
intent, and an extension model where new consumers plug in without touching the core. These
are Jones's instincts exactly.

Where the game **pragmatically inverts** Moqui defaults, it does so for sound contextual
reasons rather than negligence:

- **Imperative rendering** over declarative, because a 60 Hz loop cannot pay reactivity tax.
- **Hand-rolled cross-cutting logic** over framework magic, because there is no framework and
  no tx/auth dimension client-side.
- **Library composition** over a single integrated framework, for the UI shell.
- **Isolated-worker message passing** over shared-memory threading, for determinism and
  crash isolation in the browser — even though both are unapologetically concurrent.

The through-line both share: **isolate the core behind typed seams so everything around it is
pluggable, testable, and replaceable.** The game is what Moqui's architecture philosophy looks
like when rebuilt by the same instincts for a single-user, real-time, client-side world.

---

## 5. Improvement Proposals (Moqui / Jones-Inspired)

The comparison above shows the game already *thinks* like Moqui at the core. The remaining gap
is that several cross-cutting concerns are still **hand-rolled or duplicated** where Moqui would
promote them to a **declared policy at a seam**. These are the highest-value follow-ups, grounded
in the actual code.

### 5.1 Research grounding (verified in code)
- Command validation is **duplicated**: affordability/buildability guards live inside
  `GameEngine` (`canAffordUpgrade`, `GameEngine.ts:682/713/729`) *and* as separate UI-disable
  logic in `GameShop.vue`/`TowerPanel.vue`. Yet `commandId` is already echoed back as
  `lastAppliedCommandId` for rejection detection — the plumbing for a validation layer exists but
  is unused for policy.
- Content is **partly** data-driven (`TOWER_BASE`/`TOWER_VARIANTS`/`TOWER_META` keyed by id in
  `ConstantsTower.ts`) but tower *behavior* still lives in `Tower.ts` + 16 projectile paths in
  `ProjectileManager.ts`; adding a tower is part-data, part-code.
- The engine is injected via **four separate concerns** (`host` constructor arg +
  `runState`/`persistState`/`themeBundle` via `lifecycle:init`), not one context object.
- `uiStore` duplicates pause-restoration across separate `wasPlaying` flags (per TECHNICAL.md).

### 5.2 Prioritized proposals

**P1 — Service Facade: decompose GameEngine into a named service library** *(mirrors Moqui Service Facade — the headline 3-tier logic layer)*. `GameEngine.ts` is a ~947-line monolith whose command-handling methods (`togglePause`, `upgradeSelected`, `sellSelected`, `specializeSelected`, `setTargeting`, `selectBuildType`, `handleClick`'s build path, `debug`, plus the `llm:*` enemy-route handlers inside `applyCommand.ts`) are imperative methods reached only through the single `applyCommand` switch (`src/sim/applyCommand.ts:15`). Moqui's central thesis is that business logic lives as a library of named, composable, validated **services** (verb#noun, e.g. `create#Example`), not as methods on a god-object. Refactor: create `src/sim/services/` with a `ServiceRegistry` and one service per intent, each a pure-ish function `(ctx: RunContext, params) => ServiceResult` (e.g. `game#togglePause`, `game#cycleSpeed`, `tower#place`, `tower#upgrade`, `tower#sell`, `tower#specialize`, `tower#setTargeting`, `tower#select`, `enemy#hold`, `enemy#route`, `enemy#setTargeting`, `economy#debug`). `applyCommand` collapses to a thin table mapping each `Command` → service name + param projection; the dispatcher builds a `RunContext` and runs the service. The fixed-timestep `engine.update(dt)` stays in the engine (the loop, not a service); only discrete intent logic moves out. Engine methods remain as defensive backstops. This is the most Moqui-distinctive change: it turns the implicit "command→method" switch into an explicit, named, testable, composable service library, and it is the precondition that makes P2's validation seam and P4's data-driven artifacts clean to author (services consume `RunContext`, not engine internals).

**P2 — Declarative Command Validation/Authorization Seam** *(highest value; mirrors Moqui
Service Facade authz + validation)*. Add a single `validateCommand(engine, command)` policy
applied once, automatically, before `applyCommand` in `WorkerEntry`'s tick drain. It is the sole
source of truth for "is this command allowed and what does it cost" (gold checks, build
validation, targeting/upgrade guards, sell confirm). The engine keeps its internal guards as a
defensive backstop, but the *policy* becomes canonical; UI disables are derived from the same
policy instead of re-implementing the rules. Rejections flow through the existing
`lastAppliedCommandId` echo so a rejected command is observable, not silently dropped. This is
the single biggest structural win — it pushes permission + validation to the facade, Jones's
central thesis.

**P3 — Unified `RunContext` object** *(mirrors Moqui `ExecutionContext`)*. Bundle `runState` +
`persistState` + `host` (HostBindings) + `themeBundle` into one `RunContext` passed to
`GameEngine` and managers. The worker init protocol and `applyCommand` then carry one handle
instead of four loose params, making the "seam to the world" explicit and singular.

**P4 — Data-driven "artifacts" for towers / enemies / maps** *(mirrors Moqui's "entity/artifact
as data" + "tools not code")*. Extend the record-keyed `TOWER_*` tables into a fuller declarative
artifact (behavior knobs: targeting modes, projectile shape, splash/chain/burn/knockback, status
tuning) so a new tower/enemy is *mostly a data addition*, not new code in `Tower.ts` /
`ProjectileManager.ts`. Likewise promote `Map.ts`'s layout styles + regions toward a content-pack
registry (prefigured by the theme `MAP_THEME_MANIFEST`) so new maps are data, not procedural code
edits. The purest Jones move: build the generic resolver once, add content as data.

**P5 — Declarative UI overlay/panel registry** *(mirrors Moqui Screen Facade sub-screen
composition)*. Replace hand-wired overlays in `GameScreen.vue`/`App.vue` with a data-driven
registry: `{ id, component, storeFlag, zOrder, pausesGame, restoreKey }`. New overlays become
registry entries, and the duplicated `wasPlaying` pause-restoration collapses into one policy
keyed by `restoreKey`, removing the per-overlay flag sprawl in `uiStore`.

**P6 — Elevate hand-rolled cross-cutting policies** *(mirrors Moqui's automatic tx/cache/authz)*.
Promote the inline `persistDirty` batching, ack-gate backpressure, and snapshot→`gameStore` mirror
logic into small declarative policies (`PersistPolicy`, `BackpressurePolicy`, `MirrorPolicy`) with
tunable thresholds, so they are configurable and unit-testable as first-class concerns — the
"framework owns the how" move, applied locally.

**P7 — Auto artifact-execution metrics** *(lowest priority; mirrors Moqui service metrics)*.
Generalize `WaveGraphTracker` into a thin declarative metric hook on command/snapshot execution
(counts, durations, reject rate). Nice-to-have, not core.

### 5.3 Explicitly NON-transferable (do not do)
- **Entity Facade / Map-based ORM over sim entities** — game entities are ephemeral, 60 Hz,
  non-persisted; an ORM/cache layer adds cost and indirection with zero benefit.
- **XML declarative screens** — Vue is already declarative; replacing it with Moqui-style XML is a
  regression for a browser UI.
- **Automatic transaction + authorization framework** — single-user client: no multi-user security
  model, no ACID/connection-pool need. Keep `persistDirty` manual; do not bolt on tx semantics.
- **Hot-deploy component classloader model** — the browser has no classloader; content extension is
  already covered by the theme manifest + (proposed) content-pack registry.

### 5.4 Recommended sequencing
1. **P1** (Service Facade) — foundational; turns the monolith's command methods into a named
   service library, reusing the existing Command seam. No behavior change on its own.
2. **P3** (RunContext) — small; gives services one handle to operate on. Do with/right after P1.
3. **P2** (validation seam) — biggest payoff; now validates *services* via the same facade and
   reuses the existing `lastAppliedCommandId` plumbing to remove the verified duplication.
4. **P5** (overlay registry) — removes the `wasPlaying` sprawl; low risk.
5. **P4 / P6** — larger data-driven + cross-cutting work; do after the seams are settled.
6. **P7** — optional metrics.

The common thread: the game already isolates its core behind typed seams. These changes finish
promoting the cross-cutting concerns (validation, context, content-as-data, overlay composition)
from hand-rolled/inlined to **declared at a seam** — Jones's central thesis, applied where it
fits a real-time browser context.
