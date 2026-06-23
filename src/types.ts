// =============================================================================
// types.ts — Tipos compartilhados por toda a aplicação
// =============================================================================

/** Origem da faixa: arquivo local do dispositivo ou streaming via Spotify. */
export type TrackSource = "local" | "spotify";

/** Representa uma faixa musical na fila (crate). */
export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  /** URL da capa do álbum — usada como rótulo do vinil e para tematizar o palco. */
  cover: string;
  /** URL do áudio para faixas locais. String vazia quando a origem é Spotify. */
  src: string;
  source: TrackSource;
  /** URI do Spotify (spotify:track:...) quando source === "spotify". */
  spotifyUri?: string;
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
