/**
 * Optional Spotify connect: Authorization Code flow with PKCE (no client
 * secret, safe for a static front-end) plus the Web Playback SDK so this
 * page becomes a Spotify Connect device.
 *
 * Requirements:
 *   - A Spotify app (https://developer.spotify.com/dashboard) with this
 *     page's exact URL added as a Redirect URI.
 *   - Spotify Premium (the Web Playback SDK refuses to stream otherwise).
 *
 * Configure the client id once via the UI (stored in localStorage) or by
 * setting localStorage["spotify_client_id"] directly.
 */

const TOKEN_KEY = "spotify_token";
const VERIFIER_KEY = "spotify_verifier";
const CLIENT_ID_KEY = "spotify_client_id";

const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ");

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface SpotifyState {
  title: string;
  artist: string;
  cover: string;
  paused: boolean;
  position: number;
  duration: number;
}

export class SpotifyController {
  private token: StoredToken | null = null;
  private player: Spotify.Player | null = null;
  private deviceId: string | null = null;
  onState?: (state: SpotifyState | null) => void;
  onReady?: () => void;

  get clientId(): string {
    return localStorage.getItem(CLIENT_ID_KEY) ?? "";
  }
  set clientId(value: string) {
    localStorage.setItem(CLIENT_ID_KEY, value.trim());
  }

  get isConfigured(): boolean {
    return this.clientId.length > 0;
  }

  get isAuthenticated(): boolean {
    return !!this.token && this.token.expires_at > Date.now();
  }

  private get redirectUri(): string {
    // Strip query/hash so it matches the registered URI exactly.
    return window.location.origin + window.location.pathname;
  }

  /** Restore a saved token and, if a code is present, complete the redirect. */
  async init(): Promise<void> {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (raw) this.token = JSON.parse(raw) as StoredToken;

    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      await this.exchangeCode(code);
      // Clean the code out of the address bar.
      window.history.replaceState({}, document.title, this.redirectUri);
    }
    if (this.isAuthenticated) await this.ensureFreshToken();
  }

  /** Kick off the PKCE login redirect. */
  async login(): Promise<void> {
    if (!this.isConfigured) throw new Error("Set a Spotify client id first.");
    const verifier = randomString(64);
    const challenge = await sha256Base64Url(verifier);
    localStorage.setItem(VERIFIER_KEY, verifier);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      scope: SCOPES,
      code_challenge_method: "S256",
      code_challenge: challenge,
      redirect_uri: this.redirectUri,
    });
    window.location.href = `https://accounts.spotify.com/authorize?${params}`;
  }

  logout(): void {
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
    this.player?.disconnect();
    this.player = null;
    this.deviceId = null;
  }

  private async exchangeCode(code: string): Promise<void> {
    const verifier = localStorage.getItem(VERIFIER_KEY);
    if (!verifier) return;
    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      code_verifier: verifier,
    });
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error("Spotify token exchange failed.");
    this.storeToken(await res.json());
    localStorage.removeItem(VERIFIER_KEY);
  }

  private async ensureFreshToken(): Promise<void> {
    if (!this.token) return;
    if (this.token.expires_at > Date.now() + 60_000) return;
    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: "refresh_token",
      refresh_token: this.token.refresh_token,
    });
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      this.logout();
      return;
    }
    this.storeToken(await res.json());
  }

  private storeToken(data: {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }): void {
    this.token = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? this.token?.refresh_token ?? "",
      expires_at: Date.now() + data.expires_in * 1000,
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(this.token));
  }

  /** Load the SDK and connect this browser as a playback device. */
  async connectPlayer(): Promise<void> {
    if (!this.isAuthenticated || this.player) return;
    await loadSdk();
    const player = new window.Spotify!.Player({
      name: "Aurora Turntable",
      getOAuthToken: (cb) => {
        void this.ensureFreshToken().then(() => {
          if (this.token) cb(this.token.access_token);
        });
      },
      volume: 0.8,
    });

    player.addListener("ready", ({ device_id }) => {
      this.deviceId = device_id;
      this.onReady?.();
    });
    player.addListener("not_ready", () => {
      this.deviceId = null;
    });
    player.addListener("player_state_changed", (state) => {
      if (!state) {
        this.onState?.(null);
        return;
      }
      const t = state.track_window.current_track;
      this.onState?.({
        title: t.name,
        artist: t.artists.map((a) => a.name).join(", "),
        cover: t.album.images[0]?.url ?? "",
        paused: state.paused,
        position: state.position,
        duration: state.duration,
      });
    });

    await player.connect();
    this.player = player;
  }

  /** Route playback to this device and (optionally) start a track. */
  async transferAndPlay(uri?: string): Promise<void> {
    if (!this.deviceId || !this.token) return;
    const auth = { Authorization: `Bearer ${this.token.access_token}` };
    await fetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ device_ids: [this.deviceId], play: !uri }),
    });
    if (uri) {
      await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`,
        {
          method: "PUT",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ uris: [uri] }),
        },
      );
    }
  }

  togglePlay(): void {
    void this.player?.togglePlay();
  }
  next(): void {
    void this.player?.nextTrack();
  }
  previous(): void {
    void this.player?.previousTrack();
  }
  seek(ms: number): void {
    void this.player?.seek(ms);
  }
  setVolume(v: number): void {
    void this.player?.setVolume(v);
  }
}

// --- helpers ---------------------------------------------------------------

let sdkPromise: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve) => {
    if (window.Spotify) return resolve();
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.head.appendChild(script);
  });
  return sdkPromise;
}

function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join("");
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
