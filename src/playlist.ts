import type { Track } from "./types";

// Vite resolves these imports to hashed asset URLs at build time.
import track1 from "../assets/1.mp3";
import cover1 from "../assets/1.jpg";
import cover2 from "../assets/2.jpg";
import cover3 from "../assets/3.jpg";

// The repo ships a single real audio file. We surface it as the opening
// track and pair the two remaining covers as "load your own" placeholders
// so the playlist demonstrates re-theming without pretending audio exists
// where it doesn't. Drop in your own files (toolbar button or drag-and-drop)
// to fill the rest of the crate.
export const defaultTracks: Track[] = [
  {
    id: "house-of-wax",
    title: "House of Wax",
    artist: "The Groove Sessions",
    album: "Side A",
    cover: cover1,
    src: track1,
    source: "local",
  },
  {
    id: "amber-static",
    title: "Amber Static",
    artist: "Drop a file to play",
    album: "Side B",
    cover: cover2,
    src: "",
    source: "local",
  },
  {
    id: "periwinkle-drift",
    title: "Periwinkle Drift",
    artist: "Drop a file to play",
    album: "Side B",
    cover: cover3,
    src: "",
    source: "local",
  },
];
