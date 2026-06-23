// =============================================================================
// main.ts — Controlador principal: orquestra UI, estado e módulos
//
// Responsabilidades:
//   - Manter o estado global (fila, índice, modo, shuffle, repeat)
//   - Conectar eventos do AudioEngine às atualizações de UI
//   - Coordenar mudança de faixa, tematização e MediaSession
//   - Gerenciar integração com Spotify (estado, autenticação, playback)
//   - Lidar com carregamento de arquivos locais e drag-and-drop
// =============================================================================

import "./styles.css";
import type { RepeatMode, Track } from "./types";
import { defaultTracks } from "./playlist";
import { AudioEngine } from "./audio-engine";
import { Visualizer } from "./visualizer";
import { MediaSessionBridge } from "./media-session";
import { extractPalette } from "./color";
import { SpotifyController } from "./spotify";

// =============================================================================
// Referências aos elementos da interface
// =============================================================================

/** Atalho tipado para document.getElementById — lança erro se o elemento faltar. */
const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento ausente no DOM: #${id}`);
  return node as T;
};

const ui = {
  backdrop:      $("backdrop"),                        // fundo desfocado com a capa
  label:         $("label"),                           // rótulo central do vinil
  vinyl:         $("vinyl"),                           // disco girante
  tonearm:       $("tonearm"),                         // braço da agulha
  sourceTag:     $("sourceTag"),                       // indicador Local/Spotify
  title:         $("title"),                           // nome da faixa
  artist:        $("artist"),                          // nome do artista
  elapsed:       $("elapsed"),                         // tempo decorrido
  remaining:     $("remaining"),                       // tempo restante
  track:         $("track"),                           // trilha do scrubber
  fill:          $("fill"),                            // preenchimento do scrubber
  head:          $("head"),                            // bolinha arrastável do scrubber
  shuffle:       $<HTMLButtonElement>("shuffle"),
  prev:          $<HTMLButtonElement>("prev"),
  play:          $<HTMLButtonElement>("play"),
  next:          $<HTMLButtonElement>("next"),
  repeat:        $<HTMLButtonElement>("repeat"),
  volume:        $<HTMLInputElement>("volume"),
  crate:         $("crate"),                           // gaveta lateral da fila
  crateBtn:      $<HTMLButtonElement>("crateBtn"),     // botão que abre a gaveta
  crateList:     $<HTMLOListElement>("crateList"),     // lista de faixas na gaveta
  dropzone:      $("dropzone"),                        // overlay de drag-and-drop
  loadBtn:       $<HTMLButtonElement>("loadBtn"),      // botão "Load track"
  fileInput:     $<HTMLInputElement>("fileInput"),     // input de arquivo oculto
  spotifyBtn:    $<HTMLButtonElement>("spotifyBtn"),
  spotifyDialog: $<HTMLDialogElement>("spotifyDialog"),
  clientIdInput: $<HTMLInputElement>("clientIdInput"),
  viz:           $<HTMLCanvasElement>("viz"),          // canvas do visualizador
};

// =============================================================================
// Estado global
// =============================================================================

const engine  = new AudioEngine();
const spotify = new SpotifyController();

let tracks: Track[]           = [...defaultTracks]; // fila de reprodução
let index   = 0;                                    // índice da faixa atual
let shuffle = false;
let repeat: RepeatMode        = "off";
let mode: "local" | "spotify" = "local";
let dragDepth = 0;                                  // contador para dragenter/dragleave aninhados

/** Retorna a faixa atualmente selecionada. */
const current = (): Track => tracks[index]!;

// =============================================================================
// Visualizador de espectro
// =============================================================================

const visualizer = new Visualizer(
  ui.viz,
  () => engine.spectrum(),                           // lê frequências do AudioEngine
  () => mode === "local" && engine.playing,          // ativo apenas no modo local
);

// Propaga o nível de graves como variável CSS para o efeito de "respiro" do fundo.
visualizer.onBass = (level) => {
  document.documentElement.style.setProperty("--bass", level.toFixed(3));
};
visualizer.start();

// =============================================================================
// Controles de mídia do SO (MediaSession API)
// =============================================================================

const media = new MediaSessionBridge({
  play:     () => void play(),
  pause:    () => pause(),
  next:     () => next(),
  previous: () => previous(),
  seek:     (s) => engine.seek(s),
});

// =============================================================================
// Formatação de tempo
// =============================================================================

