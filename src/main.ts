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
import { FrequencyIdentifier } from "./frequency-identifier";
import type { FreqReading } from "./frequency-identifier";
import { MediaSessionBridge } from "./media-session";
import { extractPalette } from "./color";
import { SpotifyController } from "./spotify";
import { YouTubeController } from "./youtube";
import type { YouTubeResult } from "./youtube";
import type { SpotifyAlbum } from "./spotify";
import { Metronome, TempoEstimator } from "./metronome";
import { Zone } from "./zone";
import { Onboarding } from "./onboarding";
import { EQ_FREQUENCIES, EQ_LABELS, EQ_PRESETS } from "./equalizer";
import { THEMES, applyTheme as applyThemePreset, savedThemeId, themeById } from "./themes";

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
  crateClose:    $<HTMLButtonElement>("crateClose"),   // botão que fecha a gaveta
  crateList:     $<HTMLOListElement>("crateList"),     // lista de faixas na gaveta
  dropzone:      $("dropzone"),                        // overlay de drag-and-drop
  loadBtn:       $<HTMLButtonElement>("loadBtn"),      // botão "Load track"
  fileInput:     $<HTMLInputElement>("fileInput"),     // input de arquivo oculto
  spotifyBtn:    $<HTMLButtonElement>("spotifyBtn"),
  spotifyDialog: $<HTMLDialogElement>("spotifyDialog"),
  clientIdInput: $<HTMLInputElement>("clientIdInput"),
  viz:           $<HTMLCanvasElement>("viz"),          // canvas do visualizador
  chromaRing:    $("chromaRing"),                      // anel de 12 classes de altura
  freqReadout:   $("freqReadout"),                     // leitura de tom/nota
  freqKey:       $("freqKey"),                          // tonalidade estimada
  freqNote:      $("freqNote"),                         // nota dominante + Hz

  // --- Equalizador (estilo FxSound) ---
  eqBtn:         $<HTMLButtonElement>("eqBtn"),
  eqPanel:       $("eqPanel"),
  eqClose:       $<HTMLButtonElement>("eqClose"),
  eqEnabled:     $<HTMLInputElement>("eqEnabled"),
  eqPreset:      $<HTMLSelectElement>("eqPreset"),
  eqBands:       $("eqBands"),
  eqBass:        $<HTMLInputElement>("eqBass"),
  eqAmbience:    $<HTMLInputElement>("eqAmbience"),
  eqDynamic:     $<HTMLInputElement>("eqDynamic"),
  audioOutputRow:$("audioOutputRow"),
  audioOutput:   $<HTMLSelectElement>("audioOutput"),
  audioOutputBtn:$<HTMLButtonElement>("audioOutputBtn"),
  audioOutputLabel: $("audioOutputLabel"),

  // --- Temas lo-fi ---
  themeBtn:      $<HTMLButtonElement>("themeBtn"),
  themeBg:       $("themeBg"),
  themeDialog:   $<HTMLDialogElement>("themeDialog"),
  themeGrid:     $("themeGrid"),

  // --- Zone / Onboarding ---
  zoneBtn:       $<HTMLButtonElement>("zoneBtn"),
  chooserBtn:    $<HTMLButtonElement>("chooserBtn"),

  // --- Álbuns do Spotify ---
  spotifyAlbumsDialog: $<HTMLDialogElement>("spotifyAlbumsDialog"),
  albumSearchForm:     $<HTMLFormElement>("albumSearchForm"),
  albumQuery:          $<HTMLInputElement>("albumQuery"),
  albumStatus:         $("albumStatus"),
  albumResults:        $("albumResults"),
  spotifyDisconnect:   $<HTMLButtonElement>("spotifyDisconnect"),
  albumCloseBtn:       $<HTMLButtonElement>("albumCloseBtn"),

  youtubeBtn:    $<HTMLButtonElement>("youtubeBtn"),
  youtubeDialog: $<HTMLDialogElement>("youtubeDialog"),
  ytApiKey:      $<HTMLInputElement>("ytApiKey"),
  ytKeyBox:      $<HTMLDetailsElement>("ytKeyBox"),
  ytSearchForm:  $<HTMLFormElement>("ytSearchForm"),
  ytQuery:       $<HTMLInputElement>("ytQuery"),
  ytStatus:      $("ytStatus"),
  ytResults:     $<HTMLOListElement>("ytResults"),
  ytCloseBtn:    $<HTMLButtonElement>("ytCloseBtn"),
  videoToggle:   $<HTMLButtonElement>("videoToggle"),
};

