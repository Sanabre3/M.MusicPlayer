// =============================================================================
// zone.ts — Aba "Zone": modo para músicos
//
//   - Acorde atual: detectado do áudio local, fixado de um clique (campo
//     harmônico / cifra) ou retomando o áudio.
//   - Diagramas por instrumento com VÁRIAS posições (voicings) navegáveis.
//   - Campo harmônico do tom (segue o áudio ou escolhido manualmente).
//   - Metrônomo (manual / tap / automático).
//   - Transposição que afeta a cifra exibida e o áudio local.
//   - Editor de letra & cifra (em cifra.ts) com upload .txt/.pdf.
// =============================================================================

import {
  NOTE_NAMES,
  bassVoicings,
  chordLabel,
  chordTones,
  chordVoicings,
  degreeLabel,
  guitarVoicings,
  harmonicField,
  powerChordVoicings,
  transposeChord,
  TUNINGS,
  TUNING_PRESETS,
} from "./chords";
import type { Chord, Voicing } from "./chords";
import type { Metronome } from "./metronome";
import { CifraEditor } from "./cifra";
import { TabEditor } from "./tab";
import type { TabBlock } from "./tab";

type Instrument = "violao" | "guitarra" | "teclado" | "baixo" | "bateria" | "ukulele" | "cavaquinho";

/** Instrumentos de braço (têm diagrama de trastes). */
const FRETTED = new Set<Instrument>(["violao", "guitarra", "baixo", "ukulele", "cavaquinho"]);

