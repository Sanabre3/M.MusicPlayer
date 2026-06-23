import { defineConfig } from "vite";

// Relative base so the production build can be served from any path
// (e.g. opened directly, GitHub Pages, or a sub-folder).
export default defineConfig({
  base: "/",
  server: {
    open: true,
    port: 5173,
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 0, // keep the .mp3 as a real file, never inlined
  },
});
