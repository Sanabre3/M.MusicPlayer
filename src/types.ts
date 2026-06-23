export type TrackSource = "local" | "spotify";

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  /** Image URL used as the vinyl label and to theme the stage. */
  cover: string;
  /** Audio URL for local tracks. Empty string for Spotify-backed tracks. */
  src: string;
  source: TrackSource;
  /** Spotify track URI (spotify:track:...) when source === "spotify". */
  spotifyUri?: string;
  /** True for object-URL tracks the user dropped in; revoked on removal. */
  ephemeral?: boolean;
}

/** A two-tone palette extracted from a cover image. */
export interface CoverPalette {
  /** Vibrant primary, used as the live accent. */
  accent: string;
  /** Darker companion, used to tint the stage backdrop. */
  shade: string;
}

export type RepeatMode = "off" | "all" | "one";

export interface PlaybackSnapshot {
  position: number;
  duration: number;
  playing: boolean;
}
