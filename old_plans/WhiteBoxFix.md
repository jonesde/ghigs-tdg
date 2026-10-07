# Plan: White-Box Test Cleanup — classification + resolution strategy

## Motivation
Tests in this codebase co-evolved with the code and reached into implementation
internals: private-method spies, casts that call private methods, and hand-built
data-format literals fed across module boundaries. This white-box coupling biases
design changes — most acutely, a cross-boundary format literal freezes a producer's
wire shape, so any format change ripples into tests and the format gets preserved
for the tests' sake rather than for consumers'. The fix is not to delete tests but
to give cleanup a shared, reviewable standard: a classification (black-box vs
white-box) and a resolution strategy (fix vs remove) so every white-box test is
handled consistently.

## Embedded definitions (the plan's self-audit criteria)

### Black/white-box classification (simplified)
- **Stable boundary** = a public API the design promises to keep stable, through
  which consumer-visible behavior is observed (e.g. `SnapshotStore.apply` /
  `getLatestSnapshot`, the command seam, `getLatestSnapshot` for renderers;
  for entity tests: `Enemy`/`EnemyManager`/`TowerManager` public methods and the
  observable entity state the renderers/UI read — `health`, `x/y`, `attackAnimTime`,
  `attackingBase`, `removed`).
- **Black-box (boundary-respecting)** — drives the system only through a stable
  boundary and asserts only consumer-visible behavior at that boundary. (Internal
  values may be used as input fixtures only.)
- **White-box (boundary-violating)** — does any of:
  - (a) reaches across a module boundary to build/assert/assume another module's
    data format (hand-built format literal fed across a boundary, e.g.
    `schemaVersion` / partial `SimulationSnapshot`);
  - (b) spies on or directly calls a private/internal method;
  - (c) asserts an internal field no consumer reads.
- **Boundary qualifier** — asserting a module's *own* public output (incl. its own
  format) is black-box, not white-box. Only *cross-boundary* format knowledge and
  private/internal reach are white-box.
- **Operational rule** — a test is white-box iff it breaks under a
  behavior-preserving change to: (1) an internal field no consumer reads, (2) the
  wire/format, or (3) a private method's name/structure.

### Resolution-strategy distinction (fix vs remove), by the test's *nature*
Stripping a white-box test's white-box *mechanism* reveals whether its assertion is
a real consumer-visible behavior or merely an implementation/control-flow detail:
- **Fix** (rewrite the test to respect the boundary) iff the assertion, expressed at
  a stable boundary, is a genuine **consumer-visible behavior** the design's
  contract guarantees — i.e. it would classify as black-box once the mechanism is
  corrected. The rewritten test must still assert that same behavior.
- **Remove** (delete the test) iff the assertion, even at a stable boundary, is only
  an **implementation/control-flow detail** with no consumer-visible equivalent —
  i.e. it is "naturally" a white-box test. A removed test must have its behavior
  already covered by a black-box test (or be genuinely behavior-free); if a real
  behavior gap exists, add a *separate* black-box test — but the white-box test
  itself is removed.

### Severity tiers (prioritization, not classification)
All white-box tests are rewritable without compromising correctness, but they bias
design changes differently:
- **Tier 1 — cross-boundary format literals:** most dangerous; freeze a producer's
  wire format and force every format change to ripple into tests. Highest priority.
- **Tier 2 — private-method spies / casts:** brittle to refactors; break on
  control-flow reroutes that preserve behavior.
- **Tier 3 — internal-field pokes as fixtures:** lowest risk (set-up only, not
  assertions); a smell (often forces `@ts-nocheck`) but not behavior-biasing alone.

## Application method (how to use this plan)
1. Classify each test in a file against the classification above.
2. For each white-box test, decide **fix** vs **remove** by its *nature* (resolution
   strategy).
3. Apply priorities: Tier 1 first (design-biasing), then Tier 2, then Tier 3 only if
   convenient.
4. A fixed test asserts the same consumer-visible behavior through a stable boundary.
   A removed test has its behavior already covered by a black-box test, or is
   behavior-free (else add a separate black-box test).

## Worked examples (cited to illustrate the strategies — NOT resolved in this plan)
- `tests/unit/enemy-attack.test.ts:215` — **Fix** example. *Nature:* valid — asserts
  lateral collision separation (slower enemy separates right, faster left),
  consumer-visible via rendered `x/y`. *Mechanism:* calls the private
  `Enemy.resolveCollisions` via a cast → white-box (Tier 2). A correct resolution
  would drive the two enemies through the public `enemyManager.update` path and
  assert the resulting lateral positional separation, dropping the private call.
  Cited only as the canonical "fix" case.
- `tests/unit/enemy-attack.test.ts:591` — **Remove** example. *Nature:*
  control-flow / dead-branch guard — its only unique assertion is that the private
  `Grid.getTowerEdgeSegments` was *called*. No consumer-visible behavior is unique
  to it; the pile-attacks-blocker / stays-on-path behavior is already asserted by
  `:476`. A correct resolution would delete the spy test. Cited only as the
  canonical "remove" case.

These two are intentionally **not goals of this plan** — they exist so future
cleanup applies the two strategies consistently.

## Scope of this plan
- Establish and document the classification + resolution strategy (this file).
- Adopt it as the standard lens for reviewing and cleaning up white-box tests going
  forward.
- Does **not** resolve `:215`, `:591`, or any other specific test.

## Suggested next application (future, not in this plan)
- Highest-value targets are Tier 1 cross-boundary format literals in the
  snapshot-spine tests: `tests/unit/snapshot-store.test.ts`,
  `tests/unit/components/stats-panel.test.ts`,
  `tests/unit/components/text-game-root.test.ts` — each builds a hand-coded
  `SimulationSnapshot` literal with `schemaVersion: 1` and feeds it into
  `SnapshotStore.apply` across the module boundary. A follow-up plan would apply the
  fix/remove strategy there.

## Non-goals
- No source changes (no edits to `Enemy`, `Grid`, `SnapshotStore`, serializers).
- No full-suite rewrite; cleanup is incremental, file-by-file, as tests are touched.
- Not adding these definitions to `AGENTS.md` in this plan (candidate follow-up).
