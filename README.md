# 🎛️ Zone Player

Player de música imersivo e reativo ao áudio, construído com **TypeScript** e a Web Audio API. O palco inteiro se re-tematiza a cada faixa com base nas cores da capa do álbum, um vinil real gira durante a reprodução e um espectro circular de frequências pulsa ao redor dele — alimentado pelo áudio decodificado de verdade, não por uma barra de progresso simulada.

> Reconstruído a partir do "Mini Music Player" original (vanilla JS). O código antigo está preservado no histórico do git.

---

## ✨ Destaques

- **Tela inicial de escolha** — ao abrir, o site pergunta o que você quer fazer: **apenas escutar** (o player imersivo) ou **estudar como músico** (abre a Zone). A escolha é lembrada; o botão **✦ Modo** reabre a tela. Em [src/onboarding.ts](src/onboarding.ts).
- **Identidade de toca-discos** — vinil girante com sulcos, braço de agulha que desce ao dar play e arte do álbum como rótulo central.
- **Visualizador de áudio ao vivo** — espectro circular de frequências desenhado em canvas, lido diretamente de um `AnalyserNode` da Web Audio API.
- **Identificador de frequência automático** — anel de 12 classes de altura ao redor do vinil que acende conforme o áudio, com a **tonalidade estimada** (perfis de Krumhansl) e a **nota dominante** em tempo real, reativo ao volume. Implementado em [src/frequency-identifier.ts](src/frequency-identifier.ts).
- **Tematização dinâmica** — as cores de destaque e do fundo são extraídas no dispositivo a partir de cada capa, então cada faixa tem uma identidade visual própria.
- **Equalizador estilo FxSound** — EQ gráfico de 10 bandas + Bass Boost, Ambience (reverb) e Dynamic Boost, todos construídos sobre nós nativos da Web Audio API.
- **Temas lo-fi** — presets de fundo estético (Lo-Fi Dusk, Vaporwave, Midnight Study, Forest Tape, Sunset Cassette, Mono Noir) ou modo Auto que extrai as cores da capa.
- **YouTube** — busca por nome via Data API, miniatura no rótulo do vinil e vídeo ao fundo opcional.
- **Aba Zone (para músicos)** — acorde detectado ao vivo (ou cifra manual), diagramas completos de **violão, guitarra, ukulele, cavaquinho, baixo e teclado** (com **setas** para navegar as posições), groove de bateria, metrônomo (manual/tap/automático), **tablatura interativa com identificação de nota** e transposição de tom que afeta a cifra e o áudio local.
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

Quando conectado, o botão **Spotify** abre a busca de **álbuns**: pesquise por nome, clique e o álbum inteiro toca neste dispositivo. O botão **Desconectar** fica dentro desse diálogo.

---

## ▷ YouTube

Busca e reproduz vídeos do YouTube direto no player. Clique em **YouTube** na barra superior, pesquise por nome e escolha um resultado — ele entra na fila e toca. A miniatura aparece como rótulo do vinil; o botão **Ver vídeo** sob o deck revela o vídeo ocupando o fundo do palco (o áudio toca de qualquer forma). Implementado em [src/youtube.ts](src/youtube.ts).

### Como configurar a busca