// =============================================================================
// Estado global
// =============================================================================

const engine  = new AudioEngine();
const spotify = new SpotifyController();
const youtube = new YouTubeController();

type Mode = "local" | "spotify" | "youtube";

let tracks: Track[]    = [...defaultTracks]; // fila de reprodução
let index   = 0;                             // índice da faixa atual
let shuffle = false;
let repeat: RepeatMode = "off";
let mode: Mode         = "local";
let dragDepth = 0;                           // contador para dragenter/dragleave aninhados
let themeIsAuto = true;                      // true → cores extraídas da capa de cada faixa
let ytDuration = 0;                          // duração do vídeo YouTube atual (segundos)

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

// Estimador de andamento — alimentado pelo nível de graves a ~60fps.
const tempoEstimator = new TempoEstimator();

// Propaga o nível de graves como variável CSS para o efeito de "respiro" do fundo.
visualizer.onBass = (level) => {
  document.documentElement.style.setProperty("--bass", level.toFixed(3));
  if (mode === "local" && engine.playing) tempoEstimator.push(level);
};
visualizer.start();

// =============================================================================
// Identificador de frequência — tom/escala + nota + nível, reativo ao áudio
// =============================================================================

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const identifier = new FrequencyIdentifier(
  () => engine.pitchSpectrum(),
  () => engine.sampleRate,
  () => engine.pitchFftSize,
  () => mode === "local" && engine.playing, // só analisa áudio local
);

// Metrônomo + aba Zone (modo para músicos).
const metronome = new Metronome();
const zone = new Zone({
  metronome,
  onTranspose: (semitones) => engine.setTranspose(semitones),
  getAutoBpm: () => tempoEstimator.estimate(),
});

// Tela inicial de escolha de modo (apenas escutar × estudar). Reaberta pelo
// botão "Modo" na topbar.
const onboarding = new Onboarding({
  onListen: () => {},
  onStudy: () => zone.open(),
});

/** Cria os 12 rótulos de classe de altura distribuídos em círculo ao redor do vinil. */
function buildChromaRing(): void {
  const radius = 46; // % do raio da viz-wrap — logo além das barras do espectro
  ui.chromaRing.replaceChildren(
    ...NOTE_NAMES.map((name, i) => {
      const span = document.createElement("span");
      span.className = "chroma-ring__note";
      span.dataset.pc = String(i);
      span.textContent = name;
      // Começa no topo (−90°) e gira no sentido horário.
      const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
      span.style.left = `${50 + radius * Math.cos(angle)}%`;
      span.style.top = `${50 + radius * Math.sin(angle)}%`;
      return span;
    }),
  );
  chromaEls = Array.from(
    ui.chromaRing.querySelectorAll<HTMLSpanElement>(".chroma-ring__note"),
  );
}

let chromaEls: HTMLSpanElement[] = [];

