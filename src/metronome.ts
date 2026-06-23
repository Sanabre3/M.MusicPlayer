// =============================================================================
// metronome.ts — Metrônomo (Web Audio) + estimador de andamento (BPM)
//
// O metrônomo usa o padrão de "lookahead scheduler": um timer JS acorda a cada
// 25 ms e agenda os cliques que cairão nos próximos 100 ms diretamente no
// relógio de amostragem do AudioContext — garantindo tempo preciso, imune a
// jitter do setInterval.
//
// O TempoEstimator detecta o BPM do áudio local por autocorrelação do fluxo de
// energia (onsets). É aproximado — tap-tempo e BPM manual continuam disponíveis.
// =============================================================================

export class Metronome {
  private ctx: AudioContext | null = null;
  private bpm = 100;
  private beatsPerBar = 4;
  private nextNoteTime = 0;
  private currentBeat = 0;
  private timer = 0;
  private running = false;
  private readonly taps: number[] = [];

  /** Disparado a cada batida (0 = tempo forte). Para sincronizar a UI. */
  onBeat?: (beat: number) => void;
  /** Disparado quando liga/desliga. */
  onToggle?: (running: boolean) => void;

  get isRunning(): boolean {
    return this.running;
  }
  get tempo(): number {
    return this.bpm;
  }

  setBpm(bpm: number): void {
    this.bpm = Math.max(30, Math.min(300, Math.round(bpm)));
  }

  setBeatsPerBar(n: number): void {
    this.beatsPerBar = Math.max(1, Math.min(12, n));
  }

  toggle(): void {
    if (this.running) this.stop();
    else void this.start();
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.running = true;
    this.currentBeat = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.06;
    this.timer = window.setInterval(() => this.scheduler(), 25);
    this.onToggle?.(true);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    this.timer = 0;
    this.onToggle?.(false);
  }

  /** Registra um toque de tap-tempo e atualiza o BPM pela média dos intervalos. */
  tap(now: number): void {
    // Descarta toques muito espaçados (reinicia a contagem).
    if (this.taps.length && now - this.taps[this.taps.length - 1]! > 2000) {
      this.taps.length = 0;
    }
    this.taps.push(now);
    if (this.taps.length > 5) this.taps.shift();
    if (this.taps.length >= 2) {
      let sum = 0;
      for (let i = 1; i < this.taps.length; i++) sum += this.taps[i]! - this.taps[i - 1]!;
      const avgMs = sum / (this.taps.length - 1);
      if (avgMs > 0) this.setBpm(60000 / avgMs);
    }
  }

  /** Loop do scheduler: agenda os cliques dos próximos 100 ms. */
  private scheduler(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const secondsPerBeat = 60 / this.bpm;
    while (this.nextNoteTime < ctx.currentTime + 0.1) {
      this.scheduleClick(this.nextNoteTime, this.currentBeat);
      this.nextNoteTime += secondsPerBeat;
      this.currentBeat = (this.currentBeat + 1) % this.beatsPerBar;
    }
  }

  /** Agenda um clique no tempo `time` (relógio do AudioContext). */
  private scheduleClick(time: number, beat: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // Tempo forte mais agudo que os fracos.
    osc.frequency.value = beat === 0 ? 1500 : 1000;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.6, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
    // Dispara o callback visual o mais próximo possível da batida real.
    const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
    window.setTimeout(() => this.onBeat?.(beat), delayMs);
  }
}

// =============================================================================
// Estimador de andamento (BPM) por autocorrelação do fluxo de energia
// =============================================================================

export class TempoEstimator {
  /** Amostras de energia (alimentadas ~60×/s). */
  private readonly buf: number[] = [];
  private prev = 0;
  /** Tamanho da janela em amostras (~6 s a 60 fps). */
  private readonly size = 360;
  /** Taxa de amostragem assumida (Hz) — alimentação por requestAnimationFrame. */
  private readonly fps = 60;

  /** Alimenta uma amostra de energia (0..1) — ex: o nível de graves. */
  push(energy: number): void {
    // Fluxo de onset = aumento de energia em relação ao frame anterior.
    const flux = Math.max(0, energy - this.prev);
    this.prev = energy;
    this.buf.push(flux);
    if (this.buf.length > this.size) this.buf.shift();
  }

  /**
   * Estima o BPM no intervalo 60..180 por autocorrelação. Retorna null quando
   * não há sinal suficiente ou nenhum pico claro.
   */
  estimate(): number | null {
    if (this.buf.length < this.size) return null;
    const minLag = Math.floor((this.fps * 60) / 180); // 180 BPM
    const maxLag = Math.ceil((this.fps * 60) / 60); // 60 BPM
    let bestLag = 0;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = lag; i < this.buf.length; i++) corr += this.buf[i]! * this.buf[i - lag]!;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
    if (!bestLag || bestCorr <= 0) return null;
    return Math.round((this.fps * 60) / bestLag);
  }
}