1. Gere uma **YouTube Data API v3 key** no [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. No diálogo do YouTube, abra **Configurar API key** e cole a chave (salva apenas no `localStorage`).
3. Pesquise e clique em um resultado para tocar.

> A reprodução usa a **IFrame Player API** oficial. Como o áudio vem de um iframe cross-origin, o visualizador e o equalizador atuam apenas nas faixas locais — YouTube e Spotify usam o áudio próprio da plataforma.

---

## 🎛 Equalizador (estilo FxSound)

Abra o painel pelo botão **EQ**. Tudo é montado sobre nós nativos da Web Audio API, inseridos no grafo entre a fonte e o ganho:

- **EQ gráfico de 10 bandas** (31 Hz → 16 kHz) com filtros _peaking_, ±12 dB cada.
- **Presets** — Flat, Music, Bass Boost, Lo-Fi, Vocal, Treble, Podcast, Night.
- **Bass Boost** — realce de graves via filtro _lowshelf_.
- **Ambience** — reverb sintético (ConvolverNode com resposta ao impulso gerada no dispositivo).
- **Dynamic Boost** — compressor + ganho de _makeup_ para mais presença sem clipar.
- **Bypass** — o interruptor **Ativo** liga/desliga todo o processamento.
- **Saída de áudio** — seletor (`AudioContext.setSinkId`) que roteia a reprodução **local** para um dispositivo específico, como o do FxSound.

Implementado em [src/equalizer.ts](src/equalizer.ts) e ligado ao grafo em [src/audio-engine.ts](src/audio-engine.ts).

### Usar com o FxSound (ou outro processador do sistema)

O Web Playback SDK do Spotify **não** expõe equalizador, e nem ele nem o YouTube (iframe) permitem redirecionar a saída por elemento — ambos usam a saída padrão do SO. Então, para processar tudo com o FxSound:

1. Defina o dispositivo do **FxSound como saída padrão do Windows** → Spotify e YouTube já passam por ele.
2. No painel **EQ**, em **Saída de áudio**, clique em **Escolher saída…** e selecione o dispositivo do FxSound → as faixas locais também passam a ser roteadas para lá.

> A escolha usa `navigator.mediaDevices.selectAudioOutput()` + `AudioContext.setSinkId()` (Chrome/Edge). O seletor nativo é necessário porque, sem ele, o navegador não revela os dispositivos de saída por questão de privacidade.
>
> **No Firefox** essas APIs não existem — a página não consegue escolher a saída. Nesse caso o app mostra a instrução: **defina o FxSound como saída padrão do Windows** e o áudio do Firefox passará por ele de qualquer forma (a escolha pela página só muda as faixas locais; Spotify/YouTube sempre usam a saída padrão).

---

## 🎨 Temas lo-fi

O botão **Tema** abre um seletor de estéticas de fundo:

| Tema             | Vibe                              |
| ---------------- | --------------------------------- |
| Auto · capa      | Cores extraídas da capa (padrão)  |
| Lo-Fi Dusk       | Roxo/laranja crepuscular          |
| Vaporwave        | Rosa/ciano                        |
| Midnight Study   | Azul profundo                     |
| Forest Tape      | Verde/dourado                     |
| Sunset Cassette  | Pôr do sol quente                 |
| Mono Noir        | Monocromático                     |

Os fundos usam apenas gradientes CSS (funcionam offline). A escolha é persistida no `localStorage`. Implementado em [src/themes.ts](src/themes.ts).

---

## 🎸 Aba Zone — modo para músicos

O botão **Zone** abre uma tela dedicada a quem toca:

- **Acorde atual** — detectado ao vivo do **áudio local** (reconhecimento por croma + templates em [src/frequency-identifier.ts](src/frequency-identifier.ts)), fixado de um clique (campo harmônico/cifra) ou retomando o áudio com **↺ auto**.
- **Acordes completos para todos os instrumentos** — para violão, **guitarra** (acordes completos **+ power chords**), **ukulele**, **cavaquinho** e baixo, o app gera por **busca exaustiva no braço** ([src/chords.ts](src/chords.ts)) **todos os voicings tocáveis** (cordas soantes contíguas, baixo correto, tríade coberta, extensão ≤ 4 casas). Em instrumentos reentrantes (ukulele/cavaquinho) a regra de baixo no grave é relaxada. Um seletor **"Pos. 1 … N"** com **setas ‹ ›** escolhe qual posição ver. Teclado mostra as teclas do acorde.
- **Afinações** — seletor com Padrão, meio-tom abaixo (Eb), um tom abaixo (D), Drop D/C#/C, DADGAD, Open G e Open D. Afeta os voicings e os nomes das cordas. _(Para músicas em afinação diferente, escolha a correspondente.)_
- **Capotraste** — escolha a casa do capo; os diagramas passam a mostrar a **forma fingida a partir do capo** (o acorde alvo soa com o capo).
- **Tablatura interativa** — **grade clicável** ([src/tab.ts](src/tab.ts)): clique numa casa e digite o traste, navegue com as setas, adicione compassos/colunas. Cada casa **identifica a nota** (ciente da afinação do instrumento), mantendo o músico ciente do que executa. Um **modo texto** sincronizado importa/exporta a tab crua. (A transcrição automática do solo a partir do áudio não é possível.)
- **Exportar / Compartilhar** — baixe a **cifra**, a **tablatura** ou **ambas** como `.txt`, ou compartilhe via Web Share API.
- **Acordes completos** — o parser entende tríades, tétrades, extensões e **acordes invertidos** (`E/G#`, `Am7`, `F#m7b5`, `Dsus4/A`, `Cadd9`…).
- **Campo harmônico** — mostra os 7 acordes diatônicos do tom. Por padrão **segue o tom detectado** do áudio; desmarque "seguir áudio" para **escolher** qualquer tônica/modo. Clique num grau para ver o diagrama.
- **Letra & Cifra** — cole, digite ou **carregue um arquivo `.txt`/`.pdf`** (texto extraído com pdfjs). Linhas de acordes viram chips clicáveis; **clique numa palavra da letra para anotar acorde(s) acima dela** (vários ao mesmo tempo, separados por espaço). Clique em qualquer acorde para ver o diagrama. **Se a cifra contiver tablatura** (blocos `E|...|`, inclusive com cabeçalhos "Parte X de Y"), ela é **detectada, renderizada com identificação de nota e carregada no editor de tablatura** automaticamente. Em [src/cifra.ts](src/cifra.ts).
- **Bateria** — groove padrão em 4/4 que acompanha o metrônomo (não é a transcrição da faixa).
- **Metrônomo** — BPM manual, **tap-tempo** e **automático** (autocorrelação do áudio local). Em [src/metronome.ts](src/metronome.ts).
- **Transposição de tom** — `−`/`+` transpõem a cifra/diagramas **e** o tom do áudio local via `playbackRate` (o andamento muda junto). YouTube/Spotify: só a cifra transpõe.

> **Limites honestos:** não existe API legal/aberta de cifras prontas (CifraClub/Ultimate Guitar), por isso a detecção é feita do áudio e só funciona com **faixas locais** (YouTube/Spotify são cross-origin). Para qualquer fonte, use o editor de **Letra & Cifra**.

Controlador da aba em [src/zone.ts](src/zone.ts).

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
| `Espaço` / `F8`    | Play / Pause                |
| `Shift + →` / `F9` | Próxima faixa               |
| `Shift + ←` / `F7` | Faixa anterior              |
| `→` / `←`          | Avançar/voltar 5s (na barra)|

> `F7` / `F8` / `F9` funcionam mesmo com o foco em um campo de texto.

---

## 🗂️ Estrutura do projeto

```text
src/
├── main.ts           # controlador principal — orquestra UI, estado e módulos
├── audio-engine.ts   # motor Web Audio: HTMLAudio + EQ + grafo de nós + AnalyserNode
├── equalizer.ts      # EQ de 10 bandas + bass boost / ambience / dynamic (FxSound)
├── visualizer.ts     # espectro circular em canvas (requestAnimationFrame)
├── frequency-identifier.ts # croma + tom/escala (Krumhansl) + nota + acorde + nível
├── chords.ts         # teoria musical: acordes (slash/extensões), voicings, campo harmônico
├── metronome.ts      # metrônomo (Web Audio) + estimador de andamento (BPM)
├── cifra.ts          # editor de letra & cifra + upload .txt/.pdf (pdfjs) + tab embutida
├── tab.ts            # tablatura: parser ASCII, render com nota + editor de grade
├── onboarding.ts     # tela inicial de escolha de modo (escutar × estudar)
├── zone.ts           # aba Zone: diagramas, campo harmônico, metrônomo, transpose
├── color.ts          # extração de paleta de cores a partir da capa (no dispositivo)
├── media-session.ts  # ponte com controles de mídia do SO (MediaSession API)
├── spotify.ts        # autenticação PKCE + Web Playback SDK + busca de álbuns
├── youtube.ts        # busca (Data API v3) + IFrame Player API
├── themes.ts         # presets de tema lo-fi + aplicação
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

**Responsivo** — o layout se adapta de desktop a celular: a topbar centraliza a logo e empilha os controles, o palco vira coluna única, o equalizador vira um _bottom sheet_ rolável, a aba Zone reorganiza diagramas e cards em uma coluna, e os alvos de toque (scrubber, botões) aumentam.

Ao **girar a tela** (paisagem com pouca altura), o player não empilha: volta a **duas colunas** — vinil à esquerda, controles à direita — com a topbar em uma linha compacta e os espaçamentos verticais reduzidos, para tudo caber sem rolagem longa. Breakpoints em `880px`, `560px` e `orientation: landscape` (altura ≤ 560px).

---

## 📦 Tecnologias

| Tecnologia            | Uso                                      |
| --------------------- | ---------------------------------------- |
| TypeScript 5 (strict) | Tipagem completa, zero `any` implícito   |
| Vite 6                | Bundler, HMR, resolução de assets        |
| Web Audio API         | Grafo de áudio + AnalyserNode            |
| Canvas 2D API         | Visualizador de espectro                 |
| MediaSession API      | Controles de mídia do SO                 |
| BiquadFilter/Convolver| Equalizador + efeitos estilo FxSound     |
| Spotify Web Playback  | Streaming via Spotify Connect            |
| YouTube IFrame + Data | Busca e reprodução de vídeos             |
| CSS Custom Properties | Tematização dinâmica por faixa           |
