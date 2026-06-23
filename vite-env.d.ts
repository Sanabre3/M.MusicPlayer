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
  YT?: typeof YT;
  onYouTubeIframeAPIReady?: () => void;
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

// Minimal typings for the YouTube IFrame Player API global.
// Loaded at runtime from www.youtube.com/iframe_api only when the user
// chooses to search/play a YouTube video.
declare namespace YT {
  interface PlayerVars {
    autoplay?: 0 | 1;
    controls?: 0 | 1;
    rel?: 0 | 1;
    modestbranding?: 0 | 1;
    playsinline?: 0 | 1;
  }
  interface PlayerEvents {
    onReady?: (event: { target: Player }) => void;
    onStateChange?: (event: { data: number; target: Player }) => void;
  }
  interface PlayerOptions {
    width?: string | number;
    height?: string | number;
    videoId?: string;
    playerVars?: PlayerVars;
    events?: PlayerEvents;
  }
  enum PlayerState {
    UNSTARTED = -1,
    ENDED = 0,
    PLAYING = 1,
    PAUSED = 2,
    BUFFERING = 3,
    CUED = 5,
  }
  class Player {
    constructor(elementId: string | HTMLElement, options: PlayerOptions);
    loadVideoById(videoId: string): void;
    cueVideoById(videoId: string): void;
    playVideo(): void;
    pauseVideo(): void;
    stopVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    setVolume(volume: number): void;
    getVolume(): number;
    getCurrentTime(): number;
    getDuration(): number;
    getPlayerState(): number;
    getIframe(): HTMLIFrameElement;
    destroy(): void;
  }
}
