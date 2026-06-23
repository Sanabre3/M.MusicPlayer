// =============================================================================
// audio-engine.ts — Motor de áudio real via Web Audio API
//
// Grafo de sinal:
//   <audio> → MediaElementSource → Equalizer → GainNode → AnalyserNode → destination
//
// O AudioContext é criado de forma lazy no primeiro gesto do usuário porque
// navegadores bloqueiam contextos iniciados sem interação humana (política
// de autoplay). A partir daí, o AnalyserNode fornece dados de frequência
// em tempo real para o visualizador sem custo adicional de processamento.
//
// O equalizador (estilo FxSound) é inserido entre a fonte e o ganho. Como o
// AudioContext é lazy, os ajustes do EQ são mantidos em estado próprio e
// aplicados ao grafo no momento em que ele é construído.
// =============================================================================

import type { EqualizerSettings, PlaybackSnapshot } from "./types";
import { Equalizer, defaultEqSettings } from "./equalizer";

/** Eventos que o motor emite para os ouvintes externos. */
type EngineEvent =
  | "play"
  | "pause"
  | "ended"
  | "timeupdate"
  | "loaded"
  | "error";

type Listener = (snapshot: PlaybackSnapshot) => void;

/** AudioContext com setSinkId (Audio Output Devices API — Chrome/Edge). */
interface AudioContextWithSink extends AudioContext {
  setSinkId?(sinkId: string): Promise<void>;
}

export class AudioEngine {
  readonly element: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private eq: Equalizer | null = null;
  /** Ajustes do EQ — fonte da verdade enquanto o grafo ainda não existe. */
  private eqSettings: EqualizerSettings = defaultEqSettings();
  /** ID do dispositivo de saída desejado ("" = padrão do sistema). */
  private sinkId = "";
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
    const eq = new Equalizer(ctx, this.eqSettings);
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();

    // fftSize 256 → 128 bins de frequência; equilíbrio entre resolução e performance.
    analyser.fftSize = 256;
    // smoothingTimeConstant suaviza variações bruscas entre frames do visualizador.
    analyser.smoothingTimeConstant = 0.82;

    // source → Equalizer → gain → analyser → destino
    source.connect(eq.input);
    eq.output.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);

    this.ctx = ctx;
    this.eq = eq;
    this.gain = gain;
    this.analyser = analyser;
    this.freqData = new Uint8Array(analyser.frequencyBinCount);

    // Aplica a saída de áudio escolhida assim que o contexto existe.
    if (this.sinkId) void this.applySink();
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

  // --- Equalizador (estilo FxSound) ------------------------------------------

  /** Ajustes atuais do EQ (cópia segura para a interface). */
  get equalizerSettings(): EqualizerSettings {
    return { ...this.eqSettings, bands: [...this.eqSettings.bands] };
  }

  /** Substitui o conjunto completo de ajustes e aplica ao grafo (se existir). */
  setEqualizer(settings: EqualizerSettings): void {
    this.eqSettings = { ...settings, bands: [...settings.bands] };
    this.eq?.apply(this.eqSettings);
  }

  /** Atualiza o ganho de uma banda específica (dB). */
  setEqBand(index: number, db: number): void {
    if (this.eqSettings.bands[index] === undefined) return;
    this.eqSettings.bands[index] = db;
    this.eqSettings.preset = "Custom";
    this.eq?.setBand(index, db);
  }

  setEqEnabled(on: boolean): void {
    this.eqSettings.enabled = on;
    this.eq?.setEnabled(on);
  }

  setBassBoost(db: number): void {
    this.eqSettings.bassBoost = db;
    this.eq?.setBassBoost(db);
  }

  setAmbience(amount: number): void {
    this.eqSettings.ambience = amount;
    this.eq?.setAmbience(amount);
  }

  setDynamic(on: boolean): void {
    this.eqSettings.dynamic = on;
    this.eq?.setDynamic(on);
  }

  // --- Saída de áudio (Audio Output Devices API) -----------------------------

  /** Indica se o navegador permite escolher o dispositivo de saída do grafo. */
  get supportsOutputSelection(): boolean {
    return "setSinkId" in AudioContext.prototype;
  }

  /** ID do dispositivo de saída atual ("" = padrão do sistema). */
  get outputDeviceId(): string {
    return this.sinkId;
  }

  /**
   * Roteia a reprodução local para um dispositivo de saída específico.
   * `deviceId` vazio volta para a saída padrão do sistema operacional.
   */
  async setOutputDevice(deviceId: string): Promise<void> {
    this.sinkId = deviceId;
    if (this.ctx) await this.applySink();
  }

  /** Aplica o sinkId atual ao AudioContext, se a API estiver disponível. */
  private async applySink(): Promise<void> {
    const ctx = this.ctx as AudioContextWithSink | null;
    if (!ctx?.setSinkId) return;
    try {
      await ctx.setSinkId(this.sinkId);
    } catch (err) {
      console.warn("Falha ao definir a saída de áudio:", err);
    }
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
