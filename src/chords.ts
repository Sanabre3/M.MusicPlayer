// =============================================================================
// chords.ts — Teoria musical: acordes, transposição e voicings de instrumentos
//
// Núcleo de música usado pela aba Zone:
//   - Representação de acorde (tônica 0..11 + qualidade).
//   - Parse de rótulos ("Am", "C#m7", "Bb7", "F#dim") e transposição.
//   - Geração de voicings para violão (acorde completo), guitarra (power chord),
//     baixo (fundamental + 5ª + 8ª) e teclado (teclas do acorde).
//
// Sem dependências — apenas aritmética de classes de altura (mod 12).
// =============================================================================

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** Qualidades de acorde suportadas. */
export type ChordQuality = "maj" | "min" | "7" | "m7" | "maj7" | "dim";

/** Intervalos (em semitons a partir da tônica) de cada qualidade. */
export const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  "7": [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  dim: [0, 3, 6],
};

/** Sufixo textual de cada qualidade (maj é vazio). */
export const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: "",
  min: "m",
  "7": "7",
  m7: "m7",
  maj7: "maj7",
  dim: "dim",
};

/** Um acorde: tônica (0..11, 0 = C) + qualidade. */
export interface Chord {
  root: number;
  quality: ChordQuality;
}

/** Rótulo legível do acorde (ex: { root: 9, quality: "min" } → "Am"). */
export function chordLabel(c: Chord): string {
  return NOTE_NAMES[((c.root % 12) + 12) % 12] + QUALITY_SUFFIX[c.quality];
}

/** Transpõe um acorde por `semitones` (positivo sobe, negativo desce). */
export function transposeChord(c: Chord, semitones: number): Chord {
  return { root: (((c.root + semitones) % 12) + 12) % 12, quality: c.quality };
}

/** Classes de altura (0..11) que compõem o acorde. */
export function chordTones(c: Chord): number[] {
  return QUALITY_INTERVALS[c.quality].map((iv) => (c.root + iv) % 12);
}

/** Nome da tônica (ex: root 9 → "A"). */
export function rootName(root: number): string {
  return NOTE_NAMES[((root % 12) + 12) % 12]!;
}

// Mapa de nomes (incl. bemóis) para classe de altura, para o parser de cifra.
const NAME_TO_PC: Record<string, number> = {
  C: 0, "B#": 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4,
  "E#": 5, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10,
  Bb: 10, B: 11, Cb: 11,
};

/**
 * Faz o parse de um token de cifra (ex: "C", "Am", "F#m7", "Bbmaj7", "Gdim").
 * Retorna null se não for um acorde reconhecível.
 */
export function parseChord(token: string): Chord | null {
  const m = token.trim().match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  const root = NAME_TO_PC[m[1]!];
  if (root === undefined) return null;
  const rest = m[2]!.toLowerCase();

  // Ordem importa: testar sufixos mais longos primeiro.
  let quality: ChordQuality;
  if (rest === "" || rest === "maj") quality = "maj";
  else if (rest === "maj7" || rest === "M7") quality = "maj7";
  else if (rest === "m7" || rest === "min7" || rest === "-7") quality = "m7";
  else if (rest === "7" || rest === "dom7") quality = "7";
  else if (rest === "m" || rest === "min" || rest === "-") quality = "min";
  else if (rest === "dim" || rest === "°" || rest === "o") quality = "dim";
  else if (rest.startsWith("m")) quality = "min"; // m9, madd9 etc → trata como menor
  else quality = "maj"; // sus, add, 6, 9 etc → aproxima para maior
  return { root, quality };
}

// =============================================================================
// Voicings de cordas (afinação padrão)
// =============================================================================

/** Afinação do violão/guitarra (classes de altura, da 6ª corda grave à 1ª aguda). */
const GUITAR_TUNING = [4, 9, 2, 7, 11, 4]; // E A D G B E
/** Afinação do baixo (4 cordas, da grave à aguda). */
const BASS_TUNING = [4, 9, 2, 7]; // E A D G

/** Um voicing: fret por corda (null = corda muda) + fret inicial do diagrama. */
export interface Voicing {
  /** Fret absoluto por corda; null = não tocada. Ordem = afinação (grave→aguda). */
  frets: (number | null)[];
  /** Quais cordas tocam a tônica (para destaque). */
  isRoot: boolean[];
  /** Fret inicial exibido no diagrama (0 = pestana/casa aberta). */
  baseFret: number;
}