// Atualiza o anel, a tonalidade e a nota a cada leitura do identificador.
identifier.onUpdate = (r: FreqReading) => {
  // Índice da classe de altura dominante (para destacar no anel).
  const dominantPc = r.active && r.note !== "—" ? NOTE_NAMES.indexOf(r.note.replace(/-?\d+$/, "")) : -1;

  chromaEls.forEach((el, i) => {
    const lit = r.chroma[i] ?? 0;
    el.style.setProperty("--lit", (0.25 + lit * 0.75).toFixed(3));
    el.classList.toggle("is-dominant", i === dominantPc);
  });

  ui.freqReadout.style.setProperty("--level", r.level.toFixed(3));
  ui.freqReadout.classList.toggle("is-idle", !r.active);

  // Alimenta a aba Zone com o acorde e o tom detectados.
  zone.setDetectedChord(r.active ? r.chord : null);
  if (r.active && r.confidence > 0.1) zone.setDetectedKey(r.keyTonic, r.keyMajor);

  // Só atualiza o texto quando há sinal — evita "piscar" no silêncio.
  if (r.active) {
    if (r.confidence > 0.1) ui.freqKey.textContent = r.key;
    ui.freqNote.textContent = r.note !== "—" ? `♪ ${r.note} · ${r.freq} Hz` : "♪ —";
  }
};
identifier.start();

// =============================================================================
// Controles de mídia do SO (MediaSession API)
// =============================================================================

