/// <reference types="vite/client" />

declare module "*.mp3" {
  const src: string;
  export default src;
}

// Minimal typings for the Spotify Web Playback SDK global.
// The full SDK is loaded at runtime from sdk.scdn.co only when the user
// chooses to connect Spotify.
interface Window {
  Spotify?: typeof Spotify;
  onSpotifyWebPlaybackSDKReady?: () => void;
}

declare namespace Spotify {
  interface PlayerInit {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }
  interface WebPlaybackError {
    message: string;
  }
  interface WebPlaybackTrack {
    name: string;
    uri: string;
    artists: { name: string; uri: string }[];
    album: { name: string; images: { url: string }[] };
  }
  interface WebPlaybackState {
    paused: boolean;
    position: number;
    duration: number;
    track_window: { current_track: WebPlaybackTrack };
  }
  class Player {
    constructor(init: PlayerInit);
    connect(): Promise<boolean>;
    disconnect(): void;
    addListener(event: "ready" | "not_ready", cb: (data: { device_id: string }) => void): void;
    addListener(event: "player_state_changed", cb: (state: WebPlaybackState | null) => void): void;
    addListener(
      event: "initialization_error" | "authentication_error" | "account_error" | "playback_error",
      cb: (err: WebPlaybackError) => void,
    ): void;
    removeListener(event: string): void;
    togglePlay(): Promise<void>;
    nextTrack(): Promise<void>;
    previousTrack(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    setVolume(volume: number): Promise<void>;
    getCurrentState(): Promise<WebPlaybackState | null>;
  }
}
