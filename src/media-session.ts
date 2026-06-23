import type { Track } from "./types";

interface MediaActions {
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
}

/**
 * Bridges the player to the OS media controls via the MediaSession API:
 * hardware/keyboard media keys, the lock screen, and notification controls
 * all route through here. No-ops gracefully on unsupported browsers.
 */
export class MediaSessionBridge {
  private readonly supported = "mediaSession" in navigator;

  constructor(actions: MediaActions) {
    if (!this.supported) return;
    const ms = navigator.mediaSession;
    const bind = (
      action: MediaSessionAction,
      handler: ((d: MediaSessionActionDetails) => void) | (() => void),
    ) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action not supported in this browser */
      }
    };

    bind("play", actions.play);
    bind("pause", actions.pause);
    bind("previoustrack", actions.previous);
    bind("nexttrack", actions.next);
    bind("seekto", (d: MediaSessionActionDetails) => {
      if (typeof d.seekTime === "number") actions.seek(d.seekTime);
    });
    bind("seekbackward", () => actions.seek(Math.max(0, this.position - 10)));
    bind("seekforward", () => actions.seek(this.position + 10));
  }

  private position = 0;

  setMetadata(track: Track): void {
    if (!this.supported) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album ?? "",
      artwork: [
        { src: track.cover, sizes: "512x512", type: "image/jpeg" },
      ],
    });
  }

  setPlaybackState(playing: boolean): void {
    if (!this.supported) return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }

  setPositionState(position: number, duration: number): void {
    if (!this.supported || !duration || !Number.isFinite(duration)) return;
    this.position = position;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(position, duration),
        playbackRate: 1,
      });
    } catch {
      /* invalid state values; ignore */
    }
  }
}
