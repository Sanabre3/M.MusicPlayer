// =============================================================================
// media-session.ts — Integração com os controles de mídia do sistema operacional
//
// A MediaSession API expõe o player para:
//   - Teclas de mídia do teclado (play/pause/next/previous)
//   - Tela de bloqueio do dispositivo (Android, iOS, Windows)
//   - Notificações do navegador com controles de transporte
//
// É silenciosa em navegadores que não suportam a API — nenhum erro é lançado.
// =============================================================================

import type { Track } from "./types";

/** Ações que o controlador de mídia do SO pode acionar no player. */
interface MediaActions {
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
}

export class MediaSessionBridge {
  private readonly supported = "mediaSession" in navigator;

  constructor(actions: MediaActions) {
    if (!this.supported) return;

    const ms = navigator.mediaSession;

    /**
     * Registra um handler de ação com proteção contra navegadores que
     * declaram a API mas não suportam todas as ações (ex: iOS Safari antigo).
     */
    const bind = (
      action: MediaSessionAction,
      handler: ((d: MediaSessionActionDetails) => void) | (() => void),
    ) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // ação não suportada neste navegador — ignora silenciosamente
      }
    };

    bind("play", actions.play);
    bind("pause", actions.pause);
    bind("previoustrack", actions.previous);
    bind("nexttrack", actions.next);

    // Seek absoluto — ex: clique na barra de progresso da notificação.
    bind("seekto", (d: MediaSessionActionDetails) => {
      if (typeof d.seekTime === "number") actions.seek(d.seekTime);
    });

    // Seek relativo — botões ±10s na tela de bloqueio.
    bind("seekbackward", () => actions.seek(Math.max(0, this.position - 10)));
    bind("seekforward", () => actions.seek(this.position + 10));
  }

  /** Posição atual em segundos — mantida sincronizada para os seeks relativos. */
  private position = 0;

  /** Atualiza os metadados exibidos na tela de bloqueio e notificações. */
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

  /** Sinaliza ao SO se o player está tocando ou pausado. */
  setPlaybackState(playing: boolean): void {
    if (!this.supported) return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }

  /**
   * Atualiza a barra de progresso exibida pela interface do SO.
   * Ignora durações inválidas para não causar erros no navegador.
   */
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
      // valores de estado inválidos (ex: position > duration por race condition)
    }
  }
}
