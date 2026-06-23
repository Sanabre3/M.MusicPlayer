import "./styles.css";
import type { RepeatMode, Track } from "./types";
import { defaultTracks } from "./playlist";
import { AudioEngine } from "./audio-engine";
import { Visualizer } from "./visualizer";
import { MediaSessionBridge } from "./media-session";
import { extractPalette } from "./color";
import { SpotifyController } from "./spotify";

// --- element lookup --------------------------------------------------------
const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
};

const ui = {
  backdrop: $("backdrop"),
  label: $("label"),
  vinyl: $("vinyl"),
  tonearm: $("tonearm"),
  sourceTag: $("sourceTag"),
  title: $("title"),
  artist: $("artist"),
  elapsed: $("elapsed"),
  remaining: $("remaining"),
  track: $("track"),
  fill: $("fill"),
  head: $("head"),
  shuffle: $<HTMLButtonElement>("shuffle"),
  prev: $<HTMLButtonElement>("prev"),
  play: $<HTMLButtonElement>("play"),
  next: $<HTMLButtonElement>("next"),
  repeat: $<HTMLButtonElement>("repeat"),
  volume: $<HTMLInputElement>("volume"),
  crate: $("crate"),
  crateBtn: $<HTMLButtonElement>("crateBtn"),
  crateList: $<HTMLOListElement>("crateList"),
  dropzone: $("dropzone"),
  loadBtn: $<HTMLButtonElement>("loadBtn"),
  fileInput: $<HTMLInputElement>("fileInput"),
  spotifyBtn: $<HTMLButtonElement>("spotifyBtn"),
  spotifyDialog: $<HTMLDialogElement>("spotifyDialog"),
  clientIdInput: $<HTMLInputElement>("clientIdInput"),
  viz: $<HTMLCanvasElement>("viz"),
};

// --- state -----------------------------------------------------------------
const engine = new AudioEngine();
const spotify = new SpotifyController();
let tracks: Track[] = [...defaultTracks];
let index = 0;
let shuffle = false;
let repeat: RepeatMode = "off";
let mode: "local" | "spotify" = "local";
let dragDepth = 0;

const current = (): Track => tracks[index]!;

// --- visualizer ------------------------------------------------------------
const visualizer = new Visualizer(
  ui.viz,
  () => engine.spectrum(),
  () => mode === "local" && engine.playing,
);
visualizer.onBass = (level) => {
  document.documentElement.style.setProperty("--bass", level.toFixed(3));
};
visualizer.start();

// --- media session (OS controls) ------------------------------------------
const media = new MediaSessionBridge({
  play: () => void play(),
  pause: () => pause(),
  next: () => next(),
  previous: () => previous(),
  seek: (s) => engine.seek(s),
});

// --- formatting ------------------------------------------------------------
function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// --- theming ---------------------------------------------------------------
async function applyTheme(track: Track): Promise<void> {
  ui.backdrop.style.backgroundImage = track.cover ? `url("${track.cover}")` : "none";
  ui.label.style.backgroundImage = track.cover ? `url("${track.cover}")` : "none";
  if (!track.cover) return;
  const palette = await extractPalette(track.cover);
  const root = document.documentElement.style;
  root.setProperty("--accent", palette.accent);
  root.setProperty("--shade", palette.shade);
  visualizer.setAccent(palette.accent);
}

// --- core playback (local) -------------------------------------------------
async function loadTrack(next: number, autoplay = false): Promise<void> {
  mode = "local";
  index = (next + tracks.length) % tracks.length;
  const track = current();

  ui.title.textContent = track.title;
  ui.artist.textContent = track.artist;
  ui.sourceTag.textContent = `Local · ${track.album ?? "Unsorted"}`;
  void applyTheme(track);
  renderCrate();
  media.setMetadata(track);

  if (track.src) {
    engine.load(track.src);
    if (autoplay) await play();
  } else {
    // Placeholder slot — nudge the listener to drop a file.
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
    flashLoad();
    return;
  }
  await engine.play();
}

function pause(): void {
  if (mode === "spotify") spotify.togglePlay();
  else engine.pause();
}

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

function previous(): void {
  if (mode === "spotify") return spotify.previous();
  if (engine.snapshot().position > 3) {
    engine.seek(0);
    return;
  }
  void loadTrack(index - 1, true);
}

function randomOffset(): number {
  if (tracks.length <= 1) return 0;
  return 1 + Math.floor(Math.random() * (tracks.length - 1));
}

function setPlayIcon(playing: boolean): void {
  ui.play.textContent = playing ? "⏸" : "▶";
  ui.vinyl.classList.toggle("spinning", playing);
  ui.tonearm.classList.toggle("engaged", playing);
  media.setPlaybackState(playing);
}

// --- engine events ---------------------------------------------------------
engine.on("play", () => setPlayIcon(true));
engine.on("pause", () => setPlayIcon(false));
engine.on("ended", () => {
  if (repeat === "off" && index === tracks.length - 1 && !shuffle) {
    setPlayIcon(false);
    return;
  }
  next();
});
engine.on("timeupdate", () => {
  if (mode !== "local") return;
  const { position, duration } = engine.snapshot();
  renderProgress(position, duration);
  media.setPositionState(position, duration);
});