const media = new MediaSessionBridge({
  play:     () => void play(),
  pause:    () => pause(),
  next:     () => next(),
  previous: () => previous(),
  seek:     (s) => {
    if (mode === "youtube") youtube.seek(s);
    else if (mode === "spotify") spotify.seek(s * 1000); // Spotify usa ms
    else engine.seek(s);
  },
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
  // Com um tema lo-fi fixo ativo, as cores vêm do tema — não da capa.
  if (!themeIsAuto || !track.cover) return;
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
  index = (next + tracks.length) % tracks.length;
  const track = current();

  ui.title.textContent  = track.title;
  ui.artist.textContent = track.artist;

  void applyTheme(track);  // assíncrono — não bloqueia a UI
  renderCrate();
  media.setMetadata(track);

  if (track.source === "youtube" && track.youtubeId) {
    await loadYouTubeTrack(track, autoplay);
    return;
  }

  // Faixa local — garante que o player do YouTube esteja parado.
  if (mode === "youtube") youtube.pause();
  mode = "local";
  setVideoMode(false);
  ui.videoToggle.hidden = true;
  ui.sourceTag.textContent = `Local · ${track.album ?? "Sem álbum"}`;

  if (track.src) {
    engine.load(track.src);
    if (autoplay) await play();
  } else {
    // Slot placeholder sem áudio — pulsa o botão "Load track" como dica visual.
    engine.pause();
    setPlayIcon(false);
  }
}

/** Carrega uma faixa do YouTube no player de iframe e ativa o modo "youtube". */
async function loadYouTubeTrack(track: Track, autoplay: boolean): Promise<void> {
  engine.pause(); // silencia qualquer áudio local em andamento
  mode = "youtube";
  ui.sourceTag.textContent = "YouTube";
  ui.videoToggle.hidden = false;
  try {
    await youtube.load(track.youtubeId!, autoplay);
  } catch (err) {
    console.warn("Falha ao carregar o vídeo do YouTube:", err);
  }
}

async function play(): Promise<void> {
  if (mode === "spotify") {
    spotify.togglePlay();
    return;
  }
  if (mode === "youtube") {
    youtube.play();
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
  else if (mode === "youtube") youtube.pause();
  else engine.pause();
}

/**
 * Avança para a próxima faixa.
 * No modo "repeat one", reinicia a faixa atual.
 * No modo shuffle, escolhe uma posição aleatória na fila.
 */
function next(): void {
  if (mode === "spotify") return spotify.next();
  if (repeat === "one" && mode === "local") {
    engine.seek(0);
    void engine.play();
    return;
  }
  if (repeat === "one" && mode === "youtube") {
    youtube.seek(0);
    youtube.play();
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
  if (mode === "youtube") {
    void loadTrack(index - 1, true);
    return;
  }
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

/** Ícones SVG de play/pause (trocados sem usar emoji). */
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5 L8 19 L19 12 Z"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

/** Atualiza o ícone play/pause, a animação do vinil e a tela de bloqueio. */
function setPlayIcon(playing: boolean): void {
  ui.play.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
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
  if (mode === "youtube") {
    youtube.seek(fraction * ytDuration);
    renderProgress(fraction * ytDuration, ytDuration);
    return;
  }
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
  if (mode === "youtube") return youtube.togglePlay();
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
  // Mantém o ícone SVG; marca "repetir uma faixa" com um "1" via classe.
  ui.repeat.classList.toggle("is-one", repeat === "one");
});

ui.volume.addEventListener("input", () => {
  const v = Number(ui.volume.value) / 100;
  engine.setVolume(v);
  spotify.setVolume(v);
  youtube.setVolume(v);
});
engine.setVolume(Number(ui.volume.value) / 100);

// Atalhos de teclado globais.
document.addEventListener("keydown", (e) => {
  // Teclas de função funcionam sempre, mesmo com foco em um campo de texto.
  if (e.key === "F7") { e.preventDefault(); previous();      return; }
  if (e.key === "F8") { e.preventDefault(); ui.play.click(); return; }
  if (e.key === "F9") { e.preventDefault(); next();          return; }

  // Os demais atalhos são ignorados enquanto o usuário digita em um input.
  const typing = (e.target as HTMLElement).tagName === "INPUT";
  if (typing) return;
  if (e.code === "Space") {
    e.preventDefault();
    ui.play.click();
  } else if (e.code === "ArrowRight" && e.shiftKey) next();
  else if (e.code === "ArrowLeft"  && e.shiftKey) previous();
  else if (e.key === "Escape") closeCrate();
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

/** Fecha a gaveta (botão ✕ e tecla Escape). */
function closeCrate(): void {
  ui.crate.classList.remove("is-open");
  ui.crateBtn.setAttribute("aria-expanded", "false");
}
ui.crateClose.addEventListener("click", closeCrate);

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
    // Com tema lo-fi fixo, mantém as cores do tema.
    if (themeIsAuto) {
      void extractPalette(state.cover).then((p) => {
        document.documentElement.style.setProperty("--accent", p.accent);
        document.documentElement.style.setProperty("--shade",  p.shade);
        visualizer.setAccent(p.accent);
      });
    }
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
    // Já conectado → abre a busca de álbuns.
    ui.albumStatus.textContent = "";
    ui.spotifyAlbumsDialog.showModal();
    return;
  }
  ui.clientIdInput.value = spotify.clientId;
  ui.spotifyDialog.showModal();
});

// --- Álbuns do Spotify -------------------------------------------------------

ui.albumCloseBtn.addEventListener("click", () => ui.spotifyAlbumsDialog.close());

ui.spotifyDisconnect.addEventListener("click", () => {
  spotify.logout();
  mode = "local";
  ui.spotifyAlbumsDialog.close();
  void refreshSpotifyButton();
  void loadTrack(index);
});

ui.albumSearchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  void runAlbumSearch();
});

/** Busca álbuns e renderiza os resultados no diálogo. */
async function runAlbumSearch(): Promise<void> {
  const query = ui.albumQuery.value.trim();
  if (!query) return;
  ui.albumStatus.textContent = "Buscando…";
  ui.albumResults.replaceChildren();
  try {
    const albums = await spotify.searchAlbums(query);
    ui.albumStatus.textContent = albums.length ? `${albums.length} álbuns` : "Nenhum álbum.";
    renderAlbumResults(albums);
  } catch (err) {
    ui.albumStatus.textContent = err instanceof Error ? err.message : "Falha na busca.";
    // Se a sessão caiu (token inválido), a busca limpou o login — reflete na UI
    // e oferece reconexão imediata.
    if (!spotify.isAuthenticated) {
      mode = "local";
      void refreshSpotifyButton();
      ui.spotifyAlbumsDialog.close();
      ui.clientIdInput.value = spotify.clientId;
      ui.spotifyDialog.showModal();
    }
  }
}

