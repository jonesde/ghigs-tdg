import * as Recast from "recast-navigation";

let initialized = false;
let recastModule: typeof Recast | null = null;
// In-flight init promise shared by concurrent callers; initialized flips only on
// success so a failed load can be retried. Mirrors rapierContext.ts.
let pendingInit: Promise<void> | null = null;

// Cached async init of the recast-navigation WASM module (plans/recast.md Phase 0).
// Re-entrancy safe: returns the same pending promise while a load is in flight.
export function initNavMesh(): Promise<void> {
  if (pendingInit) return pendingInit;
  if (initialized) return Promise.resolve();
  pendingInit = runNavMeshInit();
  void pendingInit.then(
    () => {
      pendingInit = null;
    },
    () => {
      pendingInit = null;
    },
  );
  return pendingInit;
}

async function runNavMeshInit(): Promise<void> {
  await Recast.init();
  recastModule = Recast;
  initialized = true;
}

// Returns the initialized recast-navigation module namespace (classes + helpers).
// THROWS if initNavMesh() has not resolved. NavMeshBuilder and CrowdManager call
// this in their constructors as an init-first gate, so any direct construction
// path (engine, tests) fails fast instead of touching unloaded WASM.
export function getRecast(): typeof Recast {
  if (!recastModule) {
    throw new Error("initNavMesh() must be awaited before getRecast() is called");
  }
  return recastModule;
}

export function isNavMeshInitialized(): boolean {
  return initialized;
}

// Test-only reset: drops the cached module so a double-init test can observe the
// in-flight promise path. Callers must await initNavMesh() again afterwards.
export function resetNavMeshContextForTests(): void {
  initialized = false;
  recastModule = null;
  pendingInit = null;
}
