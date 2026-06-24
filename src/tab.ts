// =============================================================================
// tab.ts — Tablatura: modelo, parser ASCII, render com identificação de nota
//          e editor de grade interativo.
//
// - parseTab(): detecta blocos de tablatura em texto cru (cifras coladas/PDF),
//   lendo trastes por POSIÇÃO de caractere — tolerante a espaçamento irregular.
// - renderTabGrid(): desenha a grade (cordas × tempos) mostrando o NOME DA NOTA
//   sob cada traste, para o músico saber o que está executando.
// - TabEditor: grade clicável para criar/editar tabs, com modo texto cru
//   sincronizado (import/export) e ações (+ compasso, ± coluna, limpar).
//
// Convenção de exibição: a linha de cima é a corda mais aguda (e), a de baixo a
// mais grave (E) — como na tablatura tradicional.
// =============================================================================

import { NOTE_NAMES, noteAtFret } from "./chords";

// --- modelo ------------------------------------------------------------------

/** Uma coluna (tempo) da tab: um traste por corda, ou uma barra de compasso. */
export interface TabColumn {
  /** Traste por corda (índice 0 = corda de cima/aguda). null = corda não tocada. */
  frets: (number | null)[];
  /** true = barra de compasso (separador, sem notas). */
  bar?: boolean;
}

/** Um bloco de tablatura completo. */
export interface TabBlock {
  /** Classe de altura (0..11) de cada corda, de cima (aguda) p/ baixo (grave). */
  tuning: number[];
  /** Rótulo de cada corda (ex: "e", "B", "G", "D", "A", "E"). */
  labels: string[];
  columns: TabColumn[];
  /** Cabeçalho opcional, ex: "Parte 1 de 2". */
  title?: string;
}

// Mapa de nome de corda → classe de altura (para deduzir a afinação do texto).
const LABEL_PC: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

/** Afinação de exibição (aguda→grave) e rótulos a partir de pitches grave→aguda. */
export function displayTuning(pitchesLowToHigh: number[]): { tuning: number[]; labels: string[] } {
  const tuning = [...pitchesLowToHigh].reverse();
  return { tuning, labels: tuning.map((pc) => NOTE_NAMES[pc]!) };
}

/** Cria um bloco vazio com N compassos (cada um com `beats` colunas). */
export function emptyBlock(tuning: number[], labels: string[], measures = 1, beats = 8): TabBlock {
  const columns: TabColumn[] = [];
  for (let m = 0; m < measures; m++) {
    if (m > 0) columns.push({ frets: [], bar: true });
    for (let b = 0; b < beats; b++) columns.push({ frets: tuning.map(() => null) });
  }
  return { tuning, labels, columns };
}

// --- parser ------------------------------------------------------------------