/** Renderiza os álbuns como um slider horizontal (carrossel) com setas. */
function renderAlbumResults(albums: SpotifyAlbum[]): void {
  if (!albums.length) {
    ui.albumResults.replaceChildren();
    return;
  }

  const slider = document.createElement("div");
  slider.className = "album-slider";

  const track = document.createElement("div");
  track.className = "album-slider__track";

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "album-slider__nav album-slider__nav--prev";
  prev.setAttribute("aria-label", "Álbuns anteriores");
  prev.textContent = "‹";

  const next = document.createElement("button");
  next.type = "button";
  next.className = "album-slider__nav album-slider__nav--next";
  next.setAttribute("aria-label", "Próximos álbuns");
  next.textContent = "›";

  for (const a of albums) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "album-card";
    card.innerHTML = `
      <span class="album-card__art" style="background-image:url('${a.cover}')"></span>
      <span class="album-card__name">${escapeHtml(a.name)}</span>
      <span class="album-card__artist">${escapeHtml(a.artist)}</span>`;
    card.addEventListener("click", () => {
      // Silencia as outras fontes antes de transferir para o Spotify.
      engine.pause();
      if (mode === "youtube") youtube.pause();
      mode = "spotify";
      void spotify.playAlbum(a.uri);
      ui.spotifyAlbumsDialog.close();
    });
    track.appendChild(card);
  }

  /** Quanto rolar por clique (uma "página" do track). */
  const page = () => Math.max(track.clientWidth * 0.85, 200);
  prev.addEventListener("click", () => track.scrollBy({ left: -page(), behavior: "smooth" }));
  next.addEventListener("click", () => track.scrollBy({ left: page(), behavior: "smooth" }));

  /** Desabilita as setas nas extremidades. */
  const updateNav = () => {
    const max = track.scrollWidth - track.clientWidth - 4;
    prev.disabled = track.scrollLeft <= 4;
    next.disabled = track.scrollLeft >= max;
    const overflow = track.scrollWidth > track.clientWidth + 4;
    slider.classList.toggle("has-overflow", overflow);
  };
  track.addEventListener("scroll", updateNav, { passive: true });
  window.addEventListener("resize", updateNav);

  slider.append(prev, track, next);
  ui.albumResults.replaceChildren(slider);
  requestAnimationFrame(updateNav);
}

// --- Aba Zone ----------------------------------------------------------------

ui.zoneBtn.addEventListener("click", () => zone.toggle());
ui.chooserBtn.addEventListener("click", () => onboarding.show());

ui.spotifyDialog.addEventListener("close", () => {
  if (ui.spotifyDialog.returnValue !== "default") return; // cancelado
  const id = ui.clientIdInput.value.trim();
  if (!id) return;
  spotify.clientId = id;
  void spotify.login(); // inicia o redirect PKCE
});

// =============================================================================
// Integração com YouTube (busca + player de iframe)
// =============================================================================

// Estado de reprodução do iframe → sincroniza o ícone e encadeia a próxima faixa.
youtube.onState = (state) => {
  if (mode !== "youtube") return;
  setPlayIcon(!state.paused);
  if (state.ended) {
    // Respeita o fim de fila igual ao motor local.
    if (repeat === "off" && index === tracks.length - 1 && !shuffle) {
      setPlayIcon(false);
      return;
    }
    next();
  }
};

// Polling de tempo do YouTube → barra de progresso + tela de bloqueio.
youtube.onTime = (position, duration) => {
  if (mode !== "youtube") return;
  ytDuration = duration;
  renderProgress(position, duration);
  media.setPositionState(position, duration);
};

