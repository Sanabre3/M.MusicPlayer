// =============================================================================
// visualizer.ts — Espectro circular de frequências desenhado em canvas
//
// A cada frame do requestAnimationFrame:
//   1. Lê os dados de frequência do AudioEngine (128 bins, 0–255).
//   2. Usa os 70% inferiores (faixa musical) e os distribui em 96 barras.
//   3. Desenha cada barra radialmente a partir de um anel ao redor do vinil.
//   4. Calcula o nível de graves suavizado (--bass) para o "respiro" do fundo.
//
// Quando pausado, mantém um shimmer suave para o anel nunca ficar morto.
// =============================================================================

export class Visualizer {
  private readonly ctx: CanvasRenderingContext2D;
  private raf = 0;                                     // ID do requestAnimationFrame ativo
  private accent = "#FF9E5E";                          // cor das barras — atualizada por faixa
  private dpr = Math.min(window.devicePixelRatio || 1, 2); // densidade de pixels (max 2×)
  private bass = 0;                                    // nível de graves suavizado (0..1)

  /** Callback disparado a cada frame com o nível de graves atual (0..1). */
  onBass?: (level: number) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** Função que retorna o espectro de frequências atual do AudioEngine. */
    private readonly getSpectrum: () => Uint8Array,
    /** Função que indica se o áudio está sendo reproduzido no momento. */
    private readonly isActive: () => boolean,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D não disponível neste navegador.");
    this.ctx = ctx;
    this.resize();
    // Ajusta o tamanho do canvas ao redimensionar a janela.
    window.addEventListener("resize", () => this.resize());
  }

  /** Atualiza a cor de destaque das barras ao trocar de faixa. */
  setAccent(hex: string): void {
    this.accent = hex;
  }

  /** Ajusta a resolução física do canvas ao DPR atual para evitar blur. */
  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
  }

  /** Inicia o loop de animação. Idempotente — não duplica frames. */
  start(): void {
    if (this.raf) return;
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Para o loop de animação e libera o handle do RAF. */
  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Desenha um frame do espectro circular. Chamado ~60× por segundo. */
  private draw(): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    // Raio do anel — fração da menor dimensão do canvas. Mantido baixo o
    // suficiente para que as barras (até ~2× o raio) caibam dentro do canvas
    // sem serem cortadas pela borda do campo.
    const radius = Math.min(w, h) * 0.21;
    const spectrum = this.getSpectrum();
    const active = this.isActive();

    // Apenas os 70% inferiores dos bins são musicalmente relevantes.
    const usable = Math.max(1, Math.floor(spectrum.length * 0.7));
    const bars = 96; // número de barras distribuídas ao redor do anel
    const { accent } = this;

    // Calcula nível de graves: média dos 6 primeiros bins (frequências baixas).
    let lowSum = 0;
    for (let i = 0; i < 6; i++) lowSum += spectrum[i] ?? 0;
    const targetBass = active ? lowSum / 6 / 255 : 0;
    // Suavização exponencial para evitar saltos bruscos entre frames.
    this.bass += (targetBass - this.bass) * 0.12;
    this.onBass?.(this.bass);

    ctx.save();
    ctx.translate(cx, cy); // centraliza o sistema de coordenadas

    for (let i = 0; i < bars; i++) {
      const t = i / bars;
      const binIndex = Math.floor(t * usable);
      const raw = (spectrum[binIndex] ?? 0) / 255; // normaliza para 0..1

      // Quando pausado, shimmer suave para o anel não ficar completamente flat.
      const value = active ? raw : 0.04 + 0.02 * Math.sin(i * 0.5);
      const len = value * radius * 1.05; // comprimento radial da barra

      // Ângulo da barra — começa no topo (−π/2) e gira no sentido horário.
      const angle = t * Math.PI * 2 - Math.PI / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const inner = radius + 6 * this.dpr;  // borda interna (logo após o vinil)
      const outer = inner + len;             // borda externa (amplitude da barra)

      ctx.beginPath();
      ctx.moveTo(cos * inner, sin * inner);
      ctx.lineTo(cos * outer, sin * outer);
      ctx.lineWidth = 2.4 * this.dpr;
      ctx.lineCap = "round";
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.35 + value * 0.65;            // barras mais altas = mais opacas
      ctx.shadowBlur = (6 + value * 16) * this.dpr;     // brilho proporcional à amplitude
      ctx.shadowColor = accent;
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}