/** Converte segundos para o formato m:ss (ex: 3:07). */
function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// =============================================================================
// Tematização dinâmica por faixa
// =============================================================================

/**
 * Aplica a capa da faixa ao fundo e ao rótulo do vinil, depois extrai
 * a paleta de cores e atualiza as variáveis CSS --accent e --shade.
 */
async function applyTheme(track: Track): Promise<void> {
  ui.backdrop.style.backgroundImage = track.cover ? `url("${track.cover}")` : "none";
  ui.label.style.backgroundImage    = track.cover ? `url("${track.cover}")` : "none";
  if (!track.cover) return;
  const palette = await extractPalette(track.cover);
  const root = document.documentElement.style;
  root.setProperty("--accent", palette.accent);
  root.setProperty("--shade",  palette.shade);
  visualizer.setAccent(palette.accent);
}

// =============================================================================
// Reprodução local (Web Audio)
// =============================================================================

/**
 * Carrega uma faixa pelo índice na fila.
 * @param next     Índice desejado (wraps automaticamente).
 * @param autoplay Se true, inicia a reprodução imediatamente após carregar.
 */
async function loadTrack(next: number, autoplay = false): Promise<void> {
  mode  = "local";
  index = (next + tracks.length) % tracks.length;
  const track = current();

  ui.title.textContent    = track.title;
  ui.artist.textContent   = track.artist;
  ui.sourceTag.textContent = `Local · ${track.album ?? "Sem álbum"}`;

  void applyTheme(track);  // assíncrono — não bloqueia a UI
  renderCrate();
  media.setMetadata(track);

  if (track.src) {
    engine.load(track.src);
    if (autoplay) await play();
  } else {
    // Slot placeholder sem áudio — pulsa o botão "Load track" como dica visual.
    engine.pause();
    setPlayIcon(false);
  }
}

async function play(): Promise<void> {
  if (mode === "spotify") {
    spotify.togglePlay();
    return;
  }
  if (!current().src) {
    flashLoad(); // nenhum áudio — chama atenção para o botão de carregamento
    return;
  }
  await engine.play();
}

function pause(): void {
  if (mode === "spotify") spotify.togglePlay();
  else engine.pause();
}

/**
 * Avança para a próxima faixa.
 * No modo "repeat one", reinicia a faixa atual.
 * No modo shuffle, escolhe uma posição aleatória na fila.
 */
function next(): void {
  if (mode === "spotify") return spotify.next();
  if (repeat === "one") {
    engine.seek(0);
    void engine.play();
    return;
  }
  const step = shuffle ? randomOffset() : 1;
  void loadTrack(index + step, true);
}

/**
 * Volta à faixa anterior.
 * Se já passaram mais de 3 segundos, reinicia a faixa atual (comportamento padrão).
 */
function previous(): void {
  if (mode === "spotify") return spotify.previous();
  if (engine.snapshot().position > 3) {
    engine.seek(0);
    return;
  }
  void loadTrack(index - 1, true);
}

/** Gera um deslocamento aleatório (≥1) para o modo shuffle. */
function randomOffset(): number {
  if (tracks.length <= 1) return 0;
  return 1 + Math.floor(Math.random() * (tracks.length - 1));
}

/** Atualiza o ícone play/pause, a animação do vinil e a tela de bloqueio. */
function setPlayIcon(playing: boolean): void {
  ui.play.textContent = playing ? "⏸" : "▶";
  ui.vinyl.classList.toggle("spinning", playing);
  ui.tonearm.classList.toggle("engaged", playing);
  media.setPlaybackState(playing);
}

// =============================================================================
// Eventos do motor de áudio
// =============================================================================

engine.on("play",  () => setPlayIcon(true));
engine.on("pause", () => setPlayIcon(false));

engine.on("ended", () => {
  // Se estiver no fim da fila sem loop ativo, para a reprodução.
  if (repeat === "off" && index === tracks.length - 1 && !shuffle) {
    setPlayIcon(false);
    return;
  }
  next();
});

engine.on("timeupdate", () => {
  if (mode !== "local") return; // Spotify gerencia seu próprio progresso
  const { position, duration } = engine.snapshot();
  renderProgress(position, duration);
  media.setPositionState(position, duration);
});

/** Atualiza o scrubber, os timecodes e o atributo ARIA de progresso. */
function renderProgress(position: number, duration: number): void {
  const pct = duration ? (position / duration) * 100 : 0;
  ui.fill.style.width  = `${pct}%`;
  ui.head.style.left   = `${pct}%`;
  ui.elapsed.textContent   = fmt(position);
  ui.remaining.textContent = duration ? `-${fmt(duration - position)}` : "0:00";
  ui.track.setAttribute("aria-valuenow", Math.round(pct).toString());
}

