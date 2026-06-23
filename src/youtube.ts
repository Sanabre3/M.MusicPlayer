// =============================================================================
// youtube.ts — Busca e reprodução de vídeos do YouTube
//
// Duas integrações oficiais do YouTube:
//
//   1. YouTube Data API v3 (search.list) — busca vídeos por nome. Requer uma
//      API key gerada no Google Cloud Console (salva no localStorage).
//
//   2. IFrame Player API — incorpora um player controlável (play/pause/seek)
//      e fornece o áudio + vídeo. O mesmo iframe serve de "vídeo ao fundo"
//      quando o usuário quer assistir; caso contrário fica oculto tocando só
//      o áudio, com a miniatura exibida no rótulo do vinil.
//
// Observação técnica: como o áudio vem de um iframe cross-origin, o
// AnalyserNode da Web Audio API não consegue lê-lo — por isso o visualizador
// e o equalizador atuam apenas nas faixas locais. O YouTube traz seu próprio
// transporte (posição/duração) por polling.
// =============================================================================

const API_KEY_KEY = "youtube_api_key";

/** Resultado de busca normalizado para a interface. */
export interface YouTubeResult {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
}

/** Estado de reprodução do YouTube normalizado para o player. */
export interface YouTubeState {
  paused: boolean;
  ended: boolean;
}

export class YouTubeController {
  private player: YT.Player | null = null;
  private playerReady = false;
  private targetId = "";
  private pollTimer = 0;
  private lastVideoId = "";

  /** Disparado quando o estado muda (play/pause/fim do vídeo). */
  onState?: (state: YouTubeState) => void;
  /** Disparado ~4×/s com a posição e a duração atuais (em segundos). */
  onTime?: (position: number, duration: number) => void;
  /** Disparado quando o player do iframe está pronto para receber comandos. */
  onReady?: () => void;

  // --- configuração ----------------------------------------------------------

  get apiKey(): string {
    return localStorage.getItem(API_KEY_KEY) ?? "";
  }
  set apiKey(value: string) {
    localStorage.setItem(API_KEY_KEY, value.trim());
  }
  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  // --- busca (Data API v3) ---------------------------------------------------

  /** Busca vídeos do YouTube por palavra-chave. Lança erro se a key faltar/for inválida. */
  async search(query: string): Promise<YouTubeResult[]> {
    if (!this.isConfigured) throw new Error("Informe a YouTube Data API key primeiro.");
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      videoEmbeddable: "true",
      maxResults: "12",
      q: query,
      key: this.apiKey,
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.error?.message ?? `Busca falhou (HTTP ${res.status}).`);
    }
    const data = (await res.json()) as YouTubeSearchResponse;
    return data.items
      .filter((item) => item.id?.videoId)
      .map((item) => ({
        id: item.id.videoId!,
        title: decodeEntities(item.snippet.title),
        channel: decodeEntities(item.snippet.channelTitle),
        thumbnail:
          item.snippet.thumbnails.high?.url ??
          item.snippet.thumbnails.medium?.url ??
          item.snippet.thumbnails.default?.url ??
          "",
      }));
  }

  // --- IFrame Player ---------------------------------------------------------

  /**
   * Garante que o player do iframe exista, montado no elemento `targetId`.
   * Carrega a IFrame API sob demanda na primeira chamada.
   */
  async ensurePlayer(targetId: string): Promise<void> {
    if (this.player) return;
    this.targetId = targetId;
    await loadIframeApi();
    await new Promise<void>((resolve) => {
      this.player = new YT.Player(targetId, {
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 0,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            this.playerReady = true;
            this.onReady?.();
            resolve();
          },
          onStateChange: (e) => this.handleStateChange(e.data),
        },
      });
    });
  }

  /** Carrega e inicia um vídeo pelo ID. Cria o player se necessário. */
  async load(videoId: string, autoplay = true): Promise<void> {
    await this.ensurePlayer(this.targetId || "ytPlayer");
    this.lastVideoId = videoId;
    if (autoplay) this.player?.loadVideoById(videoId);
    else this.player?.cueVideoById(videoId);
    this.startPolling();
  }

  togglePlay(): void {
    if (!this.player) return;
    const state = this.player.getPlayerState();
    if (state === YT.PlayerState.PLAYING) this.player.pauseVideo();
    else this.player.playVideo();
  }

  play(): void {
    this.player?.playVideo();
  }
  pause(): void {
    this.player?.pauseVideo();
  }
  seek(seconds: number): void {
    this.player?.seekTo(Math.max(0, seconds), true);
  }
  /** Volume em 0..1 (a API do YouTube usa 0..100). */
  setVolume(v: number): void {
    this.player?.setVolume(Math.round(Math.max(0, Math.min(1, v)) * 100));
  }

  get isReady(): boolean {
    return this.playerReady;
  }
  get currentVideoId(): string {
    return this.lastVideoId;
  }

  // --- internos --------------------------------------------------------------

  private handleStateChange(state: number): void {
    if (state === YT.PlayerState.ENDED) {
      this.onState?.({ paused: true, ended: true });
    } else if (state === YT.PlayerState.PLAYING) {
      this.onState?.({ paused: false, ended: false });
      this.startPolling();
    } else if (state === YT.PlayerState.PAUSED) {
      this.onState?.({ paused: true, ended: false });
    }
  }

  /** Inicia o polling de tempo (o YouTube não emite "timeupdate"). */
  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = window.setInterval(() => {
      if (!this.player) return;
      const pos = this.player.getCurrentTime?.() ?? 0;
      const dur = this.player.getDuration?.() ?? 0;
      this.onTime?.(pos, dur);
    }, 250);
  }

  /** Para o player e o polling — usado ao sair do modo YouTube. */
  stop(): void {
    this.player?.stopVideo();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = 0;
    }
  }
}

// =============================================================================
// Funções auxiliares
// =============================================================================

/** Promise singleton para carregar a IFrame Player API uma única vez. */
let apiPromise: Promise<void> | null = null;

/** Injeta o script da IFrame API e aguarda o callback global do YouTube. */
function loadIframeApi(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve) => {
    if (window.YT?.Player) return resolve();
    window.onYouTubeIframeAPIReady = () => resolve();
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  });
  return apiPromise;
}

/** Decodifica entidades HTML que a Data API retorna nos títulos (ex: &amp;). */
function decodeEntities(s: string): string {
  const el = document.createElement("textarea");
  el.innerHTML = s;
  return el.value;
}

// --- tipos da resposta da Data API (subconjunto usado) -----------------------

interface YouTubeThumbnail {
  url: string;
}
interface YouTubeSearchItem {
  id: { videoId?: string };
  snippet: {
    title: string;
    channelTitle: string;
    thumbnails: {
      default?: YouTubeThumbnail;
      medium?: YouTubeThumbnail;
      high?: YouTubeThumbnail;
    };
  };
}
interface YouTubeSearchResponse {
  items: YouTubeSearchItem[];
}
