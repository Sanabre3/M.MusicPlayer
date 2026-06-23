// =============================================================================
// playlist.ts — Faixas padrão exibidas ao abrir o player pela primeira vez
// =============================================================================

import type { Track } from "./types";

// O Vite resolve esses imports para URLs com hash no build de produção,
// garantindo que os assets sejam cacheados corretamente pelo navegador.
import track1 from "../assets/1.mp3";
import cover1 from "../assets/1.jpg";
import cover2 from "../assets/2.jpg";
import cover3 from "../assets/3.jpg";

// O repositório inclui apenas um arquivo de áudio real (1.mp3).
// As outras duas faixas são marcadores visuais que demonstram a re-tematização
// por capa, sem simular áudio inexistente.
// Para adicionar mais músicas: arraste arquivos para a janela ou use "Load track".
export const defaultTracks: Track[] = [
  {
    id: "house-of-wax",
    title: "House of Wax",
    artist: "The Groove Sessions",
    album: "Side A",
    cover: cover1,
    src: track1,      // único áudio real do repositório
    source: "local",
  },
  {
    id: "amber-static",
    title: "Amber Static",
    artist: "Solte um arquivo para reproduzir",
    album: "Side B",
    cover: cover2,
    src: "",           // sem áudio — usuário deve arrastar um arquivo
    source: "local",
  },
  {
    id: "periwinkle-drift",
    title: "Periwinkle Drift",
    artist: "Solte um arquivo para reproduzir",
    album: "Side B",
    cover: cover3,
    src: "",           // sem áudio — usuário deve arrastar um arquivo
    source: "local",
  },
];