// Formas móveis (frets relativos à pestana). null = corda muda.
// Forma com tônica na 6ª corda (E-shape) e na 5ª corda (A-shape).
const E_SHAPES: Record<ChordQuality, (number | null)[]> = {
  maj:  [0, 2, 2, 1, 0, 0],
  min:  [0, 2, 2, 0, 0, 0],
  "7":  [0, 2, 0, 1, 0, 0],
  m7:   [0, 2, 0, 0, 0, 0],
  maj7: [0, 2, 1, 1, 0, 0],
  dim:  [0, 1, 2, 0, 2, null],
};
const A_SHAPES: Record<ChordQuality, (number | null)[]> = {
  maj:  [null, 0, 2, 2, 2, 0],
  min:  [null, 0, 2, 2, 1, 0],
  "7":  [null, 0, 2, 0, 2, 0],
  m7:   [null, 0, 2, 0, 1, 0],
  maj7: [null, 0, 2, 1, 2, 0],
  dim:  [null, 0, 1, 2, 1, null],
};

/**
 * Gera um voicing de acorde completo para violão, escolhendo entre a forma
 * de 6ª corda e a de 5ª corda — a que cair na casa mais baixa.
 */
export function guitarVoicing(c: Chord): Voicing {
  // Casa da pestana para cada forma (tônica na corda de referência).
  const eFret = (((c.root - GUITAR_TUNING[0]!) % 12) + 12) % 12; // ref 6ª corda (E)
  const aFret = (((c.root - GUITAR_TUNING[1]!) % 12) + 12) % 12; // ref 5ª corda (A)
  const useE = eFret <= aFret;
  const base = useE ? eFret : aFret;
  const shape = useE ? E_SHAPES[c.quality] : A_SHAPES[c.quality];
  const rootStringIdx = useE ? 0 : 1;

  const frets = shape.map((rel) => (rel === null ? null : rel + base));
  const isRoot = shape.map((_, i) => i === rootStringIdx && frets[i] !== null);
  return { frets, isRoot, baseFret: base };
}

/**
 * Power chord (tônica + 5ª + 8ª) — voicing típico de guitarra elétrica.
 * Tônica na 6ª corda quando possível; senão na 5ª.
 */
export function powerChordVoicing(c: Chord): Voicing {
  const eFret = (((c.root - GUITAR_TUNING[0]!) % 12) + 12) % 12;
  const aFret = (((c.root - GUITAR_TUNING[1]!) % 12) + 12) % 12;
  const useE = eFret <= aFret;
  const base = useE ? eFret : aFret;
  // Forma: tônica, 5ª (corda seguinte +2), 8ª (corda +2 mesma casa+2).
  const frets: (number | null)[] = [null, null, null, null, null, null];
  const isRoot = [false, false, false, false, false, false];
  const r = useE ? 0 : 1;
  frets[r] = base;
  frets[r + 1] = base + 2;
  frets[r + 2] = base + 2;
  isRoot[r] = true;
  return { frets, isRoot, baseFret: base };
}

/**
 * Voicing de baixo: marca a fundamental na corda grave + a 5ª e a 8ª próximas.
 */
export function bassVoicing(c: Chord): Voicing {
  const eFret = (((c.root - BASS_TUNING[0]!) % 12) + 12) % 12;
  const aFret = (((c.root - BASS_TUNING[1]!) % 12) + 12) % 12;
  const useE = eFret <= aFret;
  const base = useE ? eFret : aFret;
  const frets: (number | null)[] = [null, null, null, null];
  const isRoot = [false, false, false, false];
  const r = useE ? 0 : 1;
  frets[r] = base;        // fundamental
  isRoot[r] = true;
  if (r + 1 < 4) frets[r + 1] = base + 2; // 5ª
  if (r + 2 < 4) frets[r + 2] = base + 2; // 8ª
  return { frets, isRoot, baseFret: base };
}

/** Afinações exportadas para os renderizadores de diagrama. */
export const TUNINGS = { guitar: GUITAR_TUNING, bass: BASS_TUNING };
