// =============================================================================
// chords.ts — Teoria musical: acordes, transposição, voicings e campo harmônico
//
// - Representação de acorde (tônica + qualidade + baixo opcional p/ "E/G#").
// - Parser robusto de rótulos: tríades, 7ªs, sus, add, 6/9, dim7, m7b5, aug,
//   com baixo invertido ("/G#").
// - Gerador de voicings de violão/baixo por busca no braço (várias posições).
// - Campo harmônico (acordes diatônicos) de qualquer tom maior/menor.
//
// Sem dependências — apenas aritmética de classes de altura (mod 12).
// =============================================================================

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** Qualidades de acorde suportadas. */
export type ChordQuality =
  | "maj" | "min" | "dim" | "aug"
  | "sus2" | "sus4"
  | "6" | "m6"
  | "7" | "maj7" | "m7" | "dim7" | "m7b5" | "aug7" | "7sus4"
  | "9" | "maj9" | "m9" | "add9";

/** Intervalos (semitons a partir da tônica) de cada qualidade. */
export const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug7: [0, 4, 8, 10],
  "7sus4": [0, 5, 7, 10],
  "9": [0, 4, 7, 10, 2],
  maj9: [0, 4, 7, 11, 2],
  m9: [0, 3, 7, 10, 2],
  add9: [0, 4, 7, 2],
};

/** Sufixo textual de cada qualidade (maj é vazio). */
export const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: "", min: "m", dim: "dim", aug: "aug",
  sus2: "sus2", sus4: "sus4",
  "6": "6", m6: "m6",
  "7": "7", maj7: "maj7", m7: "m7", dim7: "dim7", m7b5: "m7b5", aug7: "aug7", "7sus4": "7sus4",
  "9": "9", maj9: "maj9", m9: "m9", add9: "add9",
};

/** Um acorde: tônica (0..11), qualidade e baixo opcional (acorde invertido). */
export interface Chord {
  root: number;
  quality: ChordQuality;
  /** Nota do baixo, quando diferente da tônica (ex: E/G# → bass = G#). */
  bass?: number;
}

/** Rótulo legível do acorde, incluindo o baixo invertido (ex: "E/G#"). */
export function chordLabel(c: Chord): string {
  const base = rootName(c.root) + QUALITY_SUFFIX[c.quality];
  return c.bass !== undefined && c.bass !== c.root ? `${base}/${rootName(c.bass)}` : base;
}

/** Transpõe um acorde (e seu baixo) por `semitones`. */
export function transposeChord(c: Chord, semitones: number): Chord {
  const wrap = (n: number) => (((n + semitones) % 12) + 12) % 12;
  return {
    root: wrap(c.root),
    quality: c.quality,
    ...(c.bass !== undefined ? { bass: wrap(c.bass) } : {}),
  };
}

/** Classes de altura (0..11) que compõem o acorde. */
export function chordTones(c: Chord): number[] {
  const tones = QUALITY_INTERVALS[c.quality].map((iv) => (c.root + iv) % 12);
  if (c.bass !== undefined && !tones.includes(c.bass)) tones.push(c.bass);
  return tones;
}

/** Nome da nota (ex: 9 → "A"). */
export function rootName(root: number): string {
  return NOTE_NAMES[((root % 12) + 12) % 12]!;
}

/** Nome da nota soante numa corda solta `open` pressionada na casa `fret`. */
export function noteAtFret(open: number, fret: number): string {
  return NOTE_NAMES[(((open + fret) % 12) + 12) % 12]!;
}

/** Grau cromático de uma classe de altura em relação à tônica (1, b2, 2, …, 7). */
const DEGREE_LABELS = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];
export function degreeLabel(pc: number, tonic: number): string {
  return DEGREE_LABELS[((((pc - tonic) % 12) + 12) % 12)]!;
}

/** Rótulo legível do tom (ex: "G maior", "A menor"). */
export function keyLabel(tonic: number, major: boolean): string {
  return `${rootName(tonic)} ${major ? "maior" : "menor"}`;
}

