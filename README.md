# 🎛️ Aurora Turntable

An immersive, audio-reactive music player built with **TypeScript** and the Web
Audio API. The whole stage re-themes itself to each track's cover art, a real
vinyl record spins as it plays, and a live spectrum radiates around it — driven
by the actual decoded audio, not a faked progress bar.

> Rebuilt from the original vanilla-JS "Mini Music Player". The old simulated
> player is preserved in git history.

## ✨ Highlights

- **Turntable identity** — a real spinning vinyl with grooves, a moving tonearm,
  and the album art as the center label.
- **Live audio visualizer** — a circular frequency spectrum drawn on canvas from
  a Web Audio `AnalyserNode`. The backdrop "breathes" with the bass.
- **Dynamic theming** — the accent and backdrop colors are extracted on-device
  from each cover image, so every track feels different.
- **Built in strict TypeScript**, bundled with Vite.

## 🔌 Device audio integration

Three real integrations with the device's audio stack:

1. **Web Audio API** — `<audio>` → `MediaElementSource` → `Gain` → `Analyser` →
   output. Real playback plus live frequency data ([src/audio-engine.ts](src/audio-engine.ts)).
2. **MediaSession API** — OS-level controls: hardware/keyboard media keys, the
   lock screen, and notification controls all drive the player
   ([src/media-session.ts](src/media-session.ts)).
3. **Load your own files** — the **Load track** button or drag-and-drop anywhere
   adds local audio files to the crate and plays them.

## 🎧 Spotify (optional)

Connect Spotify to stream straight in the page. It uses the **Authorization Code
flow with PKCE** (no client secret) plus the **Web Playback SDK**
([src/spotify.ts](src/spotify.ts)).

Requirements:

1. Create an app at the
   [Spotify developer dashboard](https://developer.spotify.com/dashboard).
2. Add this page's exact URL (e.g. `http://localhost:5173/`) as a **Redirect URI**.
3. Click **Connect Spotify**, paste your **Client ID**, and authorize.
4. Playback requires **Spotify Premium** (an SDK limitation).

The client id is stored in `localStorage`; nothing is sent anywhere except
Spotify's own auth and API endpoints.

## 🚀 Run it

```bash
npm install
npm run dev      # start the dev server (opens http://localhost:5173)
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build
```

## ⌨️ Shortcuts

| Key              | Action            |
| ---------------- | ----------------- |
| `Space`          | Play / pause      |
| `Shift + ←` / `→`| Previous / next   |
| `←` / `→`        | Seek ±5s (on bar) |

## 🗂️ Structure

```
src/
├── main.ts          # controller — wires UI, state, and the modules below
├── audio-engine.ts  # HTMLAudio + Web Audio graph + analyser
├── visualizer.ts    # circular canvas spectrum
├── color.ts         # on-device palette extraction from cover art
├── media-session.ts # OS media controls bridge
├── spotify.ts       # PKCE auth + Web Playback SDK
├── playlist.ts      # default track data
├── types.ts         # shared types
└── styles.css       # immersive design system
```

## 🎨 Design

- **Palette**: deep violet-night ground `#14101A`, warm cream text `#F2EDE4`,
  amber accent `#FF9E5E` (overridden per-track from cover art), periwinkle
  counterpoint `#6C7BFF`.
- **Type**: Bricolage Grotesque (display) · Inter (body) · Space Mono (timecodes).
- Respects `prefers-reduced-motion`.
