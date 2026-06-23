// =============================================================================
// spotify.ts — Integração opcional com o Spotify via PKCE + Web Playback SDK
//
// Fluxo de autenticação (Authorization Code + PKCE):
//   1. Usuário informa o Client ID no diálogo da interface.
//   2. O app gera um code_verifier aleatório e deriva o code_challenge (SHA-256).
//   3. Redireciona para accounts.spotify.com/authorize com o challenge.
//   4. O Spotify redireciona de volta com ?code=... na URL.
//   5. O app troca o code + verifier por access_token e refresh_token.
//   6. O token é renovado automaticamente quando falta menos de 60 segundos.
//
// Sem client secret — seguro para front-ends estáticos (SPA).
// Requer Spotify Premium — o Web Playback SDK recusa conexão sem premium.
//
// Para usar:
//   1. Crie um app em https://developer.spotify.com/dashboard
//   2. Adicione a URL exata desta página como Redirect URI
//   3. Clique em "Connect Spotify" na interface e cole o Client ID
// =============================================================================

/** Chaves usadas no localStorage para persistência entre sessões. */
const TOKEN_KEY = "spotify_token";
const VERIFIER_KEY = "spotify_verifier";
const CLIENT_ID_KEY = "spotify_client_id";

/** Permissões solicitadas ao Spotify. */
const SCOPES = [
  "streaming",                  // reprodução via Web Playback SDK
  "user-read-email",            // identidade do usuário
  "user-read-private",          // verificação de conta Premium
  "user-modify-playback-state", // play/pause/seek via API REST
  "user-read-playback-state",   // leitura do estado atual de reprodução
].join(" ");

/** Token de acesso armazenado localmente. */
interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // timestamp Unix em milissegundos
}

/** Estado de reprodução recebido do SDK, normalizado para o player. */
export interface SpotifyState {
  title: string;
  artist: string;
  cover: string;
  paused: boolean;
  position: number;  // em milissegundos
  duration: number;  // em milissegundos
}

/** Resultado de busca de álbum, normalizado para a interface. */
export interface SpotifyAlbum {
  uri: string;
  name: string;
  artist: string;
  cover: string;
}

export class SpotifyController {
  private token: StoredToken | null = null;
  private player: Spotify.Player | null = null;
  private deviceId: string | null = null;

  /** Disparado quando o estado de reprodução muda (faixa, posição, pausa). */
  onState?: (state: SpotifyState | null) => void;
  /** Disparado quando este browser está pronto como dispositivo Spotify Connect. */
  onReady?: () => void;

  // --- configuração ----------------------------------------------------------

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

  /** URI de retorno exata, sem query string nem hash, para corresponder ao dashboard. */
  private get redirectUri(): string {
    return window.location.origin + window.location.pathname;
  }

  // --- ciclo de vida ---------------------------------------------------------

