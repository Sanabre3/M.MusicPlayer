import type { PlaybackSnapshot } from "./types";

type EngineEvent =
  | "play"
  | "pause"
  | "ended"
  | "timeupdate"
  | "loaded"
  | "error";

type Listener = (snapshot: PlaybackSnapshot) => void;

/**
 * Wraps an HTMLAudioElement in a Web Audio graph so we get both real
 * playback (with OS-level routing) and live frequency data for the visualizer:
 *
 *   <audio> -> MediaElementSource -> GainNode -> AnalyserNode -> destination
 *
 * The AudioContext is created lazily on the first user gesture, because
 * browsers suspend contexts that start without one.
 */
export class AudioEngine {
  readonly element: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private readonly listeners = new Map<EngineEvent, Set<Listener>>();
  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(0);

  constructor() {
    this.element = new Audio();
    this.element.crossOrigin = "anonymous";
    this.element.preload = "metadata";

    this.element.addEventListener("play", () => this.emit("play"));
    this.element.addEventListener("pause", () => this.emit("pause"));
    this.element.addEventListener("ended", () => this.emit("ended"));
    this.element.addEventListener("loadedmetadata", () => this.emit("loaded"));
    this.element.addEventListener("timeupdate", () => this.emit("timeupdate"));
    this.element.addEventListener("error", () => this.emit("error"));
  }

  /** Build the Web Audio graph once, lazily, inside a user gesture. */
  private ensureGraph(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(this.element);
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;

    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);

    this.ctx = ctx;
    this.gain = gain;
    this.analyser = analyser;
    this.freqData = new Uint8Array(analyser.frequencyBinCount);
  }

  load(src: string): void {
    this.element.src = src;
    this.element.load();
  }

  async play(): Promise<void> {
    this.ensureGraph();
    if (this.ctx?.state === "suspended") await this.ctx.resume();
    await this.element.play();
  }

  pause(): void {
    this.element.pause();
  }

  async toggle(): Promise<void> {
    if (this.element.paused) await this.play();
    else this.pause();
  }

  seek(seconds: number): void {
    if (Number.isFinite(this.element.duration)) {
      this.element.currentTime = Math.max(
        0,
        Math.min(seconds, this.element.duration),
      );
    }
  }

  /** Seek by a fraction (0..1) of the track. */
  seekFraction(fraction: number): void {
    if (Number.isFinite(this.element.duration)) {
      this.seek(fraction * this.element.duration);
    }
  }

  setVolume(value: number): void {
    const v = Math.max(0, Math.min(1, value));
    this.element.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }

  get volume(): number {
    return this.element.volume;
  }

  get playing(): boolean {
    return !this.element.paused && !this.element.ended;
  }

  /** Normalized frequency spectrum (0..1) for the current frame. */
  spectrum(): Uint8Array {
    if (this.analyser) this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  snapshot(): PlaybackSnapshot {
    return {
      position: this.element.currentTime || 0,
      duration: Number.isFinite(this.element.duration)
        ? this.element.duration
        : 0,
      playing: this.playing,
    };
  }

  on(event: EngineEvent, listener: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  private emit(event: EngineEvent): void {
    const snap = this.snapshot();
    this.listeners.get(event)?.forEach((l) => l(snap));
  }
}