/** Abre o diálogo do YouTube, pré-preenchendo a API key salva. */
ui.youtubeBtn.addEventListener("click", () => {
  ui.ytApiKey.value = youtube.apiKey;
  // Se ainda não há key, já deixa a seção de configuração aberta.
  ui.ytKeyBox.open = !youtube.isConfigured;
  ui.youtubeDialog.showModal();
});

ui.ytCloseBtn.addEventListener("click", () => ui.youtubeDialog.close());

// Salva a API key conforme o usuário digita.
ui.ytApiKey.addEventListener("change", () => {
  youtube.apiKey = ui.ytApiKey.value;
});

// Busca ao enviar o formulário.
ui.ytSearchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  void runYouTubeSearch();
});

/** Executa a busca e renderiza os resultados na lista do diálogo. */
async function runYouTubeSearch(): Promise<void> {
  const query = ui.ytQuery.value.trim();
  if (!query) return;
  if (!youtube.isConfigured) {
    ui.ytKeyBox.open = true;
    ui.ytStatus.textContent = "Configure a API key para buscar.";
    return;
  }
  ui.ytStatus.textContent = "Buscando…";
  ui.ytResults.replaceChildren();
  try {
    const results = await youtube.search(query);
    ui.ytStatus.textContent = results.length
      ? `${results.length} resultados`
      : "Nenhum resultado.";
    renderYouTubeResults(results);
  } catch (err) {
    ui.ytStatus.textContent =
      err instanceof Error ? err.message : "Falha na busca.";
  }
}

/** Renderiza cada resultado como um item clicável que adiciona à fila e toca. */
function renderYouTubeResults(results: YouTubeResult[]): void {
  ui.ytResults.replaceChildren(
    ...results.map((r) => {
      const li = document.createElement("li");
      li.className = "yt-result";
      li.innerHTML = `
        <img class="yt-result__thumb" src="${r.thumbnail}" alt="" loading="lazy" />
        <span class="yt-result__meta">
          <span class="yt-result__title">${escapeHtml(r.title)}</span>
          <span class="yt-result__channel">${escapeHtml(r.channel)}</span>
        </span>`;
      li.addEventListener("click", () => {
        addYouTubeTrack(r);
        ui.youtubeDialog.close();
      });
      return li;
    }),
  );
}

/** Adiciona um vídeo do YouTube à fila e inicia a reprodução. */
function addYouTubeTrack(r: YouTubeResult): void {
  tracks.push({
    id:        `yt-${r.id}`,
    title:     r.title,
    artist:    r.channel,
    album:     "YouTube",
    cover:     r.thumbnail,
    src:       "",
    source:    "youtube",
    youtubeId: r.id,
    ephemeral: true,
  });
  renderCrate();
  void loadTrack(tracks.length - 1, true);
}

/** Liga/desliga a exibição do vídeo ao fundo (o áudio toca em ambos os casos). */
function setVideoMode(on: boolean): void {
  document.body.classList.toggle("is-video", on);
  ui.videoToggle.setAttribute("aria-pressed", String(on));
  ui.videoToggle.textContent = on ? "▣ Ocultar vídeo" : "▣ Ver vídeo";
}

ui.videoToggle.addEventListener("click", () => {
  setVideoMode(!document.body.classList.contains("is-video"));
});

// =============================================================================
// Equalizador (estilo FxSound) — painel e controles
// =============================================================================