// Mapa de nomes (incl. bemóis) para classe de altura.
const NAME_TO_PC: Record<string, number> = {
  C: 0, "B#": 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4,
  "E#": 5, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10,
  Bb: 10, B: 11, Cb: 11,
};

// Aliases de sufixo → qualidade canônica. Testados após normalização.
const SUFFIX_TO_QUALITY: Record<string, ChordQuality> = {
  "": "maj", "maj": "maj", "M": "maj",
  "m": "min", "min": "min", "-": "min",
  "dim": "dim", "o": "dim", "°": "dim",
  "aug": "aug", "+": "aug",
  "sus2": "sus2",
  "sus": "sus4", "sus4": "sus4",
  "6": "6", "maj6": "6",
  "m6": "m6", "min6": "m6",
  "7": "7", "dom7": "7",
  "maj7": "maj7", "M7": "maj7", "Δ": "maj7", "7M": "maj7",
  "m7": "m7", "min7": "m7", "-7": "m7",
  "dim7": "dim7", "o7": "dim7", "°7": "dim7",
  "m7b5": "m7b5", "ø": "m7b5", "min7b5": "m7b5", "-7b5": "m7b5", "m7-5": "m7b5",
  "aug7": "aug7", "7#5": "aug7", "+7": "aug7", "7+": "aug7",
  "7sus4": "7sus4", "7sus": "7sus4",
  "9": "9", "add9": "add9",
  "maj9": "maj9", "M9": "maj9",
  "m9": "m9", "min9": "m9", "-9": "m9",
};

/**
 * Faz o parse de um token de cifra. Entende tríades, tétrades, extensões e
 * acordes invertidos (ex: "C", "Am7", "F#m7b5", "Bb9", "E/G#", "Dsus4/A").
 * Retorna null se não reconhecer.
 */
export function parseChord(token: string): Chord | null {
  let t = token.trim();
  if (!t) return null;

  // Separa o baixo invertido ("/G#").
  let bass: number | undefined;
  const slash = t.split("/");
  if (slash.length === 2) {
    const b = NAME_TO_PC[normalizeNote(slash[1]!)];
    if (b !== undefined) bass = b;
    t = slash[0]!;
  }

  const m = t.match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  const root = NAME_TO_PC[m[1]!];
  if (root === undefined) return null;

  const quality = parseQuality(m[2]!);
  return bass !== undefined ? { root, quality, bass } : { root, quality };
}

