// @ts-nocheck
import { vi } from "vitest";
import { initNavMesh } from "@/sim/navmesh/recastContext.js";
import { initPhysics } from "@/sim/physics/rapierContext.js";

const noop = (): void => {};

const store = new Map<string, string>();

globalThis.localStorage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, val: string) => store.set(key, String(val))),
  removeItem: vi.fn((key: string) => store.delete(key)),
  clear: vi.fn(() => store.clear()),
  get length(): number {
    return store.size;
  },
  key: vi.fn((index: number) => {
    const keys = [...store.keys()];
    return keys[index] ?? null;
  }),
};

// Suppress Vue warnings about lifecycle hooks used outside component setup
// (e.g. Vue composables called directly in tests without a component instance)
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const msg = String(args[0] ?? "");
  if (msg.includes("onUnmounted is called when there is no active component instance")) return;
  originalWarn.apply(console, args as Parameters<typeof console.warn>);
};

const mockCtx: Partial<CanvasRenderingContext2D> = {
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  fillText: vi.fn(),
  strokeText: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  arcTo: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  rotate: vi.fn(),
  setTransform: vi.fn(),
  transform: vi.fn(),
  resetTransform: vi.fn(),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() }) as unknown as CanvasGradient),
  createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() }) as unknown as CanvasGradient),
  measureText: vi.fn(() => ({ width: 0 }) as unknown as TextMetrics),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0) }) as unknown as ImageData),
  putImageData: vi.fn(),
  drawImage: vi.fn(),
  strokeRect: vi.fn(),
  setLineDash: vi.fn(),
  shadowBlur: 0,
  shadowColor: "",
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  strokeStyle: "",
  fillStyle: "",
  lineWidth: 1,
  font: "",
  textAlign: "start",
  textBaseline: "top",
  lineCap: "butt",
  lineJoin: "miter",
};

const mockCanvas: {
  width: number;
  height: number;
  getContext: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
} = {
  width: 800,
  height: 600,
  getContext: vi.fn(() => mockCtx),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

// Make every HTMLCanvasElement (including ones created via document.createElement)
// return the shared mock 2D context, so canvas-using code (e.g. the snapshot
// minimap highlight) works regardless of test-file ordering. Without this, only
// files that patch the prototype locally get a working getContext.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => mockCtx,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

class MockAudioContext {
  state: AudioContextState = "running";
  sampleRate = 44100;
  currentTime = 0;
  createOscillator: ReturnType<typeof vi.fn>;
  createGain: ReturnType<typeof vi.fn>;
  createBiquadFilter: ReturnType<typeof vi.fn>;
  createBuffer: ReturnType<typeof vi.fn>;
  createBufferSource: ReturnType<typeof vi.fn>;
  decodeAudioData: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;

  constructor() {
    this.createOscillator = vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      frequency: { value: 440, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    }));
    this.createGain = vi.fn(() => ({
      gain: {
        value: 1,
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }));
    this.createBiquadFilter = vi.fn(() => ({
      type: "lowpass",
      frequency: { value: 350 },
      Q: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }));
    this.createBuffer = vi.fn(() => ({ getChannelData: vi.fn(() => new Float32Array(0)) }));
    this.createBufferSource = vi.fn(() => ({
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }));
    this.decodeAudioData = vi.fn(() => Promise.resolve({}));
    this.close = vi.fn(() => Promise.resolve());
  }
}

globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
globalThis.Audio = vi.fn(
  () => ({ src: "", play: noop, pause: noop, volume: 1, currentTime: 0 }) as unknown as HTMLAudioElement,
);

const rafCallbacks: Array<{ id: number; callback: (time: number) => void }> = [];
let rafId = 0;

globalThis.requestAnimationFrame = vi.fn((callback: (time: number) => void) => {
  const id = ++rafId;
  rafCallbacks.push({ id, callback });
  return id;
});
globalThis.cancelAnimationFrame = vi.fn((id: number) => {
  const idx = rafCallbacks.findIndex((entry) => entry.id === id);
  if (idx >= 0) rafCallbacks.splice(idx, 1);
});

globalThis.flushRaf = () => {
  const entries = [...rafCallbacks];
  rafCallbacks.length = 0;
  for (const entry of entries) entry.callback(performance.now());
};

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// Physics init safety net (plans/rapier2d.md Phase 0). Every direct-construct test
// path is safe at start-up without per-file init calls.
await initPhysics();
// Navmesh init safety net (plans/recast.md Phase 0). Same rationale as above — every
// direct-construct test path that touches recast-navigation is safe at start-up.
await initNavMesh();

export { mockCanvas, mockCtx };
