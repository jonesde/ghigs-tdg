// Lightweight WebAudio synth — no external assets needed.

import type { SoundName } from "@/sim/HostBindings.js";

interface ToneVoice {
  oscillatorType: OscillatorType;
  frequencyStart: number;
  frequencyEnd: number;
  durationSeconds: number;
  gainPeak: number;
  lowpassHz: number;
  noiseGain: number;
}

const GAIN_ATTACK_SECONDS = 0.008;
const NOISE_BUFFER_SECONDS = 0.25;
const SILENT_GAIN = 0.0001;
const RELEASE_GAIN = 0.001;

const TONE_VOICES: Record<SoundName, ToneVoice> = {
  shoot_basic: {
    oscillatorType: "triangle",
    frequencyStart: 392,
    frequencyEnd: 220,
    durationSeconds: 0.07,
    gainPeak: 0.035,
    lowpassHz: 900,
    noiseGain: 0,
  },
  shoot_sniper: {
    oscillatorType: "sine",
    frequencyStart: 140,
    frequencyEnd: 55,
    durationSeconds: 0.12,
    gainPeak: 0.04,
    lowpassHz: 400,
    noiseGain: 0,
  },
  shoot_cannon: {
    oscillatorType: "sine",
    frequencyStart: 70,
    frequencyEnd: 32,
    durationSeconds: 0.22,
    gainPeak: 0.05,
    lowpassHz: 180,
    noiseGain: 0.04,
  },
  shoot_ice: {
    oscillatorType: "sine",
    frequencyStart: 520,
    frequencyEnd: 360,
    durationSeconds: 0.16,
    gainPeak: 0.03,
    lowpassHz: 1200,
    noiseGain: 0,
  },
  shoot_lightning: {
    oscillatorType: "triangle",
    frequencyStart: 680,
    frequencyEnd: 180,
    durationSeconds: 0.05,
    gainPeak: 0.03,
    lowpassHz: 1400,
    noiseGain: 0.03,
  },
  shoot_railgun: {
    oscillatorType: "sine",
    frequencyStart: 320,
    frequencyEnd: 90,
    durationSeconds: 0.09,
    gainPeak: 0.035,
    lowpassHz: 700,
    noiseGain: 0,
  },
  shoot_shotgunTank: {
    oscillatorType: "triangle",
    frequencyStart: 160,
    frequencyEnd: 70,
    durationSeconds: 0.09,
    gainPeak: 0.04,
    lowpassHz: 500,
    noiseGain: 0,
  },
  shoot_sturdyWall: {
    oscillatorType: "sine",
    frequencyStart: 90,
    frequencyEnd: 50,
    durationSeconds: 0.06,
    gainPeak: 0.03,
    lowpassHz: 250,
    noiseGain: 0,
  },
  place: {
    oscillatorType: "triangle",
    frequencyStart: 220,
    frequencyEnd: 160,
    durationSeconds: 0.09,
    gainPeak: 0.04,
    lowpassHz: 600,
    noiseGain: 0,
  },
  sell: {
    oscillatorType: "triangle",
    frequencyStart: 300,
    frequencyEnd: 180,
    durationSeconds: 0.1,
    gainPeak: 0.035,
    lowpassHz: 700,
    noiseGain: 0,
  },
  cancel: {
    oscillatorType: "sine",
    frequencyStart: 160,
    frequencyEnd: 110,
    durationSeconds: 0.07,
    gainPeak: 0.025,
    lowpassHz: 500,
    noiseGain: 0,
  },
  base_hit: {
    oscillatorType: "sine",
    frequencyStart: 55,
    frequencyEnd: 30,
    durationSeconds: 0.28,
    gainPeak: 0.06,
    lowpassHz: 160,
    noiseGain: 0,
  },
  boss_die: {
    oscillatorType: "sine",
    frequencyStart: 70,
    frequencyEnd: 28,
    durationSeconds: 0.5,
    gainPeak: 0.07,
    lowpassHz: 200,
    noiseGain: 0,
  },
};

export class SoundManager {
  audioContext: AudioContext | null;
  enabled: boolean;
  private noiseBuffer: AudioBuffer | null;

  constructor() {
    this.audioContext = null;
    this.enabled = true;
    this.noiseBuffer = null;
  }

  ensure(): void {
    if (!this.audioContext) {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: webkitAudioContext fallback for older browsers
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch {
        this.enabled = false;
      }
    }
    if (this.audioContext && this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }
  }

  play(name: SoundName): void {
    if (!this.enabled) return;
    this.ensure();
    if (!this.audioContext) return;
    const audioContext = this.audioContext;
    const voice = TONE_VOICES[name];
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const toneFilter = audioContext.createBiquadFilter();
    const toneGain = audioContext.createGain();
    oscillator.connect(toneFilter);
    toneFilter.connect(toneGain);
    toneGain.connect(audioContext.destination);
    oscillator.type = voice.oscillatorType;
    toneFilter.type = "lowpass";
    toneFilter.frequency.value = voice.lowpassHz;
    oscillator.frequency.setValueAtTime(voice.frequencyStart, now);
    oscillator.frequency.exponentialRampToValueAtTime(voice.frequencyEnd, now + voice.durationSeconds);
    toneGain.gain.setValueAtTime(SILENT_GAIN, now);
    toneGain.gain.linearRampToValueAtTime(voice.gainPeak, now + GAIN_ATTACK_SECONDS);
    toneGain.gain.exponentialRampToValueAtTime(RELEASE_GAIN, now + voice.durationSeconds);
    oscillator.start(now);
    oscillator.stop(now + voice.durationSeconds);
    if (voice.noiseGain > 0) this.playNoise(audioContext, now, voice);
  }

  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.noiseBuffer = null;
  }

  private playNoise(audioContext: AudioContext, now: number, voice: ToneVoice): void {
    const noiseSource = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();
    noiseSource.buffer = this.sharedNoiseBuffer(audioContext);
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioContext.destination);
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = voice.lowpassHz;
    noiseGain.gain.setValueAtTime(SILENT_GAIN, now);
    noiseGain.gain.linearRampToValueAtTime(voice.noiseGain, now + GAIN_ATTACK_SECONDS);
    noiseGain.gain.exponentialRampToValueAtTime(RELEASE_GAIN, now + voice.durationSeconds);
    noiseSource.start(now);
    noiseSource.stop(now + voice.durationSeconds);
  }

  private sharedNoiseBuffer(audioContext: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const sampleRate = audioContext.sampleRate || 44100;
    const frameCount = Math.max(1, Math.floor(sampleRate * NOISE_BUFFER_SECONDS));
    const buffer = audioContext.createBuffer(1, frameCount, sampleRate);
    const samples = buffer.getChannelData(0);
    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex++) {
      samples[sampleIndex] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }
}