/** Constrói a faixa de 10 sliders verticais e o seletor de presets. */
function buildEqUI(): void {
  const settings = engine.equalizerSettings;

  // Preenche o seletor de presets.
  ui.eqPreset.replaceChildren(
    ...Object.keys(EQ_PRESETS).map((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      return opt;
    }),
    optionEl("Custom"),
  );
  ui.eqPreset.value = settings.preset;

  // Constrói as 10 bandas.
  ui.eqBands.replaceChildren(
    ...EQ_FREQUENCIES.map((_freq, i) => {
      const wrap = document.createElement("div");
      wrap.className = "eq-band";
      wrap.innerHTML = `
        <span class="eq-band__gain" data-i="${i}">${fmtGain(settings.bands[i] ?? 0)}</span>
        <input class="eq-band__slider" type="range" min="-12" max="12" step="0.5"
               value="${settings.bands[i] ?? 0}" data-i="${i}" orient="vertical"
               aria-label="${EQ_LABELS[i]} Hz" />
        <span class="eq-band__freq">${EQ_LABELS[i]}</span>`;
      const slider = wrap.querySelector<HTMLInputElement>(".eq-band__slider")!;
      const gainLabel = wrap.querySelector<HTMLSpanElement>(".eq-band__gain")!;
      slider.addEventListener("input", () => {
        const db = Number(slider.value);
        engine.setEqBand(i, db);
        gainLabel.textContent = fmtGain(db);
        ui.eqPreset.value = "Custom";
      });
      return wrap;
    }),
  );

  // Estado inicial dos efeitos.
  ui.eqEnabled.checked  = settings.enabled;
  ui.eqBass.value       = String(settings.bassBoost);
  ui.eqAmbience.value   = String(Math.round(settings.ambience * 100));
  ui.eqDynamic.checked  = settings.dynamic;
}

/** Atualiza os sliders das bandas a partir de um preset selecionado. */
function applyEqPreset(name: string): void {
  const preset = EQ_PRESETS[name];
  if (!preset) return;
  preset.forEach((db, i) => engine.setEqBand(i, db));
  // setEqBand marca como "Custom"; reafirma o nome real do preset.
  const s = engine.equalizerSettings;
  s.preset = name;
  engine.setEqualizer(s);
  // Sincroniza os sliders e rótulos visíveis.
  ui.eqBands.querySelectorAll<HTMLInputElement>(".eq-band__slider").forEach((slider) => {
    const i = Number(slider.dataset.i);
    slider.value = String(preset[i] ?? 0);
  });
  ui.eqBands.querySelectorAll<HTMLSpanElement>(".eq-band__gain").forEach((label) => {
    const i = Number(label.dataset.i);
    label.textContent = fmtGain(preset[i] ?? 0);
  });
  ui.eqPreset.value = name;
}

/** Formata um ganho em dB com sinal (ex: +3, −6, 0). */
function fmtGain(db: number): string {
  if (db === 0) return "0";
  return db > 0 ? `+${db}` : `${db}`.replace("-", "−");
}

/** Cria um <option> simples. */
function optionEl(value: string): HTMLOptionElement {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = value;
  return opt;
}

ui.eqBtn.addEventListener("click", () => {
  const open = ui.eqPanel.classList.toggle("is-open");
  ui.eqPanel.hidden = false;
  ui.eqBtn.setAttribute("aria-expanded", String(open));
  if (open) void refreshAudioOutputs(); // atualiza a lista de saídas ao abrir
});

// A API selectAudioOutput não está nos tipos padrão do TS.
type MediaDevicesWithSelect = MediaDevices & {
  selectAudioOutput?: () => Promise<MediaDeviceInfo>;
};

/** Prepara a UI de saída de áudio conforme o suporte do navegador. */
function refreshAudioOutputs(): void {
  const md = navigator.mediaDevices as MediaDevicesWithSelect | undefined;
  // Precisa de setSinkId (rotear o grafo) E de um seletor de dispositivo.
  const supported = engine.supportsOutputSelection && !!md?.selectAudioOutput;
  ui.audioOutputRow.hidden = false;
  ui.audioOutputBtn.hidden = !supported;
  if (!supported) {
    // Firefox e outros: a página não pode escolher a saída — instrui o usuário.
    ui.audioOutputLabel.textContent =
      "Seu navegador não permite escolher a saída pela página. Para usar o FxSound, defina-o como dispositivo de saída padrão do sistema — o áudio do navegador passará por ele.";
    ui.audioOutputLabel.classList.add("eq-output__note");
  }
}