// =============================================================================
// Scrubber (seek por clique/arraste)
// =============================================================================

/** Calcula a fração clicada na barra e reposiciona o áudio. */
function seekFromPointer(clientX: number): void {
  const rect     = ui.track.getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  if (mode === "spotify") return; // Spotify não suporta seek pelo SDK neste ponto
  engine.seekFraction(fraction);
  renderProgress(fraction * engine.snapshot().duration, engine.snapshot().duration);
}

let scrubbing = false;

// Usa Pointer Events para suporte unificado a mouse e touch.
ui.track.addEventListener("pointerdown", (e) => {
  scrubbing = true;
  ui.track.setPointerCapture(e.pointerId); // mantém o drag mesmo saindo do elemento
  seekFromPointer(e.clientX);
});
ui.track.addEventListener("pointermove", (e) => {
  if (scrubbing) seekFromPointer(e.clientX);
});
ui.track.addEventListener("pointerup", () => (scrubbing = false));

// Suporte a teclado: setas ±5s quando o scrubber está em foco.
ui.track.addEventListener("keydown", (e) => {
  const { position, duration } = engine.snapshot();
  if (e.key === "ArrowRight") engine.seek(Math.min(position + 5, duration));
  if (e.key === "ArrowLeft")  engine.seek(Math.max(position - 5, 0));
});

// =============================================================================
// Botões de controle
// =============================================================================

ui.play.addEventListener("click", () => {
  if (mode === "spotify") return spotify.togglePlay();
  void engine.toggle().catch(() => flashLoad());
});
ui.next.addEventListener("click", next);
ui.prev.addEventListener("click", previous);

ui.shuffle.addEventListener("click", () => {
  shuffle = !shuffle;
  ui.shuffle.setAttribute("aria-pressed", String(shuffle));
});

ui.repeat.addEventListener("click", () => {
  repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
  ui.repeat.setAttribute("aria-pressed", String(repeat !== "off"));
  ui.repeat.textContent = repeat === "one" ? "↻¹" : "↻";
});

ui.volume.addEventListener("input", () => {
  const v = Number(ui.volume.value) / 100;
  engine.setVolume(v);
  spotify.setVolume(v);
});
engine.setVolume(Number(ui.volume.value) / 100);

// Atalhos de teclado globais (ignorados quando o foco está em inputs de texto).
document.addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement).tagName === "INPUT";
  if (typing) return;
  if (e.code === "Space") {
    e.preventDefault();
    ui.play.click();
  } else if (e.code === "ArrowRight" && e.shiftKey) next();
  else if (e.code === "ArrowLeft"  && e.shiftKey) previous();
});

// =============================================================================
// Gaveta (crate) — lista de faixas
// =============================================================================

/** Renderiza (ou re-renderiza) a lista de faixas na gaveta lateral. */
function renderCrate(): void {
  ui.crateList.replaceChildren(
    ...tracks.map((track, i) => {
      const li = document.createElement("li");
      li.className = "crate__item" + (i === index ? " is-current" : "");
      li.innerHTML = `
        <span class="crate__art" style="background-image:url('${track.cover}')"></span>
        <span class="crate__meta">
          <span class="crate__title">${escapeHtml(track.title)}</span>
          <span class="crate__artist">${escapeHtml(track.artist)}</span>
        </span>
        ${track.src ? '<span class="crate__eq" aria-hidden="true"><i></i><i></i><i></i></span>' : ""}`;
      li.addEventListener("click", () => void loadTrack(i, true));
      return li;
    }),
  );
}

/** Escapa caracteres HTML especiais para evitar XSS em nomes de arquivos. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

ui.crateBtn.addEventListener("click", () => {
  const open = ui.crate.classList.toggle("is-open");
  ui.crateBtn.setAttribute("aria-expanded", String(open));
});

// =============================================================================
// Carregamento de arquivos do dispositivo
// =============================================================================

ui.loadBtn.addEventListener("click", () => ui.fileInput.click());

ui.fileInput.addEventListener("change", () => {
  if (ui.fileInput.files) addFiles(ui.fileInput.files);
  ui.fileInput.value = ""; // reseta para permitir selecionar o mesmo arquivo novamente
});

/**
 * Adiciona arquivos de áudio à fila e inicia a reprodução do primeiro adicionado.
 * Cria Object URLs temporárias (ephemeral: true) para os arquivos locais.
 */