function renderProgress(position: number, duration: number): void {
  const pct = duration ? (position / duration) * 100 : 0;
  ui.fill.style.width = `${pct}%`;
  ui.head.style.left = `${pct}%`;
  ui.elapsed.textContent = fmt(position);
  ui.remaining.textContent = duration ? `-${fmt(duration - position)}` : "0:00";
  ui.track.setAttribute("aria-valuenow", Math.round(pct).toString());
}

// --- seeking ---------------------------------------------------------------
function seekFromPointer(clientX: number): void {
  const rect = ui.track.getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  if (mode === "spotify") return; // spotify seek handled by its own state
  engine.seekFraction(fraction);
  renderProgress(fraction * engine.snapshot().duration, engine.snapshot().duration);
}

let scrubbing = false;
ui.track.addEventListener("pointerdown", (e) => {
  scrubbing = true;
  ui.track.setPointerCapture(e.pointerId);
  seekFromPointer(e.clientX);
});
ui.track.addEventListener("pointermove", (e) => {
  if (scrubbing) seekFromPointer(e.clientX);
});
ui.track.addEventListener("pointerup", () => (scrubbing = false));
ui.track.addEventListener("keydown", (e) => {
  const { position, duration } = engine.snapshot();
  if (e.key === "ArrowRight") engine.seek(Math.min(position + 5, duration));
  if (e.key === "ArrowLeft") engine.seek(Math.max(position - 5, 0));
});

// --- controls --------------------------------------------------------------
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

document.addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement).tagName === "INPUT";
  if (typing) return;
  if (e.code === "Space") {
    e.preventDefault();
    ui.play.click();
  } else if (e.code === "ArrowRight" && e.shiftKey) next();
  else if (e.code === "ArrowLeft" && e.shiftKey) previous();
});

// --- crate (playlist) ------------------------------------------------------
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

ui.crateBtn.addEventListener("click", () => {
  const open = ui.crate.classList.toggle("is-open");
  ui.crateBtn.setAttribute("aria-expanded", String(open));
});

// --- load files from the device --------------------------------------------
ui.loadBtn.addEventListener("click", () => ui.fileInput.click());
ui.fileInput.addEventListener("change", () => {
  if (ui.fileInput.files) addFiles(ui.fileInput.files);
  ui.fileInput.value = "";
});

function addFiles(files: FileList): void {
  const incoming = Array.from(files).filter((f) => f.type.startsWith("audio/"));
  if (!incoming.length) return;
  const startAt = tracks.length;
  for (const file of incoming) {
    tracks.push({
      id: `local-${crypto.randomUUID()}`,
      title: file.name.replace(/\.[^.]+$/, ""),
      artist: "From your device",
      album: "Imports",
      cover: current().cover,
      src: URL.createObjectURL(file),
      source: "local",
      ephemeral: true,
    });
  }
  renderCrate();
  void loadTrack(startAt, true);
  ui.crate.classList.add("is-open");
  ui.crateBtn.setAttribute("aria-expanded", "true");
}

function flashLoad(): void {
  ui.loadBtn.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }],
    { duration: 420, easing: "ease-out" },
  );
}

// --- drag and drop ---------------------------------------------------------
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

// --- spotify wiring --------------------------------------------------------
async function refreshSpotifyButton(): Promise<void> {
  if (spotify.isAuthenticated) {
    ui.spotifyBtn.textContent = "Spotify · Connected";
    ui.spotifyBtn.classList.add("is-live");
    await spotify.connectPlayer();
  } else {
    ui.spotifyBtn.textContent = "Connect Spotify";
    ui.spotifyBtn.classList.remove("is-live");
  }
}

spotify.onState = (state) => {
  if (!state) return;
  mode = "spotify";
  ui.title.textContent = state.title;
  ui.artist.textContent = state.artist;
  ui.sourceTag.textContent = "Spotify · Premium";
  if (state.cover) {
    ui.backdrop.style.backgroundImage = `url("${state.cover}")`;
    ui.label.style.backgroundImage = `url("${state.cover}")`;
    void extractPalette(state.cover).then((p) => {
      document.documentElement.style.setProperty("--accent", p.accent);
      document.documentElement.style.setProperty("--shade", p.shade);
      visualizer.setAccent(p.accent);
    });
  }
  setPlayIcon(!state.paused);
  renderProgress(state.position / 1000, state.duration / 1000);
};

spotify.onReady = () => {
  void spotify.transferAndPlay();
};

ui.spotifyBtn.addEventListener("click", () => {
  if (spotify.isAuthenticated) {
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
  if (ui.spotifyDialog.returnValue !== "default") return;
  const id = ui.clientIdInput.value.trim();
  if (!id) return;
  spotify.clientId = id;
  void spotify.login();
});

// --- boot ------------------------------------------------------------------
async function boot(): Promise<void> {
  await loadTrack(0);
  try {
    await spotify.init();
  } catch (err) {
    console.warn("Spotify init skipped:", err);
  }
  await refreshSpotifyButton();
}

void boot();
