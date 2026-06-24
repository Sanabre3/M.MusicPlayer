// =============================================================================
// onboarding.ts — Tela inicial de escolha de modo
//
// Ao abrir o site pela primeira vez, pergunta o que o usuário quer fazer:
//   - "Apenas escutar"  → o player imersivo.
//   - "Estudar — músico" → abre a aba Zone.
//
// A escolha é gravada em localStorage; nas próximas visitas a tela não reaparece
// (mas pode ser reaberta pelo botão "Modo" na topbar). O overlay é construído em
// JS para manter o index.html enxuto.
// =============================================================================

interface OnboardingDeps {
  /** Escolheu apenas ouvir. */
  onListen: () => void;
  /** Escolheu estudar (abre a Zone). */
  onStudy: () => void;
}

const STORAGE_KEY = "zone:onboarded";

export class Onboarding {
  private readonly root: HTMLElement;

  constructor(private readonly deps: OnboardingDeps) {
    this.root = document.createElement("div");
    this.root.className = "onboard";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", "Escolha o modo de uso");
    this.root.innerHTML = TEMPLATE;
    document.body.appendChild(this.root);
    this.wire();
  }

  /** Já passou pela escolha alguma vez? */
  get seen(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }

  /** Mostra apenas na primeira visita. */
  maybeShow(): void {
    if (!this.seen) this.show();
  }

  /** Abre o overlay (também usado pelo botão "Modo"). */
  show(): void {
    this.root.hidden = false;
    // Força reflow antes da classe para a transição de entrada disparar.
    void this.root.offsetWidth;
    this.root.classList.add("is-in");
    (this.root.querySelector<HTMLButtonElement>(".onboard-card"))?.focus();
  }

  private wire(): void {
    this.root.querySelectorAll<HTMLButtonElement>(".onboard-card").forEach((card) => {
      card.addEventListener("click", () => this.choose(card.dataset.mode === "study" ? "study" : "listen"));
    });
    this.root.querySelector<HTMLButtonElement>(".onboard__skip")?.addEventListener("click", () => this.choose("listen"));
    // Esc fecha como "apenas escutar".
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.choose("listen");
    });
  }

  private choose(mode: "listen" | "study"): void {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* localStorage indisponível — segue mesmo assim */
    }
    this.hide();
    if (mode === "study") this.deps.onStudy();
    else this.deps.onListen();
  }

  private hide(): void {
    this.root.classList.remove("is-in");
    const done = () => {
      this.root.hidden = true;
      this.root.removeEventListener("transitionend", done);
    };
    this.root.addEventListener("transitionend", done);
    // Fallback caso a transição não dispare.
    window.setTimeout(done, 400);
  }
}

const TEMPLATE = `
  <div class="onboard__bg" aria-hidden="true"></div>
  <div class="onboard__disc" aria-hidden="true">
    <span class="onboard__disc-grooves"></span>
    <span class="onboard__disc-core"></span>
  </div>
  <div class="onboard__panel">
    <div class="onboard__brand">
      <span class="onboard__dot"></span>Zone<span class="onboard__brand-thin">Player</span>
    </div>
    <h1 class="onboard__title">O que você quer fazer?</h1>
    <p class="onboard__sub">Escolha como vai usar o Zone Player agora — dá pra trocar quando quiser.</p>
    <div class="onboard__cards">
      <button class="onboard-card" type="button" data-mode="listen">
        <span class="onboard-card__glow" aria-hidden="true"></span>
        <span class="onboard-card__icon">🎧</span>
        <span class="onboard-card__h">Apenas escutar</span>
        <span class="onboard-card__d">Toca-discos imersivo, visualizador de espectro, equalizador estilo FxSound e temas lo-fi. Só relaxar e ouvir.</span>
        <span class="onboard-card__cta">Entrar no player →</span>
      </button>
      <button class="onboard-card onboard-card--study" type="button" data-mode="study">
        <span class="onboard-card__glow" aria-hidden="true"></span>
        <span class="onboard-card__icon">🎸</span>
        <span class="onboard-card__h">Estudar — músico</span>
        <span class="onboard-card__d">Acordes de vários instrumentos, tablatura interativa com identificação de nota, cifra, campo harmônico e metrônomo.</span>
        <span class="onboard-card__cta">Abrir a Zone →</span>
      </button>
    </div>
    <button class="onboard__skip" type="button">Decido depois — só abrir o player</button>
  </div>
`;