  /**
   * Inicializa ao carregar a página:
   *   - Restaura token salvo do localStorage.
   *   - Conclui a troca de código se a URL contiver ?code=...
   *   - Renova o token se estiver próximo do vencimento.
   */
  async init(): Promise<void> {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (raw) this.token = JSON.parse(raw) as StoredToken;

    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      await this.exchangeCode(code);
      // Remove o ?code= da barra de endereço sem recarregar a página.
      window.history.replaceState({}, document.title, this.redirectUri);
    }
    if (this.isAuthenticated) await this.ensureFreshToken();
  }

  /** Inicia o fluxo PKCE: gera o verifier, redireciona para o Spotify. */
  async login(): Promise<void> {
    if (!this.isConfigured) throw new Error("Informe o Client ID do Spotify primeiro.");
    const verifier = randomString(64);
    const challenge = await sha256Base64Url(verifier);
    // Guarda o verifier para a troca de código após o redirect de volta.
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

  /** Desconecta o player e apaga o token salvo. */
  logout(): void {
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
    this.player?.disconnect();
    this.player = null;
    this.deviceId = null;
  }

  // --- autenticação ----------------------------------------------------------

  /** Troca o código de autorização por access_token + refresh_token. */
  private async exchangeCode(code: string): Promise<void> {
    const verifier = localStorage.getItem(VERIFIER_KEY);
    if (!verifier) return; // verifier ausente — fluxo inválido, ignora
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
    if (!res.ok) throw new Error("Falha na troca do código Spotify.");
    this.storeToken(await res.json());
    localStorage.removeItem(VERIFIER_KEY);
  }

  /** Renova o access_token usando o refresh_token quando está próximo de expirar. */
  private async ensureFreshToken(): Promise<void> {
    if (!this.token) return;
    // Renova se vencer em menos de 60 segundos.
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
      this.logout(); // token inválido — força novo login
      return;
    }
    this.storeToken(await res.json());
  }

  /** Salva o token no localStorage com o timestamp de expiração calculado. */
  private storeToken(data: {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }): void {
    this.token = {
      access_token: data.access_token,
      // Mantém o refresh_token anterior se o novo não vier na resposta.
      refresh_token: data.refresh_token ?? this.token?.refresh_token ?? "",
      expires_at: Date.now() + data.expires_in * 1000,
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(this.token));
  }

  // --- Web Playback SDK ------------------------------------------------------

  /**
   * Carrega o SDK do Spotify e registra este browser como dispositivo
   * "Aurora Turntable" no Spotify Connect.
   */
  async connectPlayer(): Promise<void> {
    if (!this.isAuthenticated || this.player) return;
    await loadSdk();
    const player = new window.Spotify!.Player({
      name: "Aurora Turntable",
      // O SDK solicita um token fresco a cada reprodução via callback.
      getOAuthToken: (cb) => {
        void this.ensureFreshToken().then(() => {
          if (this.token) cb(this.token.access_token);
        });
      },
      volume: 0.8,
    });

    // Dispositivo registrado com sucesso — guarda o device_id para a API REST.
    player.addListener("ready", ({ device_id }) => {
      this.deviceId = device_id;
      this.onReady?.();
    });

    // Dispositivo desconectado — limpa o device_id.
    player.addListener("not_ready", () => {
      this.deviceId = null;
    });

    // Estado de reprodução mudou — repassa ao controller principal.
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

  /**
   * Transfere a reprodução ativa do Spotify para este dispositivo.
   * Se `uri` for fornecido, reproduz essa faixa específica imediatamente.
   */
  async transferAndPlay(uri?: string): Promise<void> {
    if (!this.deviceId || !this.token) return;
    const auth = { Authorization: `Bearer ${this.token.access_token}` };

    // Transfere a reprodução para este device (sem iniciar se uri não fornecido).
    await fetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ device_ids: [this.deviceId], play: !uri }),
    });

    // Se um URI foi especificado, inicia essa faixa neste device.
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

  // --- busca de álbuns --------------------------------------------------------

  /** Busca álbuns pelo nome via Web API. Requer sessão autenticada. */
  async searchAlbums(query: string): Promise<SpotifyAlbum[]> {
    await this.ensureFreshToken();
    if (!this.token) throw new Error("Conecte o Spotify primeiro.");
    const params = new URLSearchParams({ q: query, type: "album", limit: "12" });
    const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
      headers: { Authorization: `Bearer ${this.token.access_token}` },
    });
    if (!res.ok) throw new Error(`Busca de álbuns falhou (HTTP ${res.status}).`);
    const data = await res.json();
    interface RawAlbum {
      uri: string;
      name: string;
      artists: { name: string }[];
      images: { url: string }[];
    }
    return (data.albums?.items ?? []).map((a: RawAlbum) => ({
      uri: a.uri,
      name: a.name,
      artist: a.artists.map((x) => x.name).join(", "),
      cover: a.images[0]?.url ?? "",
    }));
  }

  /** Inicia a reprodução de um álbum inteiro neste dispositivo. */
  async playAlbum(uri: string): Promise<void> {
    if (!this.deviceId || !this.token) return;
    await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.token.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ context_uri: uri }),
      },
    );
  }

  // --- controles de transporte -----------------------------------------------

  togglePlay(): void { void this.player?.togglePlay(); }
  next(): void       { void this.player?.nextTrack(); }
  previous(): void   { void this.player?.previousTrack(); }
  seek(ms: number): void    { void this.player?.seek(ms); }
  setVolume(v: number): void { void this.player?.setVolume(v); }
}

// =============================================================================
// Funções auxiliares
// =============================================================================

/** Promise singleton para não carregar o SDK mais de uma vez. */
let sdkPromise: Promise<void> | null = null;

/** Injeta o script do Spotify SDK no <head> e aguarda o callback global. */
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

/** Gera uma string aleatória criptograficamente segura para o code_verifier PKCE. */
function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join("");
}

/** Gera o code_challenge SHA-256 em Base64URL a partir do verifier. */
async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
