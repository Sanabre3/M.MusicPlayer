// =============================================================================
// equalizer.ts — Equalizador multibanda + efeitos de realce (estilo FxSound)
//
// Grafo de processamento (quando habilitado):
//
//   input → b0 → b1 → … → b9 → bassShelf → compressor → makeup ─┬─→ dry ───┐
//   (10 filtros peaking)        (lowshelf)  (dynamic)            │          ├→ output
//                                                                └→ conv → wet┘
//                                                                  (ambience)
//
// Quando desabilitado (bypass), `input` conecta direto em `output`, deixando
// toda a cadeia interna sem sinal de entrada (silenciosa).
//
// Tudo é construído sobre nós nativos da Web Audio API — sem dependências.
// Os efeitos espelham o FxSound: equalização gráfica, realce de graves,
// ambiência (reverb sintético) e boost dinâmico de volume.
// =============================================================================

import type { EqualizerSettings } from "./types";

/** Frequências centrais das 10 bandas (Hz) — padrão ISO de EQ gráfico. */
export const EQ_FREQUENCIES = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
] as const;

/** Rótulos curtos para exibição na interface (ex: "1k", "16k"). */
export const EQ_LABELS = [
  "31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k",
] as const;

/**
 * Presets de EQ (ganhos em dB por banda) inspirados no FxSound.
 * A ordem segue EQ_FREQUENCIES (graves → agudos).
 */
export const EQ_PRESETS: Record<string, number[]> = {
  Flat:        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Music:       [3, 2, 1, 0, -1, -1, 0, 2, 3, 3],
  "Bass Boost":[7, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  "Lo-Fi":     [2, 1, 0, 1, 1, 0, -3, -6, -9, -11],
  Vocal:       [-3, -2, 0, 2, 4, 4, 3, 1, 0, -1],
  Treble:      [0, 0, 0, 0, 0, 1, 2, 4, 6, 7],
  Podcast:     [-4, -3, -1, 2, 3, 3, 2, 1, -1, -3],
  Night:       [4, 3, 1, 0, 0, -1, -2, -3, -4, -5],
};

/** Retorna os ajustes padrão do equalizador (Flat, habilitado). */
export function defaultEqSettings(): EqualizerSettings {
  return {
    enabled: true,
    bands: [...EQ_PRESETS.Flat!],
    bassBoost: 0,
    ambience: 0,
    dynamic: false,
    preset: "Flat",
  };
}

export class Equalizer {
  /** Nó de entrada — a fonte de áudio conecta aqui. */
  readonly input: GainNode;
  /** Nó de saída — conecta no restante do grafo (gain → analyser). */
  readonly output: GainNode;

  private readonly bands: BiquadFilterNode[];
  private readonly bassShelf: BiquadFilterNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly makeup: GainNode;
  private readonly dry: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly wet: GainNode;

  private enabled = true;

  constructor(ctx: AudioContext, settings: EqualizerSettings) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // --- 10 filtros peaking em série -----------------------------------------
    this.bands = EQ_FREQUENCIES.map((freq) => {
      const f = ctx.createBiquadFilter();
      f.type = "peaking";
      f.frequency.value = freq;
      f.Q.value = 1.0;
      f.gain.value = 0;
      return f;
    });

    // --- realce de graves (lowshelf) -----------------------------------------
    this.bassShelf = ctx.createBiquadFilter();
    this.bassShelf.type = "lowshelf";
    this.bassShelf.frequency.value = 120;
    this.bassShelf.gain.value = 0;

    // --- boost dinâmico (compressor + makeup) --------------------------------
    this.compressor = ctx.createDynamicsCompressor();
    this.makeup = ctx.createGain();

    // --- ambiência (reverb sintético, mistura wet/dry) -----------------------
    this.dry = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulse(ctx, 2.2, 3.4);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.dry.gain.value = 1;

    // --- conexões internas (permanentes) -------------------------------------
    // Série dos filtros: b0 → b1 → … → b9.
    for (let i = 0; i < this.bands.length - 1; i++) {
      this.bands[i]!.connect(this.bands[i + 1]!);
    }
    const lastBand = this.bands[this.bands.length - 1]!;
    lastBand.connect(this.bassShelf);
    this.bassShelf.connect(this.compressor);
    this.compressor.connect(this.makeup);

    // Divisão dry/wet após o makeup.
    this.makeup.connect(this.dry);
    this.makeup.connect(this.convolver);
    this.convolver.connect(this.wet);
    this.dry.connect(this.output);
    this.wet.connect(this.output);

    this.apply(settings);
  }

  /** Aplica um conjunto completo de ajustes ao grafo de uma vez. */
  apply(s: EqualizerSettings): void {
    s.bands.forEach((db, i) => this.bands[i] && this.setBand(i, db));
    this.setBassBoost(s.bassBoost);
    this.setAmbience(s.ambience);
    this.setDynamic(s.dynamic);
    this.setEnabled(s.enabled);
  }

  /** Define o ganho (dB) de uma banda específica. */
  setBand(index: number, db: number): void {
    const band = this.bands[index];
    if (band) band.gain.value = clamp(db, -12, 12);
  }

  /** Define o realce de graves extra (0..12 dB). */
  setBassBoost(db: number): void {
    this.bassShelf.gain.value = clamp(db, 0, 12);
  }

  /** Define a mistura de ambiência (0..1). Mantém o sinal dry compensado. */
  setAmbience(amount: number): void {
    const a = clamp(amount, 0, 1);
    this.wet.gain.value = a * 0.9;
    this.dry.gain.value = 1 - a * 0.35; // mantém presença mesmo com muito wet
  }

  /**
   * Liga/desliga o boost dinâmico. Ligado: compressão + ganho de makeup que
   * aumenta a sensação de volume sem clipar. Desligado: compressor transparente.
   */
  setDynamic(on: boolean): void {
    const c = this.compressor;
    if (on) {
      c.threshold.value = -24;
      c.knee.value = 30;
      c.ratio.value = 4;
      c.attack.value = 0.003;
      c.release.value = 0.25;
      this.makeup.gain.value = 1.5;
    } else {
      // ratio 1 → sem compressão (transparente).
      c.threshold.value = 0;
      c.knee.value = 0;
      c.ratio.value = 1;
      c.attack.value = 0.003;
      c.release.value = 0.25;
      this.makeup.gain.value = 1;
    }
  }

  /** Habilita/desabilita todo o processamento (bypass por reconexão). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    // Remove todas as saídas atuais de `input` antes de re-rotear.
    this.input.disconnect();
    if (on) this.input.connect(this.bands[0]!);
    else this.input.connect(this.output);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }
}

// =============================================================================
// Funções auxiliares
// =============================================================================

/** Limita `v` ao intervalo [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Gera uma resposta ao impulso sintética (ruído com decaimento exponencial)
 * para o ConvolverNode — produz uma cauda de reverb suave sem carregar arquivos.
 */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}
