export interface ParticleGame {
  id: number;
  ox: number;
  oy: number;
  deltaX: number;
  deltaY: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface RenderParticle {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  opacity: number;
}

// Sparse spawn request buffered by the worker-side spawner and shipped to the
// main thread inside the snapshot (only when non-empty). The main thread turns
// each request into live particles in its own ParticleSystem.
export interface ParticleSpawnRequest {
  x: number;
  y: number;
  color: string;
  count: number;
  speed: number;
  life: number;
}

// Shared spawner contract. `consumeSpawns` is optional: the main-thread
// ParticleSystem acts as its own spawner (spawns land directly in it) and has
// no buffer to drain, while the worker spawner buffers requests and drains
// them into the snapshot. `peekSpawns` is the non-consuming read the serializer
// uses so a built-but-not-posted snapshot never discards undrained requests;
// WorkerEntry consumes after a successful post. `setRng` is optional: only
// spawners that roll (the visual ParticleSystem below) need it; the worker
// buffer records requests without randomness.
export interface ParticleSpawner {
  spawn(
    x: number,
    y: number,
    color: string,
    count: number,
    opts: { speed?: number; life?: number; size?: number },
  ): void;
  peekSpawns?(): ParticleSpawnRequest[] | undefined;
  consumeSpawns?(): ParticleSpawnRequest[] | undefined;
  setRng?(rng: () => number): void;
}

// Default no-op spawner so `new GameEngine(...)` call sites that do not supply
// a spawner (e.g. tests) stay green without a particle side channel.
export class NoopParticleSpawner implements ParticleSpawner {
  spawn(): void {
    /* noop */
  }
  peekSpawns(): undefined {
    return undefined;
  }
  consumeSpawns(): undefined {
    return undefined;
  }
}

// Drop-oldest policy for the buffered snapshot spawn list: recent explosions
// are the ones the current frame still draws, so the newest bursts win when a
// death-spam tick exceeds the cap. Coalescing would need per-color/size
// bucketing and would still need a cap.
export const MAX_PENDING_PARTICLE_SPAWNS = 64;

// Worker-side spawner: records sparse spawn requests instead of simulating
// particles. buildSnapshot peeks the buffer when non-empty (gated like `paths`),
// so quiet ticks ship nothing; WorkerEntry consumes the buffer only after a
// successful post, so dropped-tick requests survive to the next post. Engine-scoped
// (not module-scoped) so per-engine buildSnapshot tests behave deterministically.
export class WorkerParticleSpawner implements ParticleSpawner {
  private buffer: ParticleSpawnRequest[] = [];

  spawn(
    x: number,
    y: number,
    color: string,
    count: number,
    opts: { speed?: number; life?: number; size?: number },
  ): void {
    if (this.buffer.length >= MAX_PENDING_PARTICLE_SPAWNS) {
      this.buffer.shift();
    }
    this.buffer.push({ x, y, color, count, speed: opts.speed ?? 60, life: opts.life ?? 0.5 });
  }

  peekSpawns(): ParticleSpawnRequest[] | undefined {
    return this.buffer.length === 0 ? undefined : this.buffer;
  }

  consumeSpawns(): ParticleSpawnRequest[] | undefined {
    if (this.buffer.length === 0) return undefined;
    const out = this.buffer;
    this.buffer = [];
    return out;
  }
}

const MAX_PARTICLES = 400;
// Per-call clamp: one spawn call (death burst, debug clear) cannot exceed this;
// the MAX_PARTICLES pool still bounds the total live count.
export const MAX_PARTICLES_PER_SPAWN = 24;
const PARTICLE_DAMPING_PER_REFERENCE_FRAME = 0.98;
const PARTICLE_DAMPING_REFERENCE_HZ = 60;

export class ParticleSystem implements ParticleSpawner {
  particles: ParticleGame[];
  private nextParticleId: number;
  // Reused render list (mirrors ProjectileManager.renderDataBuffer): the array
  // object is stable, only the live entries change per frame.
  private renderDataBuffer: RenderParticle[] = [];
  // Seeded roll source. The worker never constructs this class (it buffers
  // requests via WorkerParticleSpawner), so the default only governs main-thread
  // visual scatter; sim-side constructions inject the engine's per-run fork.
  private rng: () => number = Math.random;

  constructor(rng: (() => number) | null = null) {
    this.particles = [];
    this.nextParticleId = 1;
    if (rng) this.rng = rng;
  }

  // Cross-module: GameEngine injects its per-run seeded fork here after construct.
  setRng(rng: () => number): void {
    this.rng = rng;
  }

  spawn(
    x: number,
    y: number,
    color: string,
    count: number,
    opts: { speed?: number; life?: number; size?: number },
  ): void {
    const speed = opts.speed || 60;
    const life = opts.life || 0.5;
    const size = opts.size || 3;
    const clampedCount = Math.min(count, MAX_PARTICLES_PER_SPAWN);

    for (let i = 0; i < clampedCount; i++) {
      const angle = this.rng() * Math.PI * 2;
      const particleSpeed = speed * (0.5 + this.rng() * 0.8);
      this.particles.push({
        id: this.nextParticleId++,
        ox: x,
        oy: y,
        deltaX: Math.cos(angle) * particleSpeed,
        deltaY: Math.sin(angle) * particleSpeed,
        life: life,
        maxLife: life,
        color,
        size,
      });
    }

    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }
  }

  update(dt: number): void {
    // In-place compaction instead of filter() so we don't allocate a fresh array
    // every tick (bounded by MAX_PARTICLES). Write-index swap keeps the live
    // particles packed at the front; trailing slots are dropped via length.
    // Damping is per-reference-frame (0.98 at 60 Hz) raised to the real dt so a
    // variable-dt update does not damp twice as fast at half the tick rate.
    const damping = PARTICLE_DAMPING_PER_REFERENCE_FRAME ** (dt * PARTICLE_DAMPING_REFERENCE_HZ);
    let write = 0;
    for (let read = 0; read < this.particles.length; read++) {
      const particle = this.particles[read]!;
      particle.ox += particle.deltaX * dt;
      particle.oy += particle.deltaY * dt;
      particle.deltaX *= damping;
      particle.deltaY *= damping;
      particle.life -= dt;
      if (particle.life > 0) this.particles[write++] = particle;
    }
    this.particles.length = write;
  }

  getRenderData(): RenderParticle[] {
    const result = this.renderDataBuffer;
    result.length = 0;
    for (const particle of this.particles) {
      const lifeRatio = Math.max(0, particle.life / particle.maxLife);
      result.push({
        id: particle.id,
        x: particle.ox,
        y: particle.oy,
        color: particle.color,
        size: particle.size,
        opacity: lifeRatio,
      });
    }
    return result;
  }

  clear(): void {
    this.particles = [];
  }
}