interface ZoneDeps {
  metronome: Metronome;
  onTranspose: (semitones: number) => void;
  getAutoBpm: () => number | null;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Zone {
  private readonly el = {
    root: $("zone"),
    close: $<HTMLButtonElement>("zoneClose"),
    chord: $("zoneChord"),
    chordSrc: $("zoneChordSrc"),
    auto: $<HTMLButtonElement>("zoneAuto"),
    transDown: $<HTMLButtonElement>("zoneTransDown"),
    transUp: $<HTMLButtonElement>("zoneTransUp"),
    transVal: $("zoneTransVal"),
    diagram: $("zoneDiagram"),
    labelNota: $<HTMLButtonElement>("labelNota"),
    labelGrau: $<HTMLButtonElement>("labelGrau"),
    voicingNav: $("voicingNav"),
    voicingPrev: $<HTMLButtonElement>("voicingPrev"),
    voicingNext: $<HTMLButtonElement>("voicingNext"),
    voicingSelect: $<HTMLSelectElement>("voicingSelect"),
    voicingCount: $("voicingCount"),
    zoneSetup: $("zoneSetup"),
    zoneTuningField: $("zoneTuningField"),
    zoneCapoField: $("zoneCapoField"),
    zoneTuning: $<HTMLSelectElement>("zoneTuning"),
    zoneCapo: $<HTMLSelectElement>("zoneCapo"),
    tabEditor: $("tabEditor"),
    tabInput: $<HTMLTextAreaElement>("tabInput"),
    tabTemplate: $<HTMLButtonElement>("tabTemplate"),
    tabStatus: $("tabStatus"),
    dlCifra: $<HTMLButtonElement>("dlCifra"),
    dlTab: $<HTMLButtonElement>("dlTab"),
    dlBoth: $<HTMLButtonElement>("dlBoth"),
    shareDoc: $<HTMLButtonElement>("shareDoc"),
    hfFollow: $<HTMLInputElement>("hfFollow"),
    hfTonic: $<HTMLSelectElement>("hfTonic"),
    hfMode: $<HTMLSelectElement>("hfMode"),
    hfChords: $("hfChords"),
    metroBpm: $<HTMLInputElement>("metroBpm"),
    metroDown: $<HTMLButtonElement>("metroDown"),
    metroUp: $<HTMLButtonElement>("metroUp"),
    metroBeats: $("metroBeats"),
    metroToggle: $<HTMLButtonElement>("metroToggle"),
    metroTap: $<HTMLButtonElement>("metroTap"),
    metroAuto: $<HTMLButtonElement>("metroAuto"),
    metroHint: $("metroHint"),
  };

  private instrument: Instrument = "violao";
  private transpose = 0;
  private capo = 0;
  private tuning: number[] = TUNING_PRESETS[0]!.pitches;
  private voicingIndex = 0;
  private detected: Chord | null = null;
  private detectedTonic = 0;
  private detectedMajor = true;
  /** Rótulo dos diagramas: nome da nota ou grau (relativo ao campo harmônico). */
  private labelMode: "nota" | "grau" = "nota";
  /** Tônica atual do campo harmônico — usada para calcular os graus. */
  private hfTonicPc = 0;
  /** Tom da cifra (tom original) e se o campo harmônico está "seguindo a cifra". */
  private cifraKeyTonic: number | null = null;
  private cifraKeyMajor = true;
  private hfFromCifra = false;
  private pinned: Chord | null = null;
  private voicings: Voicing[] = [];
  private beatDots: HTMLElement[] = [];
  private drumNowCol = -1;
  private readonly cifra: CifraEditor;
  private readonly tab: TabEditor;

  constructor(private readonly deps: ZoneDeps) {
    this.cifra = new CifraEditor({
      container: $("cifraOut"),
      fileBtn: $<HTMLButtonElement>("cifraFileBtn"),
      fileInput: $<HTMLInputElement>("cifraFile"),
      textarea: $<HTMLTextAreaElement>("cifraInput"),
      onChordClick: (chord) => this.pinChord(chord),
      getTranspose: () => this.transpose,
      getPitches: () => this.frettedPitches(),
      onTabsDetected: (blocks) => this.loadDetectedTab(blocks),
      onKeyDetected: (tonic, major) => this.onCifraKey(tonic, major),
    });
    this.tab = new TabEditor({
      container: this.el.tabEditor,
      textarea: this.el.tabInput,
      getPitches: () => this.frettedPitches(),
    });
    this.buildBeatDots();
    this.buildHarmonicPicker();
    this.buildTuningCapoPickers();
    this.wire();
    this.applyInstrumentSetup();
    this.render();
    this.renderHarmonic();
  }

  /** Popula os seletores de afinação e capotraste. */
  private buildTuningCapoPickers(): void {
    this.el.zoneTuning.replaceChildren(
      ...TUNING_PRESETS.map((t) => {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.name;
        return opt;
      }),
    );
    this.el.zoneCapo.replaceChildren(
      ...Array.from({ length: 12 }, (_, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = i === 0 ? "Sem capotraste" : `Casa ${i}`;
        return opt;
      }),
    );
  }

  // --- ciclo de vida ---------------------------------------------------------

  get isOpen(): boolean {
    return !this.el.root.hidden;
  }
  open(): void {
    this.el.root.hidden = false;
    this.render();
    this.renderHarmonic();
  }
  close(): void {
    this.el.root.hidden = true;
  }
  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Acorde detectado do áudio (chamado pelo identificador de frequência). */
  setDetectedChord(chord: Chord | null): void {
    this.detected = chord;
    if (this.isOpen && this.pinned === null) this.render();
  }

  /** Tom detectado do áudio — alimenta o campo harmônico em modo "seguir". */
  setDetectedKey(tonic: number, major: boolean): void {
    this.detectedTonic = tonic;
    this.detectedMajor = major;
    if (this.isOpen && this.el.hfFollow.checked) this.renderHarmonic();
  }

  // --- wiring ----------------------------------------------------------------

  private wire(): void {
    this.el.close.addEventListener("click", () => this.close());
    this.el.auto.addEventListener("click", () => this.resumeAuto());

    this.el.root.querySelectorAll<HTMLButtonElement>(".zone-inst").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.instrument = btn.dataset.inst as Instrument;
        this.el.root.querySelectorAll(".zone-inst").forEach((b) => b.classList.toggle("is-active", b === btn));
        this.voicingIndex = 0;
        this.applyInstrumentSetup();
        this.render();
      });
    });

    this.el.transDown.addEventListener("click", () => this.setTranspose(this.transpose - 1));
    this.el.transUp.addEventListener("click", () => this.setTranspose(this.transpose + 1));

    // Afinação, capotraste e seletor de posição.
    this.el.zoneTuning.addEventListener("change", () => {
      const preset = TUNING_PRESETS.find((t) => t.id === this.el.zoneTuning.value);
      this.tuning = preset ? preset.pitches : TUNING_PRESETS[0]!.pitches;
      this.voicingIndex = 0;
      if (FRETTED.has(this.instrument)) this.tab.setPitches(this.frettedPitches());
      this.render();
    });
    this.el.zoneCapo.addEventListener("change", () => {
      this.capo = Number(this.el.zoneCapo.value);
      this.voicingIndex = 0;
      this.render();
    });
    this.el.voicingSelect.addEventListener("change", () => {
      this.voicingIndex = Number(this.el.voicingSelect.value);
      this.renderDiagram(this.activeChord());
    });
    // Setas para percorrer as posições (voicings) do acorde.
    this.el.voicingPrev.addEventListener("click", () => this.stepVoicing(-1));
    this.el.voicingNext.addEventListener("click", () => this.stepVoicing(1));

    // Tablatura: inserir um compasso em branco na grade.
    this.el.tabTemplate.addEventListener("click", () => this.tab.insertMeasure());

    // Exportar / compartilhar.
    this.el.dlCifra.addEventListener("click", () => this.download("cifra"));
    this.el.dlTab.addEventListener("click", () => this.download("tab"));
    this.el.dlBoth.addEventListener("click", () => this.download("both"));
    this.el.shareDoc.addEventListener("click", () => void this.share());

    // Campo harmônico.
    this.el.hfFollow.addEventListener("change", () => {
      const follow = this.el.hfFollow.checked;
      this.el.hfTonic.disabled = follow;
      this.el.hfMode.disabled = follow;
      this.hfFromCifra = false; // o usuário assumiu o controle do campo harmônico
      this.renderHarmonic();
    });
    this.el.hfTonic.addEventListener("change", () => {
      this.hfFromCifra = false;
      this.renderHarmonic();
    });
    this.el.hfMode.addEventListener("change", () => {
      this.hfFromCifra = false;
      this.renderHarmonic();
    });

    // Alternância do rótulo dos diagramas: nome da nota × grau.
    this.el.labelNota.addEventListener("click", () => this.setLabelMode("nota"));
    this.el.labelGrau.addEventListener("click", () => this.setLabelMode("grau"));

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
  }

  // --- acorde ativo / fixar --------------------------------------------------

  private activeChord(): Chord | null {
    return this.pinned ?? this.detected;
  }

  /** Fixa um acorde (de um clique) e mostra o botão de voltar ao áudio. */
  private pinChord(chord: Chord): void {
    this.pinned = chord;
    this.el.auto.hidden = false;
    if (!this.isOpen) this.open();
    else this.render();
  }

  private resumeAuto(): void {
    this.pinned = null;
    this.el.auto.hidden = true;
    this.render();
  }

  private setTranspose(semitones: number): void {
    this.transpose = Math.max(-6, Math.min(6, semitones));
    this.el.transVal.textContent = this.transpose > 0 ? `+${this.transpose}` : String(this.transpose);
    this.deps.onTranspose(this.transpose);
    this.cifra.refreshTranspose();
    // Mantém o campo harmônico (e portanto os graus) acompanhando a cifra.
    if (this.hfFromCifra) this.applyCifraKeyToHarmonic();
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
      this.el.metroHint.textContent = "Sem sinal — toque uma faixa local por alguns segundos.";
    }
  }

  // --- render do diagrama ----------------------------------------------------

  private render(): void {
    const chord = this.activeChord();
    this.el.chord.textContent = chord ? chordLabel(chord) : "—";
    this.el.chordSrc.textContent =
      this.pinned !== null
        ? "fixado (clique)"
        : this.detected
          ? "detectado · áudio local"
          : "aguardando áudio local…";
    this.el.auto.hidden = this.pinned === null;

    this.voicings = chord ? this.computeVoicings(chord) : [];
    this.renderDiagram(chord);
  }

  /** Com capotraste, a forma fingida é o acorde N semitons abaixo. */
  private effectiveChord(chord: Chord): Chord {
    return this.capo > 0 ? transposeChord(chord, -this.capo) : chord;
  }

  private computeVoicings(chord: Chord): Voicing[] {
    const c = this.effectiveChord(chord);
    switch (this.instrument) {
      case "violao":
        return guitarVoicings(c, this.tuning); // todos os modelos na afinação
      case "guitarra":
        // Acordes completos + power chords (deixou de ser só power chord).
        return [...guitarVoicings(c, this.tuning), ...powerChordVoicings(c, this.tuning)];
      case "baixo":
        return bassVoicings(c, TUNINGS.bass);
      case "ukulele":
        return chordVoicings(c, TUNINGS.ukulele, { requireBass: false });
      case "cavaquinho":
        return chordVoicings(c, TUNINGS.cavaquinho, { requireBass: false });
      default:
        return [];
    }
  }

  /** Afinação (grave→aguda) do instrumento atual; violão p/ não-trasteados. */
  private frettedPitches(): number[] {
    switch (this.instrument) {
      case "baixo":
        return TUNINGS.bass;
      case "ukulele":
        return TUNINGS.ukulele;
      case "cavaquinho":
        return TUNINGS.cavaquinho;
      default:
        return this.tuning; // violão, guitarra (e fallback p/ teclado/bateria)
    }
  }

  /** Afinação usada nos diagramas de braço do instrumento atual. */
  private diagramTuning(): number[] {
    return this.frettedPitches();
  }

  /** Mostra/oculta afinação e capotraste conforme o instrumento. */
  private applyInstrumentSetup(): void {
    // Afinação personalizável só p/ instrumentos de 6 cordas (violão/guitarra).
    const tuningOn = this.instrument === "violao" || this.instrument === "guitarra";
    // Capotraste p/ todos os instrumentos de braço.
    const capoOn = FRETTED.has(this.instrument);
    this.el.zoneTuningField.hidden = !tuningOn;
    this.el.zoneCapoField.hidden = !capoOn;
    this.el.zoneSetup.hidden = !tuningOn && !capoOn;
    if (FRETTED.has(this.instrument)) this.tab.setPitches(this.frettedPitches());
  }

  /** Percorre as posições (voicings) com as setas, em ciclo. */
  private stepVoicing(delta: number): void {
    if (!this.voicings.length) return;
    this.voicingIndex = (this.voicingIndex + delta + this.voicings.length) % this.voicings.length;
    this.el.voicingSelect.value = String(this.voicingIndex);
    this.showVoicing();
  }

  /** Carrega no editor de grade a tablatura detectada numa cifra. */
  private loadDetectedTab(blocks: TabBlock[]): void {
    this.tab.loadBlocks(blocks);
    this.el.tabStatus.textContent = `✓ Tablatura detectada na cifra (${blocks.length === 1 ? "1 bloco" : `${blocks.length} blocos`}) e carregada no editor.`;
  }

  /** Recebe o tom estimado da cifra (tom original) e ajusta o campo harmônico. */
  private onCifraKey(tonic: number, major: boolean): void {
    this.cifraKeyTonic = tonic;
    this.cifraKeyMajor = major;
    this.hfFromCifra = true;
    this.applyCifraKeyToHarmonic();
  }

  /** Aponta o campo harmônico para o tom da cifra (já somando a transposição). */
  private applyCifraKeyToHarmonic(): void {
    if (this.cifraKeyTonic === null) return;
    const tonic = (((this.cifraKeyTonic + this.transpose) % 12) + 12) % 12;
    this.el.hfFollow.checked = false;
    this.el.hfTonic.disabled = false;
    this.el.hfMode.disabled = false;
    this.el.hfTonic.value = String(tonic);
    this.el.hfMode.value = this.cifraKeyMajor ? "maj" : "min";
    this.renderHarmonic();
  }

  /** Alterna o rótulo dos diagramas entre nome da nota e grau. */
  private setLabelMode(mode: "nota" | "grau"): void {
    this.labelMode = mode;
    this.el.labelNota.classList.toggle("is-active", mode === "nota");
    this.el.labelGrau.classList.toggle("is-active", mode === "grau");
    this.renderDiagram(this.activeChord());
  }

  /** Rótulo de uma classe de altura conforme o modo (nota × grau). */
  private noteOrDegree(pc: number): string {
    return this.labelMode === "grau"
      ? degreeLabel(pc, this.hfTonicPc)
      : NOTE_NAMES[((pc % 12) + 12) % 12]!;
  }

  private renderDiagram(chord: Chord | null): void {
    const box = this.el.diagram;
    this.el.voicingNav.hidden = true;
    if (this.instrument === "bateria") {
      box.replaceChildren(this.renderDrums());
      return;
    }
    if (!chord) {
      const empty = document.createElement("p");
      empty.className = "zone-diagram__empty";
      empty.textContent = "Toque uma faixa local, clique num acorde do campo harmônico ou cole uma cifra.";
      box.replaceChildren(empty);
      return;
    }
    if (this.instrument === "teclado") {
      box.replaceChildren(this.renderPiano(chord));
      return;
    }
    // Instrumentos de braço: um modelo por vez, escolhido no seletor/setas.
    if (!this.voicings.length) {
      const empty = document.createElement("p");
      empty.className = "zone-diagram__empty";
      empty.textContent = "Sem posição encontrada para este acorde nesta afinação.";
      box.replaceChildren(empty);
      return;
    }
    if (this.voicingIndex >= this.voicings.length) this.voicingIndex = 0;
    // Popula o seletor "Pos. 1 … N".
    this.el.voicingSelect.replaceChildren(
      ...this.voicings.map((_, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = `Pos. ${i + 1}`;
        return opt;
      }),
    );
    this.el.voicingSelect.value = String(this.voicingIndex);
    this.el.voicingCount.textContent = `de ${this.voicings.length}`;
    this.el.voicingNav.hidden = false;
    this.showVoicing();
  }

  /** Renderiza apenas o diagrama do voicing atualmente selecionado. */
  private showVoicing(): void {
    if (this.voicingIndex >= this.voicings.length) this.voicingIndex = 0;
    const voicing = this.voicings[this.voicingIndex];
    if (!voicing) return;
    this.el.voicingSelect.value = String(this.voicingIndex);
    this.el.diagram.replaceChildren(this.renderFretboard(voicing, this.diagramTuning(), this.capo));
  }

  // --- diagrama de braço -----------------------------------------------------

  private renderFretboard(voicing: Voicing, tuning: number[], capo = 0): HTMLElement {
    const FRETS = 5;
    const fretted = voicing.frets.filter((f): f is number => f !== null && f > 0);
    const maxF = fretted.length ? Math.max(...fretted) : 0;
    const minF = fretted.length ? Math.min(...fretted) : 0;
    const start = maxF <= FRETS ? 1 : minF;

    const wrap = document.createElement("div");
    wrap.className = "fretboard";
    wrap.style.setProperty("--frets", String(FRETS));

    if (capo > 0) {
      const badge = document.createElement("div");
      badge.className = "fb-capo";
      badge.textContent = `🔒 Capotraste na casa ${capo} — a forma abaixo é fingida a partir do capo`;
      wrap.appendChild(badge);
    }

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
          dot.textContent = this.noteOrDegree((tuning[s]! + fret) % 12);
          cell.appendChild(dot);
        }
        row.appendChild(cell);
      }
      wrap.appendChild(row);
    }

    const nums = document.createElement("div");
    nums.className = "fb-fretnums";
    nums.style.setProperty("--frets", String(FRETS));
    nums.appendChild(document.createElement("span"));
    nums.appendChild(document.createElement("span"));
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
    const whitePc = [0, 2, 4, 5, 7, 9, 11];
    const OCTAVES = 2;

    for (let o = 0; o < OCTAVES; o++) {
      for (const pc of whitePc) {
        const key = document.createElement("div");
        key.className = "pk-white";
        if (tones.has(pc)) {
          key.classList.add("is-lit");
          key.appendChild(this.pianoLabel(pc));
        }
        if (pc === chord.root) key.classList.add("is-root");
        piano.appendChild(key);
      }
    }
    const blacks = [
      { pc: 1, boundary: 1 },
      { pc: 3, boundary: 2 },
      { pc: 6, boundary: 4 },
      { pc: 8, boundary: 5 },
      { pc: 10, boundary: 6 },
    ];
    const unit = 100 / (whitePc.length * OCTAVES);
    for (let o = 0; o < OCTAVES; o++) {
      for (const b of blacks) {
        const key = document.createElement("div");
        key.className = "pk-black";
        if (tones.has(b.pc)) {
          key.classList.add("is-lit");
          key.appendChild(this.pianoLabel(b.pc));
        }
        if (b.pc === chord.root) key.classList.add("is-root");
        key.style.left = `${(o * whitePc.length + b.boundary) * unit}%`;
        piano.appendChild(key);
      }
    }
    return piano;
  }

  /** Rótulo (nota/grau) posicionado na base de uma tecla do piano. */
  private pianoLabel(pc: number): HTMLElement {
    const lab = document.createElement("span");
    lab.className = "pk-label";
    lab.textContent = this.noteOrDegree(pc);
    return lab;
  }

  // --- bateria ---------------------------------------------------------------

  private renderDrums(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "drums";
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

  // --- campo harmônico -------------------------------------------------------

  private buildHarmonicPicker(): void {
    this.el.hfTonic.replaceChildren(
      ...NOTE_NAMES.map((name, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = name;
        return opt;
      }),
    );
    this.el.hfTonic.disabled = true; // começa em "seguir áudio"
    this.el.hfMode.disabled = true;
  }

  private renderHarmonic(): void {
    const follow = this.el.hfFollow.checked;
    const tonic = follow ? this.detectedTonic : Number(this.el.hfTonic.value);
    const major = follow ? this.detectedMajor : this.el.hfMode.value === "maj";
    if (follow) {
      this.el.hfTonic.value = String(tonic);
      this.el.hfMode.value = major ? "maj" : "min";
    }
    // Guarda a tônica para o cálculo dos graus nos diagramas.
    this.hfTonicPc = tonic;
    // Se os diagramas mostram graus, atualiza-os ao mudar o tom.
    if (this.labelMode === "grau" && this.isOpen) this.renderDiagram(this.activeChord());
    const field = harmonicField(tonic, major);
    this.el.hfChords.replaceChildren(
      ...field.map(({ chord, degree }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "hf-chord";
        btn.innerHTML = `<span class="hf-chord__deg">${degree}</span><span class="hf-chord__name">${chordLabel(chord)}</span>`;
        btn.addEventListener("click", () => this.pinChord(chord));
        return btn;
      }),
    );
  }

  // --- exportar / compartilhar -----------------------------------------------

  /** Texto atual da cifra (conteúdo do editor de letra & cifra). */
  private cifraText(): string {
    return ($("cifraInput") as HTMLTextAreaElement).value.trim();
  }
  /** Tablatura atual — serializada da grade interativa. */
  private tabText(): string {
    return this.tab.toText().trim();
  }

  /** Monta o documento a exportar conforme o tipo. */
  private buildDoc(kind: "cifra" | "tab" | "both"): { name: string; text: string } {
    const cifra = this.cifraText();
    const tab = this.tabText();
    if (kind === "cifra") return { name: "cifra.txt", text: cifra || "(cifra vazia)" };
    if (kind === "tab") return { name: "tablatura.txt", text: tab || "(tablatura vazia)" };
    const parts: string[] = [];
    if (cifra) parts.push("=== CIFRA ===\n" + cifra);
    if (tab) parts.push("=== TABLATURA ===\n" + tab);
    return { name: "cifra-e-tab.txt", text: parts.join("\n\n") || "(vazio)" };
  }

  /** Baixa o documento como arquivo .txt. */
  private download(kind: "cifra" | "tab" | "both"): void {
    const { name, text } = this.buildDoc(kind);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Compartilha (Web Share API) com fallback para download. */
  private async share(): Promise<void> {
    const { name, text } = this.buildDoc("both");
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    try {
      const file = new File([text], name, { type: "text/plain" });
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: "Cifra & Tablatura" });
        return;
      }
      if (nav.share) {
        await nav.share({ title: "Cifra & Tablatura", text });
        return;
      }
    } catch {
      // cancelado ou indisponível — cai no download.
    }
    this.download("both");
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
}
