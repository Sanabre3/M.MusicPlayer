// =============================================================================
// color.ts — Extração de paleta de cores a partir da capa do álbum
//
// Estratégia: quantização grosseira por balde de matiz.
//   1. Reduz a imagem para 48×48 px em um canvas offscreen.
//   2. Divide os pixels em 12 baldes de matiz (30° cada).
//   3. Descarta pixels muito escuros, claros ou dessaturados.
//   4. Pontua cada balde por saturação × cobertura (raiz da população).
//   5. Elege o vencedor, normaliza para vibrância de tela e deriva a sombra.
//
// Roda inteiramente no dispositivo — nenhuma chamada de rede.
// =============================================================================

import type { CoverPalette } from "./types";

/** Paleta de fallback usada quando a extração falha ou a imagem não carrega. */
const FALLBACK: CoverPalette = { accent: "#FF9E5E", shade: "#3A2A4A" };

/** Extrai um destaque vibrante e uma sombra escura da capa informada. */
export async function extractPalette(src: string): Promise<CoverPalette> {
  try {
    const img = await loadImage(src);
    const size = 48; // canvas pequeno para desempenho; resolução suficiente para cor
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return FALLBACK;

    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    // 12 baldes de matiz — cada um acumula a soma de R/G/B e saturação dos pixels.
    const buckets = Array.from({ length: 12 }, () => ({
      r: 0,
      g: 0,
      b: 0,
      n: 0,   // número de pixels no balde
      sat: 0, // soma das saturações
    }));

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const [h, s, l] = rgbToHsl(r, g, b);
      // Ignora pixels quase-pretos, quase-brancos e tons neutros (cinza).
      if (l < 0.12 || l > 0.92 || s < 0.18) continue;
      const idx = Math.min(11, Math.floor((h / 360) * 12));
      const bucket = buckets[idx]!;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.sat += s;
      bucket.n += 1;
    }

    // Elege o balde com maior pontuação (saturação média × √população).
    let best = buckets[0]!;
    let bestScore = -1;
    for (const bucket of buckets) {
      if (bucket.n === 0) continue;
      const score = (bucket.sat / bucket.n) * Math.sqrt(bucket.n);
      if (score > bestScore) {
        bestScore = score;
        best = bucket;
      }
    }
    if (best.n === 0) return FALLBACK;

    // Média de cor do balde vencedor → normaliza vibrância → deriva sombra.
    const accent = normalizeVibrant(best.r / best.n, best.g / best.n, best.b / best.n);
    return { accent: toHex(accent), shade: toHex(darken(accent, 0.55)) };
  } catch {
    return FALLBACK;
  }
}

/** Carrega uma imagem e resolve a promessa quando estiver pronta. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

type RGB = [number, number, number];

/**
 * Empurra a cor para uma faixa de vibrância agradável em tela:
 * saturação mínima 55%, luminosidade entre 50% e 68%.
 */
function normalizeVibrant(r: number, g: number, b: number): RGB {
  let [h, s, l] = rgbToHsl(r, g, b);
  s = Math.min(1, Math.max(s, 0.55));
  l = Math.min(0.68, Math.max(l, 0.5));
  return hslToRgb(h, s, l);
}

/** Escurece uma cor RGB pelo fator `amount` (0..1) reduzindo a luminosidade HSL. */
function darken([r, g, b]: RGB, amount: number): RGB {
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToRgb(h, Math.min(1, s * 0.9), l * (1 - amount));
}

/** Converte RGB (0–255) para HSL (H: 0–360, S e L: 0–1). */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
}

/** Converte HSL (H: 0–360, S e L: 0–1) para RGB (0–255). */
function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/** Converte uma tripla RGB para string hexadecimal (#rrggbb). */
function toHex([r, g, b]: RGB): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