/** Normaliza a primeira letra (maiúscula) + acidente da nota do baixo. */
function normalizeNote(s: string): string {
  const m = s.trim().match(/^([a-gA-G])([#b]?)/);
  if (!m) return s.trim();
  return m[1]!.toUpperCase() + m[2]!;
}

/** Converte o sufixo do acorde (ex: "m7b5", "sus4") na qualidade canônica. */
function parseQuality(raw: string): ChordQuality {
  // Limpa parênteses, espaços e maiúsculas comuns mantendo letras-chave.
  const cleaned = raw.replace(/[()\s]/g, "");
  if (cleaned in SUFFIX_TO_QUALITY) return SUFFIX_TO_QUALITY[cleaned]!;
  const lower = cleaned.toLowerCase();
  if (lower in SUFFIX_TO_QUALITY) return SUFFIX_TO_QUALITY[lower]!;

  // Heurística para extensões não listadas (ex: "m11", "13", "maj13").
  if (lower.startsWith("maj")) return "maj7";
  if (lower.startsWith("m") || lower.startsWith("-")) return "min";
  if (lower.includes("sus")) return "sus4";
  if (lower.includes("dim")) return "dim";
  if (lower.includes("aug") || lower.includes("+")) return "aug";
  if (lower.includes("7")) return "7";
  return "maj";
}

// =============================================================================
// Voicings (afinação padrão) — gerados por busca no braço
// =============================================================================

const GUITAR_TUNING = [4, 9, 2, 7, 11, 4]; // E A D G B E (grave → aguda)
const BASS_TUNING = [4, 9, 2, 7]; // E A D G
const UKULELE_TUNING = [7, 0, 4, 9]; // G C E A (padrão)
const CAVACO_TUNING = [2, 7, 11, 2]; // D G B D (cavaquinho)

/** Um voicing: fret por corda (null = muda) + tônicas + casa inicial. */
export interface Voicing {
  frets: (number | null)[];
  isRoot: boolean[];
  baseFret: number;
}

/** Afinações de 6 cordas disponíveis no seletor (pitches grave → aguda). */
export const TUNING_PRESETS: { id: string; name: string; pitches: number[] }[] = [
  { id: "standard", name: "Padrão · E A D G B E", pitches: [4, 9, 2, 7, 11, 4] },
  { id: "halfdown", name: "Meio tom abaixo · Eb", pitches: [3, 8, 1, 6, 10, 3] },
  { id: "fulldown", name: "Um tom abaixo · D", pitches: [2, 7, 0, 5, 9, 2] },
  { id: "dropd", name: "Drop D · D A D G B E", pitches: [2, 9, 2, 7, 11, 4] },
  { id: "dropcsharp", name: "Drop C# · C# G# C# F# A# D#", pitches: [1, 8, 1, 6, 10, 3] },
  { id: "dropc", name: "Drop C · C G C F A D", pitches: [0, 7, 0, 5, 9, 2] },
  { id: "dadgad", name: "DADGAD", pitches: [2, 9, 2, 7, 9, 2] },
  { id: "openg", name: "Open G · D G D G B D", pitches: [2, 7, 2, 7, 11, 2] },
  { id: "opend", name: "Open D · D A D F# A D", pitches: [2, 9, 2, 6, 9, 2] },
];

/** Opções da busca de voicings. */
export interface VoicingOptions {
  /** Máximo de posições retornadas. */
  limit?: number;
  /**
   * Exige que a corda soante mais grave seja o baixo do acorde. Verdadeiro para
   * violão/guitarra/baixo (a tônica/baixo fica no grave); falso para
   * instrumentos reentrantes (ukulele) ou de afinação não-ascendente
   * (cavaquinho), onde a corda mais grave não é necessariamente o baixo.
   */
  requireBass?: boolean;
}

/**
 * Gera TODOS os voicings tocáveis de um instrumento de cordas para o acorde,
 * na afinação informada. Motor genérico — serve violão, guitarra, baixo,
 * ukulele, cavaquinho e qualquer afinação custom.
 */
export function chordVoicings(c: Chord, tuning: number[], opts: VoicingOptions = {}): Voicing[] {
  return fretboardVoicings(c, tuning, opts.limit ?? 24, opts.requireBass ?? true);
}

/**
 * Gera TODOS os voicings tocáveis de violão para o acorde (até `limit`),
 * na afinação informada (padrão por omissão).
 */
export function guitarVoicings(c: Chord, tuning: number[] = GUITAR_TUNING, limit = 24): Voicing[] {
  return fretboardVoicings(c, tuning, limit);
}

/** Gera os voicings de baixo (4 cordas) — fundamental no grave + notas. */
export function bassVoicings(c: Chord, tuning: number[] = BASS_TUNING, limit = 16): Voicing[] {
  return fretboardVoicings(c, tuning, limit);
}

/**
 * Busca exaustiva de voicings num braço de afinação arbitrária.
 *
 * Para cada janela de 4 casas, cada corda pode ser abafada ou tocar qualquer
 * nota do acorde dentro da janela. Enumeramos todas as combinações e ficamos
 * com as que são tocáveis e musicalmente válidas:
 *   - cordas soantes contíguas (sem buracos no meio — abafa só nas pontas);
 *   - a corda soante mais grave é o baixo correto (tônica ou baixo invertido);
 *   - cobre a tríade característica do acorde;
 *   - extensão ≤ 4 casas.
 * O resultado é deduplicado e ordenado da posição mais fácil para a mais alta.
 */
function fretboardVoicings(c: Chord, tuning: number[], limit: number, requireBass = true): Voicing[] {
  const tones = new Set(chordTones(c));
  const bass = c.bass ?? c.root;
  // Tríade característica que todo voicing precisa conter (define a qualidade).
  const need = QUALITY_INTERVALS[c.quality].slice(0, 3).map((iv) => (c.root + iv) % 12);

  const found: (Voicing & { score: number })[] = [];
  const seen = new Set<string>();
  const n = tuning.length;

  for (let start = 0; start <= 9; start++) {
    // Notas candidatas por corda nesta janela (null = corda abafada).
    const candidates: (number | null)[][] = tuning.map((open) => {
      const opts: (number | null)[] = [null];
      for (let f = start; f <= start + 3; f++) {
        if (tones.has((open + f) % 12)) opts.push(f);
      }
      return opts;
    });

    // Produto cartesiano iterativo das candidatas (índice por corda).
    const idx = new Array(n).fill(0);
    for (;;) {
      const frets = candidates.map((opts, s) => opts[idx[s]!]!);
      evaluate(frets);

      // Avança o "contador" de combinações.
      let k = n - 1;
      while (k >= 0 && ++idx[k]! >= candidates[k]!.length) {
        idx[k] = 0;
        k--;
      }
      if (k < 0) break;
    }
  }

  /** Valida e pontua uma combinação de casas. */
  function evaluate(frets: (number | null)[]): void {
    const sounding: number[] = [];
    for (let s = 0; s < frets.length; s++) if (frets[s] !== null) sounding.push(s);
    if (sounding.length < 3) return;

    // Cordas soantes precisam ser contíguas (abafar só nas pontas).
    const lo = sounding[0]!;
    const hi = sounding[sounding.length - 1]!;
    if (hi - lo + 1 !== sounding.length) return;

    // A corda soante mais grave deve ser o baixo (instrumentos com tônica no
    // grave). Em instrumentos reentrantes a checagem é dispensada.
    if (requireBass && (tuning[lo]! + frets[lo]!) % 12 !== bass) return;

    // Deve cobrir a tríade característica.
    const covered = new Set<number>();
    for (const s of sounding) covered.add((tuning[s]! + frets[s]!) % 12);
    for (const t of need) if (!covered.has(t)) return;

    // Extensão tocável (≤ 4 casas entre as notas pressionadas).
    const fretted = sounding.map((s) => frets[s]!).filter((f) => f > 0);
    const minFret = fretted.length ? Math.min(...fretted) : 0;
    const span = fretted.length ? Math.max(...fretted) - minFret : 0;
    if (span > 4) return;

    const sig = frets.join(",");
    if (seen.has(sig)) return;
    seen.add(sig);

    const isRoot = frets.map((f, s) => f !== null && (tuning[s]! + f) % 12 === c.root);
    const muted = frets.filter((f) => f === null).length;
    const baseFret = fretted.length ? minFret : 0;
    // Mais fácil = menor extensão, mais cordas, posição mais baixa.
    const score = span * 2 + muted + baseFret * 0.2;
    found.push({ frets, isRoot, baseFret, score });
  }

  found.sort((a, b) => a.score - b.score || a.baseFret - b.baseFret);
  return found.slice(0, limit).map(({ frets, isRoot, baseFret }) => ({ frets, isRoot, baseFret }));
}

/** Um modelo de acorde no teclado (uma inversão). */
export interface PianoVoicing {
  /** Posições absolutas em semitons (0 = dó mais grave da visão do teclado). */
  notes: number[];
  /** Classe de altura da tônica — para destacar a tecla. */
  root: number;
}

/**
 * Gera os modelos (inversões) de um acorde para o teclado: fundamental, 1ª
 * inversão, 2ª inversão… Cada modelo coloca o baixo na 1ª oitava e empilha as
 * notas seguintes ascendendo, para o músico ver cada disposição.
 */
export function pianoVoicings(chord: Chord): PianoVoicing[] {
  const root = chord.root;
  // Intervalos a partir da tônica, ascendentes e únicos → classes ordenadas.
  const intervals = [...new Set(chordTones(chord).map((pc) => (((pc - root) % 12) + 12) % 12))].sort((a, b) => a - b);
  const pcs = intervals.map((iv) => (root + iv) % 12); // tônica primeiro
  const n = pcs.length;
  if (!n) return [];
  const voicings: PianoVoicing[] = [];
  for (let inv = 0; inv < n; inv++) {
    const notes: number[] = [];
    let prev = -1;
    for (let i = 0; i < n; i++) {
      const pc = pcs[(inv + i) % n]!;
      let a = pc; // começa na 1ª oitava (0..11)
      while (a <= prev) a += 12;
      notes.push(a);
      prev = a;
    }
    voicings.push({ notes, root });
  }
  return voicings;
}

/**
 * Power chord (tônica + 5ª + 8ª) — voicing típico de guitarra. Oferece a forma
 * com tônica na 6ª e na 5ª corda como duas opções.
 */
export function powerChordVoicings(c: Chord, tuning: number[] = GUITAR_TUNING): Voicing[] {
  const make = (refString: number): Voicing => {
    const base = (((c.root - tuning[refString]!) % 12) + 12) % 12;
    const frets: (number | null)[] = [null, null, null, null, null, null];
    const isRoot = [false, false, false, false, false, false];
    frets[refString] = base;
    frets[refString + 1] = base + 2;
    if (refString + 2 < 6) frets[refString + 2] = base + 2;
    isRoot[refString] = true;
    return { frets, isRoot, baseFret: base };
  };
  // Tônica na 6ª, 5ª e 4ª corda → três posições no braço.
  return [make(0), make(1), make(2)];
}

/** Afinações exportadas para os renderizadores de diagrama. */
export const TUNINGS = {
  guitar: GUITAR_TUNING,
  bass: BASS_TUNING,
  ukulele: UKULELE_TUNING,
  cavaquinho: CAVACO_TUNING,
};

// =============================================================================
// Campo harmônico (acordes diatônicos de um tom)
// =============================================================================

export interface DegreeChord {
  chord: Chord;
  /** Grau em algarismos romanos (ex: "I", "vi", "vii°"). */
  degree: string;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_QUALITIES: ChordQuality[] = ["maj", "min", "min", "maj", "maj", "min", "dim"];
const MINOR_QUALITIES: ChordQuality[] = ["min", "dim", "maj", "min", "min", "maj", "maj"];
const MAJOR_DEGREES = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
const MINOR_DEGREES = ["i", "ii°", "III", "iv", "v", "VI", "VII"];

/** Retorna os 7 acordes diatônicos do tom (tônica + modo maior/menor). */
export function harmonicField(tonic: number, major: boolean): DegreeChord[] {
  const scale = major ? MAJOR_SCALE : MINOR_SCALE;
  const quals = major ? MAJOR_QUALITIES : MINOR_QUALITIES;
  const degs = major ? MAJOR_DEGREES : MINOR_DEGREES;
  return scale.map((iv, i) => ({
    chord: { root: (tonic + iv) % 12, quality: quals[i]! },
    degree: degs[i]!,
  }));
}

/**
 * Estima o tom (tônica + modo) de uma sequência de acordes pontuando, para cada
 * um dos 24 tons, quantos acordes caem no campo harmônico — com ênfase na tônica
 * aparecer no primeiro e (sobretudo) no último acorde. Retorna null se vazio.
 */
export function estimateKey(chords: Chord[]): { tonic: number; major: boolean } | null {
  if (!chords.length) return null;
  const first = chords[0]!;
  const last = chords[chords.length - 1]!;
  let best: { tonic: number; major: boolean; score: number } | null = null;

  for (let tonic = 0; tonic < 12; tonic++) {
    for (const major of [true, false]) {
      const field = harmonicField(tonic, major);
      const byRoot = new Map(field.map((d) => [d.chord.root, d.chord.quality]));
      let score = 0;
      for (const c of chords) {
        const q = byRoot.get(c.root);
        if (q !== undefined) score += q === c.quality ? 2 : 1.2; // diatônico (forte se a qualidade casa)
        else score -= 1; // fora do campo harmônico
      }
      if (first.root === tonic) score += 1.5;
      if (last.root === tonic) score += 2.5; // músicas tendem a terminar na tônica
      if (major) score += 0.1; // desempate suave a favor do maior
      if (!best || score > best.score) best = { tonic, major, score };
    }
  }
  return best ? { tonic: best.tonic, major: best.major } : null;
}