// Abre o seletor nativo de dispositivos de saída (libera rótulos + permissão).
ui.audioOutputBtn.addEventListener("click", () => {
  const md = navigator.mediaDevices as MediaDevicesWithSelect;
  if (!md.selectAudioOutput) return;
  void md
    .selectAudioOutput()
    .then((device) => {
      void engine.setOutputDevice(device.deviceId);
      ui.audioOutputLabel.textContent = device.label || "Dispositivo selecionado";
    })
    .catch(() => {
      // Usuário cancelou o seletor — mantém a saída atual.
    });
});
ui.eqClose.addEventListener("click", () => {
  ui.eqPanel.classList.remove("is-open");
  ui.eqBtn.setAttribute("aria-expanded", "false");
});
ui.eqPreset.addEventListener("change", () => applyEqPreset(ui.eqPreset.value));
ui.eqEnabled.addEventListener("change", () => engine.setEqEnabled(ui.eqEnabled.checked));
ui.eqBass.addEventListener("input", () => engine.setBassBoost(Number(ui.eqBass.value)));
ui.eqAmbience.addEventListener("input", () =>
  engine.setAmbience(Number(ui.eqAmbience.value) / 100),
);
ui.eqDynamic.addEventListener("change", () => engine.setDynamic(ui.eqDynamic.checked));

// =============================================================================
// Temas lo-fi — seletor e aplicação
// =============================================================================

/** Aplica um tema pelo id e atualiza o flag de tematização automática. */
function selectTheme(id: string): void {
  const theme = themeById(id);
  themeIsAuto = applyThemePreset(theme, ui.themeBg);
  // Em modo Auto, reaplica as cores da faixa atual imediatamente.
  if (themeIsAuto) void applyTheme(current());
  // Marca o card ativo.
  ui.themeGrid.querySelectorAll(".theme-card").forEach((card) => {
    card.classList.toggle("is-active", (card as HTMLElement).dataset.id === id);
  });
}

/** Constrói a grade de cards de tema no diálogo. */
function buildThemeGrid(): void {
  ui.themeGrid.replaceChildren(
    ...THEMES.map((theme) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "theme-card";
      card.dataset.id = theme.id;
      const swatch = theme.auto
        ? "conic-gradient(from 0deg, #ff9e5e, #6c7bff, #ff5fb0, #ff9e5e)"
        : theme.background ?? "var(--ground)";
      card.innerHTML = `
        <span class="theme-card__swatch" style="background:${swatch}"></span>
        <span class="theme-card__name">${escapeHtml(theme.name)}</span>`;
      card.addEventListener("click", () => selectTheme(theme.id));
      return card;
    }),
  );
}

ui.themeBtn.addEventListener("click", () => ui.themeDialog.showModal());

// =============================================================================
// Inicialização
// =============================================================================

async function boot(): Promise<void> {
  buildEqUI();
  buildThemeGrid();
  buildChromaRing();

  // Restaura o tema salvo antes de carregar a faixa (afeta a tematização).
  const savedTheme = themeById(savedThemeId());
  themeIsAuto = applyThemePreset(savedTheme, ui.themeBg);
  ui.themeGrid.querySelectorAll(".theme-card").forEach((card) => {
    card.classList.toggle("is-active", (card as HTMLElement).dataset.id === savedTheme.id);
  });

  await loadTrack(0); // carrega a primeira faixa (sem autoplay — aguarda gesto do usuário)
  try {
    await spotify.init(); // tenta restaurar sessão Spotify salva ou concluir redirect
  } catch (err) {
    console.warn("Inicialização do Spotify ignorada:", err);
  }
  await refreshSpotifyButton();

  // Por último: tela de escolha de modo (só na 1ª visita).
  onboarding.maybeShow();
}

void boot();
