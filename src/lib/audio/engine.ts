import { ensureClockAlive as checkClockAlive } from "./clock-watchdog";

export type EntrainmentMode = "binaural" | "isochronic";

export interface EntrainmentEngineOptions {
  mode?: EntrainmentMode;
  carrierHz?: number;
  toneGain?: number;
  voiceGain?: number;
}

export class EntrainmentEngine {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly toneGain: GainNode;
  private readonly voiceGain: GainNode;
  private mode: EntrainmentMode;
  private readonly carrierHz: number;
  private currentBeatHz = 10;
  private bedNodes: AudioScheduledSourceNode[] = [];
  private oscB: OscillatorNode | null = null;
  private lfo: OscillatorNode | null = null;
  private disposed = false;

  constructor(
    audioContext?: AudioContext,
    options: EntrainmentEngineOptions = {},
  ) {
    this.ctx = audioContext ?? new AudioContext();
    this.mode = options.mode ?? "isochronic";
    this.carrierHz = options.carrierHz ?? 200;

    this.master = this.ctx.createGain();
    this.toneGain = this.ctx.createGain();
    this.voiceGain = this.ctx.createGain();

    this.toneGain.gain.value = options.toneGain ?? 0.12;
    this.voiceGain.gain.value = options.voiceGain ?? 1.0;

    this.toneGain.connect(this.master);
    this.voiceGain.connect(this.master);
    this.master.connect(this.ctx.destination);
  }

  get audioContext(): AudioContext {
    return this.ctx;
  }

  get currentMode(): EntrainmentMode {
    return this.mode;
  }

  setVoiceGain(value: number): void {
    this.voiceGain.gain.value = value;
  }

  setToneGain(value: number): void {
    this.toneGain.gain.value = value;
  }

  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    if (this.ctx.state === "suspended") {
      throw new Error("AudioContext suspended — no user activation");
    }
  }

  /** Sample currentTime before/after a short wait; false if the rendering clock never started. */
  async ensureClockAlive(): Promise<boolean> {
    return checkClockAlive(this.ctx);
  }

  async suspend(): Promise<void> {
    if (this.ctx.state === "running") {
      await this.ctx.suspend();
    }
  }

  setMode(mode: EntrainmentMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    const beat = this.currentBeatHz;
    this.stopBed();
    this.startBed(beat);
  }

  startBed(beatHz: number): void {
    this.currentBeatHz = beatHz;
    this.stopBed();

    if (this.mode === "binaural") {
      const oscA = this.ctx.createOscillator();
      this.oscB = this.ctx.createOscillator();
      oscA.frequency.value = this.carrierHz;
      this.oscB.frequency.value = this.carrierHz + beatHz;

      const panA = this.ctx.createStereoPanner();
      panA.pan.value = -1;
      const panB = this.ctx.createStereoPanner();
      panB.pan.value = 1;

      oscA.connect(panA).connect(this.toneGain);
      this.oscB.connect(panB).connect(this.toneGain);
      oscA.start();
      this.oscB.start();
      this.bedNodes = [oscA, this.oscB];
    } else {
      const carrier = this.ctx.createOscillator();
      carrier.frequency.value = this.carrierHz;

      const am = this.ctx.createGain();
      am.gain.value = 0;

      const offset = this.ctx.createConstantSource();
      offset.offset.value = 0.5;

      this.lfo = this.ctx.createOscillator();
      this.lfo.type = "square";
      this.lfo.frequency.value = beatHz;

      const depth = this.ctx.createGain();
      depth.gain.value = 0.5;

      offset.connect(am.gain);
      this.lfo.connect(depth).connect(am.gain);
      carrier.connect(am).connect(this.toneGain);

      offset.start();
      this.lfo.start();
      carrier.start();
      this.bedNodes = [offset, this.lfo, carrier];
    }
  }

  glideBeat(toHz: number, durationSec: number, atTime?: number): void {
    const startTime = atTime ?? this.ctx.currentTime;
    const endTime = startTime + durationSec;
    this.currentBeatHz = toHz;

    if (this.mode === "binaural" && this.oscB) {
      this.oscB.frequency.cancelScheduledValues(startTime);
      this.oscB.frequency.setValueAtTime(this.oscB.frequency.value, startTime);
      this.oscB.frequency.linearRampToValueAtTime(this.carrierHz + toHz, endTime);
    } else if (this.lfo) {
      this.lfo.frequency.cancelScheduledValues(startTime);
      this.lfo.frequency.setValueAtTime(this.lfo.frequency.value, startTime);
      this.lfo.frequency.linearRampToValueAtTime(toHz, endTime);
    }
  }

  scheduleVoice(buffer: AudioBuffer, atCtxTime: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.voiceGain);
    src.start(atCtxTime);
    return src;
  }

  isBedActive(): boolean {
    return this.bedNodes.length > 0;
  }

  getGainLevels(): { master: number; tone: number; voice: number } {
    return {
      master: this.master.gain.value,
      tone: this.toneGain.gain.value,
      voice: this.voiceGain.gain.value,
    };
  }

  /** Debug: 440 Hz burst through master bus (not a separate context). */
  playTestTone(hz = 440, durationSec = 1): void {
    const osc = this.ctx.createOscillator();
    osc.frequency.value = hz;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.15;
    osc.connect(gain).connect(this.master);
    const now = this.ctx.currentTime;
    osc.start(now);
    osc.stop(now + durationSec);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopBed();
    void this.ctx.close();
  }

  private stopBed(): void {
    for (const node of this.bedNodes) {
      try {
        node.stop();
      } catch {
        // already stopped
      }
      node.disconnect();
    }
    this.bedNodes = [];
    this.oscB = null;
    this.lfo = null;
  }
}
