# 🎛️ Aurora Turntable

Player de música imersivo e reativo ao áudio, construído com **TypeScript** e a Web Audio API. O palco inteiro se re-tematiza a cada faixa com base nas cores da capa do álbum, um vinil real gira durante a reprodução e um espectro circular de frequências pulsa ao redor dele — alimentado pelo áudio decodificado de verdade, não por uma barra de progresso simulada.

> Reconstruído a partir do "Mini Music Player" original (vanilla JS). O código antigo está preservado no histórico do git.

---

## ✨ Destaques

- **Identidade de toca-discos** — vinil girante com sulcos, braço de agulha que desce ao dar play e arte do álbum como rótulo central.
- **Visualizador de áudio ao vivo** — espectro circular de frequências desenhado em canvas, lido diretamente de um `AnalyserNode` da Web Audio API.
- **Tematização dinâmica** — as cores de destaque e do fundo são extraídas no dispositivo a partir de cada capa, então cada faixa tem uma identidade visual própria.
- **TypeScript estrito** com bundler Vite — tipagem completa, build em ~250ms.

---

## 🔌 Integração com o áudio do dispositivo

Três integrações reais com a pilha de áudio do sistema operacional:

### 1. Web Audio API

```text
<audio> → MediaElementSource → GainNode → AnalyserNode → destino de saída
```

Reprodução real pelo roteamento de áudio do SO + dados de frequência ao vivo para o visualizador. Implementado em [src/audio-engine.ts](src/audio-engine.ts).

### 2. MediaSession API

Conecta o player aos controles de mídia do sistema:

- Teclas de mídia do teclado (play/pause/próxima/anterior)
- Tela de bloqueio (Android, iOS, Windows)
- Notificações do navegador com controles de transporte

Implementado em [src/media-session.ts](src/media-session.ts).

### 3. Carregar arquivos do dispositivo

- Botão **"Load track"** na barra superior
- **Drag-and-drop** de arquivos de áudio em qualquer parte da janela

Múltiplos arquivos são aceitos de uma vez e adicionados à fila automaticamente.

---

## 🎧 Spotify (opcional)

Conecte o Spotify para transmitir direto no browser. Usa **Authorization Code + PKCE** (sem client secret — seguro para front-ends estáticos) e o **Web Playback SDK** para transformar esta página em um dispositivo Spotify Connect. Implementado em [src/spotify.ts](src/spotify.ts).

### Como configurar

1. Crie um app no [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Adicione a URL exata desta página como **Redirect URI** (ex: `http://localhost:5173/`).
3. Clique em **"Conectar Spotify"** na interface, cole o **Client ID** e autorize.
4. A reprodução requer **Spotify Premium** — limitação do Web Playback SDK.

O Client ID é salvo no `localStorage`; nenhum dado é enviado a servidores que não sejam os próprios endpoints do Spotify.

---

## 🚀 Executar localmente

```bash
npm install
npm run dev      # servidor de desenvolvimento em http://localhost:5173
npm run build    # type-check + build de produção em dist/
npm run preview  # serve o build de produção localmente
```

---

## ⌨️ Atalhos de teclado

| Tecla              | Ação                        |
| ------------------ | --------------------------- |
| `Espaço`           | Play / Pause                |
| `Shift + →`        | Próxima faixa               |
| `Shift + ←`        | Faixa anterior              |
| `→` / `←`          | Avançar/voltar 5s (na barra)|

---

## 🗂️ Estrutura do projeto

```text
src/
├── main.ts           # controlador principal — orquestra UI, estado e módulos
├── audio-engine.ts   # motor Web Audio: HTMLAudio + grafo de nós + AnalyserNode
├── visualizer.ts     # espectro circular em canvas (requestAnimationFrame)
├── color.ts          # extração de paleta de cores a partir da capa (no dispositivo)
├── media-session.ts  # ponte com controles de mídia do SO (MediaSession API)
├── spotify.ts        # autenticação PKCE + Web Playback SDK
├── playlist.ts       # faixas padrão do repositório
├── types.ts          # tipos TypeScript compartilhados
└── styles.css        # sistema de design imersivo (variáveis CSS + animações)
```

---

## 🎨 Sistema de design

| Token         | Valor padrão | Papel                                      |
| ------------- | ------------ | ------------------------------------------ |
| `--ground`    | `#14101A`    | Fundo base (violeta noturno)               |
| `--text`      | `#F2EDE4`    | Texto principal (creme quente)             |
| `--accent`    | `#FF9E5E`    | Destaque animado — sobrescrito por faixa   |
| `--accent-2`  | `#6C7BFF`    | Periwinkle elétrico — gradiente do scrubber|
| `--shade`     | `#3A2A4A`    | Sombra do backdrop — sobrescrita por faixa |
| `--bass`      | `0`          | Nível de graves (0..1) — atualizado a 60fps|

**Tipografia:** Bricolage Grotesque (display) · Inter (corpo) · Space Mono (timecodes)

O player respeita `prefers-reduced-motion` — todas as animações são desativadas.

---

## 📦 Tecnologias

| Tecnologia            | Uso                                      |
| --------------------- | ---------------------------------------- |
| TypeScript 5 (strict) | Tipagem completa, zero `any` implícito   |
| Vite 6                | Bundler, HMR, resolução de assets        |
| Web Audio API         | Grafo de áudio + AnalyserNode            |
| Canvas 2D API         | Visualizador de espectro                 |
| MediaSession API      | Controles de mídia do SO                 |
| Spotify Web Playback  | Streaming via Spotify Connect            |
| CSS Custom Properties | Tematização dinâmica por faixa           |