/** Uma linha é de tablatura? (rótulo opcional + "|" + corpo de traços/dígitos). */
export function isTabLine(line: string): boolean {
  const m = line.match(/^\s*([A-Ga-g][#b]?)?\s*\|(.*)$/);
  if (!m) return false;
  const body = m[2]!;
  if (body.length < 2) return false;
  const tabChars = (body.match(/[-0-9|hpsbx/\\~()<>.* ]/gi) || []).length;
  return /[-|]/.test(body) && tabChars / body.length > 0.7;
}

/** Detecta o cabeçalho "Parte X de Y". */
export function partTitle(line: string): string | null {
  return /\bparte\s+\d+\s+de\s+\d+\b/i.test(line) ? line.trim() : null;
}

/** Converte um grupo de linhas de tab (já isoladas) num bloco. */
export function parseTabLines(group: string[], fallbackPitches?: number[]): TabBlock | null {
  if (group.length < 3) return null;
  const block = parseGroup(group, fallbackPitches);
  return block.columns.length ? block : null;
}

/**
 * Extrai todos os blocos de tablatura de um texto. `fallbackPitches` (grave→
 * aguda) define a afinação quando as cordas não têm rótulo reconhecível.
 */
export function parseTab(text: string, fallbackPitches?: number[]): TabBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: TabBlock[] = [];
  let pendingTitle: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const title = partTitle(lines[i]!);
    if (title) {
      pendingTitle = title;
      continue;
    }
    if (!isTabLine(lines[i]!)) continue;

    // Junta as linhas de tab consecutivas num grupo (3..6 cordas, em geral).
    const group: string[] = [];
    let j = i;
    while (j < lines.length && isTabLine(lines[j]!)) group.push(lines[j++]!);
    i = j - 1;
    if (group.length < 3) {
      pendingTitle = undefined;
      continue;
    }

    const block = parseGroup(group, fallbackPitches);
    if (block.columns.length) {
      if (pendingTitle) block.title = pendingTitle;
      blocks.push(block);
    }
    pendingTitle = undefined;
  }
  return blocks;
}

/** Converte um grupo de linhas de tab num bloco estruturado. */
function parseGroup(group: string[], fallbackPitches?: number[]): TabBlock {
  const fb = fallbackPitches ? [...fallbackPitches].reverse() : undefined; // aguda→grave
  const rows = group.map((line, idx) => {
    const m = line.match(/^\s*([A-Ga-g][#b]?)?\s*\|(.*)$/)!;
    const rawLabel = m[1] ?? "";
    const label = rawLabel ? rawLabel[0]!.toUpperCase() + rawLabel.slice(1) : "";
    let pc = label && LABEL_PC[label] !== undefined ? LABEL_PC[label] : undefined;
    if (pc === undefined && fb && fb[idx] !== undefined) pc = fb[idx];
    if (pc === undefined) pc = 0;
    return { label: rawLabel || NOTE_NAMES[pc]!, pc, body: m[2]!.replace(/\|+\s*$/, "") };
  });

  // Mapa: índice de caractere → coluna (notas simultâneas começam no mesmo índice).
  const colByIndex = new Map<number, TabColumn>();
  const barIndices = new Set<number>();

  rows.forEach((row, s) => {
    const body = row.body;
    for (let ci = 0; ci < body.length; ci++) {
      const ch = body[ci]!;
      if (ch === "|") {
        barIndices.add(ci);
        continue;
      }
      if (ch >= "0" && ch <= "9") {
        // Início de um número (não no meio de outro).
        if (ci > 0 && body[ci - 1]! >= "0" && body[ci - 1]! <= "9") continue;
        let num = "";
        let k = ci;
        while (k < body.length && body[k]! >= "0" && body[k]! <= "9") num += body[k++];
        let col = colByIndex.get(ci);
        if (!col) {
          col = { frets: rows.map(() => null) };
          colByIndex.set(ci, col);
        }
        col.frets[s] = Math.min(36, Number(num));
      }
    }
  });

  // Ordena colunas e barras pela posição no texto.
  const events: { idx: number; col: TabColumn }[] = [];
  for (const [idx, col] of colByIndex) events.push({ idx, col });
  for (const idx of barIndices) {
    if (!colByIndex.has(idx)) events.push({ idx, col: { frets: [], bar: true } });
  }
  events.sort((a, b) => a.idx - b.idx);

  return {
    tuning: rows.map((r) => r.pc),
    labels: rows.map((r) => r.label),
    columns: events.map((e) => e.col),
  };
}

/** Há tablatura detectável no texto? */
export function hasTab(text: string): boolean {
  return parseTab(text).length > 0;
}

// --- serialização ASCII ------------------------------------------------------

/** Gera a tablatura ASCII canônica (round-trip com parseTab). */
export function tabToText(block: TabBlock): string {
  const n = block.tuning.length;
  // Largura de cada coluna de nota = máximo de dígitos (mín. 1).
  const width = block.columns.map((col) =>
    col.bar ? 1 : Math.max(1, ...col.frets.map((f) => (f === null ? 1 : String(f).length))),
  );
  const lines: string[] = [];
  for (let s = 0; s < n; s++) {
    let line = `${block.labels[s] ?? NOTE_NAMES[block.tuning[s]!]}|`;
    block.columns.forEach((col, c) => {
      if (col.bar) {
        line += "|";
        return;
      }
      const f = col.frets[s];
      const cell = f === null ? "-".repeat(width[c]!) : String(f).padEnd(width[c]!, "-");
      line += "-" + cell;
    });
    line += "-|";
    lines.push(line);
  }
  return (block.title ? block.title + "\n" : "") + lines.join("\n");
}

/** Serializa vários blocos (separados por linha em branco). */
export function tabsToText(blocks: TabBlock[]): string {
  return blocks.map(tabToText).join("\n\n");
}

// --- render da grade (compartilhado: editor + cifra read-only) ---------------

interface GridOpts {
  readonly?: boolean;
  active?: { s: number; c: number } | null;
  /** Coluna destacada como "tocando agora" (read-only / playback). */
  nowCol?: number;
  onCell?: (s: number, c: number) => void;
}

/** Desenha a grade da tablatura com o nome da nota sob cada traste. */
export function renderTabGrid(block: TabBlock, opts: GridOpts = {}): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "tabgrid" + (opts.readonly ? " is-readonly" : "");

  if (block.title) {
    const t = document.createElement("div");
    t.className = "tabgrid__title";
    t.textContent = block.title;
    wrap.appendChild(t);
  }

  const scroll = document.createElement("div");
  scroll.className = "tabgrid__scroll";

  const grid = document.createElement("div");
  grid.className = "tabgrid__grid";
  // Trilhas: rótulo + uma por coluna (barras mais estreitas).
  const tracks = block.columns.map((col) => (col.bar ? "0.55rem" : "2.3rem")).join(" ");
  grid.style.gridTemplateColumns = `1.7rem ${tracks}`;

  for (let s = 0; s < block.tuning.length; s++) {
    // Rótulo da corda (nome da nota da corda solta).
    const lbl = document.createElement("span");
    lbl.className = "tabgrid__str";
    lbl.textContent = block.labels[s] ?? NOTE_NAMES[block.tuning[s]!]!;
    grid.appendChild(lbl);

    block.columns.forEach((col, c) => {
      if (col.bar) {
        const bar = document.createElement("span");
        bar.className = "tabgrid__bar";
        grid.appendChild(bar);
        return;
      }
      const cell = document.createElement(opts.readonly ? "span" : "button");
      cell.className = "tabgrid__cell";
      const fret = col.frets[s] ?? null;
      const isActive = opts.active && opts.active.s === s && opts.active.c === c;
      if (isActive) cell.classList.add("is-active");
      if (opts.nowCol === c) cell.classList.add("is-now");

      const num = document.createElement("span");
      num.className = "tabgrid__num";
      num.textContent = fret === null ? "·" : String(fret);
      cell.appendChild(num);

      if (fret !== null) {
        cell.classList.add("is-set");
        const note = document.createElement("span");
        note.className = "tabgrid__note";
        note.textContent = noteAtFret(block.tuning[s]!, fret);
        cell.appendChild(note);
      }

      if (!opts.readonly) {
        (cell as HTMLButtonElement).type = "button";
        cell.dataset.s = String(s);
        cell.dataset.c = String(c);
        cell.addEventListener("click", () => opts.onCell?.(s, c));
      }
      grid.appendChild(cell);
    });
  }

  scroll.appendChild(grid);
  wrap.appendChild(scroll);
  return wrap;
}

/** Atalho read-only para a cifra (com identificação de nota). */
export function renderTabView(block: TabBlock): HTMLElement {
  return renderTabGrid(block, { readonly: true });
}

// =============================================================================
// Editor de grade interativo
// =============================================================================

interface TabEditorDeps {
  /** Container onde a toolbar + grade são montadas. */
  container: HTMLElement;
  /** Textarea espelho (modo texto cru) — já existente no HTML. */
  textarea: HTMLTextAreaElement;
  /** Afinação atual (grave→aguda) do instrumento selecionado. */
  getPitches: () => number[];
}

export class TabEditor {
  private block: TabBlock;
  private active: { s: number; c: number } | null = null;
  private textMode = false;
  /** Buffer p/ dígitos multi-caractere na célula em edição. */
  private typing = "";
  private gridMount: HTMLElement;

  constructor(private readonly deps: TabEditorDeps) {
    const { tuning, labels } = displayTuning(deps.getPitches());
    this.block = emptyBlock(tuning, labels, 1, 8);

    // Toolbar.
    const bar = document.createElement("div");
    bar.className = "tabed__toolbar";
    bar.append(
      this.btn("＋ Coluna", () => this.addColumn()),
      this.btn("－ Coluna", () => this.removeColumn()),
      this.btn("｜ Compasso", () => this.insertMeasure()),
      this.btn("Limpar", () => this.clear()),
      this.btn("⌨ Modo texto", () => this.toggleTextMode(), "tabed__texttoggle"),
    );
    const hint = document.createElement("p");
    hint.className = "tabed__hint";
    hint.textContent = "Clique numa casa e digite o traste. ←→↑↓ navegam · Backspace limpa · cada casa mostra a nota.";

    this.gridMount = document.createElement("div");
    this.gridMount.className = "tabed__mount";
    this.gridMount.tabIndex = 0;

    deps.container.replaceChildren(bar, hint, this.gridMount);

    // Edição via teclado (delegada no mount).
    this.gridMount.addEventListener("keydown", (e) => this.onKey(e));

    // Modo texto: editar o texto cru re-parseia a grade.
    deps.textarea.hidden = true;
    deps.textarea.addEventListener("input", () => {
      if (this.textMode) this.fromText(deps.textarea.value, false);
    });

    this.render();
  }

  // --- API pública -----------------------------------------------------------

  /** Reconstrói a afinação/cordas ao trocar de instrumento. */
  setPitches(pitches: number[]): void {
    const { tuning, labels } = displayTuning(pitches);
    const n = tuning.length;
    // Preserva as colunas, redimensionando cada uma p/ o novo nº de cordas.
    this.block.columns = this.block.columns.map((col) =>
      col.bar ? col : { frets: Array.from({ length: n }, (_, s) => col.frets[s] ?? null) },
    );
    this.block.tuning = tuning;
    this.block.labels = labels;
    if (this.active && this.active.s >= n) this.active = null;
    this.render();
  }

  /** Insere um compasso em branco (barra + 8 colunas). */
  insertMeasure(): void {
    const n = this.block.tuning.length;
    this.block.columns.push({ frets: [], bar: true });
    for (let b = 0; b < 8; b++) this.block.columns.push({ frets: Array(n).fill(null) });
    this.render();
  }

  /** Carrega blocos detectados (ex: tab embutida numa cifra). */
  loadBlocks(blocks: TabBlock[]): void {
    if (!blocks.length) return;
    const first = blocks[0]!;
    const merged: TabBlock = {
      tuning: first.tuning,
      labels: first.labels,
      title: first.title,
      columns: [...first.columns],
    };
    // Anexa blocos seguintes com mesmo nº de cordas, separados por barra.
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i]!.tuning.length !== merged.tuning.length) continue;
      merged.columns.push({ frets: [], bar: true }, ...blocks[i]!.columns);
    }
    this.block = merged;
    this.active = null;
    this.render();
  }

  fromText(text: string, syncTextarea = true): void {
    const blocks = parseTab(text, [...this.block.tuning].reverse());
    if (blocks.length) {
      this.loadBlocks(blocks);
    } else {
      // Sem tab válida — mantém a grade atual.
      if (syncTextarea) this.render();
    }
    if (syncTextarea) this.deps.textarea.value = this.toText();
  }

  toText(): string {
    return tabToText(this.block);
  }

  // --- ações -----------------------------------------------------------------

  private addColumn(): void {
    this.block.columns.push({ frets: Array(this.block.tuning.length).fill(null) });
    this.render();
  }
  private removeColumn(): void {
    if (this.block.columns.length > 1) this.block.columns.pop();
    if (this.active && this.active.c >= this.block.columns.length) this.active = null;
    this.render();
  }
  private clear(): void {
    const { tuning, labels } = this.block;
    this.block = emptyBlock(tuning, labels, 1, 8);
    this.active = null;
    this.render();
  }
  private toggleTextMode(): void {
    this.textMode = !this.textMode;
    this.deps.textarea.hidden = !this.textMode;
    if (this.textMode) this.deps.textarea.value = this.toText();
  }

  // --- edição ----------------------------------------------------------------

  private selectCell(s: number, c: number): void {
    this.active = { s, c };
    this.typing = "";
    this.render();
    this.gridMount.focus();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.active) return;
    const { s, c } = this.active;
    const cols = this.block.columns;
    const noteCols = cols.map((col, i) => (col.bar ? -1 : i)).filter((i) => i >= 0);

    if (e.key >= "0" && e.key <= "9") {
      e.preventDefault();
      const col = cols[c];
      if (col && !col.bar) {
        const combined = this.typing + e.key;
        const val = Math.min(36, Number(combined));
        col.frets[s] = val;
        // Permite 2 dígitos seguidos (ex: "12") enquanto ainda em foco.
        this.typing = combined.length >= 2 || val >= 4 ? "" : combined;
        this.render();
      }
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete" || e.key === "-") {
      e.preventDefault();
      const col = cols[c];
      if (col && !col.bar) col.frets[s] = null;
      this.typing = "";
      this.render();
      return;
    }
    const move = (ds: number, dc: number) => {
      e.preventDefault();
      let ns = Math.max(0, Math.min(this.block.tuning.length - 1, s + ds));
      let nc = c;
      if (dc !== 0) {
        const pos = noteCols.indexOf(c);
        const npos = Math.max(0, Math.min(noteCols.length - 1, pos + dc));
        nc = noteCols[npos] ?? c;
      }
      this.active = { s: ns, c: nc };
      this.typing = "";
      this.render();
    };
    if (e.key === "ArrowUp") move(-1, 0);
    else if (e.key === "ArrowDown") move(1, 0);
    else if (e.key === "ArrowLeft") move(0, -1);
    else if (e.key === "ArrowRight") move(0, 1);
  }

  // --- render ----------------------------------------------------------------

  private render(): void {
    this.gridMount.replaceChildren(
      renderTabGrid(this.block, {
        active: this.active,
        onCell: (s, c) => this.selectCell(s, c),
      }),
    );
    // Mantém o espelho de texto em dia se estiver visível.
    if (this.textMode) this.deps.textarea.value = this.toText();
  }

  private btn(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tabed__btn" + (cls ? " " + cls : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }
}
