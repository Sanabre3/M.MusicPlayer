// =============================================================================
// frequency-identifier.ts — Identificação automática de nota, tom e nível
//
// A partir do espectro de alta resolução (FFT 8192) do AudioEngine, a cada
// ~60 ms calcula:
//
//   1. Vetor de croma (12 classes de altura) — energia por nota, somada entre
//      oitavas. Alimenta o anel reativo ao redor do vinil.
//   2. Nota dominante — pico do espectro mapeado para nome + oitava (ex: A4).
//   3. Tonalidade estimada — correlação do croma acumulado com os perfis de
//      Krumhansl-Schmuckler (maior/menor) em todas as 12 tônicas.
//   4. Nível — energia média mapeada para 0..1 (reatividade ao volume).
//
// Funciona apenas com áudio local (o AnalyserNode não enxerga o áudio
// cross-origin do YouTube/Spotify). Quando inativo, reporta nível zero.
// =============================================================================

import { QUALITY_INTERVALS, chordLabel } from "./chords";
import type { Chord, ChordQuality } from "./chords";

/** Nomes das 12 classes de altura, índice 0 = C (Dó). */
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** Qualidades testadas na detecção de acordes (das mais simples às complexas). */
const CHORD_QUALITIES: ChordQuality[] = ["maj", "min", "7", "m7", "maj7", "dim"];

// Perfis de Krumhansl-Schmuckler — "peso" relativo de cada grau na escala.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Leitura instantânea reportada à interface. */
export interface FreqReading {
  active: boolean;
  /** Nota dominante com oitava (ex: "A4") ou "—" quando em silêncio. */
  note: string;
  /** Frequência dominante em Hz. */
  freq: number;
  /** Tonalidade estimada (ex: "C menor") ou "—". */
  key: string;
  /** Tônica do tom estimado (0..11). */
  keyTonic: number;
  /** True se o tom estimado é maior; false se menor. */
  keyMajor: boolean;
  /** Confiança da estimativa de tom (0..1). */
  confidence: number;
  /** Acorde detectado no momento (ou null em silêncio/baixa confiança). */
  chord: Chord | null;
  /** Rótulo do acorde detectado (ex: "Am") ou "—". */
  chordLabel: string;
  /** Nível geral de energia/volume (0..1). */
  level: number;
  /** Energia normalizada por classe de altura (12 valores, 0..1). */
  chroma: number[];
}

export class FrequencyIdentifier {
  private raf = 0;
  private lastRun = 0;
  /** Croma acumulado com decaimento — estabiliza a estimativa de tonalidade. */
  private readonly keyAccum = new Array(12).fill(0);
  /** Croma com decaimento mais rápido — para a detecção de acorde (muda rápido). */
  private readonly chordAccum = new Array(12).fill(0);
  private lastReading: FreqReading = idleReading();

  /** Disparado a cada análise (~16×/s) com a leitura atual. */
  onUpdate?: (reading: FreqReading) => void;

  constructor(
    private readonly getData: () => Float32Array,
    private readonly getSampleRate: () => number,
    private readonly getFftSize: () => number,
    private readonly isActive: () => boolean,
  ) {}

