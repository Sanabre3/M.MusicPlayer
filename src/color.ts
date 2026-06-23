import type { CoverPalette } from "./types";

const FALLBACK: CoverPalette = { accent: "#FF9E5E", shade: "#3A2A4A" };

/**
 * Pull a vibrant accent and a darker companion from a cover image by
 * coarse color quantization: downscale to a tiny canvas, bucket pixels by
 * hue, and pick the bucket that best balances saturation and coverage.
 * Runs entirely on-device, no network.
 */
export async function extractPalette(src: string): Promise<CoverPalette> {
  try {
    const img = await loadImage(src);
    const size = 48;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return FALLBACK;

    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    // 12 hue buckets; score by saturation * vibrancy * population.
    const buckets = Array.from({ length: 12 }, () => ({
      r: 0,
      g: 0,
      b: 0,
      n: 0,
      sat: 0,
    }));

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const [h, s, l] = rgbToHsl(r, g, b);
      if (l < 0.12 || l > 0.92 || s < 0.18) continue; // skip near-black/white/gray
      const idx = Math.min(11, Math.floor((h / 360) * 12));
      const bucket = buckets[idx]!;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.sat += s;
      bucket.n += 1;
    }

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

    const accent = normalizeVibrant(best.r / best.n, best.g / best.n, best.b / best.n);
    return { accent: toHex(accent), shade: toHex(darken(accent, 0.55)) };
  } catch {
    return FALLBACK;
  }
}

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

/** Push a color toward a pleasant, screen-friendly vibrancy. */
function normalizeVibrant(r: number, g: number, b: number): RGB {
  let [h, s, l] = rgbToHsl(r, g, b);
  s = Math.min(1, Math.max(s, 0.55));
  l = Math.min(0.68, Math.max(l, 0.5));
  return hslToRgb(h, s, l);
}

function darken([r, g, b]: RGB, amount: number): RGB {
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToRgb(h, Math.min(1, s * 0.9), l * (1 - amount));
}

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

function toHex([r, g, b]: RGB): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
