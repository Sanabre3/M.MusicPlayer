// =============================================================================
// audio-engine.ts — Motor de áudio real via Web Audio API
//
// Grafo de sinal:
//   <audio> → MediaElementSource → GainNode → AnalyserNode → destination
//
// O AudioContext é criado de forma lazy no primeiro gesto do usuário porque
// navegadores bloqueiam contextos iniciados sem interação humana (política
// de autoplay). A partir daí, o AnalyserNode fornece dados de frequência
// em tempo real para o visualizador sem custo adicional de processamento.
// =============================================================================

import type { PlaybackSnapshot } from "./types";

/** Eventos que o motor emite para os ouvintes externos. */
type EngineEvent =
  | "play"
  | "pause"
  | "ended"
  | "timeupdate"
  | "loaded"
  | "error";

type Listener = (snapshot: PlaybackSnapshot) => void;

export class AudioEngine {
  readonly element: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private readonly listeners = new Map<EngineEvent, Set<Listener>>();
  /** Buffer reutilizável para leitura do espectro de frequências. */
  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(0);

  constructor() {
    this.element = new Audio();
    // crossOrigin necessário para o AnalyserNode ler dados de URLs externas (ex: Blob URLs).
    this.element.crossOrigin = "anonymous";
    this.element.preload = "metadata";

    // Repassa os eventos nativos do <audio> para o sistema interno de listeners.
    this.element.addEventListener("play", () => this.emit("play"));
    this.element.addEventListener("pause", () => this.emit("pause"));
    this.element.addEventListener("ended", () => this.emit("ended"));
    this.element.addEventListener("loadedmetadata", () => this.emit("loaded"));
    this.element.addEventListener("timeupdate", () => this.emit("timeupdate"));
    this.element.addEventListener("error", () => this.emit("error"));
  }

  /** Constrói o grafo Web Audio uma única vez, dentro de um gesto do usuário. */
  private ensureGraph(): void {
    if (this.ctx) return; // já inicializado

    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(this.element);
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();

    // fftSize 256 → 128 bins de frequência; equilíbrio entre resolução e performance.
    analyser.fftSize = 256;
    // smoothingTimeConstant suaviza variações bruscas entre frames do visualizador.
    analyser.smoothingTimeConstant = 0.82;

    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);

    this.ctx = ctx;
    this.gain = gain;
    this.analyser = analyser;
    this.freqData = new Uint8Array(analyser.frequencyBinCount);
  }

  /** Carrega uma nova URL de áudio no elemento. */
  load(src: string): void {
    this.element.src = src;
    this.element.load();
  }

  /** Inicia a reprodução. Retoma o contexto se estiver suspenso. */
  async play(): Promise<void> {
    this.ensureGraph();
    if (this.ctx?.state === "suspended") await this.ctx.resume();
    await this.element.play();
  }

  pause(): void {
    this.element.pause();
  }

  /** Alterna entre play e pause. */
  async toggle(): Promise<void> {
    if (this.element.paused) await this.play();
    else this.pause();
  }

  /** Posiciona o cursor em `seconds` segundos (clamped ao intervalo válido). */
  seek(seconds: number): void {
    if (Number.isFinite(this.element.duration)) {
      this.element.currentTime = Math.max(
        0,
        Math.min(seconds, this.element.duration),
      );
    }
  }

  /** Posiciona pelo fraction (0..1) da duração total — usado pelo scrubber. */
  seekFraction(fraction: number): void {
    if (Number.isFinite(this.element.duration)) {
      this.seek(fraction * this.element.duration);
    }
  }

  /** Define o volume (0..1) no elemento e no nó de ganho do grafo. */
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

  /**
   * Lê o espectro de frequências atual do AnalyserNode.
   * Retorna o buffer interno (reutilizado por frame) — não guarde referências.
   */
  spectrum(): Uint8Array {
    if (this.analyser) this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  /** Retorna uma fotografia instantânea do estado atual de reprodução. */
  snapshot(): PlaybackSnapshot {
    return {
      position: this.element.currentTime || 0,
      duration: Number.isFinite(this.element.duration)
        ? this.element.duration
        : 0,
      playing: this.playing,
    };
  }

  /** Registra um ouvinte para um evento do motor. */
  on(event: EngineEvent, listener: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  /** Dispara todos os ouvintes de um evento com o snapshot atual. */
  private emit(event: EngineEvent): void {
    const snap = this.snapshot();
    this.listeners.get(event)?.forEach((l) => l(snap));
  }
}
