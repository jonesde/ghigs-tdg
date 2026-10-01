// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoundManager } from "../../src/sound/SoundManager";

interface MockAudioContext {
  state: string;
  resume: ReturnType<typeof vi.fn>;
  createOscillator: ReturnType<typeof vi.fn>;
  createGain: ReturnType<typeof vi.fn>;
  createBiquadFilter: ReturnType<typeof vi.fn>;
  createBufferSource: ReturnType<typeof vi.fn>;
  destination: unknown;
  close: ReturnType<typeof vi.fn>;
}

describe("SoundManager", () => {
  let sm: SoundManager;

  beforeEach(() => {
    sm = new SoundManager();
  });

  describe("constructor", () => {
    it("initializes with enabled=true", () => {
      expect(sm.enabled).toBe(true);
    });

    it("initializes with ctx=null", () => {
      expect(sm.audioContext).toBeNull();
    });
  });

  describe("ensure()", () => {
    it("creates AudioContext on first call", () => {
      sm.ensure();
      expect(sm.audioContext).not.toBeNull();
    });

    it("does not create new AudioContext on second call", () => {
      sm.ensure();
      const ctx1 = sm.audioContext;
      sm.ensure();
      expect(sm.audioContext).toBe(ctx1);
    });

    it("sets enabled=false if AudioContext creation fails", () => {
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class {
        constructor() {
          throw new Error("AudioContext not supported");
        }
      } as unknown as typeof AudioContext;
      sm.ensure();
      expect(sm.enabled).toBe(false);
      globalThis.AudioContext = origAudioContext;
    });

    it("resumes suspended AudioContext", () => {
      sm.ensure();
      const resumeSpy = vi.fn();
      (sm.audioContext! as unknown as MockAudioContext).resume = resumeSpy;
      (sm.audioContext! as unknown as MockAudioContext).state = "suspended";
      sm.ensure();
      expect(resumeSpy).toHaveBeenCalled();
    });

    it("does not resume running AudioContext", () => {
      sm.ensure();
      const resumeSpy = vi.fn();
      (sm.audioContext! as unknown as MockAudioContext).resume = resumeSpy;
      (sm.audioContext! as unknown as MockAudioContext).state = "running";
      sm.ensure();
      expect(resumeSpy).not.toHaveBeenCalled();
    });
  });

  describe("play()", () => {
    it("does nothing when disabled", () => {
      sm.enabled = false;
      sm.play("shoot_basic");
      expect(sm.audioContext).toBeNull();
    });

    it("does nothing when ctx is null after ensure fails", () => {
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class {
        constructor() {
          throw new Error("AudioContext not supported");
        }
      } as unknown as typeof AudioContext;
      sm.ensure();
      expect(sm.audioContext).toBeNull();
      expect(sm.enabled).toBe(false);
      sm.play("shoot_basic");
      globalThis.AudioContext = origAudioContext;
    });

    it("creates oscillatorillator and gain node", () => {
      sm.play("shoot_basic");
      expect((sm.audioContext! as unknown as MockAudioContext).createOscillator).toHaveBeenCalled();
      expect((sm.audioContext! as unknown as MockAudioContext).createGain).toHaveBeenCalled();
    });

    it("connects oscillator to lowpass, lowpass to gain, and gain to destination", () => {
      sm.play("shoot_basic");
      const audioContext = sm.audioContext as unknown as MockAudioContext;
      const oscillator = audioContext.createOscillator.mock.results[0].value;
      const toneFilter = audioContext.createBiquadFilter.mock.results[0].value;
      const gainNode = audioContext.createGain.mock.results[0].value;
      expect(oscillator.connect).toHaveBeenCalledWith(toneFilter);
      expect(toneFilter.connect).toHaveBeenCalledWith(gainNode);
      expect(gainNode.connect).toHaveBeenCalledWith(audioContext.destination);
      expect(toneFilter.type).toBe("lowpass");
      expect(toneFilter.frequency.value).toBe(900);
    });

    it.each([
      ["shoot_basic", "triangle", 392, 900, false],
      ["shoot_sniper", "sine", 140, 400, false],
      ["shoot_cannon", "sine", 70, 180, true],
      ["shoot_ice", "sine", 520, 1200, false],
      ["shoot_lightning", "triangle", 680, 1400, true],
      ["shoot_railgun", "sine", 320, 700, false],
      ["shoot_shotgunTank", "triangle", 160, 500, false],
      ["shoot_sturdyWall", "sine", 90, 250, false],
      ["place", "triangle", 220, 600, false],
      ["base_hit", "sine", 55, 160, false],
      ["boss_die", "sine", 70, 200, false],
      ["sell", "triangle", 300, 700, false],
      ["cancel", "sine", 160, 500, false],
    ] as const)("%s starts at its voice frequency through a lowpass", (name, oscillatorType, frequencyStart, lowpassHz, usesNoise) => {
      sm.play(name);
      const audioContext = sm.audioContext as unknown as MockAudioContext;
      const oscillator = audioContext.createOscillator.mock.results[0].value;
      const toneFilter = audioContext.createBiquadFilter.mock.results[0].value;
      expect(oscillator.type).toBe(oscillatorType);
      expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(frequencyStart, expect.anything());
      expect(oscillator.frequency.exponentialRampToValueAtTime).toHaveBeenCalled();
      expect(toneFilter.frequency.value).toBe(lowpassHz);
      if (usesNoise) {
        expect(audioContext.createBufferSource).toHaveBeenCalled();
      } else {
        expect(audioContext.createBufferSource).not.toHaveBeenCalled();
      }
    });

    it("calls setValueAtTime on gain", () => {
      sm.play("shoot_basic");
      const gainNode = (sm.audioContext?.createGain as MockAudioContext["createGain"]).mock.results[0].value;
      expect(gainNode.gain.setValueAtTime).toHaveBeenCalled();
    });

    it("calls exponentialRampToValueAtTime on gain", () => {
      sm.play("shoot_basic");
      const gainNode = (sm.audioContext?.createGain as MockAudioContext["createGain"]).mock.results[0].value;
      expect(gainNode.gain.exponentialRampToValueAtTime).toHaveBeenCalled();
    });

    it("calls start and stop on oscillatorillator", () => {
      sm.play("shoot_basic");
      const oscillator = (sm.audioContext?.createOscillator as MockAudioContext["createOscillator"]).mock.results[0]
        .value;
      expect(oscillator.start).toHaveBeenCalled();
      expect(oscillator.stop).toHaveBeenCalled();
    });
  });

  describe("dispose()", () => {
    it("closes AudioContext and sets ctx to null", () => {
      sm.ensure();
      const closeSpy = vi.fn();
      (sm.audioContext! as unknown as { close: ReturnType<typeof vi.fn> }).close = closeSpy;
      sm.dispose();
      expect(closeSpy).toHaveBeenCalled();
      expect(sm.audioContext).toBeNull();
    });

    it("does nothing when ctx is null", () => {
      const closeSpy = vi.fn();
      sm.dispose();
      expect(closeSpy).not.toHaveBeenCalled();
    });
  });
});
