// =============================================================================
// zone.ts — Aba "Zone": modo para músicos
//
// Reúne, para a música tocando:
//   - Acorde atual (detectado do áudio local, ou selecionado da cifra manual).
//   - Diagramas por instrumento: violão (acorde), guitarra (power chord),
//     baixo (fundamental/5ª/8ª), teclado (teclas do acorde) e bateria (groove
//     em notação seguindo o metrônomo).
//   - Transposição de tom (afeta a cifra exibida e, no áudio local, o playback).
//   - Metrônomo com BPM manual, tap-tempo e detecção automática.
//   - Cifra manual: cole acordes e clique para ver o diagrama (transposto).
//
// O zone.ts cuida só da interface/render; o áudio (transpose, metrônomo) é
// injetado pelo main via callbacks/instâncias.
// =============================================================================

import {
  bassVoicing,
  chordLabel,
  chordTones,
  guitarVoicing,
  parseChord,
  powerChordVoicing,
  rootName,
  transposeChord,
  TUNINGS,
} from "./chords";
import type { Chord, Voicing } from "./chords";
import type { Metronome } from "./metronome";

type Instrument = "violao" | "guitarra" | "teclado" | "baixo" | "bateria";

interface ZoneDeps {
  metronome: Metronome;
  /** Aplica a transposição ao áudio local (semitons). */
  onTranspose: (semitones: number) => void;
  /** Retorna um BPM estimado do áudio local, ou null se indisponível. */
  getAutoBpm: () => number | null;
}

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export class Zone {
  private readonly el = {
    root: $("zone"),
    close: $<HTMLButtonElement>("zoneClose"),
    chord: $("zoneChord"),
    chordSrc: $("zoneChordSrc"),
    transDown: $<HTMLButtonElement>("zoneTransDown"),
    transUp: $<HTMLButtonElement>("zoneTransUp"),
    transVal: $("zoneTransVal"),
    diagram: $("zoneDiagram"),
    metroBpm: $<HTMLInputElement>("metroBpm"),
    metroDown: $<HTMLButtonElement>("metroDown"),
    metroUp: $<HTMLButtonElement>("metroUp"),
    metroBeats: $("metroBeats"),
    metroToggle: $<HTMLButtonElement>("metroToggle"),
    metroTap: $<HTMLButtonElement>("metroTap"),
    metroAuto: $<HTMLButtonElement>("metroAuto"),
    metroHint: $("metroHint"),
    cifraInput: $<HTMLTextAreaElement>("cifraInput"),
    cifraOut: $("cifraOut"),
  };

  private instrument: Instrument = "violao";
  private transpose = 0;
  private detected: Chord | null = null;
  private manual: { chord: Chord; raw: string }[] = [];
  private selectedManual: number | null = null;
  private beatDots: HTMLElement[] = [];
  private drumNowCol = -1;

  constructor(private readonly deps: ZoneDeps) {
    this.wire();
    this.buildBeatDots();
    this.render();
  }

  // --- ciclo de vida ---------------------------------------------------------

  get isOpen(): boolean {
    return !this.el.root.hidden;
  }
  open(): void {
    this.el.root.hidden = false;
    this.render();
  }
  close(): void {
    this.el.root.hidden = true;
  }
  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Recebe o acorde detectado do áudio (chamado pelo identificador de freq.). */
  setDetectedChord(chord: Chord | null): void {
    this.detected = chord;
    // Só re-renderiza se a fonte ativa for a detecção e a aba estiver visível.
    if (this.isOpen && this.selectedManual === null) this.render();
  }

  // --- wiring de eventos -----------------------------------------------------

  private wire(): void {
    this.el.close.addEventListener("click", () => this.close());

    // Tabs de instrumento.
    this.el.root.querySelectorAll<HTMLButtonElement>(".zone-inst").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.instrument = btn.dataset.inst as Instrument;
        this.el.root
          .querySelectorAll(".zone-inst")
          .forEach((b) => b.classList.toggle("is-active", b === btn));
        this.render();
      });
    });

    // Transpose.
    this.el.transDown.addEventListener("click", () => this.setTranspose(this.transpose - 1));
    this.el.transUp.addEventListener("click", () => this.setTranspose(this.transpose + 1));

    // Metrônomo.
    const m = this.deps.metronome;
    this.el.metroBpm.addEventListener("change", () => m.setBpm(Number(this.el.metroBpm.value)));
    this.el.metroDown.addEventListener("click", () => this.nudgeBpm(-1));
    this.el.metroUp.addEventListener("click", () => this.nudgeBpm(1));
    this.el.metroToggle.addEventListener("click", () => m.toggle());
    this.el.metroTap.addEventListener("click", () => {
      m.tap(performance.now());
      this.el.metroBpm.value = String(m.tempo);
    });
    this.el.metroAuto.addEventListener("click", () => this.autoBpm());

    m.onToggle = (running) => {
      this.el.metroToggle.textContent = running ? "⏸ Parar" : "▶ Iniciar";
      if (!running) this.clearBeatHighlight();
    };
    m.onBeat = (beat) => this.onBeat(beat);

    // Cifra manual.
    this.el.cifraInput.addEventListener("input", () => this.parseCifra());
  }

  private setTranspose(semitones: number): void {
    this.transpose = Math.max(-6, Math.min(6, semitones));
    this.el.transVal.textContent = this.transpose > 0 ? `+${this.transpose}` : String(this.transpose);
    this.deps.onTranspose(this.transpose); // afeta o áudio local
    this.renderCifra(); // rótulos transpostos
    this.render();
  }

  private nudgeBpm(delta: number): void {
    const m = this.deps.metronome;
    m.setBpm(m.tempo + delta);
    this.el.metroBpm.value = String(m.tempo);
  }

  private autoBpm(): void {
    const bpm = this.deps.getAutoBpm();
    if (bpm) {
      this.deps.metronome.setBpm(bpm);
      this.el.metroBpm.value = String(this.deps.metronome.tempo);
      this.el.metroHint.textContent = `Detectado: ${bpm} BPM (áudio local).`;
    } else {
      this.el.metroHint.textContent = "Sem sinal para detectar — toque uma faixa local por alguns segundos.";
    }
  }

  // --- acorde ativo ----------------------------------------------------------

  /** Acorde a exibir: o selecionado na cifra (transposto) ou o detectado. */
  private activeChord(): Chord | null {
    if (this.selectedManual !== null) {
      const item = this.manual[this.selectedManual];
      return item ? transposeChord(item.chord, this.transpose) : null;
    }
    return this.detected;
  }

  // --- render principal ------------------------------------------------------

  private render(): void {
    const chord = this.activeChord();
    this.el.chord.textContent = chord ? chordLabel(chord) : "—";
    this.el.chordSrc.textContent =
      this.selectedManual !== null
        ? "cifra manual"
        : this.detected
          ? "detectado · áudio local"
          : "aguardando áudio local…";
    this.renderDiagram(chord);
  }

  private renderDiagram(chord: Chord | null): void {
    const box = this.el.diagram;
    if (this.instrument === "bateria") {
      box.replaceChildren(this.renderDrums());
      return;
    }
    if (!chord) {
      const empty = document.createElement("p");
      empty.className = "zone-diagram__empty";
      empty.textContent =
        "Toque uma faixa local para detectar o acorde, ou cole uma cifra e clique em um acorde.";
      box.replaceChildren(empty);
      return;
    }
    switch (this.instrument) {
      case "violao":
        box.replaceChildren(this.renderFretboard(guitarVoicing(chord), TUNINGS.guitar));
        break;
      case "guitarra":
        box.replaceChildren(this.renderFretboard(powerChordVoicing(chord), TUNINGS.guitar));
        break;
      case "baixo":
        box.replaceChildren(this.renderFretboard(bassVoicing(chord), TUNINGS.bass));
        break;
      case "teclado":
        box.replaceChildren(this.renderPiano(chord));
        break;
    }
  }

  // --- diagrama de braço (violão / guitarra / baixo) -------------------------

  private renderFretboard(voicing: Voicing, tuning: number[]): HTMLElement {
    const FRETS = 5;
    const fretted = voicing.frets.filter((f): f is number => f !== null && f > 0);
    const maxF = fretted.length ? Math.max(...fretted) : 0;
    const minF = fretted.length ? Math.min(...fretted) : 0;
    // Acordes na região aberta começam em 1 (casa 0 vira marcador de corda solta).
    const start = maxF <= FRETS ? 1 : minF;

    const wrap = document.createElement("div");
    wrap.className = "fretboard";
    wrap.style.setProperty("--frets", String(FRETS));

    // Renderiza da corda mais grave (índice 0) para a mais aguda (embaixo).
    for (let s = 0; s < tuning.length; s++) {
      const fret = voicing.frets[s] ?? null;
      const row = document.createElement("div");
      row.className = "fb-row";

      const name = document.createElement("span");
      name.className = "fb-string";
      name.textContent = NOTE_NAMES[tuning[s]! % 12]!;
      row.appendChild(name);

      const mark = document.createElement("span");
      mark.className = "fb-mark";
      mark.textContent = fret === null ? "✕" : fret === 0 ? "○" : "";
      row.appendChild(mark);

      for (let c = 0; c < FRETS; c++) {
        const cell = document.createElement("span");
        cell.className = "fb-cell";
        if (fret !== null && fret > 0 && fret === start + c) {
          const dot = document.createElement("span");
          dot.className = "fb-dot" + (voicing.isRoot[s] ? " is-root" : "");
          cell.appendChild(dot);
        }
        row.appendChild(cell);
      }
      wrap.appendChild(row);
    }

    // Numeração de casas embaixo.
    const nums = document.createElement("div");
    nums.className = "fb-fretnums";
    nums.style.setProperty("--frets", String(FRETS));
    nums.appendChild(spacer());
    nums.appendChild(spacer());
    for (let c = 0; c < FRETS; c++) {
      const n = document.createElement("span");
      n.className = "fb-fretnum";
      n.textContent = String(start + c);
      nums.appendChild(n);
    }
    wrap.appendChild(nums);
    return wrap;
  }

  // --- teclado ---------------------------------------------------------------

  private renderPiano(chord: Chord): HTMLElement {
    const tones = new Set(chordTones(chord));
    const piano = document.createElement("div");
    piano.className = "piano";

    const whitePc = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
    const OCTAVES = 2;

    // Teclas brancas.
    for (let o = 0; o < OCTAVES; o++) {
      for (const pc of whitePc) {
        const key = document.createElement("div");
        key.className = "pk-white";
        if (tones.has(pc)) key.classList.add("is-lit");
        if (pc === chord.root) key.classList.add("is-root");
        piano.appendChild(key);
      }
    }

    // Teclas pretas posicionadas sobre os limites das brancas.
    const blacks = [
      { pc: 1, boundary: 1 },  // C#
      { pc: 3, boundary: 2 },  // D#
      { pc: 6, boundary: 4 },  // F#
      { pc: 8, boundary: 5 },  // G#
      { pc: 10, boundary: 6 }, // A#
    ];
    const unit = 100 / (whitePc.length * OCTAVES);
    for (let o = 0; o < OCTAVES; o++) {
      for (const b of blacks) {
        const key = document.createElement("div");
        key.className = "pk-black";
        if (tones.has(b.pc)) key.classList.add("is-lit");
        if (b.pc === chord.root) key.classList.add("is-root");
        key.style.left = `${(o * whitePc.length + b.boundary) * unit}%`;
        piano.appendChild(key);
      }
    }
    return piano;
  }

  // --- bateria ---------------------------------------------------------------

  private renderDrums(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "drums";
    // Groove básico de rock em 4/4 (8 colunas = colcheias).
    const rows: { label: string; hits: number[] }[] = [
      { label: "Hi-hat", hits: [0, 1, 2, 3, 4, 5, 6, 7] },
      { label: "Caixa", hits: [2, 6] },
      { label: "Bumbo", hits: [0, 4] },
    ];
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "dr-row";
      const label = document.createElement("span");
      label.className = "dr-label";
      label.textContent = r.label;
      row.appendChild(label);
      const cells = document.createElement("div");
      cells.className = "dr-cells";
      for (let c = 0; c < 8; c++) {
        const cell = document.createElement("span");
        cell.className = "dr-cell" + (r.hits.includes(c) ? " is-hit" : "");
        cell.dataset.col = String(c);
        if (c === this.drumNowCol) cell.classList.add("is-now");
        cells.appendChild(cell);
      }
      row.appendChild(cells);
      wrap.appendChild(row);
    }
    const hint = document.createElement("p");
    hint.className = "drums__hint";
    hint.textContent = "Groove padrão em 4/4 — acompanha o metrônomo. (Não é a transcrição da faixa.)";
    wrap.appendChild(hint);
    return wrap;
  }

  // --- metrônomo: batidas ----------------------------------------------------

  private buildBeatDots(): void {
    this.beatDots = [];
    this.el.metroBeats.replaceChildren(
      ...Array.from({ length: 4 }, (_, i) => {
        const dot = document.createElement("span");
        dot.className = "metro-beat" + (i === 0 ? " is-downbeat" : "");
        this.beatDots.push(dot);
        return dot;
      }),
    );
  }

  private onBeat(beat: number): void {
    this.beatDots.forEach((d, i) => d.classList.toggle("is-now", i === beat));
    // Atualiza a coluna "agora" da bateria (colcheia = beat * 2).
    this.drumNowCol = beat * 2;
    if (this.isOpen && this.instrument === "bateria") {
      this.el.diagram
        .querySelectorAll<HTMLElement>(".dr-cell")
        .forEach((c) => c.classList.toggle("is-now", Number(c.dataset.col) === this.drumNowCol));
    }
  }

  private clearBeatHighlight(): void {
    this.beatDots.forEach((d) => d.classList.remove("is-now"));
    this.drumNowCol = -1;
    this.el.diagram.querySelectorAll(".dr-cell.is-now").forEach((c) => c.classList.remove("is-now"));
  }

  // --- cifra manual ----------------------------------------------------------

  private parseCifra(): void {
    const raw = this.el.cifraInput.value;
    const tokens = raw.split(/\s+/).filter(Boolean);
    this.manual = [];
    for (const tok of tokens) {
      const chord = parseChord(tok);
      if (chord) this.manual.push({ chord, raw: tok });
    }
    this.selectedManual = this.manual.length ? 0 : null;
    this.renderCifra();
    this.render();
  }

  private renderCifra(): void {
    this.el.cifraOut.replaceChildren(
      ...this.manual.map((item, i) => {
        const transposed = transposeChord(item.chord, this.transpose);
        const span = document.createElement("button");
        span.type = "button";
        span.className = "cifra-chord" + (i === this.selectedManual ? " is-active" : "");
        span.textContent = chordLabel(transposed);
        span.addEventListener("click", () => {
          this.selectedManual = i;
          this.renderCifra();
          this.render();
        });
        return span;
      }),
    );
  }

  /** Nome do tom atual considerando o transpose (utilidade para a interface). */
  currentKeyName(): string {
    return rootName(this.transpose);
  }
}

/** Célula vazia usada para alinhar a numeração de casas com as colunas. */
function spacer(): HTMLElement {
  return document.createElement("span");
}
