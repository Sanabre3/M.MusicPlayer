/**
 * Circular audio spectrum drawn around the vinyl. Reads live frequency
 * data each frame and radiates mirrored bars outward from a ring, with an
 * accent-colored glow. Returns the smoothed bass level (0..1) so the rest
 * of the UI can "breathe" with the low end.
 */
export class Visualizer {
  private readonly ctx: CanvasRenderingContext2D;
  private raf = 0;
  private accent = "#FF9E5E";
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private bass = 0;
  /** Called every frame with the smoothed bass level (0..1). */
  onBass?: (level: number) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getSpectrum: () => Uint8Array,
    private readonly isActive: () => boolean,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  setAccent(hex: string): void {
    this.accent = hex;
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
  }

  start(): void {
    if (this.raf) return;
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private draw(): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.3;
    const spectrum = this.getSpectrum();
    const active = this.isActive();

    // Use the lower ~70% of bins (musical range); ignore the highest, near-silent bins.
    const usable = Math.max(1, Math.floor(spectrum.length * 0.7));
    const bars = 96;
    const { accent } = this;

    // Smoothed bass from the first few bins.
    let lowSum = 0;
    for (let i = 0; i < 6; i++) lowSum += spectrum[i] ?? 0;
    const targetBass = active ? lowSum / 6 / 255 : 0;
    this.bass += (targetBass - this.bass) * 0.12;
    this.onBass?.(this.bass);

    ctx.save();
    ctx.translate(cx, cy);

    for (let i = 0; i < bars; i++) {
      const t = i / bars;
      const binIndex = Math.floor(t * usable);
      const raw = (spectrum[binIndex] ?? 0) / 255;
      // Idle shimmer so the ring is alive even when paused.
      const value = active ? raw : 0.04 + 0.02 * Math.sin(i * 0.5);
      const len = value * radius * 1.15;

      const angle = t * Math.PI * 2 - Math.PI / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const inner = radius + 6 * this.dpr;
      const outer = inner + len;

      ctx.beginPath();
      ctx.moveTo(cos * inner, sin * inner);
      ctx.lineTo(cos * outer, sin * outer);
      ctx.lineWidth = 2.4 * this.dpr;
      ctx.lineCap = "round";
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.35 + value * 0.65;
      ctx.shadowBlur = (6 + value * 16) * this.dpr;
      ctx.shadowColor = accent;
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}
