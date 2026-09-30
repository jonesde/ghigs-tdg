import RAPIER from "@dimforge/rapier2d-compat";

let initialized = false;
let rapierModule: typeof RAPIER | null = null;
// In-flight init promise: concurrent initPhysics() callers share one WASM load
// instead of racing two inits, and initialized flips only on success so a failed
// load can be retried by a later call.
let pendingInit: Promise<void> | null = null;

// Cached async init of the Rapier WASM module. Re-entrancy safe: returns the same
// pending promise while a load is in flight, a resolved promise once done.
export function initPhysics(): Promise<void> {
  if (pendingInit) return pendingInit;
  if (initialized) return Promise.resolve();
  pendingInit = runPhysicsInit();
  // Clear the in-flight slot once settled (success or failure) so a later call
  // either short-circuits on initialized or retries a failed load.
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

async function runPhysicsInit(): Promise<void> {
  // rapier2d-compat@0.19.3's bundled init() passes the inlined WASM bytes to the
  // wasm-bindgen loader as a positional argument, which triggers a spurious
  // "deprecated parameters for the initialization function" warning. The call is
  // correct; suppress only that exact message while init runs, then restore.
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === "string" && args[0].includes("deprecated parameters for the initialization function")) {
      return;
    }
    originalWarn(...args);
  };
  try {
    await RAPIER.init();
  } finally {
    console.warn = originalWarn;
  }
  rapierModule = RAPIER;
  initialized = true;
}

// Returns the initialized Rapier module. THROWS if initPhysics() has not
// resolved — this guards misuse (the synchronous GameEngine constructor calls
// this unconditionally, so it is only safe after initPhysics() has resolved).
export function getRapier(): typeof RAPIER {
  if (!rapierModule) {
    throw new Error("initPhysics() must be awaited before getRapier() is called");
  }
  return rapierModule;
}

export function isPhysicsInitialized(): boolean {
  return initialized;
}

// Test-only reset: drops the cached module so a double-init test can observe the
// in-flight promise path. Callers must await initPhysics() again afterwards.
export function resetPhysicsContextForTests(): void {
  initialized = false;
  rapierModule = null;
  pendingInit = null;
}
