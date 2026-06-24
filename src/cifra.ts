// =============================================================================
// cifra.ts — Editor de letra + cifra (estilo CifraClub)
//
// - Cola/digita ou carrega a letra/cifra de um arquivo .txt ou .pdf.
// - Linhas reconhecidas como "linha de acordes" (a maioria dos tokens é acorde)
//   viram chips clicáveis; as demais viram linhas de letra com palavras
//   clicáveis.
// - Clique numa palavra para anotar um acorde acima dela (vários separados por
//   espaço — "mais de um acorde ao mesmo tempo"). Clique no chip para ver o
//   diagrama.
// - A transposição global reescreve todos os acordes exibidos.
//
// Os acordes são autorados no tom original (transpose 0) e exibidos transpostos.
// =============================================================================

import { chordLabel, parseChord, transposeChord } from "./chords";
import type { Chord } from "./chords";
import { isTabLine, parseTabLines, partTitle, renderTabView } from "./tab";
import type { TabBlock } from "./tab";

/** Um segmento da cifra renderizada: linha de acordes, letra, vazia, cabeçalho
 *  de parte ou um bloco de tablatura embutido. */
type Segment =
  | { kind: "chord"; tokens: string[] }
  | { kind: "lyric"; tokens: string[] }
  | { kind: "blank" }
  | { kind: "part"; text: string }
  | { kind: "tab"; block: TabBlock };

interface CifraDeps {
  /** Container onde a letra/cifra renderizada é exibida. */
  container: HTMLElement;
  /** Botão que dispara o seletor de arquivo. */
  fileBtn: HTMLButtonElement;
  /** Input de arquivo (.txt/.pdf) oculto. */
  fileInput: HTMLInputElement;
  /** Textarea para colar/digitar. */
  textarea: HTMLTextAreaElement;
  /** Disparado ao clicar num acorde (já transposto) — mostra o diagrama. */
  onChordClick: (chord: Chord) => void;
  /** Transposição global atual (semitons). */
  getTranspose: () => number;
  /** Afinação atual (grave→aguda) — para deduzir cordas das tabs embutidas. */
  getPitches?: () => number[];
  /** Disparado quando uma cifra carregada/colada contém tablatura. */
  onTabsDetected?: (blocks: TabBlock[]) => void;
}

export class CifraEditor {
  private segments: Segment[] = [];
  /** Acordes anotados manualmente: chave `segmento:palavra` → lista de acordes. */
  private readonly annotations = new Map<string, Chord[]>();

  constructor(private readonly deps: CifraDeps) {
    deps.textarea.addEventListener("input", () => this.setText(deps.textarea.value, false));
    deps.fileBtn.addEventListener("click", () => deps.fileInput.click());
    deps.fileInput.addEventListener("change", () => {
      const file = deps.fileInput.files?.[0];
      if (file) void this.loadFile(file);
      deps.fileInput.value = "";
    });
  }

  /** Reaplica a transposição (re-render) — chamado quando o tom muda. */
  refreshTranspose(): void {
    this.render();
  }

  /** Define o texto bruto (de colar ou de arquivo) e reclassifica os segmentos. */
  setText(raw: string, syncTextarea = true): void {
    if (syncTextarea) this.deps.textarea.value = raw;
    this.annotations.clear();

    const fallback = this.deps.getPitches?.() ?? [4, 9, 2, 7, 11, 4];
    const lines = raw.split(/\r?\n/);
    const segs: Segment[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Cabeçalho "Parte X de Y".
      const pt = partTitle(line);
      if (pt) {
        segs.push({ kind: "part", text: pt });
        continue;
      }

      // Bloco de tablatura: agrupa as linhas de tab consecutivas.
      if (isTabLine(line)) {
        const group: string[] = [];
        let j = i;
        while (j < lines.length && isTabLine(lines[j]!)) group.push(lines[j++]!);
        i = j - 1;
        const block = parseTabLines(group, fallback);
        if (block) {
          // Herda o último cabeçalho "Parte…" como título do bloco.
          const prev = segs[segs.length - 1];
          if (prev && prev.kind === "part") {
            block.title = prev.text;
            segs.pop();
          }
          segs.push({ kind: "tab", block });
          continue;
        }
        // Não era tab válida — trata como letra.
        segs.push({ kind: "lyric", tokens: group.join(" ").split(/\s+/).filter(Boolean) });
        continue;
      }

      const tokens = line.split(/\s+/).filter(Boolean);
      if (!tokens.length) {
        segs.push({ kind: "blank" });
        continue;
      }
      const chordCount = tokens.filter((t) => parseChord(t) !== null).length;
      // Linha de acordes: maioria dos tokens são acordes (e poucos tokens).
      const isChord = chordCount >= Math.ceil(tokens.length * 0.6) && tokens.length <= 16;
      segs.push({ kind: isChord ? "chord" : "lyric", tokens });
    }

    this.segments = segs;
    this.render();

    // Avisa a aba Zone se a cifra CARREGADA (não digitação) trouxe tablatura.
    if (syncTextarea) {
      const blocks = segs.filter((s): s is Segment & { kind: "tab" } => s.kind === "tab").map((s) => s.block);
      if (blocks.length) this.deps.onTabsDetected?.(blocks);
    }
  }