function addFiles(files: FileList): void {
  const incoming = Array.from(files).filter((f) => f.type.startsWith("audio/"));
  if (!incoming.length) return;

  const startAt = tracks.length; // índice da primeira faixa adicionada
  for (const file of incoming) {
    tracks.push({
      id:       `local-${crypto.randomUUID()}`,
      title:    file.name.replace(/\.[^.]+$/, ""), // remove a extensão do nome
      artist:   "Do seu dispositivo",
      album:    "Importados",
      cover:    current().cover, // usa a capa atual como placeholder
      src:      URL.createObjectURL(file),
      source:   "local",
      ephemeral: true,
    });
  }

  renderCrate();
  void loadTrack(startAt, true);
  // Abre a gaveta para o usuário ver as faixas adicionadas.
  ui.crate.classList.add("is-open");
  ui.crateBtn.setAttribute("aria-expanded", "true");
}

/** Pulsa o botão "Load track" quando o usuário tenta tocar um slot vazio. */
function flashLoad(): void {
  ui.loadBtn.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }],
    { duration: 420, easing: "ease-out" },
  );
}

// =============================================================================
// Drag-and-drop global
// =============================================================================

// dragDepth evita que o overlay pisque ao mover entre elementos filhos da janela.
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  ui.dropzone.classList.add("is-active");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", (e) => {
  e.preventDefault();
  if (--dragDepth <= 0) ui.dropzone.classList.remove("is-active");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  ui.dropzone.classList.remove("is-active");
  if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
});

// =============================================================================
// Integração com Spotify
// =============================================================================

/** Atualiza o texto e visual do botão conforme o estado de autenticação. */
async function refreshSpotifyButton(): Promise<void> {
  if (spotify.isAuthenticated) {
    ui.spotifyBtn.textContent = "Spotify · Conectado";
    ui.spotifyBtn.classList.add("is-live");
    await spotify.connectPlayer(); // registra este browser como dispositivo Spotify Connect
  } else {
    ui.spotifyBtn.textContent = "Conectar Spotify";
    ui.spotifyBtn.classList.remove("is-live");
  }
}

/** Recebe atualizações de estado do Spotify SDK e sincroniza a interface. */
spotify.onState = (state) => {
  if (!state) return;
  mode = "spotify";
  ui.title.textContent     = state.title;
  ui.artist.textContent    = state.artist;
  ui.sourceTag.textContent = "Spotify · Premium";

  if (state.cover) {
    ui.backdrop.style.backgroundImage = `url("${state.cover}")`;
    ui.label.style.backgroundImage    = `url("${state.cover}")`;
    void extractPalette(state.cover).then((p) => {
      document.documentElement.style.setProperty("--accent", p.accent);
      document.documentElement.style.setProperty("--shade",  p.shade);
      visualizer.setAccent(p.accent);
    });
  }

  setPlayIcon(!state.paused);
  // Spotify usa milissegundos; a interface usa segundos.
  renderProgress(state.position / 1000, state.duration / 1000);
};

/** Quando o dispositivo Spotify estiver pronto, transfere a reprodução ativa. */
spotify.onReady = () => {
  void spotify.transferAndPlay();
};

ui.spotifyBtn.addEventListener("click", () => {
  if (spotify.isAuthenticated) {
    // Clique quando já conectado = desconectar e voltar ao modo local.
    spotify.logout();
    mode = "local";
    void refreshSpotifyButton();
    void loadTrack(index);
    return;
  }
  ui.clientIdInput.value = spotify.clientId;
  ui.spotifyDialog.showModal();
});

ui.spotifyDialog.addEventListener("close", () => {
  if (ui.spotifyDialog.returnValue !== "default") return; // cancelado
  const id = ui.clientIdInput.value.trim();
  if (!id) return;
  spotify.clientId = id;
  void spotify.login(); // inicia o redirect PKCE
});

// =============================================================================
// Inicialização
// =============================================================================

async function boot(): Promise<void> {
  await loadTrack(0); // carrega a primeira faixa (sem autoplay — aguarda gesto do usuário)
  try {
    await spotify.init(); // tenta restaurar sessão Spotify salva ou concluir redirect
  } catch (err) {
    console.warn("Inicialização do Spotify ignorada:", err);
  }
  await refreshSpotifyButton();
}

void boot();
