// =============================================================================
// themes.ts — Presets de tema lo-fi + aplicação ao palco
//
// O tema "Auto" mantém o comportamento original: cores extraídas da capa de
// cada faixa. Os demais presets são estéticas lo-fi fixas — sobrescrevem as
// variáveis CSS e pintam uma camada de fundo (#themeBg) com gradientes, sem
// depender de imagens externas (funciona offline).
//
// A preferência é persistida no localStorage.
// =============================================================================

import type { ThemePreset } from "./types";

const THEME_KEY = "lofi_theme";

/** Conjunto de temas disponíveis no seletor. O primeiro é o modo dinâmico. */
export const THEMES: ThemePreset[] = [
  {
    id: "auto",
    name: "Auto · capa",
    auto: true,
  },
  {
    id: "lofi-dusk",
    name: "Lo-Fi Dusk",
    animated: true,
    vars: {
      "--ground": "#1a1320",
      "--accent": "#ff9e5e",
      "--accent-2": "#b56cff",
      "--shade": "#43285a",
      "--text": "#f4ecdf",
    },
    background:
      "radial-gradient(120% 90% at 20% 15%, #ff9e5e33, transparent 55%)," +
      "radial-gradient(110% 80% at 85% 80%, #b56cff3d, transparent 55%)," +
      "linear-gradient(160deg, #241634, #14101a 70%)",
  },
  {
    id: "vapor",
    name: "Vaporwave",
    animated: true,
    vars: {
      "--ground": "#1a1030",
      "--accent": "#ff5fb0",
      "--accent-2": "#41e0ff",
      "--shade": "#3a1f6b",
      "--text": "#f6ecff",
    },
    background:
      "radial-gradient(100% 80% at 50% 0%, #ff5fb04d, transparent 60%)," +
      "radial-gradient(120% 90% at 50% 100%, #41e0ff3d, transparent 55%)," +
      "linear-gradient(180deg, #2a1255, #160a2e)",
  },
  {
    id: "midnight",
    name: "Midnight Study",
    vars: {
      "--ground": "#0d1424",
      "--accent": "#6fb4ff",
      "--accent-2": "#9d8bff",
      "--shade": "#1b2b4d",
      "--text": "#e6edf7",
    },
    background:
      "radial-gradient(120% 90% at 80% 10%, #6fb4ff2e, transparent 55%)," +
      "radial-gradient(100% 80% at 10% 90%, #9d8bff2b, transparent 55%)," +
      "linear-gradient(165deg, #14213d, #0a0f1c 75%)",
  },
  {
    id: "forest",
    name: "Forest Tape",
    animated: true,
    vars: {
      "--ground": "#0f1a16",
      "--accent": "#7fe0a8",
      "--accent-2": "#d9c27a",
      "--shade": "#1d3a2c",
      "--text": "#eaf3ec",
    },
    background:
      "radial-gradient(120% 90% at 25% 20%, #7fe0a82e, transparent 55%)," +
      "radial-gradient(110% 80% at 80% 85%, #d9c27a29, transparent 55%)," +
      "linear-gradient(160deg, #16271f, #0c1411 75%)",
  },
  {
    id: "sunset",
    name: "Sunset Cassette",
    animated: true,
    vars: {
      "--ground": "#1f1216",
      "--accent": "#ff7a59",
      "--accent-2": "#ffd166",
      "--shade": "#5a2333",
      "--text": "#fdeee3",
    },
    background:
      "radial-gradient(120% 100% at 50% 0%, #ff7a594d, transparent 55%)," +
      "radial-gradient(120% 90% at 50% 100%, #ffd16633, transparent 50%)," +
      "linear-gradient(180deg, #45151f, #1c0e12)",
  },
  {
    id: "noir",
    name: "Mono Noir",
    vars: {
      "--ground": "#111113",
      "--accent": "#cfcad3",
      "--accent-2": "#8b8794",
      "--shade": "#2a2a30",
      "--text": "#f0eef2",
    },
    background:
      "radial-gradient(120% 90% at 30% 20%, #ffffff14, transparent 55%)," +
      "linear-gradient(160deg, #1c1c20, #0c0c0e 80%)",
  },
];

/** Variáveis CSS originais — restauradas ao voltar para o modo "Auto". */
const BASE_VARS: Record<string, string> = {
  "--ground": "#14101a",
  "--accent": "#ff9e5e",
  "--accent-2": "#6c7bff",
  "--shade": "#3a2a4a",
  "--text": "#f2ede4",
};

/** Lê o id do tema salvo (padrão "auto"). */
export function savedThemeId(): string {
  return localStorage.getItem(THEME_KEY) ?? "auto";
}

/** Localiza um tema pelo id, com fallback para o primeiro (Auto). */
export function themeById(id: string): ThemePreset {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

/**
 * Aplica um tema ao documento.
 * @returns `true` se o tema é "Auto" (cores devem vir da capa da faixa).
 */
export function applyTheme(theme: ThemePreset, bgEl: HTMLElement): boolean {
  localStorage.setItem(THEME_KEY, theme.id);
  const root = document.documentElement.style;

  if (theme.auto) {
    // Restaura as variáveis base; a camada de fundo lo-fi some e a capa volta.
    for (const [k, v] of Object.entries(BASE_VARS)) root.setProperty(k, v);
    bgEl.style.background = "";
    bgEl.classList.remove("is-active", "is-animated");
    document.body.classList.remove("themed");
    return true;
  }

  for (const [k, v] of Object.entries(theme.vars ?? {})) root.setProperty(k, v);
  bgEl.style.background = theme.background ?? "";
  bgEl.classList.add("is-active");
  bgEl.classList.toggle("is-animated", !!theme.animated);
  document.body.classList.add("themed");
  return false;
}