  /** Inicia o loop de análise. Idempotente. */
  start(): void {
    if (this.raf) return;
    const loop = (t: number) => {
      // Limita a ~16 análises por segundo — FFT grande não precisa rodar a 60fps.
      if (t - this.lastRun >= 60) {
        this.lastRun = t;
        this.analyze();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Lê o espectro, calcula croma/nota/tom/nível e emite a leitura. */
  private analyze(): void {
    if (!this.isActive()) {
      // Decai o nível suavemente até zero; mantém o último tom como referência.
      if (this.lastReading.active || this.lastReading.level > 0.01) {
        this.lastReading = {
          ...this.lastReading,
          active: false,
          level: this.lastReading.level * 0.8,
          chroma: this.lastReading.chroma.map((c) => c * 0.8),
        };
        this.onUpdate?.(this.lastReading);
      }
      return;
    }

    const data = this.getData();
    const sr = this.getSampleRate();
    const binHz = sr / this.getFftSize();

    // Faixa musical útil: ~55 Hz (A1) a ~5 kHz.
    const minBin = Math.max(1, Math.floor(55 / binHz));
    const maxBin = Math.min(data.length - 1, Math.ceil(5000 / binHz));

    const chroma = new Array(12).fill(0);
    let peakAmp = 0;
    let peakFreq = 0;
    let dbSum = 0;
    let count = 0;

    for (let i = minBin; i <= maxBin; i++) {
      const db = data[i]!;
      if (!Number.isFinite(db) || db < -90) continue;
      const amp = Math.pow(10, db / 20); // dB → amplitude linear
      const freq = i * binHz;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += amp;
      dbSum += db;
      count++;
      if (amp > peakAmp) {
        peakAmp = amp;
        peakFreq = freq;
      }
    }

    // Nível: energia média em dB mapeada para 0..1 (−70 dB ≈ silêncio, −20 ≈ alto).
    const avgDb = count ? dbSum / count : -100;
    const level = clamp01((avgDb + 70) / 50);

    // Normaliza o croma do frame.
    const maxChroma = Math.max(...chroma, 1e-9);
    const chromaNorm = chroma.map((c) => c / maxChroma);

    // Acumula com decaimento: lento para o tom (estável), rápido para o acorde.
    for (let i = 0; i < 12; i++) {
      this.keyAccum[i] = this.keyAccum[i]! * 0.96 + chromaNorm[i]! * 0.04;
      this.chordAccum[i] = this.chordAccum[i]! * 0.6 + chromaNorm[i]! * 0.4;
    }

    const { key, tonic, major, confidence } = this.estimateKey();
    const note = peakFreq > 0 ? freqToNote(peakFreq) : "—";
    const chord = level > 0.15 ? detectChord(this.chordAccum) : null;

    this.lastReading = {
      active: true,
      note,
      freq: Math.round(peakFreq),
      key,
      keyTonic: tonic,
      keyMajor: major,
      confidence,
      chord,
      chordLabel: chord ? chordLabel(chord) : "—",
      level,
      chroma: chromaNorm,
    };
    this.onUpdate?.(this.lastReading);
  }

  /** Correlaciona o croma acumulado com os perfis maior/menor em 12 tônicas. */
  private estimateKey(): { key: string; tonic: number; major: boolean; confidence: number } {
    let best = { score: -Infinity, tonic: 0, major: true };
    for (let tonic = 0; tonic < 12; tonic++) {
      const major = correlate(this.keyAccum, MAJOR_PROFILE, tonic);
      const minor = correlate(this.keyAccum, MINOR_PROFILE, tonic);
      if (major > best.score) best = { score: major, tonic, major: true };
      if (minor > best.score) best = { score: minor, tonic, major: false };
    }
    const name = NOTE_NAMES[best.tonic]!;
    const key = `${name} ${best.major ? "maior" : "menor"}`;
    return { key, tonic: best.tonic, major: best.major, confidence: clamp01(best.score) };
  }
}

// =============================================================================
// Funções auxiliares
// =============================================================================

function idleReading(): FreqReading {
  return {
    active: false,
    note: "—",
    freq: 0,
    key: "—",
    keyTonic: 0,
    keyMajor: true,
    confidence: 0,
    chord: null,
    chordLabel: "—",
    level: 0,
    chroma: new Array(12).fill(0),
  };
}

/**
 * Identifica o acorde mais provável a partir do croma, testando as 12 tônicas
 * em cada qualidade. A pontuação favorece energia nas notas do acorde e
 * penaliza energia nas notas de fora.
 */
function detectChord(chroma: number[]): Chord | null {
  const total = chroma.reduce((a, b) => a + b, 0) || 1;
  let best: { score: number; root: number; quality: ChordQuality } | null = null;

  for (const quality of CHORD_QUALITIES) {
    const intervals = QUALITY_INTERVALS[quality];
    for (let root = 0; root < 12; root++) {
      const tones = intervals.map((iv) => (root + iv) % 12);
      let inside = 0;
      for (const t of tones) inside += chroma[t]!;
      const outside = total - inside;
      // Média dentro do acorde menos média fora, normalizada.
      const score = inside / tones.length - (outside / (12 - tones.length)) * 0.9;
      if (!best || score > best.score) best = { score, root, quality };
    }
  }
  // Exige uma separação mínima para não "inventar" acordes em ruído.
  if (!best || best.score < 0.04) return null;
  return { root: best.root, quality: best.quality };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Converte uma frequência (Hz) para nome de nota com oitava (ex: 440 → "A4"). */
function freqToNote(freq: number): string {
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pc]}${octave}`;
}

/**
 * Correlação de Pearson entre o croma e um perfil rotacionado para a tônica.
 * Quanto maior, mais o croma se parece com aquela escala.
 */
function correlate(chroma: number[], profile: number[], tonic: number): number {
  const rotated = profile.map((_, i) => profile[(i - tonic + 12) % 12]!);
  const meanC = mean(chroma);
  const meanP = mean(rotated);
  let num = 0;
  let dc = 0;
  let dp = 0;
  for (let i = 0; i < 12; i++) {
    const a = chroma[i]! - meanC;
    const b = rotated[i]! - meanP;
    num += a * b;
    dc += a * a;
    dp += b * b;
  }
  const den = Math.sqrt(dc * dp);
  return den === 0 ? 0 : num / den;
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