  // --- carregamento de arquivo ----------------------------------------------

  private async loadFile(file: File): Promise<void> {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith(".pdf")) {
        this.setText(await extractPdfText(file));
      } else {
        this.setText(await file.text());
      }
    } catch (err) {
      console.warn("Falha ao ler o arquivo:", err);
      this.deps.container.textContent = "Não foi possível ler o arquivo.";
    }
  }

  // --- render ----------------------------------------------------------------

  private render(): void {
    const t = this.deps.getTranspose();
    const frag = document.createDocumentFragment();

    this.segments.forEach((seg, si) => {
      if (seg.kind === "blank") {
        const br = document.createElement("div");
        br.className = "cf-blank";
        frag.appendChild(br);
        return;
      }
      if (seg.kind === "part") {
        const head = document.createElement("div");
        head.className = "cf-part";
        head.textContent = seg.text;
        frag.appendChild(head);
        return;
      }
      if (seg.kind === "tab") {
        // Tablatura embutida — renderizada com identificação de nota.
        const box = document.createElement("div");
        box.className = "cf-tab";
        box.appendChild(renderTabView(seg.block));
        frag.appendChild(box);
        return;
      }
      if (seg.kind === "chord") {
        const row = document.createElement("div");
        row.className = "cf-chordline";
        for (const tok of seg.tokens) {
          const chord = parseChord(tok);
          if (chord) row.appendChild(this.chordChip(transposeChord(chord, t)));
          else {
            const sp = document.createElement("span");
            sp.className = "cf-chordtext";
            sp.textContent = tok;
            row.appendChild(sp);
          }
        }
        frag.appendChild(row);
        return;
      }
      // Linha de letra: palavras clicáveis com slot de acorde acima.
      const row = document.createElement("div");
      row.className = "cf-lyricline";
      seg.tokens.forEach((word, wi) => {
        const key = `${si}:${wi}`;
        const wrap = document.createElement("span");
        wrap.className = "cf-word";

        const slot = document.createElement("span");
        slot.className = "cf-slot";
        const anns = this.annotations.get(key);
        if (anns) anns.forEach((ch) => slot.appendChild(this.chordChip(transposeChord(ch, t))));
        wrap.appendChild(slot);

        const text = document.createElement("span");
        text.className = "cf-text";
        text.textContent = word;
        text.title = "Clique para anotar acorde(s)";
        text.addEventListener("click", () => this.editAnnotation(key));
        wrap.appendChild(text);

        row.appendChild(wrap);
      });
      frag.appendChild(row);
    });

    this.deps.container.replaceChildren(frag);
  }

  /** Cria um chip de acorde clicável que mostra o diagrama. */
  private chordChip(chord: Chord): HTMLElement {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "cf-chip";
    chip.textContent = chordLabel(chord);
    chip.addEventListener("click", () => this.deps.onChordClick(chord));
    return chip;
  }

  /** Abre um prompt para anotar/editar os acordes de uma palavra. */
  private editAnnotation(key: string): void {
    const existing = this.annotations.get(key);
    const current = existing ? existing.map(chordLabel).join(" ") : "";
    const input = window.prompt(
      "Acorde(s) acima desta palavra (separe por espaço; vazio remove):\n" +
        "Digite no tom ORIGINAL — a transposição é aplicada na exibição.",
      current,
    );
    if (input === null) return; // cancelou
    const chords = input
      .split(/\s+/)
      .filter(Boolean)
      .map(parseChord)
      .filter((c): c is Chord => c !== null);
    if (chords.length) this.annotations.set(key, chords);
    else this.annotations.delete(key);
    this.render();
  }
}

// =============================================================================
// Extração de texto de PDF (pdfjs-dist)
// =============================================================================

/** Extrai o texto de um PDF página a página. */
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // O worker é resolvido pelo Vite como URL de asset.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Reconstrói linhas usando a posição vertical de cada item de texto.
    let lastY: number | null = null;
    let line = "";
    const out: string[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5] as number;
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        out.push(line.trimEnd());
        line = "";
      }
      line += item.str + (item.hasEOL ? "" : " ");
      lastY = y;
    }
    if (line.trim()) out.push(line.trimEnd());
    pages.push(out.join("\n"));
  }
  return pages.join("\n\n");
}
