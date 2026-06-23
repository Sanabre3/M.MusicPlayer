// =============================================================================
// types.ts — Tipos compartilhados por toda a aplicação
// =============================================================================

/** Origem da faixa: arquivo local, streaming via Spotify ou vídeo do YouTube. */
export type TrackSource = "local" | "spotify" | "youtube";

/** Representa uma faixa musical na fila (crate). */
export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  /** URL da capa do álbum — usada como rótulo do vinil e para tematizar o palco. */
  cover: string;
  /** URL do áudio para faixas locais. String vazia quando a origem é Spotify/YouTube. */
  src: string;
  source: TrackSource;
  /** URI do Spotify (spotify:track:...) quando source === "spotify". */
  spotifyUri?: string;
  /** ID do vídeo do YouTube (ex: dQw4w9WgXcQ) quando source === "youtube". */
  youtubeId?: string;
  /** Verdadeiro para faixas carregadas via drag-and-drop (object URL temporária). */
  ephemeral?: boolean;
}

/** Paleta de duas cores extraída da capa do álbum. */
export interface CoverPalette {
  /** Cor vibrante principal — usada como destaque animado (--accent). */
  accent: string;
  /** Variação mais escura — usada para tingir o fundo do palco (--shade). */
  shade: string;
}

/** Modo de repetição da fila. */
export type RepeatMode = "off" | "all" | "one";

/** Fotografia instantânea do estado de reprodução em um dado momento. */
export interface PlaybackSnapshot {
  position: number;  // segundos decorridos
  duration: number;  // duração total em segundos
  playing: boolean;
}

// =============================================================================
// Equalizador (estilo FxSound) — EQ multibanda + efeitos de realce
// =============================================================================

/** Ajustes completos do equalizador, persistidos no localStorage. */
export interface EqualizerSettings {
  /** Quando falso, o sinal passa direto (bypass total). */
  enabled: boolean;
  /** Ganho de cada banda em dB (−12..+12). Mesmo comprimento de EQ_FREQUENCIES. */
  bands: number[];
  /** Realce de graves extra (lowshelf) em dB (0..12). */
  bassBoost: number;
  /** Mistura de ambiência/reverb (0..1) — o "Ambience" do FxSound. */
  ambience: number;
  /** Boost dinâmico de volume (compressor + makeup) — o "Dynamic Boost". */
  dynamic: boolean;
  /** Nome do preset atualmente selecionado (ou "custom"). */
  preset: string;
}

// =============================================================================
// Temas visuais (presets lo-fi)
// =============================================================================

/** Um preset de tema lo-fi que retematiza o palco inteiro. */
export interface ThemePreset {
  id: string;
  name: string;
  /** Quando true, o tema é "Auto": cores extraídas da capa de cada faixa. */
  auto?: boolean;
  /** Variáveis CSS aplicadas em :root quando o tema está ativo. */
  vars?: Record<string, string>;
  /** Valor CSS de `background` aplicado à camada de fundo lo-fi. */
  background?: string;
  /** Quando true, anima lentamente o gradiente de fundo. */
  animated?: boolean;
}
