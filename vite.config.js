import { defineConfig } from "vite";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("src", import.meta.url));
const pagesDir = resolve(srcDir, "pages");

// Vite baut im Dev-Server jede Datei live, egal ob deklariert — im
// Produktions-Build dagegen nur das, was hier als Rollup-Input steht. Ohne
// das wurden "pages/*.html" nie mitgebaut, nur index.html; main.js hat dann
// nach "/pages/dashboard.html" navigiert, das es im Build gar nicht gab.
const input = {
    index: resolve(srcDir, "index.html"),
};
for (const name of readdirSync(pagesDir)) {
    if (!name.endsWith(".html")) continue;
    input[`pages/${name.replace(/\.html$/, "")}`] = resolve(pagesDir, name);
}

export default defineConfig({
  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: { input },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
});
